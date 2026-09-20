# Publish to GitHub

This is a standalone local Git repository. Creating this folder does not create a repository on GitHub.

1. Create an empty public GitHub repository named `learn-codex` under your account. Do not initialize it with a README, license, or gitignore because the local repository already has an initial commit.
2. Review `NOTICE.md` and decide the licensing terms before public release. Replace the `OWNER` placeholder in the root README's installation command. The plugin manifest's publisher name uses the existing local Git author; update it if needed. Add the actual repository URL to the manifest after choosing the destination.
3. Open PowerShell in this repository and run, replacing `OWNER`:

```powershell
npm test
git add .
git commit -m "Prepare GitHub release"
git remote add origin https://github.com/OWNER/learn-codex.git
git push -u origin main
```

If there are no new changes, skip the second commit. Git authentication uses your own configured GitHub credentials.

4. Verify installation from GitHub:

```powershell
codex plugin marketplace add OWNER/learn-codex
codex plugin add learn-codex@codex-learning
```

If `codex-learning` already points to a local checkout, inspect it with `codex plugin marketplace list` and remove that source with `codex plugin marketplace remove codex-learning` before adding the GitHub source. Start a fresh task and test Learn, Quiz, and Review.

5. Share the repository URL and the two installation commands from the README. Once satisfied, create a `v0.1.0` Git tag/release for the first version.

## Updates

Change the version in `plugins/learn-codex/.codex-plugin/plugin.json` and the plugin's `package.json` together. Run tests, commit, and push. Users can refresh the source and reinstall:

```powershell
codex plugin marketplace upgrade codex-learning
codex plugin add learn-codex@codex-learning
```

Start a new Codex task to pick up updated skills. Do not commit `.learning/`, personal notes, credentials, or test screenshots.

GitHub distribution is separate from submission to the official public plugin directory.
