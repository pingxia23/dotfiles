#!/bin/bash
set -e

command_exists() { command -v "$1" >/dev/null 2>&1; }

# Install Oh My Zsh
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  echo "Installing oh-my-zsh..."
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
else
  echo "oh-my-zsh is already installed"
fi

# Install zsh plugins (you use these in your config)
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
[ -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ] || \
  git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
[ -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ] || \
  git clone https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"

# Install GitHub CLI
if ! command_exists gh; then
  echo "Installing GitHub CLI..."
  if command_exists apt-get; then
    sudo apt-get update && sudo apt-get install -y gh
  fi
else
  echo "gh is already installed"
fi

# Install direnv
if ! command_exists direnv; then
  echo "Installing direnv..."
  if command_exists apt-get; then
    sudo apt-get install -y direnv
  fi
else
  echo "direnv is already installed"
fi

# Install Node.js (for Claude Code CLI)
if ! command_exists node; then
  echo "Installing Node.js via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 18
else
  echo "Node.js is already installed"
fi

# Install Claude Code CLI
if ! command_exists claude; then
  echo "Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code
else
  echo "Claude Code is already installed"
fi

# Source dotfiles/zshrc from main .zshrc
DOTFILES_SOURCE_LINE="source \$HOME/dotfiles/zshrc"
if ! grep -q "$DOTFILES_SOURCE_LINE" "$HOME/.zshrc" 2>/dev/null; then
  echo "" >> "$HOME/.zshrc"
  echo "# Source custom dotfiles" >> "$HOME/.zshrc"
  echo "$DOTFILES_SOURCE_LINE" >> "$HOME/.zshrc"
  echo "Added dotfiles source line to .zshrc"
else
  echo "Dotfiles source line already exists in .zshrc"
fi

# Setup Claude config
mkdir -p "$HOME/.claude"
[ -f "$(dirname "$0")/claude-global.md" ] && cp "$(dirname "$0")/claude-global.md" "$HOME/.claude/CLAUDE.md"
[ -f "$(dirname "$0")/claude-settings.json" ] && cp "$(dirname "$0")/claude-settings.json" "$HOME/.claude/settings.json"
echo "Claude configuration copied to ~/.claude/"

echo "Installation complete!"
