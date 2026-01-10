#!/bin/bash
set -e

# =============================================================================
# Helper Functions
# =============================================================================

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check if Node.js is installed and version is 18+
check_nodejs() {
  if command_exists node; then
    NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
    if [ "$NODE_VERSION" -ge 18 ]; then
      echo "Node.js v$(node -v | cut -d 'v' -f 2) is already installed"
      return 0
    else
      echo "Node.js v$(node -v | cut -d 'v' -f 2) is installed but version 18+ is required"
      return 1
    fi
  else
    echo "Node.js is not installed"
    return 1
  fi
}

# =============================================================================
# Installation Functions
# =============================================================================

# Install Node.js if not already installed or version is less than 18
install_nodejs() {
  if ! check_nodejs; then
    echo "Installing Node.js 18+..."

    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS - use Homebrew if available
      if command_exists brew; then
        brew install node@18
        # Add to PATH if needed
        if ! command_exists node || [ "$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)" -lt 18 ]; then
          echo 'export PATH="/usr/local/opt/node@18/bin:$PATH"' >> ~/.zshrc
          export PATH="/usr/local/opt/node@18/bin:$PATH"
        fi
      else
        echo "Homebrew not found. Please install Homebrew first or install Node.js manually."
      fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
      # Linux - use nvm for easier version management
      if ! command_exists nvm; then
        echo "Installing nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash

        # Load nvm
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
      fi

      # Install and use Node.js 18
      nvm install 18
      nvm use 18
    else
      echo "Unsupported OS. Please install Node.js manually."
    fi
  fi
}

# Install Claude Code CLI
install_claude_code() {
  if ! command_exists claude; then
    echo "Installing Claude Code CLI..."

    if command_exists npm; then
      npm install -g @anthropic-ai/claude-code
      echo "Claude Code installed successfully"
    else
      echo "npm not found. Please install Node.js first."
    fi
  else
    echo "Claude Code is already installed"
  fi
}

# Install uv (Python package manager)
install_uv_uvx() {
  if ! command_exists uv; then
    echo "Installing uv..."

    if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "linux-gnu"* ]]; then
      curl -LsSf https://astral.sh/uv/install.sh | sh
    else
      echo "Unsupported OS. Please install uv manually."
    fi
  else
    echo "uv is already installed"
  fi
}

# Install direnv if not already installed
install_direnv() {
  if ! command_exists direnv; then
    echo "Installing direnv..."

    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS - use Homebrew if available
      if command_exists brew; then
        brew install direnv
      else
        echo "Homebrew not found. Please install Homebrew first or install direnv manually."
      fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
      # Linux - try using apt or your preferred package manager
      if command_exists apt-get; then
        sudo apt-get update
        sudo apt-get install -y direnv
      elif command_exists yum; then
        sudo yum install -y direnv
      else
        # Fall back to direct download and installation
        echo "Installing direnv from GitHub releases..."
        DIRENV_VERSION=$(curl -s https://api.github.com/repos/direnv/direnv/releases/latest | grep 'tag_name' | cut -d\" -f4)
        DIRENV_ARCH=$(uname -m)
        DIRENV_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
        curl -sfLo direnv "https://github.com/direnv/direnv/releases/download/${DIRENV_VERSION}/direnv.${DIRENV_OS}-${DIRENV_ARCH}"
        chmod +x direnv
        sudo mv direnv /usr/local/bin/
      fi
    else
      echo "Unsupported OS. Please install direnv manually from https://direnv.net/docs/installation.html"
    fi

    # Configure shell integration if not already configured (idempotent)
    if [[ -f "$HOME/.zshrc" ]]; then
      if ! grep -q "direnv hook" "$HOME/.zshrc"; then
        echo 'eval "$(direnv hook zsh)"' >> "$HOME/.zshrc"
        echo "Added direnv hook to .zshrc"
      fi
    fi
  else
    echo "direnv is already installed"
  fi
}

# Install Rust and Cargo if not already installed
install_cargo() {
  if ! command_exists cargo || ! command_exists rustc; then
    echo "Installing Rust and Cargo..."

    # The official way to install Rust is through rustup
    if ! command_exists rustup; then
      echo "Installing rustup..."

      # Using the official rustup installer
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

      # Source cargo environment to make cargo available in current shell
      source "$HOME/.cargo/env"

      echo "Rust and Cargo installed successfully"
    else
      # If rustup is installed but cargo/rustc aren't, update rustup
      echo "Updating rustup..."
      rustup update
    fi

    # Add Cargo's bin directory to PATH in shell configs if not already added (idempotent)
    CARGO_ENV_LINE='source "$HOME/.cargo/env"'

    if [[ -f "$HOME/.zshrc" ]]; then
      if ! grep -q ".cargo/env" "$HOME/.zshrc"; then
        echo "" >> "$HOME/.zshrc"
        echo "# Rust/Cargo environment" >> "$HOME/.zshrc"
        echo "$CARGO_ENV_LINE" >> "$HOME/.zshrc"
        echo "Added Cargo environment to .zshrc"
      fi
    fi
  else
    echo "Rust and Cargo are already installed"

    # Update if already installed
    if command_exists rustup; then
      echo "Checking for Rust updates..."
      rustup update
    fi
  fi
}

# Setup Vim configuration
setup_vim() {
  DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

  echo "Setting up Vim configuration..."

  # Symlink vimrc (skip if already symlinked to our file)
  if [ -L "$HOME/.vimrc" ]; then
    CURRENT_LINK=$(readlink "$HOME/.vimrc")
    if [ "$CURRENT_LINK" = "$DOTFILES_DIR/vimrc" ]; then
      echo "~/.vimrc already symlinked to dotfiles"
    else
      echo "~/.vimrc is a symlink to something else: $CURRENT_LINK"
      echo "Backing up and replacing..."
      mv "$HOME/.vimrc" "$HOME/.vimrc.backup"
      ln -s "$DOTFILES_DIR/vimrc" "$HOME/.vimrc"
    fi
  elif [ -f "$HOME/.vimrc" ]; then
    echo "Backing up existing ~/.vimrc to ~/.vimrc.backup"
    mv "$HOME/.vimrc" "$HOME/.vimrc.backup"
    ln -s "$DOTFILES_DIR/vimrc" "$HOME/.vimrc"
  else
    ln -s "$DOTFILES_DIR/vimrc" "$HOME/.vimrc"
  fi
  echo "~/.vimrc symlinked to dotfiles/vimrc"

  # Create vim undo directory
  mkdir -p "$HOME/.vim/undodir"
  echo "Created ~/.vim/undodir for persistent undo"

  # Install vim-plug if not already installed
  if [ ! -f "$HOME/.vim/autoload/plug.vim" ]; then
    echo "Installing vim-plug..."
    curl -fLo "$HOME/.vim/autoload/plug.vim" --create-dirs \
      https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim
    echo "vim-plug installed"
  else
    echo "vim-plug is already installed"
  fi

  # Install vim plugins headlessly
  echo "Installing vim plugins (this may take a moment)..."
  vim +PlugInstall +qall 2>/dev/null
  echo "Vim plugins installed"
}

# Setup dd-source local configurations
setup_dd_source() {
  DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"
  DD_SOURCE_DIR="$HOME/dd/dd-source"

  # Check if dd-source exists
  if [ ! -d "$DD_SOURCE_DIR" ]; then
    echo "dd-source directory not found at $DD_SOURCE_DIR, skipping..."
    return 0
  fi

  echo "Setting up dd-source local configurations..."

  # Create directories
  mkdir -p "$DD_SOURCE_DIR/.vscode"
  mkdir -p "$DD_SOURCE_DIR/.claude"

  # Copy files (using cp instead of symlinks since these are in a git repo)
  cp "$DOTFILES_DIR/dd-source/.envrc" "$DD_SOURCE_DIR/.envrc"
  cp "$DOTFILES_DIR/dd-source/.envrc-rapid" "$DD_SOURCE_DIR/.envrc-rapid"
  cp "$DOTFILES_DIR/dd-source/CLAUDE.local.md" "$DD_SOURCE_DIR/CLAUDE.local.md"
  cp "$DOTFILES_DIR/dd-source/.cursorignore" "$DD_SOURCE_DIR/.cursorignore"
  cp "$DOTFILES_DIR/dd-source/.claude/settings.local.json" "$DD_SOURCE_DIR/.claude/settings.local.json"
  cp "$DOTFILES_DIR/dd-source/.vscode/settings.json" "$DD_SOURCE_DIR/.vscode/settings.json"
  cp "$DOTFILES_DIR/dd-source/.vscode/run_bazel_test.sh" "$DD_SOURCE_DIR/.vscode/run_bazel_test.sh"

  # direnv allow (idempotent)
  if command_exists direnv; then
    (cd "$DD_SOURCE_DIR" && direnv allow)
  fi

  echo "dd-source local configurations installed"
}

# Setup Git configuration
setup_gitconfig() {
  DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

  echo "Setting up Git configuration..."

  # Symlink gitconfig (skip if already symlinked to our file)
  if [ -L "$HOME/.gitconfig" ]; then
    CURRENT_LINK=$(readlink "$HOME/.gitconfig")
    if [ "$CURRENT_LINK" = "$DOTFILES_DIR/gitconfig" ]; then
      echo "~/.gitconfig already symlinked to dotfiles"
    else
      echo "~/.gitconfig is a symlink to something else: $CURRENT_LINK"
      echo "Backing up and replacing..."
      mv "$HOME/.gitconfig" "$HOME/.gitconfig.backup"
      ln -s "$DOTFILES_DIR/gitconfig" "$HOME/.gitconfig"
    fi
  elif [ -f "$HOME/.gitconfig" ]; then
    echo "Backing up existing ~/.gitconfig to ~/.gitconfig.backup"
    mv "$HOME/.gitconfig" "$HOME/.gitconfig.backup"
    ln -s "$DOTFILES_DIR/gitconfig" "$HOME/.gitconfig"
  else
    ln -s "$DOTFILES_DIR/gitconfig" "$HOME/.gitconfig"
  fi
  echo "~/.gitconfig symlinked to dotfiles/gitconfig"
}

# Install GitHub CLI if not already installed
install_gh() {
  if ! command_exists gh; then
    echo "Installing GitHub CLI (gh)..."

    if [[ "$OSTYPE" == "darwin"* ]]; then
      # macOS - use Homebrew if available
      if command_exists brew; then
        brew install gh
      else
        echo "Homebrew not found. Please install Homebrew first or install gh manually."
      fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
      # Linux - try using apt or your preferred package manager
      if command_exists apt-get; then
        sudo apt-get update
        sudo apt-get install -y gh
      elif command_exists yum; then
        sudo yum install -y gh
      elif command_exists snap; then
        sudo snap install gh
      else
        # Fall back to direct download and installation
        echo "Installing gh from GitHub releases..."
        GH_VERSION=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep 'tag_name' | cut -d\" -f4)
        GH_ARCH=$(uname -m)
        if [[ "$GH_ARCH" == "x86_64" ]]; then
          GH_ARCH="amd64"
        fi
        GH_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
        curl -sfLo gh.tar.gz "https://github.com/cli/cli/releases/download/${GH_VERSION}/gh_${GH_VERSION#v}_${GH_OS}_${GH_ARCH}.tar.gz"
        tar -xzf gh.tar.gz
        sudo mv gh_*/bin/gh /usr/local/bin/
        rm -rf gh.tar.gz gh_*
      fi
    else
      echo "Unsupported OS. Please install gh manually."
    fi
  else
    echo "GitHub CLI (gh) is already installed"
  fi
}

# =============================================================================
# Main Installation
# =============================================================================

# Install oh-my-zsh if not already installed
if [ ! -d "$HOME/.oh-my-zsh" ]; then
  echo "Installing oh-my-zsh..."
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
else
  echo "oh-my-zsh is already installed"
fi

# Install zsh plugins
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]; then
  echo "Installing zsh-autosuggestions..."
  git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
else
  echo "zsh-autosuggestions is already installed"
fi

if [ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]; then
  echo "Installing zsh-syntax-highlighting..."
  git clone https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
else
  echo "zsh-syntax-highlighting is already installed"
fi

# Install Node.js 18+ if needed
install_nodejs

# Install Claude Code
install_claude_code

# Install uv
install_uv_uvx

# Install direnv
install_direnv

# Install Rust and Cargo
install_cargo

# Install GitHub CLI
install_gh

# Setup Vim configuration
setup_vim

# Setup Git configuration
setup_gitconfig

# Setup dd-source local configurations
setup_dd_source

# Add source line to .zshrc if it doesn't already exist (idempotent)
DOTFILES_SOURCE_LINE="source \$HOME/dotfiles/zshrc"
if ! grep -q "$DOTFILES_SOURCE_LINE" "$HOME/.zshrc" 2>/dev/null; then
  echo "Adding dotfiles/zshrc to .zshrc"
  echo "" >> "$HOME/.zshrc"
  echo "# Source custom dotfiles" >> "$HOME/.zshrc"
  echo "$DOTFILES_SOURCE_LINE" >> "$HOME/.zshrc"
  echo "Added dotfiles source line to .zshrc"
else
  echo "Dotfiles source line already exists in .zshrc"
fi

# Create ~/.claude directory and copy configuration
if [ -f "$(dirname "$0")/claude-global.md" ]; then
  echo "Setting up Claude global configuration..."
  mkdir -p "$HOME/.claude"
  cp "$(dirname "$0")/claude-global.md" "$HOME/.claude/CLAUDE.md"
  echo "Global CLAUDE.md copied to ~/.claude/CLAUDE.md"
else
  echo "claude-global.md not found in dotfiles directory"
fi

# Install Claude settings.json
if [ -f "$(dirname "$0")/claude-settings.json" ]; then
  echo "Installing Claude settings..."
  mkdir -p "$HOME/.claude"
  cp "$(dirname "$0")/claude-settings.json" "$HOME/.claude/settings.json"
  echo "Claude settings.json installed to ~/.claude/settings.json"
else
  echo "claude-settings.json not found in dotfiles directory"
fi

echo ""
echo "============================================="
echo "Installation complete!"
echo "============================================="
echo "Please restart your shell or run: source ~/.zshrc"
