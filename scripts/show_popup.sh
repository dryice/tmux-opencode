#!/usr/bin/env bash
set -euo pipefail

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
quoted_render_script="$(printf '%q' "$CURRENT_DIR/render_status.sh")"
tmux display-popup -E "bash $quoted_render_script"
