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

# Custom functions
git_is_ancestor() {
  if [ $# -ne 2 ]; then
    echo "Usage: git_is_ancestor <commit-A> <commit-B>"
    return 2
  fi
  if git merge-base --is-ancestor "$1" "$2"; then
    echo "$1 is an ancestor of $2"
    return 0
  else
    echo "$1 is not an ancestor of $2"
    return 1
  fi
}

rapid_my_td() {
  rapid td list -o ping.xia@datadoghq.com
}

# Load secrets from workspace secrets system (if available)
[ -f ~/.secrets ] && source ~/.secrets
