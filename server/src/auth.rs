//! No accounts: OctopusVidGen runs on your own computer for one person. Every request acts as the
//! one local user (the first one in the database, made on first use), so films and projects from
//! older versions that had sign-in stay where they were.
//!
//! The server listens on 127.0.0.1 only. Don't put it on a public address: anyone who reached it
//! could start Claude jobs on your machine.

use axum::{extract::FromRequestParts, http::request::Parts, routing::get, Json, Router};
use chrono::Utc;
use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    AppState,
};

#[derive(Serialize, Clone, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub created_at: String,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/me", get(me))
}

async fn me(user: User) -> Json<User> {
    Json(user)
}

/// The one local user, created the first time it is needed.
pub async fn local_user(st: &AppState) -> AppResult<User> {
    let q = "SELECT id, email, name, created_at FROM users ORDER BY created_at LIMIT 1";
    if let Some(u) = sqlx::query_as::<_, User>(q).fetch_optional(&st.db).await? {
        return Ok(u);
    }
    let user = User {
        id: uuid::Uuid::new_v4().to_string(),
        email: "local@localhost".into(),
        name: "Local".into(),
        created_at: Utc::now().to_rfc3339(),
    };
    // password_hash stays empty: nobody signs in.
    sqlx::query("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, '', ?)")
        .bind(&user.id)
        .bind(&user.email)
        .bind(&user.name)
        .bind(&user.created_at)
        .execute(&st.db)
        .await?;
    Ok(user)
}

/// Handlers that take a `User` get the local user.
impl FromRequestParts<AppState> for User {
    type Rejection = AppError;

    async fn from_request_parts(_parts: &mut Parts, st: &AppState) -> Result<Self, Self::Rejection> {
        local_user(st).await
    }
}

/// With no sign-in, the API must only answer this computer's own pages:
/// - the Host header must be this server's local address (stops DNS rebinding from a web page);
/// - a request that changes something must carry `X-OVG-Client: 1`. Browsers only let a page send a
///   custom header to another origin after a CORS preflight, which this server never allows, so a
///   page on another site can't start films or post chat messages here;
/// - an Origin header, when present, must be this server.
pub async fn local_only(
    axum::extract::State(st): axum::extract::State<AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::{http::{header, Method, StatusCode}, response::IntoResponse};
    let port = st.cfg.port;
    let allowed = [format!("127.0.0.1:{port}"), format!("localhost:{port}"), format!("[::1]:{port}")];
    let h = req.headers();
    let host_ok = h.get(header::HOST).and_then(|v| v.to_str().ok()).is_some_and(|v| allowed.iter().any(|a| a == v));
    let origin_ok = match h.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        None => true,
        Some(o) => allowed.iter().any(|a| o == format!("http://{a}")),
    };
    let reads = matches!(*req.method(), Method::GET | Method::HEAD);
    let marked = h.get("x-ovg-client").is_some_and(|v| v == "1");
    if !host_ok || !origin_ok || (!reads && !marked) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "local requests only" }))).into_response();
    }
    next.run(req).await
}
