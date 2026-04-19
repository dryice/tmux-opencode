# tmux-opencode

A small bridge between OpenCode session state and tmux.

The project has two parts:

1. An OpenCode plugin that writes per-session JSON snapshots into a shared status directory.
2. A TPM-compatible tmux plugin that opens a popup and renders those snapshots.

## Requirements

- `tmux`
- `python3`
- `npm`
- OpenCode with plugin support

## Local development

Install dependencies:

```bash
npm install
```

Run the TypeScript tests and typecheck:

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
- `status`
- `summary`
- `updatedAt`

To override the snapshot directory:

```bash
export TMUX_OPENCODE_STATUS_DIR="$HOME/.cache/opencode-status"
```

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

The tmux entrypoint is `tmux-opencode.tmux`. It binds the configured key to `scripts/show_popup.sh`, which opens a tmux popup and runs `scripts/render_status.sh`.

## Viewer behavior

- By default, only root sessions are shown.
- To include subagents, set `TMUX_OPENCODE_SHOW_SUBAGENTS=1` in the tmux environment before launching the popup.
- Malformed snapshot files are ignored.
- Snapshots older than 60 seconds are treated as stale and hidden.
- If no valid snapshots exist, the popup shows `No active opencode sessions`.

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
