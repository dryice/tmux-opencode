#!/usr/bin/env bash
set -euo pipefail

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
quoted_popup_script="$(printf '%q' "$CURRENT_DIR/popup_command.sh")"
tmux display-popup -w 90% -h 90% -E "bash $quoted_popup_script"
