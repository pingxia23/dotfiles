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

Do not copy the macOS Datadog hook path into Linux workspaces:

```ini
[core]
  hooksPath = /usr/local/dd/global_hooks
```

Linux workspaces already get the Datadog global hook wrapper from
`/etc/gitconfig`:

```text
core.hooksPath = /usr/local/lib/dd-git-hooks
```

Do not set `core.hooksPath` to `~/.global_hooks` unless that directory has been
created intentionally. A missing `core.hooksPath` directory prevents Git from
falling back to repo-local hooks.

Validate the effective hook path:

```bash
git config --show-origin --get-all core.hooksPath
```

Expected Linux result:

```text
file:/etc/gitconfig  /usr/local/lib/dd-git-hooks
```

## dd-source git config

For an existing `~/dd/dd-source` checkout, do not replace or symlink `.git/config`.
Update it according to `~/dotfiles/dd-source/.git-config-template`, while keeping the
checkout-specific remote URL.

## Workspace Git signing and push authentication

### Reasoning

Commit signing and push authentication are separate:

```text
git commit -> needs a signing key
git push   -> needs GitHub repository authentication
```

Use explicit local private keys in the workspace so commits and pushes use
deterministic identities. `ddoghq` and `DataDog` are separate GitHub
enterprises/accounts, so they need separate SSH authentication keys:

```text
commit signing -> ~/.ssh/workspace_git
ddoghq auth    -> ~/.ssh/workspace_git
DataDog auth   -> ~/.ssh/workspace_git_datadog
```

Use `user.signingkey = ~/.ssh/workspace_git` so Git signing uses the local
workspace key directly.

Do not edit `/home/bits/.config/datadog/git/ssh_config` by hand. It is managed
by `git-config-tool` and included from `~/.ssh/config`.

### Set up ddoghq

```bash
ssh-keygen -t ed25519 -f ~/.ssh/workspace_git -C "workspace-git" -N ""
chmod 600 ~/.ssh/workspace_git
chmod 644 ~/.ssh/workspace_git.pub

gh auth refresh -h github.com -s admin:public_key -s admin:ssh_signing_key

gh ssh-key add ~/.ssh/workspace_git.pub --type authentication --title "workspace-git-auth"
gh ssh-key add ~/.ssh/workspace_git.pub --type signing --title "workspace-git-signing"

git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/workspace_git
git config --global commit.gpgsign true
```

`~/.ssh/workspace_git.pub` must exist on the `ddoghq` GitHub account twice:

```text
authentication key -> Git push/fetch for ddoghq
signing key        -> GitHub commit signature verification
```

### Set up DataDog

Create a separate key for the GitHub account that belongs to the `DataDog`
enterprise:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/workspace_git_datadog -C "workspace-git-datadog" -N ""
chmod 600 ~/.ssh/workspace_git_datadog
chmod 644 ~/.ssh/workspace_git_datadog.pub
cat ~/.ssh/workspace_git_datadog.pub
```

Upload `~/.ssh/workspace_git_datadog.pub` to the GitHub account that belongs to
the `DataDog` enterprise as an authentication key.

For DataDog, SSO authorization is required for the DataDog authentication key:

1. Open GitHub in a browser and complete DataDog SSO at least once.
2. Go to GitHub -> Settings -> SSH and GPG keys.
3. Find the `workspace-git-datadog` authentication key.
4. Use `Configure SSO` for that key and authorize it for the DataDog
   organization.

Only authentication keys need SSO authorization for Git over SSH. The
`workspace-git-signing` key is only for GitHub commit signature verification.

### Final SSH and Git setup

Add the DataDog host alias to `~/.ssh/config`:

```bash
if ! grep -q '^Host datadog\.github\.com$' ~/.ssh/config 2>/dev/null; then
  cat >> ~/.ssh/config <<'EOF'
Host datadog.github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/workspace_git_datadog
  IdentitiesOnly yes
EOF
fi

chmod 600 ~/.ssh/config
```

Use a small SSH wrapper so normal `ddoghq` Git operations keep using
`~/.ssh/workspace_git`, while `DataDog` remotes use
`~/.ssh/workspace_git_datadog`:

```bash
cat > ~/.ssh/git-ssh-workspace <<'EOF'
#!/bin/sh

key="$HOME/.ssh/workspace_git"

for arg in "$@"; do
  case "$arg" in
    *datadog.github.com*|*DataDog/datacenter-config.git*)
      key="$HOME/.ssh/workspace_git_datadog"
      ;;
  esac
done

exec ssh -i "$key" -o IdentitiesOnly=yes "$@"
EOF

chmod 700 ~/.ssh/git-ssh-workspace
git config --global core.sshCommand "$HOME/.ssh/git-ssh-workspace"
```

Route `DataDog` repositories through the DataDog host alias. Clear existing
values first so rerunning this block does not duplicate entries:

```bash
git config --global --unset-all url.git@datadog.github.com:DataDog/.insteadOf || true
git config --global --unset-all url.ssh://git@datadog.github.com/DataDog/.insteadOf || true

git config --global --add url."git@datadog.github.com:DataDog/".insteadOf "https://github.com/DataDog/"
git config --global --add url."git@datadog.github.com:DataDog/".insteadOf "git@github.com:DataDog/"
git config --global --add url."ssh://git@datadog.github.com/DataDog/".insteadOf "ssh://git@github.com/DataDog/"
```

## Personal dotfiles push authentication

`ping-xia_ddog` is an Enterprise Managed User and cannot be added as a
collaborator to the personal `pingxia23/dotfiles` repository. Keep commit
signing on `~/.ssh/workspace_git`, but use a separate personal GitHub
authentication key only for the `~/dotfiles` checkout.

This assumes the matching public key has already been added to the `pingxia23`
GitHub account as an authentication key named `workspace-dotfiles-auth`.

The dotfiles repository SSH key is stored in 1Password. Find it by searching
1Password for `dotfiles repo ssh key`, `workspace-dotfiles-auth`, or
`pingxia23-dotfiles`. Do not commit the key material to this repository.

The matching private key must exist in the workspace at:

```text
~/.ssh/pingxia23_dotfiles
```

Configure only the dotfiles repository to use that key for SSH transport:

```bash
cd ~/dotfiles
git config core.sshCommand "ssh -i ~/.ssh/pingxia23_dotfiles -o IdentitiesOnly=yes"
git remote set-url origin git@github.com:pingxia23/dotfiles.git
```

Validate that GitHub sees the key as the personal `pingxia23` account:

```bash
ssh -T -i ~/.ssh/pingxia23_dotfiles -o IdentitiesOnly=yes git@github.com
```

Expected result:

```text
Hi pingxia23! You've successfully authenticated, but GitHub does not provide shell access.
```

Then push normally from `~/dotfiles`:

```bash
git push
```

If the push is rejected with `fetch first`, integrate the remote commit before
pushing:

```bash
git fetch origin master
git rebase origin/master
git push
```
