# AGENTS.md

## Purpose

Trailblazer is an Electron desktop app for coordinating coding agents across GitHub repositories. Users connect GitHub, add repos to a project, create multi-repo features, ask Claude Code or Codex CLI to work in isolated git worktrees, inspect diffs, and create pull requests.

This file is for agents working on Trailblazer itself. It follows the Builder.io AGENTS.md guidance: clear do/don't rules, project structure, commands, safety, examples, and PR expectations.

## Do

- Keep changes scoped to the requested behavior.
- Prefer existing services, IPC patterns, and shared types over new abstractions.
- Use TypeScript types from `src/shared/types.ts` and IPC channel names from `src/shared/ipc.ts`.
- Keep main-process logic in `src/main/services/*` and renderer UI logic in `src/renderer/*`.
- Preserve user data migrations in `src/main/services/db.ts`; add migrations defensively and keep old installs working.
- Treat feature workspaces and issue worktrees as user code. Do not assume they are this repository.
- Use `simple-git` for git operations unless a service already exposes a helper.
- Use Octokit through `src/main/services/github.ts` for GitHub API calls.
- Keep renderer components functional and small.
- Reuse `src/renderer/components/ui.tsx`, `src/renderer/lib/cn.ts`, and existing visual patterns.
- Keep dark UI styling consistent with `src/renderer/styles.css` and Tailwind classes.
- Run focused typechecks after TypeScript changes.

## Don't

- Do not rewrite unrelated UI or service structure.
- Do not bypass IPC by exposing Node APIs directly to the renderer.
- Do not put GitHub tokens, auth state, or file system access in renderer code.
- Do not run `git push`, create releases, or publish packages unless explicitly asked.
- Do not delete worktrees, repos, database files, or generated release artifacts without explicit approval.
- Do not add heavy dependencies unless the user asks or there is a strong reason.
- Do not hard-code absolute user paths in source code.
- Do not modify generated output in `out/` or packaged app artifacts as the source of truth.

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run typecheck:node
npm run typecheck:web
npm run gen:icon
npm run package:mac
npm run package:win
```

Use focused checks while iterating:

```bash
npm run typecheck:node
npm run typecheck:web
```

Use `npm run build` when main, preload, renderer bundling, path aliases, or packaging-facing code changed.

## Safety And Permissions

Allowed without asking:

- Read, list, and search files.
- Run typecheck and build commands.
- Run non-destructive git inspection commands like `git status`, `git diff`, `git log`, and `git show`.

Ask first:

- Installing dependencies.
- Publishing releases.
- Pushing branches or tags.
- Removing files, worktrees, cloned repos, app data, or database files.
- Running commands that need network access unless the task clearly requires it.

## Project Structure

- `src/main/index.ts`: Electron app lifecycle, BrowserWindow creation, app icon resolution, updater initialization, and userData migration.
- `src/main/ipc/index.ts`: IPC registration. Renderer calls should be wired here and delegated to services.
- `src/preload/index.ts`: Safe renderer API exposed through `contextBridge`.
- `src/shared/ipc.ts`: IPC channel constants. Add new channels here first.
- `src/shared/types.ts`: Shared types used by main, preload, and renderer.
- `src/shared/models.ts`: Engine model lists and model-use-case typing.

Main services:

- `src/main/services/db.ts`: SQLite setup, migrations, encrypted key/value storage with Electron `safeStorage`.
- `src/main/services/engine.ts`: Claude Code and Codex CLI detection, argument construction, and process spawning.
- `src/main/services/agentInstructions.ts`: Shared prompt snippet that tells spawned agents to read target-repo `AGENTS.md` or `CLAUDE.md`.
- `src/main/services/ghAuth.ts`: GitHub CLI auth detection, device login, scope refresh, token retrieval, and auth events.
- `src/main/services/github.ts`: Octokit wrapper for repos, issues, PRs, merge/close operations.
- `src/main/services/git.ts`: Clone, worktree, diff, commit, push, and remote URL helpers.
- `src/main/services/claudeRunner.ts`: Single-issue issue-to-PR runner for one repo worktree.
- `src/main/services/issueExpander.ts`: Agent-assisted issue body/title generation from a user brief.
- `src/main/services/features.ts`: Multi-repo feature records, workspaces, sessions, and worktree setup.
- `src/main/services/featureRunner.ts`: Feature chat execution, activity parsing, commits, diff summaries, and PR creation.
- `src/main/services/agentParser.ts`: Converts Claude/Codex JSONL output into UI activity events.
- `src/main/services/modelDiscovery.ts`: Discovers available models from configured engines.
- `src/main/services/modelPrefs.ts`: Stores model preferences per use case.
- `src/main/services/updater.ts`: Electron auto-update state and IPC-facing update actions.

Renderer:

- `src/renderer/App.tsx`: Top-level layout and navigation state.
- `src/renderer/main.tsx`: React entry point.
- `src/renderer/styles.css`: Tailwind layers, theme variables, and custom app animations.
- `src/renderer/stores/app.ts`: Zustand app navigation store.
- `src/renderer/pages/Projects.tsx`: Project list, GitHub setup flow, repo selection entry points.
- `src/renderer/pages/ProjectView.tsx`: Project details, issues, repos, feature access.
- `src/renderer/pages/FeaturesView.tsx`: Feature list and feature creation entry.
- `src/renderer/pages/FeatureChatView.tsx`: Multi-repo feature chat, sessions, model picker, PR creation.
- `src/renderer/pages/Onboarding.tsx`: Initial setup experience.
- `src/renderer/components/*`: Reusable dialogs, pickers, activity views, diff views, settings, and UI primitives.

Assets and build:

- `build/icon.svg`: Source for packaged app icons.
- `build/icon.png`, `build/icon.icns`, `build/icon.ico`: Generated platform icons.
- `build/logo.svg`: README logo.
- `build/logo-black-bg.png`: Square black-background logo asset for organization/profile use.
- `scripts/generate-icon.mjs`: Regenerates platform icons from `build/icon.svg`.
- `electron.vite.config.ts`: Electron Vite config and path aliases.
- `package.json`: npm scripts, Electron Builder config, release targets.

## Data Flow

Setup:

1. Renderer calls preload API.
2. Preload forwards to IPC channels from `src/shared/ipc.ts`.
3. Main IPC handlers call services.
4. Services store data in SQLite under Electron `userData`.

Issue flow:

1. User selects a repo and optionally expands a brief.
2. `issueExpander.ts` runs the configured engine in read-only mode in the cloned repo.
3. `github.ts` creates the issue.
4. `claudeRunner.ts` creates an isolated worktree for issue resolution.
5. Engine runs in write mode.
6. Trailblazer commits changes, shows diff, waits for approval, pushes, and opens a PR.

Feature flow:

1. `features.ts` creates a feature workspace under userData and one git worktree per selected repo.
2. `featureRunner.ts` runs feature chat turns from the workspace root.
3. First turns include repo/branch context and target-repo instruction-file lookup.
4. Subsequent turns resume the engine's native session where possible.
5. `createPRs` commits outstanding changes, pushes feature branches, generates PR copy, and opens PRs per repo.

Auth flow:

1. GitHub auth can use a PAT or GitHub CLI.
2. Tokens are stored through encrypted KV helpers in `db.ts`.
3. Before pushes, remote URLs are refreshed so cloned worktrees use the current token.

## Prompt And Agent Rules

- Any prompt that sends an agent into user code should include `AGENT_INSTRUCTIONS_FILE_PROMPT`.
- That prompt tells the spawned agent to search the target worktree for `AGENTS.md`, then `CLAUDE.md`.
- Do not confuse this root `AGENTS.md` with target-repo instructions. This file guides work on Trailblazer itself.
- For multi-repo features, instructions must be checked per repo subdirectory.

## Good Examples

- For IPC wiring, follow existing handlers in `src/main/ipc/index.ts`.
- For new shared API shapes, update `src/shared/ipc.ts`, `src/shared/types.ts`, and `src/preload/index.ts` together.
- For main service code, follow the small exported function style in `src/main/services/features.ts` and `src/main/services/github.ts`.
- For runner/event code, follow `featureRunner.ts` event emission and parser usage.
- For renderer dialogs, follow `NewFeatureModal.tsx`, `NewIssueModal.tsx`, and `SettingsModal.tsx`.
- For display components, follow `ActivityList.tsx`, `FeatureChangesPanel.tsx`, and `DiffView.tsx`.

## PR Checklist

- Typechecks pass for changed areas.
- Build passes if bundling, Electron main/preload, aliases, or package config changed.
- DB migrations are backwards compatible.
- Renderer changes do not require Node access outside preload.
- Agent prompt changes are clear about cwd and target repo context.
- Diffs are focused and do not include unrelated generated files.
- No secrets, tokens, local absolute paths, or app data files are committed.

## When Stuck

- Search before adding a new pattern.
- Prefer a short plan or question over speculative rewrites.
- If an engine behavior is unclear, inspect `engine.ts`, parser output handling, and the relevant runner before changing UI.
- If GitHub behavior is unclear, check whether the app is using PAT or `gh` auth and whether scopes are current.
