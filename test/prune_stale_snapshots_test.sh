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

cat > "$WORK_DIR/slow-tmux-root.json" <<'JSON'
{
  "version": 1,
  "sessionID": "slow-tmux-root",
  "parentID": null,
  "kind": "root",
  "title": "Slow tmux root",
  "projectName": "tmux-opencode",
  "status": "working",
  "summary": "Prune test",
  "tmuxSessionID": "$slow",
  "tmuxWindowID": "@slow",
  "tmuxPaneID": "%slow",
  "updatedAt": 4102444809999
}
JSON

cat > "$WORK_DIR/bin/tmux" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

sleep 5
exit 0
EOF
chmod +x "$WORK_DIR/bin/tmux"

PATH="$WORK_DIR/bin:$PATH" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" python3 - "$ROOT_DIR/scripts/prune_stale_snapshots.py" <<'PY'
import subprocess
import sys

try:
    completed = subprocess.run([sys.executable, sys.argv[1]], timeout=3, check=False)
except subprocess.TimeoutExpired:
    print("prune script hung on slow tmux", file=sys.stderr)
    sys.exit(124)

if completed.returncode == 0:
    print("expected slow tmux to fail pruning", file=sys.stderr)
    sys.exit(1)

sys.exit(0)
PY

assert_file_exists "$WORK_DIR/slow-tmux-root.json"

EMPTY_ENV_DIR="$WORK_DIR/empty-env"
mkdir -p "$EMPTY_ENV_DIR"

cat > "$EMPTY_ENV_DIR/repo-root-danger.json" <<'JSON'
{
  "version": 1,
  "sessionID": "repo-root-danger",
  "parentID": null,
  "kind": "root",
  "title": "Repo root danger",
  "processPID": 99999999,
  "status": "working",
  "summary": "Should not be touched",
  "updatedAt": 4102444810000
}
JSON

TMPDIR="$EMPTY_ENV_DIR" python3 - "$ROOT_DIR/scripts/prune_stale_snapshots.py" <<'PY'
import os
import subprocess
import sys

completed = subprocess.run(
    [sys.executable, sys.argv[1]],
    cwd=os.environ["TMPDIR"],
    env={**os.environ, "TMUX_OPENCODE_STATUS_DIR": ""},
    check=False,
)
sys.exit(completed.returncode)
PY

assert_file_exists "$EMPTY_ENV_DIR/repo-root-danger.json"

WHITESPACE_FALLBACK_DIR="$WORK_DIR/whitespace-fallback"
mkdir -p "$WHITESPACE_FALLBACK_DIR/opencode-status"

cat > "$WHITESPACE_FALLBACK_DIR/opencode-status/whitespace-fallback.json" <<'JSON'
{
  "version": 1,
  "sessionID": "whitespace-fallback",
  "parentID": null,
  "kind": "root",
  "title": "Whitespace fallback",
  "processPID": 99999999,
  "status": "working",
  "summary": "Should be pruned via TMPDIR fallback",
  "updatedAt": 4102444810001
}
JSON

TMPDIR="$WHITESPACE_FALLBACK_DIR" python3 - "$ROOT_DIR/scripts/prune_stale_snapshots.py" <<'PY'
import os
import subprocess
import sys

completed = subprocess.run(
    [sys.executable, sys.argv[1]],
    cwd=os.environ["TMPDIR"],
    env={**os.environ, "TMUX_OPENCODE_STATUS_DIR": "   "},
    check=False,
)
sys.exit(completed.returncode)
PY

assert_file_not_exists "$WHITESPACE_FALLBACK_DIR/opencode-status/whitespace-fallback.json"

EMPTY_TMPDIR_DIR="$WORK_DIR/empty-tmpdir"
mkdir -p "$EMPTY_TMPDIR_DIR/opencode-status"

cat > "$EMPTY_TMPDIR_DIR/opencode-status/empty-tmpdir-fallback.json" <<'JSON'
{
  "version": 1,
  "sessionID": "empty-tmpdir-fallback",
  "parentID": null,
  "kind": "root",
  "title": "Empty TMPDIR fallback",
  "processPID": 99999999,
  "status": "working",
  "summary": "Should stay when TMPDIR falls back to /tmp",
  "updatedAt": 4102444810002
}
JSON

python3 - "$ROOT_DIR/scripts/prune_stale_snapshots.py" "$EMPTY_TMPDIR_DIR" <<'PY'
import os
import subprocess
import sys

completed = subprocess.run(
    [sys.executable, sys.argv[1]],
    cwd=sys.argv[2],
    env={**os.environ, "TMUX_OPENCODE_STATUS_DIR": "", "TMPDIR": ""},
    check=False,
)
sys.exit(completed.returncode)
PY

assert_file_exists "$EMPTY_TMPDIR_DIR/opencode-status/empty-tmpdir-fallback.json"

WHITESPACE_TMPDIR_DIR="$WORK_DIR/whitespace-tmpdir"
mkdir -p "$WHITESPACE_TMPDIR_DIR/opencode-status"

cat > "$WHITESPACE_TMPDIR_DIR/opencode-status/whitespace-tmpdir-fallback.json" <<'JSON'
{
  "version": 1,
  "sessionID": "whitespace-tmpdir-fallback",
  "parentID": null,
  "kind": "root",
  "title": "Whitespace TMPDIR fallback",
  "processPID": 99999999,
  "status": "working",
  "summary": "Should stay when TMPDIR falls back to /tmp",
  "updatedAt": 4102444810003
}
JSON

python3 - "$ROOT_DIR/scripts/prune_stale_snapshots.py" "$WHITESPACE_TMPDIR_DIR" <<'PY'
import os
import subprocess
import sys

completed = subprocess.run(
    [sys.executable, sys.argv[1]],
    cwd=sys.argv[2],
    env={**os.environ, "TMUX_OPENCODE_STATUS_DIR": "", "TMPDIR": "   "},
    check=False,
)
sys.exit(completed.returncode)
PY

assert_file_exists "$WHITESPACE_TMPDIR_DIR/opencode-status/whitespace-tmpdir-fallback.json"

FOREIGN_DIR="$WORK_DIR/foreign-json"
mkdir -p "$FOREIGN_DIR"

cat > "$FOREIGN_DIR/unrelated.json" <<'JSON'
{
  "sessionID": "foreign-session",
  "kind": "root",
  "processPID": 99999999,
  "title": "Foreign file"
}
JSON

TMUX_OPENCODE_STATUS_DIR="$FOREIGN_DIR" python3 "$ROOT_DIR/scripts/prune_stale_snapshots.py"

assert_file_exists "$FOREIGN_DIR/unrelated.json"

MISSING_TMUX_DIR="$WORK_DIR/missing-tmux"
mkdir -p "$MISSING_TMUX_DIR"

cat > "$MISSING_TMUX_DIR/missing-tmux-root.json" <<'JSON'
{
  "version": 1,
  "sessionID": "missing-tmux-root",
  "parentID": null,
  "kind": "root",
  "title": "Missing tmux root",
  "projectName": "tmux-opencode",
  "status": "working",
  "summary": "Should stay when tmux is unavailable",
  "tmuxSessionID": "$missing",
  "tmuxWindowID": "@missing",
  "tmuxPaneID": "%missing",
  "updatedAt": 4102444810004
}
JSON

MISSING_TMUX_PATH_DIR="$WORK_DIR/missing-tmux-path"
mkdir -p "$MISSING_TMUX_PATH_DIR"

PATHLESS_DIR="$MISSING_TMUX_PATH_DIR" STATUS_DIR="$MISSING_TMUX_DIR" python3 - "$ROOT_DIR/scripts/prune_stale_snapshots.py" <<'PY'
import os
import subprocess
import sys

completed = subprocess.run(
    [sys.executable, sys.argv[1]],
    env={**os.environ, "PATH": os.environ["PATHLESS_DIR"], "TMUX_OPENCODE_STATUS_DIR": os.environ["STATUS_DIR"]},
    check=False,
)
sys.exit(completed.returncode)
PY

assert_file_exists "$MISSING_TMUX_DIR/missing-tmux-root.json"

INVALID_PID_DIR="$WORK_DIR/invalid-pid"
mkdir -p "$INVALID_PID_DIR"

cat > "$INVALID_PID_DIR/zero-pid-root.json" <<'JSON'
{
  "version": 1,
  "sessionID": "zero-pid-root",
  "parentID": null,
  "kind": "root",
  "title": "Zero PID root",
  "projectName": "tmux-opencode",
  "processPID": 0,
  "status": "working",
  "summary": "Should stay when PID is invalid",
  "updatedAt": 4102444810005
}
JSON

cat > "$INVALID_PID_DIR/negative-pid-root.json" <<'JSON'
{
  "version": 1,
  "sessionID": "negative-pid-root",
  "parentID": null,
  "kind": "root",
  "title": "Negative PID root",
  "projectName": "tmux-opencode",
  "processPID": -1,
  "status": "working",
  "summary": "Should stay when PID is invalid",
  "updatedAt": 4102444810006
}
JSON

TMUX_OPENCODE_STATUS_DIR="$INVALID_PID_DIR" python3 "$ROOT_DIR/scripts/prune_stale_snapshots.py"

assert_file_exists "$INVALID_PID_DIR/zero-pid-root.json"
assert_file_exists "$INVALID_PID_DIR/negative-pid-root.json"

printf 'prune_stale_snapshots_test.sh: PASS\n'
