<div align="center">
  <img src="build/logo.svg" width="120" alt="Trailblazer" />
  <h1>Trailblazer</h1>
  <p><strong>Multi-repo agent orchestrator for Claude Code and Codex.</strong></p>
  <p>
    <a href="#download">Download</a> ·
    <a href="#quick-start">Quick Start</a> ·
    <a href="#features">Features</a> ·
    <a href="#building-from-source">Build</a>
  </p>
</div>

<!-- TODO: badges -->
<!--
  ![Build](https://img.shields.io/github/actions/workflow/status/<owner>/trailblazer/ci.yml)
  ![Release](https://img.shields.io/github/v/release/<owner>/trailblazer)
  ![License](https://img.shields.io/github/license/<owner>/trailblazer)
  ![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-orange)
-->

---

Trailblazer is a desktop app that lets coding agents work across **multiple repos at once**.
Group repositories into projects, describe issues, watch an agent resolve them, then review
and merge — all from one window.

> Pick **Claude Code** or **Codex** as the engine. Bring your existing GitHub login via the
> `gh` CLI. No PAT shuffle.

<!-- TODO: hero screenshot of the Features tab with chat + changes panel -->
<p align="center">
  <img src="docs/screenshots/hero.png" width="900" alt="Trailblazer feature view" />
</p>

## Why

Most coding agents top out at "fix this file in this repo." Real product work spans repos —
backend, frontend, infra, SDKs. Trailblazer treats a **feature** as a workspace across all
the repos it touches:

- One agent, one prompt, one chat — but the worktree it sees is your whole feature.
- Per-repo branches, per-repo PRs, per-repo diffs. Reviewed in one place.
- Sessions remember context. Pick up where you left off, or branch into a new line of thought
  without losing the old one.

## Features

### Multi-repo features

Create a feature with a name and a set of repos. Trailblazer creates a `feature/<slug>`
branch in each repo and stitches them into a shared workspace the agent operates in.

<!-- TODO: screenshot of New Feature modal -->
<p align="center">
  <img src="docs/screenshots/new-feature.png" width="720" alt="New feature modal" />
</p>

### Agent chat with sessions

The feature view is a chat. Each turn streams the agent's reasoning, tool calls (Read, Edit,
Bash, Grep…), and file changes in real time. Run multiple **sessions** in parallel for the
same feature — each one keeps its own conversation history, its own checkpoint baseline,
and resumes via the engine's native session id (`claude --resume`, `codex exec --resume`).

<!-- TODO: screenshot of chat with activity stream + changes panel + sessions sidebar -->
<p align="center">
  <img src="docs/screenshots/chat.png" width="900" alt="Feature chat" />
</p>

### Issues to PRs

A separate **Issues** tab shows GitHub issues across every repo in a project. Add a one-line
brief and the agent expands it into a detailed issue, grounded in your codebase. Pick an
issue and hit **Resolve** — the agent works in an isolated worktree, you review the diff
inline, and a PR opens with `Closes #N` wired up.

<!-- TODO: screenshot of issues table + Add Issue modal -->
<p align="center">
  <img src="docs/screenshots/issues.png" width="900" alt="Issues view" />
</p>

### Inline diff review

A built-in diff viewer with proper syntax highlighting (Prism / oneDark) and line-number
gutters. Click any changed file in the Changes panel or PR Review modal to see it.

<!-- TODO: screenshot of diff modal -->
<p align="center">
  <img src="docs/screenshots/diff.png" width="900" alt="Diff viewer" />
</p>

### One-click PRs

When the work is good, hit **Create PRs**. Trailblazer pushes each feature branch and opens
a PR per repo against the configured base branch (or reuses an existing one). "Open all in
browser" sends every PR to your default browser.

### Engine choice + per-use-case models

Bring your own setup:

- **Claude Code** (`@anthropic-ai/claude-code`) or **Codex CLI** (`@openai/codex`).
- Pick the model **per use case** in Settings: issue creation, PR generation. The feature
  chat lets you choose **per-message**.
- Models are curated per engine and probed via the CLI's interactive `/model` command so
  the list reflects what your account can actually access. Custom model IDs supported.

### Quality-of-life

- `gh` CLI sign-in (SSO handled in the browser); PAT fallback when `gh` isn't installed.
- Persistent local cache for issues/PRs so the app feels instant on open.
- Session-scoped diff view alongside an overall feature diff.
- Commit checkpoints from inside the chat panel.
- Repo-filter pills when a project spans many repos.
- Working-branch override per repo (some teams branch from `develop`, not `main`).

## Download

These links always resolve to the latest release.

| Platform | Architecture | Link |
| --- | --- | --- |
| macOS  | Apple Silicon (arm64) | [Trailblazer-mac-arm64.dmg](https://github.com/Trailblazer-Labs/trailblazer/releases/latest/download/Trailblazer-mac-arm64.dmg) |
| macOS  | Intel (x64)           | [Trailblazer-mac-x64.dmg](https://github.com/Trailblazer-Labs/trailblazer/releases/latest/download/Trailblazer-mac-x64.dmg) |
| Windows | x64                  | [Trailblazer-win-x64.exe](https://github.com/Trailblazer-Labs/trailblazer/releases/latest/download/Trailblazer-win-x64.exe) |

See [all releases](https://github.com/Trailblazer-Labs/trailblazer/releases) for changelogs, older versions, and checksums. After install, Trailblazer auto-updates in the background when a new release is published.

## Requirements

- **Node 20+** (Node 22 LTS recommended) to build from source.
- One of:
  - **Claude Code CLI** — `npm i -g @anthropic-ai/claude-code`, plus a signed-in `claude` session.
  - **Codex CLI** — `npm i -g @openai/codex`, plus a signed-in `codex` session.
- **GitHub CLI** (`gh`) for the easiest sign-in. Optional — a Personal Access Token also works.
- **git** on your `PATH`.

## Quick start

1. Install Trailblazer (see [Download](#download) or [Build](#building-from-source)).
2. Launch the app. The first-run setup walks you through:
   1. GitHub sign-in (via `gh auth login` or a PAT).
   2. Pick an engine (Claude Code or Codex). Trailblazer detects what's installed.
3. **Create a project** and pick the repositories it spans.
4. Either:
   - Open the **Features** tab → **New feature** → pick repos and chat your way through it.
   - Open the **Issues** tab → **+ Add Issue** to file, or pick one and click **Resolve**.
5. When you're happy with the work, **Create PRs** opens one PR per repo.

## Building from source

Trailblazer is an Electron + Vite + React + TypeScript app.

```bash
git clone https://github.com/<owner>/trailblazer.git
cd trailblazer
npm install
npm run dev          # dev with hot reload
```

Native modules (`better-sqlite3`, `node-pty`) are rebuilt against Electron's ABI via the
`postinstall` hook. If a rebuild fails:

```bash
npx electron-rebuild
```

### Packaging

```bash
npm run package:mac    # produces a .dmg in dist/
npm run package:win    # produces an .nsis installer in dist/
```

### Auto updates

Packaged builds check GitHub Releases for updates on startup and from Settings. macOS builds
produce both `.dmg` and `.zip` artifacts because Electron's macOS updater needs the zip plus
the generated update metadata.

Merges to `main` publish macOS and Windows releases through GitHub Actions. The workflow derives
the major/minor version from `package.json` and sets the packaged app version to
`<major>.<minor>.<github-run-number>` before building, so each main-branch build has a higher
SemVer version for the updater to discover. The release artifacts are uploaded to GitHub Releases
under `Trailblazer-Labs/trailblazer`.

For a prerelease:

```bash
npm version prerelease --preid beta
npm run release:mac
npm run release:win
```

The in-app updater allows prereleases so beta users can move forward without reinstalling
manually. Production update installs should use signed builds, especially on macOS and Windows.
Configure the `CSC_LINK` and `CSC_KEY_PASSWORD` repository secrets for code signing. Add the
Apple notarization secrets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for
signed macOS releases.

### Generating icons

The icon SVG lives at `build/icon.svg`. Regenerate platform icons after editing:

```bash
npm run gen:icon   # writes build/icon.png, build/icon.icns, build/icon.ico
```

## Tech stack

- **Electron 32** — desktop shell.
- **electron-vite + Vite 5** — bundler and dev server.
- **React 18 + TypeScript** — renderer.
- **TanStack Query** with `localStorage` persistence — data fetching & caching.
- **better-sqlite3** — local state (projects, repos, features, sessions, messages).
- **simple-git** — worktree management and diffs.
- **node-pty** — interactive CLI integration for `gh auth login` and model discovery.
- **@octokit/rest** — GitHub API.
- **Tailwind + custom theme** — UI.

## Architecture

```
src/
  main/              Electron main process
    ipc/             IPC handler registration
    services/        github, git, features, runner, parsers, prefs
  preload/           Context-bridge: typed window.api surface
  renderer/          React app
    pages/           Projects, ProjectView, FeatureChatView, Onboarding
    components/      Modals, panels, diff view, activity stream
    stores/          Zustand for app/view state
  shared/            Types + IPC channel constants used by both sides
```

Local data lives under your platform's userData directory:

- macOS: `~/Library/Application Support/Trailblazer/`
- Windows: `%APPDATA%/Trailblazer/`

Inside:

- `trailblazer.db` — SQLite (encrypted secrets via Electron `safeStorage`).
- `repos/` — bare clones of every repo across all projects.
- `worktrees/` — per-issue resolve worktrees (cleaned up after PR open).
- `features/<id>-<slug>/<repo>` — long-lived feature workspaces.

## Configuration

Most configuration lives in the in-app **Settings** modal. A few power-user knobs:

- `engine.kind`, `engine.claude.path`, `engine.codex.path` (kv) — engine binary overrides.
- `model.<useCase>.<engine>` (kv) — per-use-case model id.
- `working_branch` on each repo row — base branch for new feature/issue branches.

There's currently no settings file — everything's in SQLite. A migration to a sidecar
config file is planned (see [Roadmap](#roadmap)).

## Roadmap

<!-- TODO: keep this short and honest -->

- [ ] Cross-platform packaging + auto-update.
- [ ] Inline PR comments / review threads in the in-app PR viewer.
- [ ] Multi-message broadcasts (one prompt fanned out across affected repos in parallel).
- [ ] Telemetry-free crash reporting.
- [ ] Settings export / import.
- [ ] Linux builds.

## Contributing

Issues and PRs welcome. The codebase is small enough to read through end-to-end in an
afternoon. Start with:

- `src/main/services/featureRunner.ts` — the agent spawn + per-turn lifecycle.
- `src/main/services/agentParser.ts` — Claude stream-json / Codex JSONL → unified activities.
- `src/renderer/pages/FeatureChatView.tsx` — the chat UI.

Before sending a PR:

```bash
npm run typecheck    # node + web
npm run build        # makes sure both bundles assemble
```

## License

<!-- TODO: pick a license -->

To be added. MIT is the likely choice.

---
