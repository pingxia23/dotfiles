# Workspace indicator
if [ -n "$WORKSPACE_NAME" ]; then
  export PS1="[ws:${WORKSPACE_NAME}] $PS1"
fi

# Editor
export EDITOR='vim'

# Aliases
alias ls='ls --color=auto'
alias k="kubectl"

# Go setup
export GOPATH="$HOME/go"
export PATH="$GOPATH/bin:$PATH"
export DATADOG_ROOT="$HOME/dd"
export DD_SOURCE_ROOT="$HOME/dd/dd-source"
export GO111MODULE=auto
export GOPRIVATE=github.com/DataDog
export GOPROXY=binaries.ddbuild.io,https://proxy.golang.org,direct
export GONOSUMDB=github.com/DataDog,go.ddbuild.io

# Devtools
export PATH="$HOME/dd/devtools/bin:$PATH"

# AWS session config
export AWS_SESSION_TTL=24h
export AWS_ASSUME_ROLE_TTL=1h
export HELM_DRIVER=configmap

# direnv (if available)
if command -v direnv >/dev/null 2>&1; then
  eval "$(direnv hook zsh)"
fi

# pyenv (if available)
if command -v pyenv >/dev/null 2>&1; then
  eval "$(pyenv init -)"
fi

# nvm (if available)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Cargo/Rust (if available)
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

# uv (Python package manager) - adds ~/.local/bin to PATH
export PATH="$HOME/.local/bin:$PATH"

alias claude_normal="ddtool auth login --datacenter us1.ddbuild.io && claude --effort medium --allow-dangerously-skip-permissions"
alias claude_high="ddtool auth login --datacenter us1.ddbuild.io && claude --effort high --allow-dangerously-skip-permissions"
alias claude_max="ddtool auth login --datacenter us1.ddbuild.io && claude --effort max --allow-dangerously-skip-permissions"

alias codex_normal="ddtool auth login --datacenter us1.ddbuild.io && codex -c 'model_reasoning_effort=\"medium\"' --dangerously-bypass-approvals-and-sandbox"
alias codex_high="ddtool auth login --datacenter us1.ddbuild.io && codex -c 'model_reasoning_effort=\"high\"' --dangerously-bypass-approvals-and-sandbox"
alias codex_xhigh="ddtool auth login --datacenter us1.ddbuild.io && codex -c 'model_reasoning_effort=\"xhigh\"' --dangerously-bypass-approvals-and-sandbox"

export MCP_OAUTH_CALLBACK_PORT=41111

# Trigger tribunal cron jobs with correct kube_cronjob tag
trigger-tribunal() {
  local experiment="${1:?Usage: trigger-tribunal <experiment-name>}"
  local cronjob="assistant-evaluation-tribunal-${experiment}"
  local job_name="tribunal-${experiment}-$(date +%s | tail -c 5)"  # Short name to fit 63 char limit
  local context="general2.us1.prod.dog"
  local namespace="rapid-assistant"

  echo "Creating job ${job_name} from cronjob ${cronjob}..."

  kubectl --context "${context}" -n "${namespace}" create job \
    --from="cronjob/${cronjob}" "${job_name}" \
    --dry-run=client -o yaml | \
  yq eval ".spec.template.metadata.annotations[\"ad.datadoghq.com/tags\"] = \"{\\\"kube_cronjob\\\":\\\"${cronjob}\\\"}\"" - | \
  kubectl --context "${context}" -n "${namespace}" apply -f -

  echo "Job ${job_name} created."
  echo ""
  echo "Datadog logs:"
  echo "  https://app.datadoghq.com/logs?query=kube_namespace%3A${namespace}%20kube_cronjob%3A${cronjob}"
}

# Ensure workspace SSH key is loaded for git commit signing
if [ -f "$HOME/.ssh/id_ed25519" ]; then
  ssh-add -l 2>/dev/null | grep -q "$(ssh-keygen -lf "$HOME/.ssh/id_ed25519.pub" 2>/dev/null | awk '{print $2}')" || ssh-add "$HOME/.ssh/id_ed25519" 2>/dev/null
fi

eval "$(codex completion zsh)"


######################## functions ###################

create-worktree() {
  local feature="$1"

  if [[ -z "$feature" ]]; then
    echo "Usage: create-worktree <feature-name>"
    return 1
  fi

  local branch="ping.xia/$feature"
  local target="$HOME/dd/$feature"

  if [[ -d "$target" ]]; then
    echo "Directory already exists: $target"
    return 1
  fi

  if ! git -C "$DD_SOURCE_ROOT" fetch origin main; then
    echo "Failed to fetch origin/main for $DD_SOURCE_ROOT"
    return 1
  fi

  git -C "$DD_SOURCE_ROOT" worktree add --track -b "$branch" "$target" origin/main && cd "$target"

  # Set up Python virtual environment for assistant domain
  # if ! make -C "$target/domains/assistant" setup; then
  #   echo "Warning: .venv setup failed. Run 'make setup' in domains/assistant manually."
  # fi

  # Create detached tmux session if tmux is available
  if command -v tmux >/dev/null 2>&1; then
    tmux new-session -d -s "$feature" -c "$target"
    echo "Created tmux session: $feature"
  fi
}

delete-worktree() {
  local feature="$1"

  if [[ -z "$feature" ]]; then
    echo "Usage: delete-worktree <feature-name>"
    return 1
  fi

  local target="$HOME/dd/$feature"

  if [[ ! -d "$target" ]]; then
    echo "Worktree directory does not exist: $target"
    return 1
  fi

  # Kill tmux session if it exists
  if command -v tmux >/dev/null 2>&1; then
    tmux kill-session -t "$feature" 2>/dev/null
  fi

  # Force remove the git worktree
  git -C "$DD_SOURCE_ROOT" worktree remove --force "$target"

  # Delete Bazel output bases that belong to this worktree.
  local deleted=0
  local search_root=""
  local marker=""
  local output_base=""
  local workspace_path=""
  for search_root in "$HOME/.cache/bazel" "$HOME/Library/Caches/bazel"; do
    [[ -d "$search_root" ]] || continue
    while IFS= read -r -d '' marker; do
      workspace_path="$(cat "$marker" 2>/dev/null || true)"
      [[ "$workspace_path" == "$target" ]] || continue
      output_base="$(dirname "$marker")"
      chmod -R u+w "$output_base" 2>/dev/null || true
      rm -rf -- "$output_base"
      echo "Deleted Bazel output base: $output_base"
      deleted=$((deleted + 1))
    done < <(find "$search_root" -mindepth 2 -maxdepth 3 -type f -name DO_NOT_BUILD_HERE -print0 2>/dev/null)
  done
  ((deleted > 0)) || echo "No Bazel output base found for: $target"

  echo "Worktree '$feature' removed"
}
