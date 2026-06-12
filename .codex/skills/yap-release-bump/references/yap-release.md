# Yap Release Reference

## Version Files

Update all of these for a release:

- `desktop/package.json`
- `desktop/native-core/Cargo.toml`
- `desktop/native-core/Cargo.lock`

Prefer:

```bash
cd desktop
pnpm version X.Y.Z --no-git-tag-version
cargo check --manifest-path native-core/Cargo.toml --bin yap-core
```

Then verify no stale app version remains, ignoring unrelated dependency versions.

## Historical Release Style

Yap releases use this shape:

```md
## What's Changed
* feat: concise user-facing change by @oobagi in https://github.com/oobagi/yap/pull/NN
* fix: concise user-facing fix by @oobagi in https://github.com/oobagi/yap/pull/NN
* chore: bump version to X.Y.Z by @oobagi in https://github.com/oobagi/yap/pull/NN


**Full Changelog**: https://github.com/oobagi/yap/compare/vPREV...vX.Y.Z
```

Use PR links when a PR exists. If a user explicitly requires direct commits and no PR exists, use commit links only as a fallback and say why.

Good bullets are terse but specific:

- `feat: add press enter after paste setting`
- `feat: redesign settings UI`
- `fix: relaunch after Accessibility grant`
- `fix: clean up Accessibility prompt`

Avoid vague bullets:

- `feat: polish release`
- `fix: update app`
- `chore: changes`

## PR Body Template

```md
## Summary
- feat: ...
- fix: ...
- style: ...
- chore: bump version to X.Y.Z

## Testing
- [x] `pnpm run check`
- [x] `pnpm run electron:check`
- [x] `cargo check --manifest-path native-core/Cargo.toml --bin yap-core`
- [x] `cargo fmt --check --manifest-path native-core/Cargo.toml`
- [x] `pnpm run electron:build`

## Release Notes Preview
## What's Changed
* feat: ... by @oobagi in this PR
* fix: ... by @oobagi in this PR
* chore: bump version to X.Y.Z by @oobagi in this PR


**Full Changelog**: https://github.com/oobagi/yap/compare/vPREV...vX.Y.Z
```

## Branch And Commit Style

Use branch names like:

- `release/vX.Y.Z-background-audio`
- `release/vX.Y.Z-windows-audio-fix`

Use conventional commits for grouped work:

- `feat: add background audio modes`
- `fix: restore Windows background audio`
- `fix: route provider errors to settings sections`
- `style: polish Settings controls`
- `chore: bump version to 2.4.0`

Do not combine unrelated features, fixes, styles, and version bumps into one commit unless the release is genuinely tiny.

## GitHub Checks

After pushing the tag, verify the release workflow:

```powershell
$headers=@{'User-Agent'='Codex'}
Invoke-RestMethod -Headers $headers -Uri 'https://api.github.com/repos/oobagi/yap/actions/runs/<run-id>'
Invoke-RestMethod -Headers $headers -Uri 'https://api.github.com/repos/oobagi/yap/releases/tags/vX.Y.Z'
```

Wait for Windows, macOS, and release jobs to finish before calling the release done.
