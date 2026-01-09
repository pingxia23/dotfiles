<global_rules>
- Always use `gh` for GitHub interactions
- Always use `bzl` for bazel commands.
- Never run `bzl` commands in the background. They will conflict with each other, fighting over lockfiles.
- **Pull Request Creation**: If currently on the default branch (which is main, master, or prod usually), create a new branch. Branch format is ping.xia/yyyymmdd-brief-description.
</global_rules>

