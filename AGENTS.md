# AGENTS.md — tmux-opencode

## Project Overview

A bridge between OpenCode session state and tmux. It has two parts:

1. **OpenCode plugin** (`src/` → `dist/index.js`) — writes per-session JSON snapshots to a shared status directory as sessions change state.
2. **tmux plugin** (`tmux-opencode.tmux` + `scripts/`) — binds a key (default `prefix + O`) to open a popup that renders those snapshots.

## Architecture

```
OpenCode session lifecycle events
        │
        ▼
  src/index.ts (plugin)  ──writes──►  ${STATUS_DIR}/*.json  ◄──reads──  scripts/render_status.sh
                                              one file per session         (python3 inline)
                                                                        │
        src/status-store.ts                                          scripts/popup_command.sh
        src/types.ts                                                      │
                                                                   scripts/show_popup.sh
                                                                        │
                                                                   tmux display-popup
```

**Data flow:** Plugin receives OpenCode events → writes/deletes JSON snapshot files → tmux popup reads files on open. There is no live polling or websocket; the popup snapshot is taken at render time.

## File Map

### Plugin source (`src/`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin entrypoint. Handles `event()` and `permission.ask()` hooks. Maps lifecycle events to snapshot write/delete. |
| `src/types.ts` | `SessionSnapshot` interface, `SessionStatus` union (`working \| waiting \| question \| idle \| error`), `SessionKind` (`root \| subagent`), `STATUS_DIR_ENV_KEY`, `defaultStatusDirectory()`. |
| `src/status-store.ts` | Filesystem operations: `writeSnapshot` (atomic via tmp+rename), `deleteSnapshot`, `listSnapshots`. |
| `src/__tests__/index.test.ts` | 13 tests for plugin event handling. Uses vitest, writes to temp dirs via `TMUX_OPENCODE_STATUS_DIR`. |
| `src/__tests__/status-store.test.ts` | 10 tests for snapshot store (atomic writes, deletion, listing, malformed file handling). |
| `src/__tests__/types.test.ts` | 2 tests for constants. |

### tmux plugin (`scripts/`, root)

| File | Purpose |
|------|---------|
| `tmux-opencode.tmux` | TPM entrypoint. Reads `@opencode-key` option (default `O`), binds key to `show_popup.sh`. |
| `scripts/show_popup.sh` | Opens a tmux popup (`display-popup -E`) running `popup_command.sh`. |
| `scripts/popup_command.sh` | Runs `render_status.sh`, then waits for any keypress before closing. |
| `scripts/render_status.sh` | Inline Python3 script that reads JSON snapshots from status dir and prints a plain-text table. |

### Tests

| File | Purpose |
|------|---------|
| `test/render_status_test.sh` | Shell integration tests for the popup renderer. Creates fixture files, asserts output contains/excludes expected strings. |
| `test/fixtures/root-working.json` | Test fixture: a root session in "working" state. |
| `test/fixtures/subagent-waiting.json` | Test fixture: a subagent session in "waiting" state. |

## Event → Status Mapping (src/index.ts)

The plugin only writes snapshots for these explicit lifecycle events:

| Event | Action | Snapshot status |
|-------|--------|----------------|
| `session.deleted` | Delete snapshot | — |
| `session.idle` | Delete snapshot | — |
| `session.status` (idle) | Delete snapshot | — |
| `session.status` (busy) | Write snapshot | `working` |
| `session.status` (retry) | Write snapshot | `working` |
| `question.asked` | Write snapshot | `question` |
| `permission.asked` | Write snapshot | `waiting` |
| `permission.ask` hook | Write snapshot | `waiting` |
| All other events | Ignored | — |

**Important:** `message.updated`, `message.part.updated`, `message.part.delta`, `session.created`, and `session.updated` events are intentionally NOT handled. Previously they unconditionally wrote "working" snapshots, which caused stale "Session is busy" status when these events fired after the session had already gone idle.

## Snapshot Format

Each file is `${sessionID}.json` in the status directory:

```json
{
  "version": 1,
  "sessionID": "ses_abc123",
  "parentID": null,
  "kind": "root",
  "title": "Main session",
  "status": "working",
  "summary": "Session is busy",
  "updatedAt": 1713523200000
}
```

- `kind`: `"root"` when `parentID` is null/absent, `"subagent"` when `parentID` is set.
- `updatedAt`: epoch milliseconds from `Date.now()`.
- Write is atomic: writes to `.json.tmp`, then `rename()` to `.json`.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `TMUX_OPENCODE_STATUS_DIR` | `${TMPDIR:-/tmp}/opencode-status` | Directory for snapshot JSON files. |
| `TMUX_OPENCODE_SHOW_SUBAGENTS` | `0` | Set to `1` to include subagent sessions in popup. |
| `@opencode-key` tmux option | `O` | Key binding (used with tmux prefix). |

## Build & Test Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript src/ → dist/
npm run typecheck    # Type-check without emitting
npm test             # Run vitest suite (25 tests across 3 files)
bash test/render_status_test.sh  # Shell integration tests for popup renderer
```

- **Runtime:** Node.js (ES2022, ESM), Python 3 (for render script), bash.
- **Test framework:** vitest.
- **TypeScript:** strict mode, ESNext modules, bundler resolution.
- Tests are excluded from the build via `tsconfig.json` `"exclude"`.

## Plugin Installation

The plugin entrypoint is `dist/index.js`. Install it in OpenCode via:

1. Symlink: `ln -sf "$(pwd)/dist/index.js" ~/.config/opencode/plugin/tmux-opencode.js`
2. Or config: `{ "plugin": ["file:///path/to/tmux-opencode/dist/index.js"] }`

Rebuild (`npm run build`) and restart OpenCode after changes.

## Key Design Decisions

- **No polling:** The popup reads snapshots at open time only. There is no background refresh.
- **No stale filtering:** Old snapshots remain until explicitly deleted by an idle/delete event. This is intentional — a session that stops emitting events stays visible.
- **Atomic writes:** Snapshot files use tmp+rename to avoid partial reads.
- **Malformed file tolerance:** Both the store's `listSnapshots` and the render script skip invalid JSON silently.
- **Subagent filtering:** By default only root sessions appear in the popup. Set `TMUX_OPENCODE_SHOW_SUBAGENTS=1` to include subagents (prefixed with `-`).
