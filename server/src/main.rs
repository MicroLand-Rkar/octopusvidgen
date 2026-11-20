mod auth;
mod chat;
mod config;
mod error;
mod jobs;
mod plan;
mod progress;
mod projects;
mod styles;

use std::{str::FromStr, sync::Arc};

use axum::{routing::get, Json, Router};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub cfg: Arc<config::Config>,
    pub styles: styles::Catalog,
    pub runner: jobs::Runner,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "octopus_server=info,tower_http=info".into()))
        .init();

    let cfg = config::Config::from_env()?;
    let opts = SqliteConnectOptions::from_str(&cfg.db_url())?
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);
    let db = SqlitePoolOptions::new().max_connections(8).connect_with(opts).await?;
    sqlx::migrate!("./migrations").run(&db).await?;

    let state = AppState {
        styles: styles::Catalog::load(
            &cfg.engine_dir,
            &cfg.root.join("engine").join("extra-styles"),
            &cfg.root.join("server").join("style_inputs.json"),
        )?,
        cfg: Arc::new(cfg.clone()),
        db,
        runner: jobs::Runner::default(),
    };
    jobs::start_worker(state.clone()).await?;

    let api = Router::new()
        .route("/health", get(|| async { Json(serde_json::json!({ "ok": true })) }))
        .nest("/auth", auth::routes())
        .nest("/styles", styles::routes())
        .nest("/jobs", jobs::routes())
        .nest("/plan", plan::routes())
        .nest("/projects", projects::routes())
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth::local_only));

    // The React app (web/app, built to web/app/dist) under /app, any unknown path falling back to its
    // index.html so client routes load; the static landing page (web/landing) at everything else.
    let dist = cfg.root.join("web").join("app").join("dist");
    let spa = ServeDir::new(&dist).fallback(ServeFile::new(dist.join("index.html")));
    let landing = ServeDir::new(cfg.root.join("web").join("landing"));

    let app = Router::new()
        .nest("/api", api)
        .nest_service("/app", spa)
        .fallback_service(landing)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], cfg.port));
    tracing::info!(
        "OctopusVidGen API on http://{addr} (dry run: {}, workers: {}, images: {})",
        cfg.dry_run,
        cfg.max_concurrent_jobs,
        cfg.image_tool
    );
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
