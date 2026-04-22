#!/usr/bin/env bash
set -euo pipefail

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v fzf >/dev/null 2>&1; then
  printf 'fzf is required for popup selection\n' >&2
  exit 1
fi

selection=""
set +e
machine_output="$(TMUX_OPENCODE_RENDER_MODE=machine bash "$CURRENT_DIR/render_status.sh")"
if [[ -z "$machine_output" ]]; then
  exit 0
fi

selection="$(printf '%s\n' "$machine_output" | fzf --delimiter=$'\t' --nth=4,5 --with-nth=4,5)"
status=$?
set -e

if [[ $status -eq 130 ]]; then
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
