#!/usr/bin/env bash
# One-time setup: clone + build the OpenID conformance suite into a sibling
# directory. Idempotent — safe to re-run.
#
# The suite lives at ~/abs/conformance-suite (NOT inside ~/abs/auth so it
# doesn't pollute the package's build / lint / publish). The runner script
# (run.sh) finds it via this fixed path.
set -euo pipefail

SUITE_DIR="${SUITE_DIR:-$HOME/abs/conformance-suite}"
SUITE_REPO="https://gitlab.com/openid/conformance-suite.git"

if [ ! -d "$SUITE_DIR" ]; then
	echo "[setup] cloning $SUITE_REPO → $SUITE_DIR"
	git clone --depth=1 "$SUITE_REPO" "$SUITE_DIR"
else
	echo "[setup] $SUITE_DIR already exists; pulling latest"
	git -C "$SUITE_DIR" pull --ff-only
fi

cd "$SUITE_DIR"

if ! command -v docker >/dev/null 2>&1; then
	echo "[setup] error: docker is required" >&2
	exit 1
fi

# The suite has its own Maven Docker build target. ~15-20 min on a cold cache.
echo "[setup] building suite via mvn-docker (this can take 15+ min)…"
docker run --rm \
	-v "$SUITE_DIR":/usr/src/mymaven \
	-v "$HOME/.m2":/root/.m2 \
	-w /usr/src/mymaven \
	maven:3.9-eclipse-temurin-21 \
	mvn -B clean package -DskipTests

echo "[setup] done. Next step: ./conformance/run.sh"
