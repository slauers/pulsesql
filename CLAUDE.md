# CLAUDE.md

**Core Loop**: Gather context → Act → Verify → Repeat.

## 1. Execution & Context
* **Phased Execution**: Limit to 5 files per phase. Wait for explicit approval before proceeding.
* **Plan First**: Output architectural plans for vague/large requests. Do not write code until the plan is approved.
* **One-Word Mode**: Respond to "Yes/do it/push" by executing immediately with zero commentary.
* **Context Decay**: Re-read files after 10+ messages. Run `/compact` and write state to `context-log.md` on degradation.
* **Cache Integrity**: Keep system prompt and tools static. Launch sub-agents for model switches or parallel tasks.
* **File System as State**: Use `grep`/`jq` instead of full file loads. Persist intermediate work to markdown files.

## 2. Code Quality & Edit Safety
* **Senior Standard**: Propose structural fixes for flawed/duplicated state. Favor simple, correct, and elegant solutions.
* **Forced Verification**: Never report "Done" without running the strict type-checker and checking logs.
* **Clean First**: Remove dead code/imports before refactoring files >300 LOC. Commit cleanup separately.
* **Read Before Edit**: Edit tools fail silently on stale context. Max 3 edits per file between verification reads.
* **Destructive Safety**: Verify all references before deleting. Do not push unless explicitly commanded.
* **Autonomous Fixes**: Trace logs/errors to resolve bugs independently. Add user corrections to `gotchas.md`.

## 3. PulseSQL Stack & Commands
* **Frontend**: React 19 (TypeScript), Zustand, Vite.
* **Backend**: Tauri 2 (Rust), SQLite, Oracle JDBC sidecar.
* **Dev Scripts**: `npm run app:dev` (Mac/Linux), `npm run app:dev:win` (Windows).
* **Build Scripts**: `npm run app:build` (Mac/Linux), `npm run app:build:win` (Windows).
* **Validation**: Run `npx tsc --noEmit` for type checking (no linters/test suites configured).

## 4. Architecture & Patterns
* **Frontend Structure**: Feature-based under `src/features/` (connections, query, database, history, settings).
* **State Management**: Zustand in `src/store/`. Persisted data (queries, connections, uiPreferences) normalizes on retrieval. Runtime data is in-memory.
* **Backend Operations**: Database I/O happens entirely in Rust (`src-tauri/src/db.rs`), bridged via Tauri `invoke()`.
* **Communication**: Use custom events (`pulsesql:*`) for cross-feature actions instead of lifting state globally.
* **Theming**: CSS custom properties on document root ("PulseSQL Dark", "Teal Grid").
* **Dev Mode**: Set `LOCK_SPLASH_FOR_DEV = true` in `src/devFlags.ts` to freeze the splash screen.
* **Releasing**: Sync versions exactly across `package.json`, `tauri.conf.json`, and `Cargo.toml`.