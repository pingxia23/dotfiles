#!/bin/bash
set -e

dotfiles_dir="${1:?Usage: install-dotfiles-bin.sh <dotfiles-directory>}"
dotfiles_bin="$dotfiles_dir/bin"
path_line="case \":\$PATH:\" in *\":$dotfiles_bin:\"*) ;; *) export PATH=\"$dotfiles_bin:\$PATH\" ;; esac"

for source in "$dotfiles_bin"/*; do
  [[ -f "$source" ]] || continue
  if [[ ! -x "$source" ]]; then
    echo "Dotfiles command is not executable: $source" >&2
    exit 1
  fi
done

startup_file="$HOME/.zshenv"
touch "$startup_file"
if ! grep -Fqx "$path_line" "$startup_file"; then
  printf '\n# Add dotfiles commands to PATH\n%s\n' "$path_line" >> "$startup_file"
  echo "  Added $dotfiles_bin to ${startup_file#$HOME/}"
fi
