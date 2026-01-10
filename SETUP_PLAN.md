# Plan: Add Vim and Git Setup to Dotfiles

## Current State

**Already in dotfiles repo:**
- `zshrc` - oh-my-zsh, plugins, aliases, Go/k8s/AWS setup
- `claude-global.md`, `claude-settings.json` - Claude config
- `install.sh` - installs oh-my-zsh, plugins, Node.js, Claude CLI, uv, direnv, Rust, gh

**Added:**
- `vimrc` - vim config with vim-plug, NERDTree, fzf, airline
- `gitconfig` - portable git config with aliases

## Remote Editing

Using **vim** for all remote editing (no rmate/subl complexity).

---

## Files in Dotfiles Repo

| File | Purpose |
|------|---------|
| `dotfiles/vimrc` | Vim config with NERDTree, fzf, airline, syntax highlighting |
| `dotfiles/gitconfig` | Git aliases (`newbranch`, `repush`, `userlog`, `uncommit`) |
| `dotfiles/install.sh` | Idempotent installer for vim and git setup |

---

## What install.sh Does (idempotent - safe to re-run)

1. Symlinks `~/.vimrc` → `dotfiles/vimrc`
2. Symlinks `~/.gitconfig` → `dotfiles/gitconfig`
3. Installs vim-plug if not present
4. Creates `~/.vim/undodir` for persistent undo
5. Runs `vim +PlugInstall +qall` to install plugins

---

## To Deploy on Linux Machine

```bash
cd ~/dotfiles
git pull
./install.sh
```
