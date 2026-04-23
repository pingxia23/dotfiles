Run the following commands

## 1. Authentication & git signing
```bash
ddtool auth github login --org DataDog
dd-gitsign install --remote --email "ping.xia@datadoghq.com" --name "Ping Xia" --github "pingxia23"
gh auth login
```

## 2. Workspace-local git commit signing

By default, `dd-gitsign install` configures the laptop's forwarded SSH key for signing.
This breaks when the laptop disconnects. Register the workspace's own SSH key as a signing
key so commits can be signed without the laptop connection.

```bash
# Add GitHub scope for signing key management
gh auth refresh -h github.com -s admin:ssh_signing_key

# Register workspace key as a signing key on GitHub
gh api user/ssh_signing_keys -f "key=$(cat ~/.ssh/id_ed25519.pub)" -f "title=workspace-signing"

# Point git signing config to the workspace key
git config --global user.signingkey "key::$(cat ~/.ssh/id_ed25519.pub)"

# Add workspace key to allowed signers (for local signature verification)
echo "ping.xia@datadoghq.com $(cat ~/.ssh/id_ed25519.pub)" >> ~/.config/gitsign/allowed-signers

# Load the workspace key into the SSH agent
ssh-add ~/.ssh/id_ed25519
```

Then go to https://github.com/settings/keys and SSO-authorize the workspace's **auth key**
("GitHub CLI") for the **DataDog** organization. (Signing keys don't have a separate SSO
option; the auth key authorization covers both.)

Verify:
```bash
dd-gitsign doctor
```

## dd-auth setup
```bash
dd-auth --domain dd.datad0g.com --workspace workspace-pingxia-workspace-test
```
