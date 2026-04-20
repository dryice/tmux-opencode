# Design: tmux Popup 90 Percent Sizing

## Goal
Make the tmux popup for `tmux-opencode` open at 90% of the available width and 90% of the available height.

## Current State
`scripts/show_popup.sh` invokes `tmux display-popup -E` without explicit sizing flags. That means popup size is controlled entirely by tmux defaults.

## Recommended Approach
Update `scripts/show_popup.sh` to pass tmux percentage sizing flags directly:

```bash
tmux display-popup -w 90% -h 90% -E "bash $quoted_popup_script"
```

This is the recommended approach because it is the smallest change, matches the user's requested behavior exactly, and keeps sizing logic in the one script that owns popup creation.

## Alternatives Considered
1. **Hard-code 90% width and height in `scripts/show_popup.sh`** — recommended for simplicity and exact fit.
2. **Introduce tmux options for width and height** — more configurable, but unnecessary for the current request and adds new configuration surface.
3. **Compute dimensions dynamically in shell** — unnecessary because tmux already supports percentage-based sizing.

## Scope
- Modify `scripts/show_popup.sh` only.
- Do not change popup content rendering.
- Do not change OpenCode plugin behavior.
- Do not add new user configuration unless separately requested.

## Data Flow
1. User presses the configured tmux key binding.
2. `tmux-opencode.tmux` runs `scripts/show_popup.sh`.
3. `scripts/show_popup.sh` opens a popup sized to 90% width and 90% height.
4. The popup runs `scripts/popup_command.sh`, which renders the existing content unchanged.

## Error Handling
No new error handling is required. The change only adds sizing flags to an existing tmux command. Existing shell strict mode (`set -euo pipefail`) remains unchanged.

## Testing
- Verify the script still builds a valid `tmux display-popup` command.
- Run the existing shell tests to confirm no renderer behavior regresses.
- If practical during implementation, perform a manual tmux smoke test to confirm the popup occupies roughly 90% of the available pane space.

## Out of Scope
- Adding configurable popup sizing.
- Changing popup position or border styling.
- Changing renderer output, session filtering, or snapshot handling.
