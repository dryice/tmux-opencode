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

cp "$FIXTURE_DIR/root-working.json" "$WORK_DIR/root-working.json"
cp "$FIXTURE_DIR/root-question.json" "$WORK_DIR/root-question.json"
cp "$FIXTURE_DIR/root-idle.json" "$WORK_DIR/root-idle.json"
cp "$FIXTURE_DIR/subagent-waiting.json" "$WORK_DIR/subagent-waiting.json"

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
assert_contains "$output" "• custom      odd-app           Custom session"
assert_contains "$output" "× error       tmux-opencode     Broken session"
assert_contains "$output" "○ idle        my-app            Idle session"
assert_contains "$output" "? question    tmux-opencode     Second session"
assert_contains "$output" "● working     tmux-opencode     Main session"
assert_contains "$output" "tmux-opencode"
assert_contains "$output" "my-app"
assert_not_contains "$output" "Session is idle"
assert_not_contains "$output" "Subagent helper"

output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" TMUX_OPENCODE_SHOW_SUBAGENTS=1 bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "… waiting     tmux-opencode     - Subagent helper"
assert_contains "$output" "● working     tmux-opencode     Main session"
assert_contains "$output" "? question    tmux-opencode     Second session"

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

EMPTY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tmux-opencode-empty.XXXXXX")"
trap 'rm -rf "$WORK_DIR" "$EMPTY_DIR"' EXIT
output="$(TMUX_OPENCODE_STATUS_DIR="$EMPTY_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "No active opencode sessions"

popup_output="$(printf 'x' | TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/popup_command.sh")"
assert_contains "$popup_output" "Main session"
assert_contains "$popup_output" "Press any key to close"

printf 'render_status_test.sh: PASS\n'
