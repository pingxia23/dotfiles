# Path to your Oh My Zsh installation
export ZSH="$HOME/.oh-my-zsh"

# Theme
ZSH_THEME="robbyrussell"

# Plugins
plugins=(git docker zsh-autosuggestions zsh-syntax-highlighting direnv)

source $ZSH/oh-my-zsh.sh

# Workspace indicator
if [ -n "$WORKSPACE_NAME" ]; then
  export PS1="[ws:${WORKSPACE_NAME}] $PS1"
fi

# Editor
export EDITOR='vim'

# Aliases
alias ls='ls --color=auto'
alias k="kubectl"

# Datadog cluster aliases
alias stg="ddtool clusters use gizmo.us1.staging.dog"
alias us1="ddtool clusters use general2.us1.prod.dog"
alias eu1="ddtool clusters use spirou.eu1.prod.dog"
alias us3="ddtool clusters use zekrom.us3.prod.dog"
alias us5="ddtool clusters use hypno.us5.prod.dog"
alias ap1="ddtool clusters use nidorino.ap1.prod.dog"
alias ap2="ddtool clusters use espathra.ap2.prod.dog"

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

alias claude="source ~/.zshrc && ddtool auth login --datacenter us1.ddbuild.io && claude --model opus --allow-dangerously-skip-permissions"
