# tmux-opencode

A small bridge between OpenCode session state and tmux.

The project has two parts:

1. An OpenCode plugin that turns session events into daemon mutations.
2. A shared local daemon that owns the popup-visible SQLite state.
3. A TPM-compatible tmux plugin that opens a popup, asks the daemon for rows, and jumps to the selected tmux target.

## Requirements

- `tmux`
- `fzf`
- `python3.10+`
- Node.js 22+ (the daemon uses the built-in `node:sqlite` module)
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
bash test/prune_stale_snapshots_test.sh
bash test/show_popup_test.sh
```

## OpenCode plugin setup

This repo builds the OpenCode plugin entrypoint to `dist/index.js`. The plugin sends normalized session mutations to a shared daemon over a Unix socket. The daemon owns the SQLite database that the popup treats as its source of truth.

By default the daemon stores its socket and database under:

```text
${TMUX_OPENCODE_DAEMON_DIR:-${TMPDIR:-/tmp}/tmux-opencode-daemon}
```

with these files:

- `daemon.sock` for local RPC
- `status.sqlite` for popup-visible session state

To override the daemon directory:

```bash
export TMUX_OPENCODE_DAEMON_DIR="$HOME/.cache/tmux-opencode-daemon"
```

The daemon stores the current visible row fields derived from plugin mutations:

- `sessionID`
- `parentID`
- `kind`
- `title`
- `projectName` (optional)
- `processPID` (root rows only)
- `tmuxSessionID` (optional)
- `tmuxWindowID` (optional)
- `tmuxPaneID` (optional)
- `status`
- `summary`
- `updatedAt`

`projectName` is taken from the OpenCode project context when available. The plugin prefers `project.name` and falls back to the worktree folder name.

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

Optional: override the default key binding (`prefix + o`):

```tmux
set -g @opencode-key 's'
```

Then install or reload with TPM:

```tmux
prefix + I
```

The tmux entrypoint is `tmux-opencode.tmux`. It binds the configured key to `scripts/show_popup.sh`, which opens a tmux popup and runs `scripts/popup_command.sh`.

The popup-side Python scripts in `scripts/` require Python 3.10 or newer.

On popup startup, `scripts/popup_command.sh` calls `dist/daemon-cli.js prune-and-list`. That command checks the daemon process, starts it when the daemon socket is absent, asks the daemon for popup-visible rows from SQLite, and passes the daemon JSON response to `scripts/render_status.sh`. If the first `prune-and-list` attempt fails, the popup follows the implemented restart-once retry path: run `dist/daemon-cli.js ensure-running` once, then retry `prune-and-list` once. If the retry fails, the popup exits with `daemon unavailable after one restart attempt` and the daemon error output.

The popup uses stored tmux metadata to jump to the selected tmux session, window, and pane. `fzf` displays and matches against the session status, project name, and title. The human-readable rows look like this:

```text
<status> <projectName> <title>
```

Subagents are prefixed with `- ` when shown.

## Session lifecycle behavior

- `session.created` sends an initial `idle` upsert mutation for the new session.
- `session.status` with `busy` or `retry` sends `working`; `idle` sends `idle`.
- `session.idle` also sends `idle`.
- `question.asked` sends `question`.
- `permission.asked` and the `permission.ask` hook send `waiting` with the permission type in the summary.
- `tui.session.select` selecting a root session replaces the previous visible root for that plugin instance; selecting a child session keeps the existing visible root and only sends an `idle` upsert for the child.
- `session.new` sends a daemon `delete-session-tree` mutation for the current root before the replacement session is created.
- `/exit` and other `*.exit` commands send `delete-session-tree` for the current root; child-session exits are left visible until the root topic is cleared.
- `session.deleted` sends `delete-session-tree` for roots; child-session deletions are left visible until the root topic is cleared.
- Message streaming events such as `message.part.delta` are ignored; status is driven by explicit session and permission events.

## Viewer behavior

- By default, only root sessions are shown.
- To include subagents, set `TMUX_OPENCODE_SHOW_SUBAGENTS=1` in the tmux environment before launching the popup.
- SQLite rows are read through the daemon; malformed daemon responses fail before `fzf` is shown.
- Idle sessions stay visible as `idle` rows until another event replaces or removes them.
- Each plugin instance keeps one visible root session at a time; selecting another session or creating a new one asks the daemon to remove the prior visible root tree from that instance.
- Child rows keep their `parentID` relationship in SQLite until the owning root session exits or is replaced with `/new`.
- Rows from other running OpenCode instances are left alone until those instances explicitly update or remove them.
- The popup requires `fzf`. If `fzf` is unavailable, the popup exits with a short error.
- Before showing `fzf`, popup startup is mediated by the daemon through the `prune-and-list` request. The daemon store contains the stale-root pruning rules: a root can be removed with descendants when its recorded `processPID` is not running or its complete tmux session/window/pane target is not live. When real liveness inputs are unavailable, rows are kept visible rather than guessed stale.
- Rows that lack enough metadata to prove staleness (no `processPID` and no complete tmux metadata) are kept visible.
- Pressing Enter on a selectable row jumps to the stored tmux session, window, and pane.
- Canceling `fzf` exits cleanly without changing tmux state.
- Selecting a row that lacks tmux metadata fails safely with a short error.
- If no daemon rows render, the popup shows `No active opencode sessions`.
- The popup is a point-in-time snapshot taken when it opens; there is no live refresh.

## Manual smoke test

Build first so the daemon CLI exists:

```bash
npm run build
```

Start or check the daemon and list rows:

```bash
TMUX_OPENCODE_DAEMON_DIR="$PWD/.tmp-daemon" node dist/daemon-cli.js ensure-running
TMUX_OPENCODE_DAEMON_DIR="$PWD/.tmp-daemon" node dist/daemon-cli.js prune-and-list
```

Open the interactive selector directly:

```bash
TMUX_OPENCODE_DAEMON_DIR="$PWD/.tmp-daemon" bash scripts/popup_command.sh
```
