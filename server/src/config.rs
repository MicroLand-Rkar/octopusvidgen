use std::path::PathBuf;

/// Runtime settings, read from the environment (and `server/.env` if present).
#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    /// Project root (holds `engine/`, `data/`, `.claude/`).
    pub root: PathBuf,
    pub data_dir: PathBuf,
    pub engine_dir: PathBuf,
    pub claude_bin: String,
    pub claude_model: Option<String>,
    pub claude_effort: String,
    /// How many films may render at once.
    pub max_concurrent_jobs: usize,
    /// Make a placeholder test video with ffmpeg instead of calling Claude (no tokens spent).
    pub dry_run: bool,
    /// How styles that draw with an image generator get their images:
    /// "none" (default: such films can't start) or "chrome-flow" (Google Flow in the signed-in Chrome,
    /// through Claude in Chrome; a local, single-user setup only).
    pub image_tool: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let root = match std::env::var("OVG_ROOT") {
            Ok(p) => PathBuf::from(p),
            // server/ is one level below the project root
            Err(_) => std::env::current_dir()?
                .parent()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("..")),
        };
        let root = root.canonicalize()?;
        let data_dir = std::env::var("OVG_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| root.join("data"));
        std::fs::create_dir_all(data_dir.join("jobs"))?;
        let engine_dir = root.join("engine").join("lemo-opuscar");
        anyhow::ensure!(
            engine_dir.join("AGENTS.md").exists(),
            "style library not found at {}",
            engine_dir.display()
        );

        Ok(Self {
            port: env_or("PORT", "8787").parse()?,
            root,
            data_dir: data_dir.canonicalize()?,
            engine_dir,
            claude_bin: env_or("CLAUDE_BIN", "claude"),
            claude_model: std::env::var("CLAUDE_MODEL").ok().filter(|s| !s.is_empty()),
            claude_effort: env_or("CLAUDE_EFFORT", "high"),
            max_concurrent_jobs: env_or("OVG_MAX_CONCURRENT_JOBS", "1").parse()?,
            dry_run: env_flag("OVG_DRY_RUN"),
            image_tool: env_or("OVG_IMAGE_TOOL", "none"),
        })
    }

    pub fn db_url(&self) -> String {
        format!("sqlite://{}?mode=rwc", self.data_dir.join("octopus.db").display())
    }

    pub fn jobs_dir(&self) -> PathBuf {
        self.data_dir.join("jobs")
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_flag(key: &str) -> bool {
    matches!(std::env::var(key).as_deref(), Ok("1" | "true" | "yes"))
}
