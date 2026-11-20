#!/bin/sh
# OctopusVidGen setup: builds the app and the server, and installs what the film styles need.
#   sh setup.sh          everything (takes a while the first time: Python packages, a headless browser, voice models)
#   sh setup.sh app      only the web app and the server
# Needs: Rust (cargo), Node 20+, Python 3.11+, ffmpeg 7+, and Claude Code signed in (`claude`).
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1 ($2)"; exit 1; }; }
need cargo   "install Rust from https://rustup.rs"
need node    "install Node 20+"
need python3 "install Python 3.11+"
need ffmpeg  "install ffmpeg 7+"
command -v claude >/dev/null 2>&1 || echo "Note: the claude CLI is not on PATH. Install Claude Code and sign in before making films."

echo "== Skills (git submodules, from their original repositories)"
git submodule update --init --depth 1

echo "== Web app"
(cd web/app && npm install && npm run build)

echo "== Server"
[ -f server/.env ] || { cp server/.env.example server/.env; echo "Made server/.env from .env.example (dry run is on: set OVG_DRY_RUN=0 for real films)."; }
(cd server && cargo build --release)

[ "$1" = "app" ] && { echo "Done. Run: sh run.sh"; exit 0; }

echo "== Lemo-Opuscar packages (core, voice, music)"
LEMO_OPUSCAR_HOME="$ROOT/engine/lemo-opuscar" sh engine/lemo-opuscar/plugin/skills/lemo-opuscar/scripts/setup.sh deps voice music

echo "== onetake packages"
# onetake's packages (av, opencv) need Python 3.11-3.13: use the newest of those that is installed
PY=""
for v in 3.13 3.12 3.11; do command -v "python$v" >/dev/null 2>&1 && { PY="python$v"; break; }; done
[ -n "$PY" ] || { echo "Missing: Python 3.11, 3.12 or 3.13 for onetake (python3 is $(python3 --version 2>&1)). macOS: brew install python@3.13"; exit 1; }
if [ ! -x engine/onetake/.venv/bin/python ]; then
  echo "Using $PY for onetake"
  "$PY" -m venv engine/onetake/.venv
fi
engine/onetake/.venv/bin/pip install -q playwright numpy scipy Pillow matplotlib opencv-python faster-whisper
engine/onetake/.venv/bin/python -m playwright install chromium

echo "Done. Run: sh run.sh   then open http://127.0.0.1:8787"
