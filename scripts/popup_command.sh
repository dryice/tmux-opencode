#!/usr/bin/env bash
set -euo pipefail

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
delimiter=$'\t'

if ! command -v fzf >/dev/null 2>&1; then
  printf 'fzf is required for popup selection\n' >&2
  exit 1
fi

daemon_cli() {
  node "$CURRENT_DIR/../dist/daemon-cli.js" "$@"
}

fetch_rows() {
  daemon_cli prune-and-list 2>/dev/null
}

set +e
daemon_output="$(fetch_rows)"
daemon_status=$?
set -e

if [[ $daemon_status -ne 0 ]]; then
  daemon_cli ensure-running >/dev/null 2>&1 || true
  set +e
  daemon_output="$(fetch_rows)"
  daemon_status=$?
  set -e
fi

if [[ $daemon_status -ne 0 ]]; then
  printf 'daemon unavailable after one restart attempt\n' >&2
  daemon_cli prune-and-list >&2 2>&1 || true
  exit "$daemon_status"
fi

set +e
machine_output="$(DAEMON_JSON="$daemon_output" TMUX_OPENCODE_RENDER_MODE=machine bash "$CURRENT_DIR/render_status.sh")"
render_status_status=$?
set -e

if [[ $render_status_status -ne 0 ]]; then
  printf 'render_status.sh failed with exit code %s\n' "$render_status_status" >&2
  exit "$render_status_status"
fi

if [[ -z "$machine_output" ]]; then
  printf 'No active opencode sessions\n'
  exit 0
fi

selection=""
set +e
selection="$(printf '%s\n' "$machine_output" | fzf "--delimiter=$delimiter" --with-nth=3,4,5)"
status=$?
set -e

if [[ $status -eq 130 || $status -eq 1 ]]; then
  exit 0
fi

if [[ $status -ne 0 ]]; then
  exit "$status"
fi

if [[ -z "$selection" ]]; then
  exit 0
fi

IFS=$'\t' read -r _session_id _kind _status _project_name _title tmux_session_id tmux_window_id tmux_pane_id extra <<<"$selection"
if [[ -z "$tmux_session_id" || -z "$tmux_window_id" || -z "$tmux_pane_id" ]]; then
  printf 'Selected row lacks tmux metadata\n' >&2
  exit 1
fi

tmux switch-client -t "$tmux_session_id"
tmux select-window -t "$tmux_window_id"
tmux select-pane -t "$tmux_pane_id"
