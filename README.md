# tmux-opencode

A small bridge between OpenCode session state and tmux.

The project has two parts:

1. An OpenCode plugin that writes per-session JSON snapshots into a shared status directory.
2. A TPM-compatible tmux plugin that opens a popup and renders those snapshots.

## Requirements

- `tmux`
- `fzf`
- `python3`
- `npm`
- OpenCode with plugin support

## Local development

Install dependencies:

```bash
npm install
```

Run the TypeScript tests, typecheck, and build:

```bash
npm test
npm run typecheck
npm run build
```

Run the shell viewer tests:

```bash
bash test/render_status_test.sh
```

## OpenCode plugin setup

This repo builds the OpenCode plugin entrypoint to `dist/index.js`. The plugin writes JSON snapshots to:

```text
${TMUX_OPENCODE_STATUS_DIR:-${TMPDIR:-/tmp}/opencode-status}
```

The writer uses these snapshot fields:

- `version`
- `sessionID`
- `parentID`
- `kind`
- `title`
- `projectName` (optional)
- `tmuxSessionID` (optional)
- `tmuxWindowID` (optional)
- `tmuxPaneID` (optional)
- `status`
- `summary`
- `updatedAt`

`projectName` is taken from the OpenCode project context when available. The plugin prefers `project.name` and falls back to the worktree folder name.

To override the snapshot directory:

```bash
export TMUX_OPENCODE_STATUS_DIR="$HOME/.cache/opencode-status"
```

### Local development

Build the plugin first:

```bash
npm run build
```

Then add it to OpenCode with either of these approaches:

1. Symlink the built entrypoint into the global plugin directory:

```bash
mkdir -p ~/.config/opencode/plugin
ln -sf "$(pwd)/dist/index.js" ~/.config/opencode/plugin/tmux-opencode.js
```

2. Or register the built file explicitly in your OpenCode config:

```json
{
  "plugin": ["file:///absolute/path/to/tmux-opencode/dist/index.js"]
}
```

Restart OpenCode after rebuilding or changing the plugin.

### Normal user install

Until this package is published, normal users should use the same file-based install flow as local development: point OpenCode at the built `dist/index.js` file, either through `~/.config/opencode/plugin/` or a `file://...` plugin entry in `opencode.json`.

Once the package is published, users can install it by package name instead:

```json
{
  "plugin": ["tmux-opencode"]
}
```

Or with the helper CLI:

```bash
ocx add npm:tmux-opencode
```

Because the package is currently marked `"private": true`, the npm-style install path is not available yet.

## tmux / TPM setup

Add the plugin to your `.tmux.conf`:

```tmux
set -g @plugin 'dryice/tmux-opencode'
```

Optional: override the default key binding (`prefix + O`):

```tmux
set -g @opencode-key 's'
```

Then install or reload with TPM:

```tmux
prefix + I
```

The tmux entrypoint is `tmux-opencode.tmux`. It binds the configured key to `scripts/show_popup.sh`, which opens a tmux popup and runs `scripts/popup_command.sh`.

The popup uses stored tmux metadata to jump to the selected tmux session, window, and pane. `fzf` displays and matches against the session status, project name, and title. The human-readable rows look like this:

```text
<status> <projectName> <title>
```

Subagents are prefixed with `- ` when shown.

## Session lifecycle behavior

- `session.created` writes an initial `idle` snapshot for the new session.
- `session.status` with `busy` or `retry` writes `working`; `idle` writes `idle`.
- `session.idle` also writes `idle`.
- `question.asked` writes `question`.
- `permission.asked` and the `permission.ask` hook write `waiting` with the permission type in the summary.
- `tui.session.select` switches the visible root session for that plugin instance and writes an `idle` snapshot for the selected session.
- `session.new` removes the current root snapshot and every descendant snapshot before the replacement session is created.
- `/exit` and other `*.exit` commands remove the current root snapshot and all descendant snapshots; child-session exits are left visible until the root topic is cleared.
- `session.deleted` removes the root snapshot tree; child-session deletions are left visible until the root topic is cleared.
- Message streaming events such as `message.part.delta` are ignored; status is driven by explicit session and permission events.

## Viewer behavior

- By default, only root sessions are shown.
- To include subagents, set `TMUX_OPENCODE_SHOW_SUBAGENTS=1` in the tmux environment before launching the popup.
- Malformed snapshot files are ignored.
- Idle sessions stay visible as `idle` rows until another event replaces or removes them.
- Each plugin instance keeps one visible root session at a time; selecting another session or creating a new one replaces the prior visible root snapshot from that instance.
- Child snapshots keep their `parentID` relationship and remain on disk until the owning root session exits or is replaced with `/new`.
- Snapshots from other running OpenCode instances are left alone until those instances explicitly update or remove them.
- The popup requires `fzf`. If `fzf` is unavailable, the popup exits with a short error.
- Pressing Enter on a selectable row jumps to the stored tmux session, window, and pane.
- Canceling `fzf` exits cleanly without changing tmux state.
- Selecting a row that lacks tmux metadata fails safely with a short error.
- If no valid snapshots exist, the popup shows `No active opencode sessions`.
- The popup is a point-in-time snapshot taken when it opens; there is no live refresh.

## Manual smoke test

Write a demo snapshot:

```bash
mkdir -p "$PWD/.tmp-status"
python3 <<'PY'
import json
import os
import time
from pathlib import Path

status_dir = Path(os.getcwd()) / ".tmp-status"
status_dir.mkdir(parents=True, exist_ok=True)
(status_dir / "demo.json").write_text(json.dumps({
    "version": 1,
    "sessionID": "demo",
    "parentID": None,
    "kind": "root",
    "title": "Demo",
    "projectName": "tmux-opencode",
    "tmuxSessionID": "$1",
    "tmuxWindowID": "@2",
    "tmuxPaneID": "%3",
    "status": "working",
    "summary": "Waiting for tmux",
    "updatedAt": int(time.time() * 1000),
}, indent=2) + "\n", encoding="utf-8")
PY
```

Render it directly:

```bash
TMUX_OPENCODE_STATUS_DIR="$PWD/.tmp-status" bash scripts/render_status.sh
```

Open the interactive selector directly:

```bash
TMUX_OPENCODE_STATUS_DIR="$PWD/.tmp-status" bash scripts/popup_command.sh
```
