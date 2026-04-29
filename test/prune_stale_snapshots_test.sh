#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tmux-opencode-prune-test.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

assert_file_exists() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    printf 'Expected file to exist: %s\n' "$path" >&2
    exit 1
  fi
}

assert_file_not_exists() {
  local path="$1"
  if [[ -f "$path" ]]; then
    printf 'Expected file NOT to exist: %s\n' "$path" >&2
    exit 1
  fi
}

cat > "$WORK_DIR/write_snapshots.py" <<'PY'
import json
import os
from pathlib import Path

status_dir = Path(os.environ["WORK_DIR"])
current_pid = int(os.environ["CURRENT_PID"])

snapshots = [
    {
        "sessionID": "live-pid-root",
        "parentID": None,
        "kind": "root",
        "title": "Live PID root",
        "processPID": current_pid,
    },
    {
        "sessionID": "dead-pid-root",
        "parentID": None,
        "kind": "root",
        "title": "Dead PID root",
        "processPID": 99999999,
    },
    {
        "sessionID": "dead-pid-child",
        "parentID": "dead-pid-root",
        "kind": "subagent",
        "title": "Dead PID child",
    },
    {
        "sessionID": "live-tmux-root",
        "parentID": None,
        "kind": "root",
        "title": "Live tmux root",
        "tmuxSessionID": "$live",
        "tmuxWindowID": "@live",
        "tmuxPaneID": "%live",
    },
    {
        "sessionID": "dead-tmux-root",
        "parentID": None,
        "kind": "root",
        "title": "Dead tmux root",
        "tmuxSessionID": "$dead",
        "tmuxWindowID": "@dead",
        "tmuxPaneID": "%dead",
    },
    {
        "sessionID": "dead-tmux-child",
        "parentID": "dead-tmux-root",
        "kind": "subagent",
        "title": "Dead tmux child",
    },
    {
        "sessionID": "legacy-root",
        "parentID": None,
        "kind": "root",
        "title": "Legacy root",
    },
]

for index, snapshot in enumerate(snapshots):
    payload = {
        "version": 1,
        "projectName": "tmux-opencode",
        "status": "working",
        "summary": "Prune test",
        "updatedAt": 4102444800000 + index,
        **snapshot,
    }
    (status_dir / f"{payload['sessionID']}.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

WORK_DIR="$WORK_DIR" CURRENT_PID="$$" python3 "$WORK_DIR/write_snapshots.py"

mkdir -p "$WORK_DIR/bin"
cat > "$WORK_DIR/bin/tmux" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1" in
  has-session)
    if [[ "$2" == "-t" && "$3" == '$live' ]]; then
      exit 0
    fi
    exit 1
    ;;
  list-windows)
    if [[ "$2" == "-t" && "$3" == '$live' ]]; then
      printf '@live\n'
      exit 0
    fi
    exit 1
    ;;
  list-panes)
    if [[ "$2" == "-t" && "$3" == '@live' ]]; then
      printf '%%live\n'
      exit 0
    fi
    exit 1
    ;;
esac

exit 2
EOF
chmod +x "$WORK_DIR/bin/tmux"

PATH="$WORK_DIR/bin:$PATH" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" python3 "$ROOT_DIR/scripts/prune_stale_snapshots.py"

assert_file_exists "$WORK_DIR/live-pid-root.json"
assert_file_not_exists "$WORK_DIR/dead-pid-root.json"
assert_file_not_exists "$WORK_DIR/dead-pid-child.json"
assert_file_exists "$WORK_DIR/live-tmux-root.json"
assert_file_not_exists "$WORK_DIR/dead-tmux-root.json"
assert_file_not_exists "$WORK_DIR/dead-tmux-child.json"
assert_file_exists "$WORK_DIR/legacy-root.json"

printf 'prune_stale_snapshots_test.sh: PASS\n'
