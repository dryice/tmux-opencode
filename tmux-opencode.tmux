#!/usr/bin/env bash
set -euo pipefail

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

get_tmux_option() {
  local option="$1"
  local default_value="$2"
  local option_value
  option_value="$(tmux show-option -gqv "$option")"
  if [ -z "$option_value" ]; then
    printf '%s\n' "$default_value"
  else
    printf '%s\n' "$option_value"
  fi
}

key="$(get_tmux_option "@opencode-key" "o")"
quoted_popup_script="$(printf '%q' "$CURRENT_DIR/scripts/show_popup.sh")"
tmux bind-key "$key" run-shell "bash $quoted_popup_script"
