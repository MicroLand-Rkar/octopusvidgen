#!/bin/sh
# Update OctopusVidGen and every skill to the latest version of its original repository, then rebuild.
#   sh update.sh          pull this repo, move each skill in engine/ to its upstream's newest commit, rebuild
# The skills are git submodules (see .gitmodules): their code always comes from the original authors.
set -e
cd "$(dirname "$0")"

echo "== OctopusVidGen"
git pull --ff-only || echo "(could not fast-forward this repo; skipping)"

echo "== Skills"
git submodule sync --quiet
git submodule update --init --remote --depth 1
git submodule foreach --quiet 'echo "  $name  $(git log -1 --format="%h %cs %s" | cut -c1-80)"'

echo "== Packages the styles need (only what changed)"
LEMO_OPUSCAR_HOME="$PWD/engine/lemo-opuscar" sh engine/lemo-opuscar/plugin/skills/lemo-opuscar/scripts/setup.sh deps voice music || true

echo "== App and server"
(cd web/app && npm install --silent && npm run build)
(cd server && cargo build --release)

echo "Done. Restart with: sh run.sh"
echo "To keep these skill versions in your own fork: git add engine && git commit -m 'Update skills'"
