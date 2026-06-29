Run the following commands

<!-- ## 1. Authentication & git signing
```bash
ddtool auth github login --org DataDog
dd-gitsign install --remote --email "ping.xia@datadoghq.com" --name "Ping Xia" --github "pingxia23"
gh auth login
``` -->

## Zsh plugins

To keep Oh My Zsh plugins in dotfiles, replace the generated `plugins=(...)` line in
`~/.zshrc` with the following before `source $ZSH/oh-my-zsh.sh`:

```zsh
source "$HOME/dotfiles/zshrc.plugins"
```

## dd-auth setup
```bash
dd-auth --domain dd.datad0g.com --workspace workspace-pingxia-workspace-test
```

## Global git config

Update the global Git config according to `~/dotfiles/git_config_template`.

## dd-source git config

For an existing `~/dd/dd-source` checkout, do not replace or symlink `.git/config`.
Update it according to `~/dotfiles/dd-source/.git-config-template`, while keeping the
checkout-specific remote URL.
