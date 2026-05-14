#!/usr/bin/env bash
set -euo pipefail

SOCK="$HOME/.ssh/ssh_auth_sock"
KEY="$HOME/.ssh/id_ed25519"
LOCK="$HOME/.ssh/.ssh_auth_sock.lock"

if [ ! -f "$KEY" ]; then
  echo "missing signing key: $KEY" >&2
  exit 1
fi

if [ ! -f "$KEY.pub" ]; then
  echo "missing signing public key: $KEY.pub" >&2
  exit 1
fi

fingerprint="$(ssh-keygen -lf "$KEY.pub" | awk '{print $2}')"
if [ -z "$fingerprint" ]; then
  echo "unable to read signing key fingerprint: $KEY.pub" >&2
  exit 1
fi

agent_is_valid() {
  [ -S "$SOCK" ] || return 1
  [ ! -L "$SOCK" ] || return 1
  SSH_AUTH_SOCK="$SOCK" ssh-add -l | grep -Fq "$fingerprint"
}

agent_is_valid && exit 0

mkdir -p "$(dirname "$SOCK")"

(
  flock 9

  agent_is_valid && exit 0

  rm -f "$SOCK"
  ssh-agent -a "$SOCK" >/dev/null
  SSH_AUTH_SOCK="$SOCK" ssh-add "$KEY"

  if ! agent_is_valid; then
    echo "failed to initialize local signing agent: $SOCK" >&2
    exit 1
  fi
) 9>"$LOCK"
