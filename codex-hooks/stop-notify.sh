#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

PAYLOAD="$(codex_hooks_load_payload "$@" || true)"
if [ -z "$PAYLOAD" ]; then
  codex_hooks_log "stop skipped: empty payload"
  exit 0
fi

codex_hooks_post_payload "$PAYLOAD" || exit 0
codex_hooks_log "stop completed"
