//! The chat on a film's page: the planning chat, then Claude's messages while it works, and the
//! client's replies. While the film runs, a reply answers Claude's open question (`chat/answer.md`)
//! or becomes a note it reads between stages (`chat/notes.md`). After the run has stopped, a reply
//! puts the job back in the queue and the worker resumes the same Claude session with it.

use std::path::Path;

use axum::{
    extract::{Multipart, Path as UrlPath, State},
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::{
    auth::User,
    error::{AppError, AppResult},
    jobs::{self, MAX_FILE_BYTES, MAX_TOTAL_BYTES},
    AppState,
};

#[derive(Serialize)]
pub struct Msg {
    /// "client" | "claude"
    role: &'static str,
    /// "plan" (planning chat) | "update" (Claude while working) | "question" | "note" | "answer" | "reply"
    kind: String,
    text: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    files: Vec<String>,
}

#[derive(Serialize)]
pub struct Chat {
    messages: Vec<Msg>,
    /// Claude's question that is waiting for an answer, if any.
    question: Option<String>,
}

/// A client message, kept in `chat/client.jsonl`.
#[derive(Serialize, Deserialize)]
struct ClientLine {
    t: String,
    kind: String,
    text: String,
    #[serde(default)]
    files: Vec<String>,
    /// How many of Claude's messages came before this one (to place it in the chat).
    after: usize,
}

pub async fn get(State(st): State<AppState>, user: User, UrlPath(id): UrlPath<String>) -> AppResult<Json<Chat>> {
    let job = jobs::fetch(&st, &user, &id).await?;
    let ws = st.cfg.jobs_dir().join(&id);
    let mut messages = planning_chat(&job.prompt);

    let claude = claude_messages(&ws).await;
    let client: Vec<ClientLine> = tokio::fs::read_to_string(ws.join("chat").join("client.jsonl"))
        .await
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    let mut ci = client.into_iter().peekable();
    for (i, text) in claude.into_iter().enumerate() {
        while let Some(c) = ci.next_if(|c| c.after <= i) {
            messages.push(Msg { role: "client", kind: c.kind, text: c.text, files: c.files });
        }
        messages.push(Msg { role: "claude", kind: "update".into(), text, files: vec![] });
    }
    for c in ci {
        messages.push(Msg { role: "client", kind: c.kind, text: c.text, files: c.files });
    }

    let question = open_question(&ws).await;
    Ok(Json(Chat { messages, question }))
}

/// POST: multipart with a `text` part and any number of `file` parts.
pub async fn post(State(st): State<AppState>, user: User, UrlPath(id): UrlPath<String>, mut mp: Multipart) -> AppResult<Json<Chat>> {
    let job = jobs::fetch(&st, &user, &id).await?;
    let ws = st.cfg.jobs_dir().join(&id);
    let bad = |m: &str| AppError::BadRequest(m.into());

    let mut text = String::new();
    let mut files = Vec::new();
    let mut total = 0u64;
    let dir = ws.join("inputs").join("chat");
    while let Some(mut part) = mp.next_field().await.map_err(|e| bad(&e.body_text()))? {
        match part.name().unwrap_or("") {
            "text" => text = part.text().await.map_err(|e| bad(&e.body_text()))?,
            "file" => {
                let original = part.file_name().unwrap_or("file").to_string();
                tokio::fs::create_dir_all(&dir).await.map_err(anyhow::Error::from)?;
                let n = std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0) + 1;
                let rel = format!("inputs/chat/{n:02}-{}", jobs::safe_name(&original));
                let mut out = tokio::fs::File::create(ws.join(&rel)).await.map_err(anyhow::Error::from)?;
                let mut size = 0u64;
                while let Some(chunk) = part.chunk().await.map_err(|e| bad(&e.body_text()))? {
                    size += chunk.len() as u64;
                    total += chunk.len() as u64;
                    if size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES {
                        drop(out);
                        let _ = tokio::fs::remove_file(ws.join(&rel)).await;
                        return Err(bad("files are limited to 500 MB each, 1 GB together"));
                    }
                    out.write_all(&chunk).await.map_err(anyhow::Error::from)?;
                }
                out.flush().await.map_err(anyhow::Error::from)?;
                files.push(rel);
            }
            _ => {}
        }
    }
    let text = text.trim().to_string();
    if text.is_empty() && files.is_empty() {
        return Err(bad("write something or attach a file"));
    }
    if text.chars().count() > 4000 {
        return Err(bad("keep a message under 4000 characters"));
    }

    let chat_dir = ws.join("chat");
    tokio::fs::create_dir_all(&chat_dir).await.map_err(anyhow::Error::from)?;
    let attached = if files.is_empty() { String::new() } else { format!("\n\nFiles they attached: {}", files.join(", ")) };
    let live = matches!(job.status.as_str(), "queued" | "running");
    let kind = if !live {
        // The run has stopped: queue it again; the worker resumes the session with this message.
        tokio::fs::write(chat_dir.join("resume.md"), format!("{text}{attached}")).await.map_err(anyhow::Error::from)?;
        jobs::requeue(&st, &id).await?;
        "reply"
    } else if open_question(&ws).await.is_some() {
        tokio::fs::write(chat_dir.join("answer.md"), format!("{text}{attached}\n")).await.map_err(anyhow::Error::from)?;
        "answer"
    } else {
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(chat_dir.join("notes.md"))
            .await
            .map_err(anyhow::Error::from)?;
        f.write_all(format!("\n- {} {text}{attached}\n", Utc::now().format("%H:%M")).as_bytes())
            .await
            .map_err(anyhow::Error::from)?;
        "note"
    };

    let line = ClientLine {
        t: Utc::now().to_rfc3339(),
        kind: kind.into(),
        text,
        files: files.iter().map(|f| f.rsplit('/').next().unwrap_or(f).to_string()).collect(),
        after: claude_messages(&ws).await.len(),
    };
    let mut f = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(chat_dir.join("client.jsonl"))
        .await
        .map_err(anyhow::Error::from)?;
    f.write_all(format!("{}\n", serde_json::to_string(&line).map_err(anyhow::Error::from)?).as_bytes())
        .await
        .map_err(anyhow::Error::from)?;

    get(State(st), user, UrlPath(id)).await
}

/// The planning chat, read back from the brief the form sent ("Client: …" / "Claude: …").
fn planning_chat(prompt: &str) -> Vec<Msg> {
    let Some(start) = prompt.find("The planning chat:\n") else {
        // An older film: just the client's brief.
        return vec![Msg { role: "client", kind: "plan".into(), text: prompt.trim().to_string(), files: vec![] }];
    };
    let mut out: Vec<Msg> = Vec::new();
    for line in prompt[start + "The planning chat:\n".len()..].lines() {
        if let Some(t) = line.strip_prefix("Client: ") {
            out.push(Msg { role: "client", kind: "plan".into(), text: t.to_string(), files: vec![] });
        } else if let Some(t) = line.strip_prefix("Claude: ") {
            out.push(Msg { role: "claude", kind: "plan".into(), text: t.to_string(), files: vec![] });
        } else if let Some(last) = out.last_mut() {
            last.text.push('\n');
            last.text.push_str(line);
        }
    }
    for m in &mut out {
        m.text = m.text.trim().to_string();
    }
    out
}

/// Everything Claude has said while working, in order. The run's closing summary repeats its last
/// message, so it is only added when it says something new.
async fn claude_messages(ws: &Path) -> Vec<String> {
    let text = tokio::fs::read_to_string(ws.join("agent.jsonl")).await.unwrap_or_default();
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if v["type"] == "assistant" {
            for c in v["message"]["content"].as_array().into_iter().flatten() {
                if c["type"] == "text" {
                    if let Some(t) = c["text"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
                        out.push(t.to_string());
                    }
                }
            }
        } else if v["type"] == "result" {
            if let Some(r) = v["result"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
                if out.last().map(String::as_str) != Some(r) {
                    out.push(r.to_string());
                }
            }
        }
    }
    out
}

async fn open_question(ws: &Path) -> Option<String> {
    let q = tokio::fs::read_to_string(ws.join("chat").join("question.md")).await.ok()?;
    if tokio::fs::try_exists(ws.join("chat").join("answer.md")).await.unwrap_or(false) {
        return None;
    }
    Some(q.trim().to_string()).filter(|q| !q.is_empty())
}
