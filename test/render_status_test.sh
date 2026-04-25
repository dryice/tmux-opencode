#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_DIR="$ROOT_DIR/test/fixtures"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tmux-opencode-test.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" == *"$needle"* ]]; then
    printf 'Expected output NOT to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  fi
}

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

assert_no_tmux_calls() {
  local calls_file="$1"
  local calls=""
  if [[ -f "$calls_file" ]]; then
    calls="$(<"$calls_file")"
  fi
  if [[ -n "$calls" ]]; then
    printf 'Expected no tmux jump commands, but saw:\n%s\n' "$calls" >&2
    exit 1
  fi
}

assert_tmux_call_sequence() {
  local calls_file="$1"
  local expected_session="$2"
  local expected_window="$3"
  local expected_pane="$4"

  python3 - "$calls_file" "$expected_session" "$expected_window" "$expected_pane" <<'PY'
import sys
from pathlib import Path

calls = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
expected_session, expected_window, expected_pane = sys.argv[2:5]

expected = [
    f"switch-client -t {expected_session}",
    f"select-window -t {expected_window}",
    f"select-pane -t {expected_pane}",
]

if calls != expected:
    print(
        "Expected tmux jump sequence to switch client, then window, then pane\n"
        f"Expected: {expected}\n"
        f"Actual:   {calls}",
        file=sys.stderr,
    )
    sys.exit(1)
PY
}

assert_fzf_delimiter_arg() {
  local args_file="$1"

  python3 - "$args_file" <<'PY'
import sys
from pathlib import Path

args = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
delimiter_args = [arg for arg in args if arg.startswith("--delimiter=")]

if len(delimiter_args) != 1:
    print(
        "Expected exactly one --delimiter argument\n"
        f"Actual args: {args}",
        file=sys.stderr,
    )
    sys.exit(1)

delimiter_arg = delimiter_args[0]
if len(delimiter_arg) <= len("--delimiter="):
    print(
        "Expected --delimiter to include a non-empty delimiter value\n"
        f"Actual arg: {delimiter_arg!r}",
        file=sys.stderr,
    )
    sys.exit(1)
PY
}

cp "$FIXTURE_DIR/root-question.json" "$WORK_DIR/root-question.json"
cp "$FIXTURE_DIR/root-idle.json" "$WORK_DIR/root-idle.json"
cp "$FIXTURE_DIR/subagent-waiting.json" "$WORK_DIR/subagent-waiting.json"

cat > "$WORK_DIR/root-working.json" <<'JSON'
{
  "version": 1,
  "sessionID": "root-1",
  "parentID": null,
  "kind": "root",
  "title": "Main session",
  "projectName": "tmux-opencode",
  "status": "working",
  "summary": "Generating code",
  "tmuxSessionID": "$9",
  "tmuxWindowID": "@11",
  "tmuxPaneID": "%42",
  "updatedAt": 4102444800000
}
JSON

cat > "$WORK_DIR/root-nometa.json" <<'JSON'
{
  "version": 1,
  "sessionID": "root-nometa",
  "parentID": null,
  "kind": "root",
  "title": "No metadata row",
  "projectName": "plain-app",
  "status": "working",
  "summary": "Missing tmux metadata",
  "updatedAt": 4102444808500
}
JSON

cat > "$WORK_DIR/root-escaped.json" <<'JSON'
{
  "version": 1,
  "sessionID": "root-escaped",
  "parentID": null,
  "kind": "root",
  "title": "Line 1\nLine 2",
  "projectName": "tab\tproject",
  "status": "working",
  "summary": "Escaped fields",
  "tmuxSessionID": "$9",
  "tmuxWindowID": "@11",
  "tmuxPaneID": "%42",
  "updatedAt": 4102444808000
}
JSON

cat > "$WORK_DIR/root-error.json" <<'JSON'
{
  "version": 1,
  "sessionID": "root-error",
  "parentID": null,
  "kind": "root",
  "title": "Broken session",
  "projectName": "tmux-opencode",
  "status": "error",
  "summary": "Renderer failure",
  "updatedAt": 4102444806000
}
JSON

cat > "$WORK_DIR/root-custom.json" <<'JSON'
{
  "version": 1,
  "sessionID": "root-custom",
  "parentID": null,
  "kind": "root",
  "title": "Custom session",
  "projectName": "odd-app",
  "status": "custom",
  "summary": "Custom state",
  "updatedAt": 4102444807000
}
JSON

output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "• custom"
assert_contains "$output" "× error"
assert_contains "$output" "○ idle"
assert_contains "$output" "? question"
assert_contains "$output" "● working"
assert_contains "$output" "tab project"
assert_contains "$output" "Line 1 Line 2"
assert_contains "$output" "Custom session"
assert_contains "$output" "Broken session"
assert_contains "$output" "Idle session"
assert_contains "$output" "Second session"
assert_contains "$output" "Main session"
assert_contains "$output" "tmux-opencode"
assert_contains "$output" "my-app"
assert_not_contains "$output" $'tab\tproject'
assert_not_contains "$output" $'Line 1\nLine 2'
assert_not_contains "$output" "Session is idle"
assert_not_contains "$output" "Subagent helper"

output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" TMUX_OPENCODE_SHOW_SUBAGENTS=1 bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "… waiting"
assert_contains "$output" "- Subagent helper"
assert_contains "$output" "● working"
assert_contains "$output" "? question"

printf '{broken json}\n' > "$WORK_DIR/broken.json"
output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "Main session"

cat > "$WORK_DIR/wrong-shape.json" <<'JSON'
{
  "version": 1,
  "sessionID": "bad-1",
  "kind": "root",
  "title": ["not a string"],
  "status": "working",
  "summary": "Bad payload",
  "updatedAt": 4102444800000
}
JSON
output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "Main session"
assert_not_contains "$output" "Bad payload"

cat > "$WORK_DIR/stale.json" <<'JSON'
{
  "version": 1,
  "sessionID": "stale-1",
  "parentID": null,
  "kind": "root",
  "title": "Old session",
  "status": "working",
  "summary": "Stale snapshot",
  "updatedAt": 1
}
JSON
output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "Old session"

cat > "$WORK_DIR/legacy.json" <<'JSON'
{
  "version": 1,
  "sessionID": "legacy-1",
  "parentID": null,
  "kind": "root",
  "title": "Legacy session",
  "status": "working",
  "summary": "Old format",
  "updatedAt": 4102444802000
}
JSON
output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "Legacy session"

LONG_PROJECT_NAME="12345678901234567890123456789012345extra-tail"
TRUNCATED_PROJECT_NAME="${LONG_PROJECT_NAME:0:35}"

cat > "$WORK_DIR/long-project.json" <<JSON
{
  "version": 1,
  "sessionID": "long-project-1",
  "parentID": null,
  "kind": "root",
  "title": "Long project title",
  "projectName": "$LONG_PROJECT_NAME",
  "status": "working",
  "summary": "Long project name",
  "updatedAt": 4102444803000
}
JSON

cat > "$WORK_DIR/short-project.json" <<'JSON'
{
  "version": 1,
  "sessionID": "short-project-1",
  "parentID": null,
  "kind": "root",
  "title": "Short project title",
  "projectName": "my-app",
  "status": "working",
  "summary": "Short project name",
  "updatedAt": 4102444804000
}
JSON

output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "$TRUNCATED_PROJECT_NAME"
assert_not_contains "$output" "$LONG_PROJECT_NAME"

OUTPUT="$output" python3 <<'PY'
import os
import sys

output = os.environ["OUTPUT"].splitlines()
long_line = next(line for line in output if "Long project title" in line)
short_line = next(line for line in output if "Short project title" in line)

long_title_index = long_line.index("Long project title")
short_title_index = short_line.index("Short project title")

if long_title_index != short_title_index:
    print(
        "Expected aligned title column for long and short project names\n"
        f"Long line:  {long_line}\n"
        f"Short line: {short_line}\n"
        f"Long title index: {long_title_index}\n"
        f"Short title index: {short_title_index}",
        file=sys.stderr,
    )
    sys.exit(1)
PY

EMPTY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tmux-opencode-empty.XXXXXX")"
trap 'rm -rf "$WORK_DIR" "$EMPTY_DIR"' EXIT
output="$(TMUX_OPENCODE_STATUS_DIR="$EMPTY_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "No active opencode sessions"

machine_output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" TMUX_OPENCODE_RENDER_MODE=machine bash "$ROOT_DIR/scripts/render_status.sh")"
MACHINE_OUTPUT="$machine_output" python3 <<'PY'
import os
import sys

lines = [line for line in os.environ["MACHINE_OUTPUT"].splitlines() if line.strip()]
root_line = next((line for line in lines if "Main session" in line), None)
nometa_line = next((line for line in lines if "No metadata row" in line), None)
escaped_line = next((line for line in lines if line.startswith("root-escaped\t")), None)

if root_line is None or nometa_line is None or escaped_line is None:
    print(
        "Expected machine-readable rows for jumpable, escaped, and non-jumpable root sessions\n"
        f"Actual output:\n{os.environ['MACHINE_OUTPUT']}",
        file=sys.stderr,
    )
    sys.exit(1)

root_fields = root_line.split("\t")

if len(root_fields) < 8 or not root_fields[5].strip() or not root_fields[6].strip() or not root_fields[7].strip():
    print(
        "Expected jumpable rows to include stored tmuxSessionID, tmuxWindowID, and tmuxPaneID fields\n"
        f"Jumpable row: {root_line}",
        file=sys.stderr,
    )
    sys.exit(1)

nometa_fields = nometa_line.split("\t")
if len(nometa_fields) < 8 or nometa_fields[5].strip() or nometa_fields[6].strip() or nometa_fields[7].strip():
    print(
        "Expected visible-but-not-jumpable root rows to omit tmux metadata\n"
        f"Visible row: {nometa_line}",
        file=sys.stderr,
    )
    sys.exit(1)

escaped_fields = escaped_line.split("\t")
if len(escaped_fields) != 8:
    print(
        "Expected delimiter-safe machine rows to stay parseable with exactly 8 fields\n"
        f"Escaped row: {escaped_line}",
        file=sys.stderr,
    )
    sys.exit(1)

if escaped_fields[3] != "tab\\tproject" or escaped_fields[4] != "Line 1\\nLine 2":
    print(
        "Expected machine-mode project and title to be escaped deterministically\n"
        f"Escaped row: {escaped_line}",
        file=sys.stderr,
    )
    sys.exit(1)
PY

assert_not_contains "$machine_output" $'Subagent helper'

machine_with_subagents="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" TMUX_OPENCODE_RENDER_MODE=machine TMUX_OPENCODE_SHOW_SUBAGENTS=1 bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$machine_with_subagents" "Subagent helper"

INTERACTIVE_DIR="$WORK_DIR/interactive"
mkdir -p "$INTERACTIVE_DIR/bin" "$INTERACTIVE_DIR/logs"

cat > "$INTERACTIVE_DIR/bin/fzf" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

log_dir="${TMUX_TEST_LOG_DIR:?missing TMUX_TEST_LOG_DIR}"
input_file="$log_dir/fzf-stdin.txt"
args_file="$log_dir/fzf-args.txt"
selection_file="$log_dir/fzf-selection.txt"

cat > "$input_file"
printf '%s\n' "$@" > "$args_file"
if [[ -n "${FZF_SELECT_FIRST:-}" ]]; then
  if IFS= read -r first_line; then
    printf '%s\n' "$first_line" > "$selection_file"
    printf '%s\n' "$first_line"
    exit 0
  fi < "$input_file"
  printf '\n' > "$selection_file"
  exit 0
fi
if [[ -n "${FZF_EXIT_CODE:-}" ]]; then
  printf '%s\n' "${FZF_SELECTION:-}" > "$selection_file"
  exit "$FZF_EXIT_CODE"
fi
printf '%s\n' "${FZF_SELECTION:-}" > "$selection_file"
printf '%s\n' "${FZF_SELECTION:-}"
EOF
chmod +x "$INTERACTIVE_DIR/bin/fzf"

cat > "$INTERACTIVE_DIR/bin/tmux" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

log_dir="${TMUX_TEST_LOG_DIR:?missing TMUX_TEST_LOG_DIR}"
printf '%s\n' "$*" >> "$log_dir/tmux-calls.txt"
EOF
chmod +x "$INTERACTIVE_DIR/bin/tmux"

PATH="$INTERACTIVE_DIR/bin:$PATH" TMUX_TEST_LOG_DIR="$INTERACTIVE_DIR/logs" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" FZF_SELECTION=$'root-1\troot\tworking\ttmux-opencode\tMain session\t$9\t@11\t%42' bash "$ROOT_DIR/scripts/popup_command.sh" <<< 'x'

assert_file_exists "$INTERACTIVE_DIR/logs/fzf-stdin.txt"
assert_contains "$(<"$INTERACTIVE_DIR/logs/fzf-stdin.txt")" $'root-1\troot\tworking\ttmux-opencode\tMain session\t$9\t@11\t%42'
assert_file_exists "$INTERACTIVE_DIR/logs/fzf-args.txt"
assert_fzf_delimiter_arg "$INTERACTIVE_DIR/logs/fzf-args.txt"
assert_not_contains "$(<"$INTERACTIVE_DIR/logs/fzf-args.txt")" "--nth"
assert_contains "$(<"$INTERACTIVE_DIR/logs/fzf-args.txt")" $'--with-nth=3,4,5'
assert_file_exists "$INTERACTIVE_DIR/logs/tmux-calls.txt"
assert_tmux_call_sequence "$INTERACTIVE_DIR/logs/tmux-calls.txt" '$9' '@11' '%42'

REAL_FZF_DIR="$WORK_DIR/real-fzf"
mkdir -p "$REAL_FZF_DIR/bin" "$REAL_FZF_DIR/logs"

cat > "$REAL_FZF_DIR/bin/tmux" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

log_dir="${TMUX_TEST_LOG_DIR:?missing TMUX_TEST_LOG_DIR}"
printf '%s\n' "$*" >> "$log_dir/tmux-calls.txt"
EOF
chmod +x "$REAL_FZF_DIR/bin/tmux"

if command -v fzf >/dev/null 2>&1; then
  set +e
  real_fzf_output="$(PATH="$REAL_FZF_DIR/bin:$PATH" TMUX_TEST_LOG_DIR="$REAL_FZF_DIR/logs" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" FZF_DEFAULT_OPTS='--filter=Main' bash "$ROOT_DIR/scripts/popup_command.sh" 2>&1)"
  real_fzf_status=$?
  set -e

  if [[ $real_fzf_status -ne 0 ]]; then
    printf 'Expected popup_command.sh to let real fzf match visible fields\nActual status: %s\nActual output:\n%s\n' "$real_fzf_status" "$real_fzf_output" >&2
    exit 1
  fi

  assert_file_exists "$REAL_FZF_DIR/logs/tmux-calls.txt"
  assert_tmux_call_sequence "$REAL_FZF_DIR/logs/tmux-calls.txt" '$9' '@11' '%42'

  rm -f "$REAL_FZF_DIR/logs/tmux-calls.txt"

  set +e
  real_status_filter_output="$(PATH="$REAL_FZF_DIR/bin:$PATH" TMUX_TEST_LOG_DIR="$REAL_FZF_DIR/logs" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" FZF_DEFAULT_OPTS='--filter=working\ Main' bash "$ROOT_DIR/scripts/popup_command.sh" 2>&1)"
  real_status_filter_status=$?
  set -e

  if [[ $real_status_filter_status -ne 0 ]]; then
    printf 'Expected popup_command.sh to let real fzf match session status\nActual status: %s\nActual output:\n%s\n' "$real_status_filter_status" "$real_status_filter_output" >&2
    exit 1
  fi

  assert_file_exists "$REAL_FZF_DIR/logs/tmux-calls.txt"
  assert_tmux_call_sequence "$REAL_FZF_DIR/logs/tmux-calls.txt" '$9' '@11' '%42'
fi

rm -f "$INTERACTIVE_DIR/logs/fzf-stdin.txt" "$INTERACTIVE_DIR/logs/fzf-args.txt" "$INTERACTIVE_DIR/logs/fzf-selection.txt" "$INTERACTIVE_DIR/logs/tmux-calls.txt"

PATH="$INTERACTIVE_DIR/bin:$PATH" TMUX_TEST_LOG_DIR="$INTERACTIVE_DIR/logs" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" FZF_SELECTION=$'root-1\troot\tworking\ttmux-opencode\tMain session\t$9\t@11\t%42' FZF_EXIT_CODE=130 bash "$ROOT_DIR/scripts/popup_command.sh" <<< 'x'

assert_file_exists "$INTERACTIVE_DIR/logs/fzf-stdin.txt"
assert_contains "$(<"$INTERACTIVE_DIR/logs/fzf-stdin.txt")" $'root-1\troot\tworking\ttmux-opencode\tMain session\t$9\t@11\t%42'
assert_no_tmux_calls "$INTERACTIVE_DIR/logs/tmux-calls.txt"

rm -f "$INTERACTIVE_DIR/logs/fzf-stdin.txt" "$INTERACTIVE_DIR/logs/fzf-args.txt" "$INTERACTIVE_DIR/logs/fzf-selection.txt" "$INTERACTIVE_DIR/logs/tmux-calls.txt"

set +e
no_match_output="$(PATH="$INTERACTIVE_DIR/bin:$PATH" TMUX_TEST_LOG_DIR="$INTERACTIVE_DIR/logs" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" FZF_EXIT_CODE=1 bash "$ROOT_DIR/scripts/popup_command.sh" 2>&1 <<< 'x')"
no_match_status=$?
set -e

if [[ $no_match_status -ne 0 ]]; then
  printf 'Expected no-match popup flow to exit cleanly\nActual status: %s\nActual output:\n%s\n' "$no_match_status" "$no_match_output" >&2
  exit 1
fi

assert_file_exists "$INTERACTIVE_DIR/logs/fzf-stdin.txt"
assert_contains "$(<"$INTERACTIVE_DIR/logs/fzf-stdin.txt")" $'root-1\troot\tworking\ttmux-opencode\tMain session\t$9\t@11\t%42'
assert_no_tmux_calls "$INTERACTIVE_DIR/logs/tmux-calls.txt"

rm -f "$INTERACTIVE_DIR/logs/fzf-stdin.txt" "$INTERACTIVE_DIR/logs/fzf-args.txt" "$INTERACTIVE_DIR/logs/fzf-selection.txt" "$INTERACTIVE_DIR/logs/tmux-calls.txt"

set +e
subagent_output="$(PATH="$INTERACTIVE_DIR/bin:$PATH" TMUX_TEST_LOG_DIR="$INTERACTIVE_DIR/logs" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" TMUX_OPENCODE_SHOW_SUBAGENTS=1 FZF_SELECTION=$'sub-1\tsubagent\twaiting\ttmux-opencode\tSubagent helper\t\t\t' bash "$ROOT_DIR/scripts/popup_command.sh" 2>&1 <<< 'x')"
subagent_status=$?
set -e

if [[ $subagent_status -eq 0 ]]; then
  printf 'Expected non-jumpable selection to fail safely\nActual output:\n%s\n' "$subagent_output" >&2
  exit 1
fi

assert_contains "$subagent_output" "tmux metadata"

assert_file_exists "$INTERACTIVE_DIR/logs/fzf-stdin.txt"
assert_contains "$(<"$INTERACTIVE_DIR/logs/fzf-stdin.txt")" $'sub-1\tsubagent\twaiting\ttmux-opencode\tSubagent helper\t\t\t'
assert_no_tmux_calls "$INTERACTIVE_DIR/logs/tmux-calls.txt"

rm -f "$INTERACTIVE_DIR/logs/fzf-stdin.txt" "$INTERACTIVE_DIR/logs/fzf-args.txt" "$INTERACTIVE_DIR/logs/fzf-selection.txt" "$INTERACTIVE_DIR/logs/tmux-calls.txt"

missing_fzf_dir="$(mktemp -d "${TMPDIR:-/tmp}/tmux-opencode-missing-fzf.XXXXXX")"
trap 'rm -rf "$WORK_DIR" "$EMPTY_DIR" "$missing_fzf_dir"' EXIT

ln -sf "$(command -v bash)" "$missing_fzf_dir/bash"
ln -sf "$(command -v dirname)" "$missing_fzf_dir/dirname"

assert_file_exists "$missing_fzf_dir/bash"
assert_file_exists "$missing_fzf_dir/dirname"

set +e
missing_fzf_output="$(PATH="$missing_fzf_dir" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/popup_command.sh" 2>&1 <<< 'x')"
missing_fzf_status=$?
set -e

if [[ $missing_fzf_status -eq 0 ]]; then
  printf 'Expected popup_command.sh to fail when fzf is unavailable\nActual output:\n%s\n' "$missing_fzf_output" >&2
  exit 1
fi

assert_contains "$missing_fzf_output" "fzf"
assert_not_contains "$missing_fzf_output" "Press any key to close"

cat > "$INTERACTIVE_DIR/bin/bash" <<'EOF'
#!/bin/bash
set -euo pipefail

if [[ "${1:-}" == *"scripts/render_status.sh" ]]; then
  exit 17
fi

exec /bin/bash "$@"
EOF
chmod +x "$INTERACTIVE_DIR/bin/bash"

set +e
render_failure_output="$(PATH="$INTERACTIVE_DIR/bin:$PATH" TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" /bin/bash "$ROOT_DIR/scripts/popup_command.sh" 2>&1 <<< 'x')"
render_failure_status=$?
set -e

if [[ $render_failure_status -ne 17 ]]; then
  printf 'Expected popup_command.sh to surface render_status.sh failure\nActual status: %s\nActual output:\n%s\n' "$render_failure_status" "$render_failure_output" >&2
  exit 1
fi

assert_contains "$render_failure_output" "render_status.sh failed with exit code 17"

rm -f "$INTERACTIVE_DIR/bin/bash"
rm -f "$INTERACTIVE_DIR/logs/fzf-stdin.txt" "$INTERACTIVE_DIR/logs/fzf-args.txt" "$INTERACTIVE_DIR/logs/fzf-selection.txt" "$INTERACTIVE_DIR/logs/tmux-calls.txt"

set +e
empty_fzf_output="$(PATH="$INTERACTIVE_DIR/bin:$PATH" TMUX_TEST_LOG_DIR="$INTERACTIVE_DIR/logs" TMUX_OPENCODE_STATUS_DIR="$EMPTY_DIR" FZF_SELECT_FIRST=1 bash "$ROOT_DIR/scripts/popup_command.sh" 2>&1 <<< 'x')"
empty_fzf_status=$?
set -e

if [[ $empty_fzf_status -ne 0 ]]; then
  printf 'Expected empty-state popup to no-op cleanly\nActual output:\n%s\n' "$empty_fzf_output" >&2
  exit 1
fi

assert_contains "$empty_fzf_output" "No active opencode sessions"
assert_file_not_exists "$INTERACTIVE_DIR/logs/fzf-stdin.txt"
assert_no_tmux_calls "$INTERACTIVE_DIR/logs/tmux-calls.txt"

printf 'render_status_test.sh: PASS\n'
