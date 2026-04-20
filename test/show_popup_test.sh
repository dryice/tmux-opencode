#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tmux-opencode-popup.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  fi
}

cat > "$WORK_DIR/tmux" <<'SH'
#!/usr/bin/env bash
printf '%s ' "$@" > "$TMUX_OPENCODE_CAPTURE_FILE"
SH
chmod +x "$WORK_DIR/tmux"

capture_file="$WORK_DIR/capture.txt"
PATH="$WORK_DIR:$PATH" TMUX_OPENCODE_CAPTURE_FILE="$capture_file" bash "$ROOT_DIR/scripts/show_popup.sh"

captured_args="$(cat "$capture_file")"
assert_contains "$captured_args" "display-popup"
assert_contains "$captured_args" "-w 90%"
assert_contains "$captured_args" "-h 90%"
assert_contains "$captured_args" "bash"

printf 'show_popup_test.sh: PASS\n'
