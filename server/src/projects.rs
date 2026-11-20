//! Projects: folders of films (episodes) that share characters, places, look and music.
//! Each project has a folder of its own (`data/projects/<id>/`) with the series bible (`BIBLE.md`)
//! and reusable assets (`assets/`), which Claude reads before an episode and updates after it, and the
//! client's own references (`refs/`: pictures, clips, voice, music, documents), which every episode can use.

use std::path::PathBuf;

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path as UrlPath, Request, State},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use tower::ServiceExt;
use tower_http::services::ServeFile;
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    auth::User,
    error::{AppError, AppResult},
    jobs::Job,
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", get(get_one).patch(update))
        .route("/{id}/media", get(media))
        .route(
            "/{id}/refs",
            post(add_refs).layer(DefaultBodyLimit::max(crate::jobs::MAX_TOTAL_BYTES as usize + 1024 * 1024)),
        )
        .route("/{id}/refs/{name}", delete(remove_ref))
        .route("/{id}/file/{*path}", get(file))
}

/// What kind of file a name is, by its extension.
pub fn kind_of(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg" | "avif" | "heic" => "image",
        "mp4" | "mov" | "webm" | "m4v" | "mkv" => "video",
        "mp3" | "wav" | "m4a" | "aac" | "ogg" | "flac" => "audio",
        "pdf" | "txt" | "md" | "doc" | "docx" | "csv" | "xlsx" | "json" => "doc",
        _ => "other",
    }
}

#[derive(Serialize)]
struct MediaItem {
    /// Path inside the project folder: `refs/<name>` or `assets/<…>`.
    path: String,
    name: String,
    kind: &'static str,
    size: u64,
    /// RFC 3339 time the file was last changed.
    modified: String,
}

#[derive(Serialize)]
struct Media {
    /// The client's references, newest first.
    refs: Vec<MediaItem>,
    /// Pictures, clips and sound Claude made or kept for the series (code and data files left out).
    assets: Vec<MediaItem>,
}

fn item(root: &std::path::Path, path: &std::path::Path, meta: &std::fs::Metadata) -> MediaItem {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let modified = meta
        .modified()
        .ok()
        .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
        .unwrap_or_default();
    MediaItem {
        path: path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/"),
        kind: kind_of(&name),
        name,
        size: meta.len(),
        modified,
    }
}

async fn media(State(st): State<AppState>, user: User, UrlPath(id): UrlPath<String>) -> AppResult<Json<Media>> {
    fetch(&st, &user, &id).await?;
    let root = dir(&st, &id);
    let out = tokio::task::spawn_blocking(move || {
        let mut refs = Vec::new();
        if let Ok(it) = std::fs::read_dir(root.join("refs")) {
            for e in it.flatten() {
                if let Ok(m) = e.metadata() {
                    if m.is_file() && !e.file_name().to_string_lossy().starts_with('.') {
                        refs.push(item(&root, &e.path(), &m));
                    }
                }
            }
        }
        refs.sort_by(|a, b| b.modified.cmp(&a.modified));
        let mut assets = Vec::new();
        let mut stack = vec![(root.join("assets"), 0)];
        while let Some((d, depth)) = stack.pop() {
            let Ok(it) = std::fs::read_dir(&d) else { continue };
            for e in it.flatten() {
                let Ok(m) = e.metadata() else { continue };
                if e.file_name().to_string_lossy().starts_with('.') {
                    continue;
                }
                if m.is_dir() && depth < 4 {
                    stack.push((e.path(), depth + 1));
                } else if m.is_file() && matches!(kind_of(&e.file_name().to_string_lossy()), "image" | "video" | "audio") {
                    assets.push(item(&root, &e.path(), &m));
                }
            }
        }
        assets.sort_by(|a, b| b.modified.cmp(&a.modified));
        assets.truncate(400);
        Media { refs, assets }
    })
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(out))
}

/// POST: multipart, any number of `file` parts, saved to the project's `refs/`.
async fn add_refs(State(st): State<AppState>, user: User, UrlPath(id): UrlPath<String>, mut mp: Multipart) -> AppResult<Json<Vec<String>>> {
    fetch(&st, &user, &id).await?;
    let bad = |m: &str| AppError::BadRequest(m.into());
    let refs = dir(&st, &id).join("refs");
    tokio::fs::create_dir_all(&refs).await.map_err(anyhow::Error::from)?;
    let mut saved = Vec::new();
    let mut total = 0u64;
    while let Some(mut part) = mp.next_field().await.map_err(|e| bad(&e.body_text()))? {
        if part.name() != Some("file") {
            return Err(bad("unexpected form part"));
        }
        let clean = crate::jobs::safe_name(part.file_name().unwrap_or("file"));
        // Never overwrite: a second "photo.jpg" becomes "photo-2.jpg".
        let mut name = clean.clone();
        let mut n = 2;
        while tokio::fs::try_exists(refs.join(&name)).await.unwrap_or(false) {
            name = match clean.rsplit_once('.') {
                Some((stem, ext)) => format!("{stem}-{n}.{ext}"),
                None => format!("{clean}-{n}"),
            };
            n += 1;
        }
        let path = refs.join(&name);
        let mut out = tokio::fs::File::create(&path).await.map_err(anyhow::Error::from)?;
        let mut size = 0u64;
        while let Some(chunk) = part.chunk().await.map_err(|e| bad(&e.body_text()))? {
            size += chunk.len() as u64;
            total += chunk.len() as u64;
            if size > crate::jobs::MAX_FILE_BYTES || total > crate::jobs::MAX_TOTAL_BYTES {
                drop(out);
                let _ = tokio::fs::remove_file(&path).await;
                return Err(bad("files are limited to 500 MB each"));
            }
            tokio::io::AsyncWriteExt::write_all(&mut out, &chunk).await.map_err(anyhow::Error::from)?;
        }
        saved.push(name);
    }
    Ok(Json(saved))
}

async fn remove_ref(State(st): State<AppState>, user: User, UrlPath((id, name)): UrlPath<(String, String)>) -> AppResult<Json<serde_json::Value>> {
    fetch(&st, &user, &id).await?;
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\']) || name.contains("..") {
        return Err(AppError::NotFound);
    }
    let path = dir(&st, &id).join("refs").join(&name);
    tokio::fs::remove_file(&path).await.map_err(|_| AppError::NotFound)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// A file from the project's `refs/` or `assets/` (Range requests work, so clips can seek).
async fn file(State(st): State<AppState>, user: User, UrlPath((id, path)): UrlPath<(String, String)>, req: Request) -> AppResult<Response> {
    fetch(&st, &user, &id).await?;
    let ok_root = path.starts_with("refs/") || path.starts_with("assets/");
    if !ok_root || path.split('/').any(|p| p.is_empty() || p == ".." || p.starts_with('.')) {
        return Err(AppError::NotFound);
    }
    let root = dir(&st, &id).canonicalize().map_err(|_| AppError::NotFound)?;
    let full = root.join(&path).canonicalize().map_err(|_| AppError::NotFound)?;
    if !full.starts_with(&root) || !full.is_file() {
        return Err(AppError::NotFound);
    }
    let res = ServeFile::new(full).oneshot(req).await.map_err(|e| anyhow::anyhow!(e))?;
    Ok(res.map(axum::body::Body::new).into_response())
}

#[derive(Serialize, Clone, sqlx::FromRow)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
}

#[derive(Serialize)]
struct ProjectCard {
    #[serde(flatten)]
    project: Project,
    episodes: i64,
    /// The newest episode, for the folder's cover and style.
    latest_job_id: Option<String>,
    latest_style: Option<String>,
    latest_has_video: bool,
    updated_at: String,
}

#[derive(Serialize)]
struct ProjectDetail {
    #[serde(flatten)]
    project: Project,
    /// The series bible Claude keeps for this project (empty until the first episode is made).
    bible: String,
    /// File names in the project's shared assets folder.
    assets: Vec<String>,
}

#[derive(Deserialize)]
struct ProjectReq {
    name: String,
    #[serde(default)]
    description: String,
}

pub fn dir(st: &AppState, id: &str) -> PathBuf {
    st.cfg.data_dir.join("projects").join(id)
}

pub async fn fetch(st: &AppState, user: &User, id: &str) -> AppResult<Project> {
    sqlx::query_as("SELECT id, name, description, created_at FROM projects WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(&user.id)
        .fetch_optional(&st.db)
        .await?
        .ok_or(AppError::NotFound)
}

fn check(req: &ProjectReq) -> AppResult<(String, String)> {
    let name = req.name.trim().to_string();
    let description = req.description.trim().to_string();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::BadRequest("give the project a name (up to 80 characters)".into()));
    }
    if description.chars().count() > 2000 {
        return Err(AppError::BadRequest("keep the description under 2000 characters".into()));
    }
    Ok((name, description))
}

async fn list(State(st): State<AppState>, user: User) -> AppResult<Json<Vec<ProjectCard>>> {
    let projects: Vec<Project> =
        sqlx::query_as("SELECT id, name, description, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC")
            .bind(&user.id)
            .fetch_all(&st.db)
            .await?;
    let mut out = Vec::new();
    for p in projects {
        let (episodes,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM jobs WHERE project_id = ?")
            .bind(&p.id)
            .fetch_one(&st.db)
            .await?;
        let latest: Option<(String, String, Option<String>, String)> = sqlx::query_as(
            "SELECT id, style_slug, video_path, created_at FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(&p.id)
        .fetch_optional(&st.db)
        .await?;
        let updated_at = latest.as_ref().map(|l| l.3.clone()).unwrap_or_else(|| p.created_at.clone());
        out.push(ProjectCard {
            episodes,
            latest_job_id: latest.as_ref().map(|l| l.0.clone()),
            latest_style: latest.as_ref().map(|l| l.1.clone()),
            latest_has_video: latest.as_ref().is_some_and(|l| l.2.is_some()),
            updated_at,
            project: p,
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(Json(out))
}

async fn create(State(st): State<AppState>, user: User, Json(req): Json<ProjectReq>) -> AppResult<Json<Project>> {
    let (name, description) = check(&req)?;
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO projects (id, user_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(&user.id)
        .bind(&name)
        .bind(&description)
        .bind(Utc::now().to_rfc3339())
        .execute(&st.db)
        .await?;
    tokio::fs::create_dir_all(dir(&st, &id).join("assets")).await.map_err(anyhow::Error::from)?;
    Ok(Json(fetch(&st, &user, &id).await?))
}

async fn get_one(State(st): State<AppState>, user: User, UrlPath(id): UrlPath<String>) -> AppResult<Json<ProjectDetail>> {
    let project = fetch(&st, &user, &id).await?;
    let d = dir(&st, &id);
    let bible = tokio::fs::read_to_string(d.join("BIBLE.md")).await.unwrap_or_default();
    let mut assets: Vec<String> = std::fs::read_dir(d.join("assets"))
        .map(|it| it.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default();
    assets.sort();
    Ok(Json(ProjectDetail { project, bible, assets }))
}

async fn update(State(st): State<AppState>, user: User, UrlPath(id): UrlPath<String>, Json(req): Json<ProjectReq>) -> AppResult<Json<Project>> {
    fetch(&st, &user, &id).await?;
    let (name, description) = check(&req)?;
    sqlx::query("UPDATE projects SET name = ?, description = ? WHERE id = ?")
        .bind(&name)
        .bind(&description)
        .bind(&id)
        .execute(&st.db)
        .await?;
    Ok(Json(fetch(&st, &user, &id).await?))
}

/// What an episode needs to know about its series.
pub struct EpisodeCtx {
    pub name: String,
    pub description: String,
    pub dir: PathBuf,
    /// 1-based position of this film in the project.
    pub number: usize,
    /// Earlier episodes: (number, title, workspace folder).
    pub earlier: Vec<(usize, String, PathBuf)>,
    pub bible: String,
}

/// The series context for a film, if it belongs to a project. No user check: used by the worker
/// and by handlers that have already checked the film is the user's.
pub async fn episode_ctx(st: &AppState, job: &Job) -> Option<EpisodeCtx> {
    let pid = job.project_id.as_deref()?;
    let p: Project = sqlx::query_as("SELECT id, name, description, created_at FROM projects WHERE id = ?")
        .bind(pid)
        .fetch_optional(&st.db)
        .await
        .ok()??;
    let eps: Vec<(String, String)> = sqlx::query_as("SELECT id, prompt FROM jobs WHERE project_id = ? ORDER BY created_at")
        .bind(pid)
        .fetch_all(&st.db)
        .await
        .ok()?;
    let number = eps.iter().position(|(id, _)| id == &job.id).map(|i| i + 1).unwrap_or(eps.len() + 1);
    let earlier = eps
        .iter()
        .enumerate()
        .take(number.saturating_sub(1))
        .map(|(i, (id, prompt))| (i + 1, title(prompt), st.cfg.jobs_dir().join(id)))
        .collect();
    let d = dir(st, pid);
    let _ = tokio::fs::create_dir_all(d.join("assets")).await;
    let bible = tokio::fs::read_to_string(d.join("BIBLE.md")).await.unwrap_or_default();
    Some(EpisodeCtx { name: p.name, description: p.description, dir: d, number, earlier, bible })
}

/// A short title for a film: the client's first chat message, else the brief's first line.
pub fn title(prompt: &str) -> String {
    let t = prompt
        .lines()
        .find_map(|l| l.strip_prefix("Client: "))
        .unwrap_or_else(|| prompt.lines().next().unwrap_or(""))
        .trim();
    if t.chars().count() > 90 {
        t.chars().take(90).collect::<String>() + "…"
    } else {
        t.to_string()
    }
}

/// The part of a brief (or planning prompt) that tells Claude about the series.
pub fn series_text(ep: &EpisodeCtx, for_planning: bool) -> String {
    let mut s = format!(
        "Series: this film is episode {n} of the client's project \"{name}\".{desc}\n",
        n = ep.number,
        name = ep.name,
        desc = if ep.description.is_empty() { String::new() } else { format!(" About the project: {}", ep.description) },
    );
    if ep.earlier.is_empty() {
        s.push_str("It is the first episode, so it sets the characters, places, look and music the later episodes will reuse.\n");
    } else {
        s.push_str("Earlier episodes:\n");
        let recent = ep.earlier.len().saturating_sub(3);
        for (i, (n, t, ws)) in ep.earlier.iter().enumerate() {
            if for_planning {
                s.push_str(&format!("- Episode {n}: {t}\n"));
                // Without a bible yet, the last few episodes' own briefs carry the continuity.
                if ep.bible.trim().is_empty() && i >= recent {
                    if let Ok(b) = std::fs::read_to_string(ws.join("film").join("BRIEF.md")) {
                        let b: String = b.chars().take(1500).collect();
                        s.push_str(&format!("  <episode-{n}-brief>\n{b}\n  </episode-{n}-brief>\n"));
                    }
                }
            } else {
                s.push_str(&format!("- Episode {n}: {t} (folder `{}`)\n", ws.display()));
            }
        }
    }
    let refs: Vec<String> = std::fs::read_dir(ep.dir.join("refs"))
        .map(|it| it.flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| !n.starts_with('.')).collect())
        .unwrap_or_default();
    if !refs.is_empty() {
        let mut refs = refs;
        refs.sort();
        let shown: Vec<String> = refs.iter().take(60).map(|n| format!("{n} ({})", kind_of(n))).collect();
        if for_planning {
            s.push_str(&format!(
                "\nThe client's reference files for this project (pictures, clips, sound, documents they collected for it): {}{}\n",
                shown.join(", "),
                if refs.len() > 60 { ", …" } else { "" }
            ));
        } else {
            s.push_str(&format!(
                "\nThe client's reference files for this project are in `{}`: {}{}. Look at the ones that matter for this \
                 episode (characters, places, products, logos, voice, music, footage) and use them as the client would expect: \
                 as the look to match, as material in the film, or as facts. Don't change or delete them.\n",
                ep.dir.join("refs").display(),
                shown.join(", "),
                if refs.len() > 60 { ", …" } else { "" }
            ));
        }
    }
    if !ep.bible.trim().is_empty() {
        let bible: String = ep.bible.chars().take(8000).collect();
        s.push_str(&format!("\nThe series bible (characters, places, look, music) so far:\n<bible>\n{bible}\n</bible>\n"));
    }
    s
}

/// The series context for the next episode, while it is being planned.
pub async fn next_episode_ctx(st: &AppState, user: &User, pid: &str) -> AppResult<EpisodeCtx> {
    let p = fetch(st, user, pid).await?;
    let eps: Vec<(String, String)> = sqlx::query_as("SELECT id, prompt FROM jobs WHERE project_id = ? ORDER BY created_at")
        .bind(pid)
        .fetch_all(&st.db)
        .await?;
    let d = dir(st, pid);
    Ok(EpisodeCtx {
        name: p.name,
        description: p.description,
        number: eps.len() + 1,
        earlier: eps
            .iter()
            .enumerate()
            .map(|(i, (id, prompt))| (i + 1, title(prompt), st.cfg.jobs_dir().join(id)))
            .collect(),
        bible: tokio::fs::read_to_string(d.join("BIBLE.md")).await.unwrap_or_default(),
        dir: d,
    })
}
