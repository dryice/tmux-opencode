#!/usr/bin/env bash
set -euo pipefail

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$CURRENT_DIR/render_status.sh"
printf '\nPress any key to close...'
IFS= read -rsn1 _
printf '\n'
