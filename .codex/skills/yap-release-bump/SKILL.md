---
name: yap-release-bump
description: Prepare clean Yap app releases with semantic version bumps, feature-grouped commits, PR-based release notes, tags, and GitHub Releases. Use when the user asks to release Yap, bump a version, cut a new version, create release notes, split release commits, open/merge a release PR, tag a release, or asks for "nice" Yap release messages based on the contents of the update.
---

# Yap Release Bump

Use this skill to ship Yap releases through a clean branch and PR flow, with grouped commits and release notes that match the repository's historical GitHub release style.

## Release Rule

Never make a direct-to-main release unless the user explicitly overrides this skill after being told the downside. The default release path is:

1. Inspect existing changes and previous releases.
2. Choose the next semantic version from the content.
3. Create or use a release branch.
4. Commit each logical feature/fix group separately.
5. Open a well-formatted PR.
6. Merge the PR.
7. Tag the merge commit.
8. Create or verify the GitHub Release notes.

If work has already been committed as one local unpushed commit, split it before pushing. If it has already been pushed to `main`, stop and ask before destructive history edits.

## Quick Context

Read `references/yap-release.md` before performing an actual release. It contains the repo-specific commands, version files, PR body shape, and release note style.

## Workflow

### 1. Inspect

Gather current state before changing anything:

- `git status --short --branch`
- `git tag --sort=-creatordate`
- `git log --oneline <latest-tag>..HEAD`
- Current versions in `desktop/package.json`, `desktop/pnpm-lock.yaml`, `desktop/native-core/Cargo.toml`, `desktop/native-core/Cargo.lock`, and `SPEC.md`
- Diff/stat of all uncommitted or branch changes
- Existing release note style from the latest comparable GitHub Releases

Call out dirty worktree state clearly. Do not overwrite user changes.

### 2. Choose Version

Choose the bump from the actual content:

- Patch: bug fixes, wording/copy corrections, small reliability fixes, CI fixes, docs-only updates.
- Minor: new user-visible settings, workflows, providers, UI surfaces, platform support, updater behavior, or meaningful feature polish.
- Major: breaking config changes, incompatible behavior, removed features, migration risk, or changed public contracts.

Use the latest released tag as the base. If package versions disagree with tags, pause and reconcile before release.

### 3. Branch

If not already on a suitable branch, create one from the intended base:

```bash
git switch -c release/vX.Y.Z-short-description
```

If changes are already present on `main` but unpushed, create the release branch at `HEAD`, then reset `main` back only if the user has explicitly approved. If changes are already pushed to `main`, ask before rewriting.

### 4. Group Commits

Commit by user-facing feature set, not by file type. Good Yap release groups look like:

- `feat: add background audio modes`
- `fix: restore Windows background audio`
- `fix: route provider errors to settings sections`
- `style: polish Settings layout`
- `chore: bump version to X.Y.Z`

Keep version bumps in the final commit unless the repository convention for that release says otherwise. Avoid one giant commit for a multi-feature release.

### 5. Verify

Run the repo's relevant checks before PR/merge:

```bash
cd desktop
pnpm run electron:check
pnpm run check
cargo check --manifest-path native-core/Cargo.toml --bin yap-core
cargo fmt --check --manifest-path native-core/Cargo.toml
pnpm run electron:build
```

If a command cannot run locally, report why in the PR and final answer.

### 6. PR

Open a PR from the release branch into `main`. The title should be concise and release-shaped:

```text
Release vX.Y.Z
```

The body must include:

- Summary grouped by feature/fix/style/chore.
- Testing checklist with exact commands run.
- Version bump files touched.
- Release note preview in the same style GitHub Releases should show.

Merge through GitHub so the release notes can reference a PR. Prefer the repository's usual merge strategy. Confirm the merge commit on `main` before tagging.

### 7. Tag And Release

Create the tag from the merge commit on `main`, matching older Yap tags:

```bash
git switch main
git pull --ff-only
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

After the release workflow finishes, inspect the GitHub Release body. If generated notes are empty or too vague, update the release body to the historical style while preserving `## What's Changed` and `**Full Changelog**`.

## Stop Conditions

Stop and ask before:

- Force-pushing `main`
- Deleting tags or GitHub Releases
- Reusing a version that already exists remotely
- Shipping from a failed or unverified build
- Releasing from direct `main` commits without a PR
