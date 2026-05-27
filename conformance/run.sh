#!/usr/bin/env bash
# Boots the OpenID conformance suite via docker-compose, against a target
# issuer URL passed in via TARGET_ISSUER. The suite UI is served on
# https://localhost:8443; results land in MongoDB inside the compose stack
# (persists across runs unless you `docker-compose down -v`).
#
# Prerequisites:
#   1. ./conformance/setup.sh has run (clones + builds the suite)
#   2. TARGET_ISSUER points at a reachable HTTPS URL that serves
#      /.well-known/openid-configuration
#   3. Docker daemon is up
set -euo pipefail

SUITE_DIR="${SUITE_DIR:-$HOME/abs/conformance-suite}"
TARGET_ISSUER="${TARGET_ISSUER:-}"

if [ -z "$TARGET_ISSUER" ]; then
	echo "[run] error: set TARGET_ISSUER, e.g.:" >&2
	echo "      TARGET_ISSUER=https://auth.absolutejs.com ./conformance/run.sh" >&2
	exit 1
fi

if [ ! -d "$SUITE_DIR" ]; then
	echo "[run] error: $SUITE_DIR does not exist; run ./conformance/setup.sh first" >&2
	exit 1
fi

echo "[run] target: $TARGET_ISSUER"
echo "[run] sanity-check the discovery doc is reachable…"
if ! curl -fsSLI "$TARGET_ISSUER/.well-known/openid-configuration" >/dev/null; then
	echo "[run] error: $TARGET_ISSUER/.well-known/openid-configuration is unreachable" >&2
	exit 1
fi
echo "[run] ✓ discovery reachable"

cd "$SUITE_DIR"

echo "[run] starting docker-compose stack…"
docker compose up -d

echo
echo "[run] ✓ suite is up at https://localhost:8443"
echo
echo "Next:"
echo "  1. open https://localhost:8443/ (accept the self-signed cert)"
echo "  2. create a test plan from the catalog, e.g.:"
echo "       oidcc-basic-certification-test-plan"
echo "       oidcc-formpost-basic-certification-test-plan"
echo "       oidcc-config-certification-test-plan"
echo "       oidcc-dynamic-certification-test-plan"
echo "       oidcc-rp-initiated-logout-certification-test-plan"
echo "  3. set 'discoveryUrl' = $TARGET_ISSUER/.well-known/openid-configuration"
echo "  4. run the plan; the suite walks the OP through ~50-150 test cases"
echo
echo "To stop:    docker compose -f $SUITE_DIR/docker-compose.yml down"
echo "Wipe data:  docker compose -f $SUITE_DIR/docker-compose.yml down -v"
