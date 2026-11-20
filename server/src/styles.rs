//! The style catalogue, read once at startup from the bundled Lemo-Opuscar library.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    extract::{Path as UrlPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    AppState,
};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Style {
    pub slug: String,
    #[serde(default)]
    pub num: String,
    pub en: String,
    #[serde(default)]
    pub cn: String,
    #[serde(default)]
    pub category_en: String,
    #[serde(default)]
    pub film: String,
    #[serde(default)]
    pub line: String,
    #[serde(default)]
    pub uses: Vec<String>,
    #[serde(default)]
    pub dur: f64,
    /// Filled in by the server: whether a poster image is available.
    #[serde(default)]
    pub has_poster: bool,
    /// Styles marked ✦ need an external image generator; we flag them so the UI can say so.
    #[serde(default)]
    pub needs_image_gen: bool,
    /// From style.json: e.g. ["image-generation"].
    #[serde(default)]
    pub needs: Vec<String>,
    /// Filled in by the server from style_inputs.json: what the user can bring for this style.
    #[serde(default)]
    pub inputs: StyleInputs,
    /// Filled in by the server from style_examples_my.json: sample wishes, in Burmese, for the brief box.
    #[serde(default)]
    pub examples: Vec<String>,
    /// Set per request for styles that need generated images: how this server makes them
    /// ("chrome-flow" = Google Flow through Claude in Chrome, "none" = not set up). Empty otherwise.
    #[serde(default)]
    pub image_tool: String,
    /// The skill that makes films in this style (a folder under `.claude/skills/`).
    #[serde(default = "default_skill")]
    pub skill: String,
    /// Licence terms to show with the style when they limit its use (e.g. noncommercial only).
    #[serde(default)]
    pub license: String,
    /// For a style from a multi-style skill (anidoodle): that skill's own name for the style.
    #[serde(default)]
    pub engine_style: String,
    /// Where the style's own files are (style.json, poster.jpg, STYLE.md).
    #[serde(skip)]
    pub dir: PathBuf,
}

fn default_skill() -> String {
    "lemo-opuscar".into()
}

impl Style {
    /// What the planning chat reads to know the style: the library's STYLE.md, or for a style
    /// from another skill, that skill's SKILL.md and style notes.
    pub fn guide(&self, skills_dir: &Path) -> String {
        if self.skill == "lemo-opuscar" {
            return std::fs::read_to_string(self.dir.join("STYLE.md")).unwrap_or_default();
        }
        let root = skills_dir.join(&self.skill);
        ["SKILL.md", "references/style.md"]
            .iter()
            .filter_map(|f| std::fs::read_to_string(root.join(f)).ok())
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

/// One thing a user can supply with their brief (a file set, a line of text or a link).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InputField {
    pub key: String,
    pub label: String,
    /// "files" | "text" | "url"
    pub kind: String,
    #[serde(default)]
    pub accept: String,
    #[serde(default)]
    pub max_files: Option<u32>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub hint: String,
    /// Set by the server: one of the fields every style takes (voice, music, photos, logo).
    #[serde(default)]
    pub common: bool,
    /// Set by the server from ui_my.json: the label and hint in Burmese, for the form.
    #[serde(default)]
    pub label_my: String,
    #[serde(default)]
    pub hint_my: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StyleInputs {
    /// "none" | "optional" | "required": whether the style is built from real-world material.
    pub material: String,
    /// Whether the agent can find material itself when the user gives none.
    pub agent_can_source: bool,
    /// Common fields first, then the style's own.
    pub fields: Vec<InputField>,
    pub note: String,
    /// Set by the server from ui_my.json.
    #[serde(default)]
    pub note_my: String,
}

impl Default for StyleInputs {
    fn default() -> Self {
        Self { material: "none".into(), agent_can_source: false, fields: Vec::new(), note: String::new(), note_my: String::new() }
    }
}

#[derive(Deserialize, Default)]
struct InputsFile {
    #[serde(default)]
    common: Vec<InputField>,
    #[serde(default)]
    styles: HashMap<String, StyleInputs>,
}

impl InputField {
    /// Whether a file name's extension is one this field takes (accept lists MIME types and/or extensions).
    pub fn accepts_file(&self, name: &str) -> bool {
        if self.accept.trim().is_empty() {
            return true;
        }
        let ext = Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        self.accept.split(',').map(str::trim).filter(|a| !a.is_empty()).any(|a| {
            let a = a.to_lowercase();
            if let Some(e) = a.strip_prefix('.') {
                e == ext
            } else if let Some(group) = a.strip_suffix("/*") {
                mime_group(&ext) == Some(group)
            } else {
                mime_ext(&a).contains(&ext.as_str())
            }
        })
    }
}

fn mime_group(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "heic" | "tif" | "tiff" | "svg" | "bmp" => "image",
        "mp4" | "mov" | "m4v" | "webm" | "mkv" | "avi" | "mpeg" | "mpg" | "ogv" => "video",
        "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" | "opus" | "aiff" | "aif" => "audio",
        "txt" | "csv" | "md" | "srt" | "vtt" => "text",
        _ => return None,
    })
}

fn mime_ext(mime: &str) -> &'static [&'static str] {
    match mime {
        "application/pdf" => &["pdf"],
        "application/json" | "text/json" => &["json", "geojson"],
        "text/csv" => &["csv"],
        "text/plain" => &["txt", "md"],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.ms-excel" => &["xlsx", "xls"],
        "image/jpeg" => &["jpg", "jpeg"],
        "image/png" => &["png"],
        "image/svg+xml" => &["svg"],
        "image/webp" => &["webp"],
        "video/mp4" => &["mp4", "m4v"],
        "video/quicktime" => &["mov"],
        "audio/mpeg" => &["mp3"],
        "audio/wav" | "audio/x-wav" => &["wav"],
        "font/ttf" => &["ttf"],
        "font/otf" => &["otf"],
        "model/gltf-binary" => &["glb"],
        "model/stl" => &["stl"],
        "application/zip" => &["zip"],
        _ => &[],
    }
}

#[derive(Clone, Default)]
pub struct Catalog {
    pub list: Arc<Vec<Style>>,
    pub by_slug: Arc<HashMap<String, Style>>,
}

impl Catalog {
    pub fn load(engine_dir: &Path, extra_dir: &Path, inputs_path: &Path) -> anyhow::Result<Self> {
        let inputs: InputsFile = match std::fs::read_to_string(inputs_path) {
            Ok(t) => serde_json::from_str(&t)?,
            Err(_) => {
                tracing::warn!("no {} yet: styles take only the brief", inputs_path.display());
                InputsFile::default()
            }
        };
        let examples: HashMap<String, Vec<String>> =
            std::fs::read_to_string(inputs_path.with_file_name("style_examples_my.json"))
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or_default();
        let my: HashMap<String, String> = std::fs::read_to_string(inputs_path.with_file_name("ui_my.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let tr = |en: &str| my.get(en).cloned().unwrap_or_default();
        let styles_dir = engine_dir.join("styles");
        let readme = std::fs::read_to_string(styles_dir.join("README.md")).unwrap_or_default();
        let mut list = Vec::new();
        // The library's styles, then styles from other skills.
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(&styles_dir)?.filter_map(|e| e.ok().map(|e| e.path())).collect();
        if let Ok(extra) = std::fs::read_dir(extra_dir) {
            dirs.extend(extra.filter_map(|e| e.ok().map(|e| e.path())));
        }
        for dir in dirs {
            if dir.file_name().is_some_and(|n| n.to_string_lossy().starts_with('_')) {
                continue; // _template
            }
            let meta = dir.join("style.json");
            if !meta.exists() {
                continue; // README.md, _template
            }
            let mut s: Style = serde_json::from_str(&std::fs::read_to_string(&meta)?)?;
            s.has_poster = dir.join("poster.jpg").exists();
            s.dir = dir.clone();
            s.needs_image_gen = s.needs.iter().any(|n| n == "image-generation")
                || readme.lines().any(|l| l.contains(&format!("[`{}`]", s.slug)) && l.contains('✦'));
            let mut si = inputs.styles.get(&s.slug).cloned().unwrap_or_default();
            let own = std::mem::take(&mut si.fields);
            si.fields = inputs
                .common
                .iter()
                .cloned()
                .map(|mut f| {
                    f.common = true;
                    f
                })
                .chain(own.into_iter().map(|mut f| {
                    f.common = false;
                    f
                }))
                .collect();
            si.note_my = tr(&si.note);
            for f in &mut si.fields {
                f.label_my = tr(&f.label);
                f.hint_my = tr(&f.hint);
            }
            s.inputs = si;
            s.examples = examples.get(&s.slug).cloned().unwrap_or_default();
            list.push(s);
        }
        list.sort_by(|a, b| a.category_en.cmp(&b.category_en).then(a.num.cmp(&b.num)));
        let by_slug = list.iter().map(|s| (s.slug.clone(), s.clone())).collect();
        tracing::info!("loaded {} styles", list.len());
        Ok(Self { list: Arc::new(list), by_slug: Arc::new(by_slug) })
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list))
        .route("/{slug}/poster", get(poster))
}

async fn list(State(st): State<AppState>) -> Json<Vec<Style>> {
    let mut list = st.styles.list.as_ref().clone();
    for s in list.iter_mut().filter(|s| s.needs_image_gen) {
        s.image_tool = st.cfg.image_tool.clone();
    }
    Json(list)
}

async fn poster(State(st): State<AppState>, UrlPath(slug): UrlPath<String>) -> AppResult<Response> {
    // Only slugs from the catalogue reach the filesystem.
    let style = st.styles.by_slug.get(&slug).ok_or(AppError::NotFound)?;
    let path = style.dir.join("poster.jpg");
    let bytes = tokio::fs::read(&path).await.map_err(|_| AppError::NotFound)?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "image/jpeg"), (header::CACHE_CONTROL, "public, max-age=86400")],
        bytes,
    )
        .into_response())
}
