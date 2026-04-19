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
cp "$FIXTURE_DIR/subagent-waiting.json" "$WORK_DIR/subagent-waiting.json"

output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "Main session"
assert_not_contains "$output" "Subagent helper"

output="$(TMUX_OPENCODE_STATUS_DIR="$WORK_DIR" TMUX_OPENCODE_SHOW_SUBAGENTS=1 bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "Main session"
assert_contains "$output" "- Subagent helper"

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
assert_not_contains "$output" "Old session"

EMPTY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tmux-opencode-empty.XXXXXX")"
trap 'rm -rf "$WORK_DIR" "$EMPTY_DIR"' EXIT
output="$(TMUX_OPENCODE_STATUS_DIR="$EMPTY_DIR" bash "$ROOT_DIR/scripts/render_status.sh")"
assert_contains "$output" "No active opencode sessions"

printf 'render_status_test.sh: PASS\n'
