//! How far a film has got. Read from the agent's own log (`agent.jsonl`): each tool call is
//! sorted into a production stage, and the furthest stage reached is the current one.
//! This is an estimate from what Claude is doing, not a promise about time left.

use std::path::Path;

use axum::{
    extract::{Path as UrlPath, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::{auth::User, error::AppResult, jobs, AppState};

/// key, weight in the progress bar
const STAGES: [(&str, f64); 6] = [
    ("read", 6.0),    // read the style and its guides
    ("plan", 10.0),   // brief, treatment, decisions
    ("images", 26.0), // pictures from the image generator (only some styles)
    ("build", 28.0),  // write the scenes, sound and music in code
    ("render", 25.0), // render, look at stills, fix
    ("finish", 5.0),  // final.mp4
];

#[derive(Serialize)]
pub struct Stage {
    key: &'static str,
    /// "done" | "active" | "todo"
    state: &'static str,
}

#[derive(Serialize)]
pub struct Progress {
    stages: Vec<Stage>,
    percent: u32,
    elapsed_s: i64,
    /// Pictures made so far (styles that use an image generator).
    images: usize,
    /// Number of steps Claude has taken.
    steps: usize,
    /// What Claude is doing right now, in a few words (English, from its tool call).
    doing: String,
}

pub async fn get(State(st): State<AppState>, user: User, UrlPath(id): UrlPath<String>) -> AppResult<Json<Progress>> {
    let job = jobs::fetch(&st, &user, &id).await?;
    let needs_images = st.styles.by_slug.get(&job.style_slug).is_some_and(|s| s.needs_image_gen);
    let dir = st.cfg.jobs_dir().join(&id);
    let text = tokio::fs::read_to_string(dir.join("agent.jsonl")).await.unwrap_or_default();

    let mut reached = 0usize; // index into STAGES
    let mut in_stage = 0usize; // tool calls since the current stage began
    let mut steps = 0usize;
    let mut made_images = false;
    let mut images_closed = false;
    let mut doing = String::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if v["type"] != "assistant" {
            continue;
        }
        for c in v["message"]["content"].as_array().into_iter().flatten() {
            if c["type"] == "text" {
                if let Some(t) = c["text"].as_str().and_then(|t| t.lines().find(|l| !l.trim().is_empty())) {
                    doing = t.trim().chars().take(160).collect();
                }
                continue;
            }
            if c["type"] != "tool_use" {
                continue;
            }
            steps += 1;
            let name = c["name"].as_str().unwrap_or("");
            let input = &c["input"];
            let mut s = classify(name, input);
            if s == 2 {
                made_images = true;
                // Claude closes its Flow tabs when the pictures are all in.
                images_closed |= name.ends_with("tabs_close_mcp");
            } else if needs_images && !made_images && s > 2 {
                // Image styles set up their code before the pictures exist: that is still preparation.
                s = 1;
            } else if needs_images && made_images && !images_closed && s == 3 {
                // Small scripts run between pictures (renaming, checking) are part of making the images.
                s = 2;
            }
            if s > reached {
                reached = s;
                in_stage = 0;
            }
            in_stage += 1;
            let d = describe(name, input);
            if !d.is_empty() {
                doing = d;
            }
        }
    }
    let finished = matches!(job.status.as_str(), "succeeded" | "failed" | "canceled");
    if job.status == "succeeded" {
        reached = STAGES.len() - 1;
    }

    let images = count_images(&dir.join("film").join("gen"));
    let mut stages = Vec::new();
    let (mut total, mut done) = (0.0, 0.0);
    for (i, (key, w)) in STAGES.iter().enumerate() {
        if *key == "images" && !needs_images {
            continue;
        }
        total += w;
        let state = if job.status == "succeeded" || i < reached {
            done += w;
            "done"
        } else if i == reached && matches!(job.status.as_str(), "running" | "failed") {
            // Part-way through the stage: rises with each step, never reaching the end.
            done += w * 0.9 * (1.0 - (-(in_stage as f64) / 10.0).exp());
            "active"
        } else {
            "todo"
        };
        stages.push(Stage { key, state });
    }
    let percent = match job.status.as_str() {
        "succeeded" => 100,
        "queued" => 0,
        _ => ((done / total) * 100.0).round().clamp(1.0, 99.0) as u32,
    };

    let parse = |s: &Option<String>| s.as_deref().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Utc));
    let elapsed_s = match parse(&job.started_at) {
        Some(start) => {
            let end = if finished { parse(&job.finished_at).unwrap_or_else(Utc::now) } else { Utc::now() };
            (end - start).num_seconds().max(0)
        }
        None => 0,
    };

    Ok(Json(Progress { stages, percent, elapsed_s, images, steps, doing: if finished { String::new() } else { doing } }))
}

fn classify(name: &str, input: &serde_json::Value) -> usize {
    let path = input["file_path"].as_str().unwrap_or("").to_lowercase();
    let cmd = input["command"].as_str().unwrap_or("").to_lowercase();
    if name.starts_with("mcp__claude-in-chrome__") {
        return 2;
    }
    // A note written with a heredoc (`cat > X.md <<EOF`): planning, whatever words its text holds.
    if let Some(i) = cmd.find("cat >") {
        let target = cmd[i + 5..].trim_start().split_whitespace().next().unwrap_or("");
        if target.ends_with(".md") {
            return 1;
        }
    }
    // Writing the final file, not just looking for it.
    if cmd.contains("final.mp4") && ["cp ", "mv ", "ffmpeg", "ln "].iter().any(|k| cmd.contains(k)) && !cmd.contains("ls ") {
        return 5;
    }
    if name == "Write" || name == "Edit" {
        let file = path.rsplit('/').next().unwrap_or("");
        if ["brief.md", "treatment.md", "decisions.md", "script.md", "storyboard.md", "shotlist.md"].contains(&file) {
            return 1;
        }
        return 3;
    }
    if name == "Bash" {
        let renders = cmd.contains("core/render/")
            || cmd.contains("build.sh")
            || (cmd.contains("ffmpeg") && cmd.contains(" -i "));
        if renders {
            return 4;
        }
        // Writing or changing the film's own code, sound or pictures (not just reading or copying).
        let writes = ["cat >", "sed -i", "python", "tts", "say "].iter().any(|k| cmd.contains(k));
        let in_film = cmd.contains("/film") || cmd.starts_with("cd film");
        if writes && in_film {
            return 3;
        }
        return 0;
    }
    if name == "Read" && path.contains("/film/") && [".jpg", ".png"].iter().any(|e| path.ends_with(e)) && !path.contains("/gen/") {
        return 4;
    }
    0
}

fn describe(name: &str, input: &serde_json::Value) -> String {
    if let Some(d) = input["description"].as_str().filter(|d| !d.is_empty()) {
        return d.chars().take(90).collect();
    }
    let file = input["file_path"].as_str().and_then(|p| p.rsplit('/').next()).unwrap_or("");
    match name {
        "Write" | "Edit" => format!("writing {file}"),
        "Read" => format!("looking at {file}"),
        "Skill" => "opening the film skill".into(),
        n if n.starts_with("mcp__claude-in-chrome__") => "making pictures in Google Flow".into(),
        _ => String::new(),
    }
}

fn count_images(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|it| {
            it.filter_map(|e| e.ok())
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().to_lowercase();
                    [".png", ".jpg", ".jpeg", ".webp"].iter().any(|x| n.ends_with(x))
                })
                .count()
        })
        .unwrap_or(0)
}
