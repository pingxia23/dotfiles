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

## Workspace Git signing and push authentication

Commit signing and push authentication are separate:

```text
git commit -> needs a signing key
git push   -> needs GitHub repository authentication
```

For workspaces without an SSH session or forwarded SSH agent, use one local private
key for both operations:

```text
commit signing -> ~/.ssh/workspace_git
push auth      -> ~/.ssh/workspace_git via core.sshCommand
GitHub account -> upload ~/.ssh/workspace_git.pub twice:
                  authentication key + signing key
```

Important: `user.signingkey = key::<public-key>` depends on an SSH agent.
`user.signingkey = ~/.ssh/workspace_git` works without `SSH_AUTH_SOCK`.

### Setup

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
git config --global core.sshCommand "ssh -i ~/.ssh/workspace_git -o IdentitiesOnly=yes"
```

For DataDog, SSO authorization is required for the authentication key:

1. Open GitHub in a browser and complete DataDog SSO at least once.
2. Go to GitHub -> Settings -> SSH and GPG keys.
3. Find the `workspace-git-auth` key under authentication keys.
4. Use `Configure SSO` for that key and authorize it for the DataDog
   organization.

Only the authentication key needs SSO authorization for Git over SSH. The
`workspace-git-signing` key is what GitHub uses to verify commit signatures.

Disable `SSH_AUTH_SOCK` forwarding for the workspace SSH client connection so
Git signing does not accidentally depend on a laptop agent. On the machine that
opens the SSH connection to the workspace, add or update the workspace host
entry:

```sshconfig
Host workspace-pingxia-workspace-test
  ForwardAgent no
  IdentityAgent none
```

After reconnecting to the workspace, `SSH_AUTH_SOCK` should be unset:

```bash
env | grep SSH_AUTH_SOCK || echo "SSH_AUTH_SOCK unset"
```

### Validation

```bash
env | grep SSH_AUTH_SOCK || echo "SSH_AUTH_SOCK unset"

tmpdir=$(mktemp -d)
cd "$tmpdir"
git init
git config user.name "Probe User"
git config user.email "$(git config --global user.email)"
echo test > f
git add f
git commit -m "probe local key signing"
cd -
rm -rf "$tmpdir"

git ls-remote origin HEAD
```

Known-good branch test:

```text
Branch: ping.xia/workspace-git-key-test-20260701160030
Verified commit: 54a757ffe7678a750e71f4dbb75adfa9fc7b66af
GitHub verification: verified: true, reason valid
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
