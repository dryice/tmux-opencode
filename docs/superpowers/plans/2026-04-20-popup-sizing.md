# Popup 90 Percent Sizing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tmux popup open at 90% width and 90% height without changing popup content or plugin behavior.

**Architecture:** Keep the change isolated to the tmux popup launcher. Add a focused shell test that intercepts the `tmux` command so the sizing contract is verified without needing a live tmux session, then update `scripts/show_popup.sh` to pass the explicit sizing flags.

**Tech Stack:** Bash, tmux CLI, shell integration tests

---

### Task 1: Lock in popup sizing with a focused shell test and minimal script change

**Files:**
- Create: `test/show_popup_test.sh`
- Modify: `scripts/show_popup.sh:1-6`
- Test: `test/show_popup_test.sh`
- Test: `test/render_status_test.sh`

- [ ] **Step 1: Write the failing popup launcher test**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tmux-opencode-show-popup.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  fi
}

cat > "$WORK_DIR/tmux" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$TMUX_CAPTURE_FILE"
MOCK
chmod +x "$WORK_DIR/tmux"

CAPTURE_FILE="$WORK_DIR/tmux-command.txt"
PATH="$WORK_DIR:$PATH" TMUX_CAPTURE_FILE="$CAPTURE_FILE" bash "$ROOT_DIR/scripts/show_popup.sh"

command="$(cat "$CAPTURE_FILE")"
assert_contains "$command" "display-popup"
assert_contains "$command" "-w 90%"
assert_contains "$command" "-h 90%"
assert_contains "$command" "bash "

printf 'show_popup_test.sh: PASS\n'
```

- [ ] **Step 2: Run the popup launcher test to verify it fails**

Run: `bash test/show_popup_test.sh`
Expected: FAIL because the captured `tmux display-popup` command does not yet include `-w 90%` and `-h 90%`

- [ ] **Step 3: Update the popup launcher with the minimal sizing change**

```bash
#!/usr/bin/env bash
set -euo pipefail

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
quoted_popup_script="$(printf '%q' "$CURRENT_DIR/popup_command.sh")"
tmux display-popup -w 90% -h 90% -E "bash $quoted_popup_script"
```

- [ ] **Step 4: Run the shell tests to verify the behavior and avoid regressions**

Run: `bash test/show_popup_test.sh && bash test/render_status_test.sh`
Expected: both scripts print `PASS` and exit 0

- [ ] **Step 5: Perform a manual tmux smoke test**

Run inside tmux: trigger the configured key binding (`prefix + O` unless overridden)
Expected: the popup opens and visually occupies about 90% of the client width and 90% of the client height while rendering the same session table as before

- [ ] **Step 6: Commit the change**

```bash
git add scripts/show_popup.sh test/show_popup_test.sh
git commit -m "Make popup use 90 percent width and height"
```
