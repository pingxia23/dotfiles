# New workspace setup

Replace `<my-workspace>` with your workspace name.

## Zsh plugins

To keep Oh My Zsh plugins in dotfiles, replace the generated `plugins=(...)` line in
`~/.zshrc` with the following before `source $ZSH/oh-my-zsh.sh`:

```zsh
source "$HOME/dotfiles/zshrc.plugins"
```

## dd-auth setup

```bash
dd-auth --domain dd.datad0g.com --workspace workspace-<my-workspace>
```

## Global git config

Update the global Git config according to `~/dotfiles/git_config_template`.
Preserve the Workspaces-managed includes in `~/.gitconfig`; do not replace that
file with the template.

Do not edit `~/.config/datadog/git/ssh_config` by hand. It is managed by
`git-config-tool` and included from `~/.ssh/config`.

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

## Workspace authentication and commit signing

### On your personal computer

Install the current Workspaces command-line tool:

```bash
dogbrew install workspaces
```

In 1Password, enable **Settings → Developer → Integrate with 1Password SDKs**.
Then set up signing for the workspace:

```bash
workspaces ssh-config <my-workspace>
```

Complete any GitHub or 1Password prompts. Workspaces creates encrypted signing
keys, registers their public keys with GitHub, and configures Git to use them.
Signing continues after your laptop disconnects. A workspace restart or
pause/resume may require another 1Password approval; rerun this command if
signing needs recovery.

New workspaces created with the current `workspaces create` command already
include signing setup. Use `ssh-config` for existing workspaces, workspaces
created another way, or recovery.

See the [Workspaces signing guide](https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/7382991923)
for details.

### Inside the Linux workspace

Before refreshing credentials, ensure repositories from both GitHub organizations
are present directly under `~/dd`, such as `ddoghq/dd-source` at `~/dd/dd-source`
and `DataDog/devtools` at `~/dd/devtools`. The command discovers which accounts to
refresh from those repositories. The `DataDog` login also supplies the personal
account used for the dotfiles push setup below.

Install the tools needed to refresh credentials:

```bash
dogbrew install workspaces
dogbrew install gh-shim
~/dotfiles/bin/workspace_agent_auth
```

`workspace_agent_auth` runs `workspaces force-auth` with the current
`WORKSPACE_NAME`. This is equivalent to:

```bash
workspaces force-auth <my-workspace>
```

It refreshes GitHub credentials and Vault sessions (credentials for internal
services), and configures Git to fetch and push over HTTPS using stored tokens.
`gh-shim` selects the correct GitHub account. Follow login prompts with the
employee account `ping-xia_ddog` for `ddoghq`, and the personal account
`pingxia23` for `DataDog`.

The command discovers GitHub organizations from repositories directly under
`~/dd`. Run it after those repositories exist, and rerun it when authentication
expires or after adding repositories from another organization. The existing Pi
shortcuts call `workspace_agent_auth` before launching Pi.

You can also run `workspaces force-auth <my-workspace>` on your personal computer
to refresh the workspace remotely. Use this explicit command to select the
workspace instead of relying on the script's default when `WORKSPACE_NAME` is
unset.

## Personal dotfiles push authentication

`ping-xia_ddog` is an Enterprise Managed User and cannot be added as a
collaborator to the personal `pingxia23/dotfiles` repository. Use the personal
`pingxia23` GitHub login for pushes from the `~/dotfiles` checkout.

Use HTTPS for this repository. The credential helper supplies Git's login
credentials through `gh-personal`, which selects the `pingxia23` account.

After the workspace authentication step above, confirm that the personal
credential identifies the correct account:

```bash
cd ~/dotfiles
~/dotfiles/bin/gh-personal api user --jq .login
```

Expected output:

```text
pingxia23
```

Configure only the dotfiles repository:

```bash
cd ~/dotfiles
git remote set-url origin https://pingxia23@github.com/pingxia23/dotfiles.git
git config --local --unset-all credential.helper || true
git config --local --add credential.helper ""
git config --local --add credential.helper "!$(pwd)/bin/gh-personal auth git-credential"
```

Keep the `pingxia23@` part of the URL so the Git URL rules in the dotfiles template
do not rewrite it to SSH. The `gh-personal` helper selects the personal account.

These settings are stored in `~/dotfiles/.git/config`. They remain in effect
after terminal reconnects and machine restarts. Do not repeat this setup for
normal pushes from this checkout.

Validate the configuration without uploading commits:

```bash
GIT_TERMINAL_PROMPT=0 git push --dry-run
```

The output must identify the personal repository and must not contain
`ping-xia_ddog`:

```text
To https://github.com/pingxia23/dotfiles.git
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
