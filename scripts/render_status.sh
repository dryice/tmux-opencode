#!/usr/bin/env bash
set -euo pipefail

status_dir="${TMUX_OPENCODE_STATUS_DIR:-${TMPDIR:-/tmp}/opencode-status}"
show_subagents="${TMUX_OPENCODE_SHOW_SUBAGENTS:-0}"
render_mode="${TMUX_OPENCODE_RENDER_MODE:-display}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PYTHONIOENCODING=utf-8 STATUS_DIR="$status_dir" SHOW_SUBAGENTS="$show_subagents" RENDER_MODE="$render_mode" python3 "$SCRIPT_DIR/render_status.py"
