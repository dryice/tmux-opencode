# Design: OpenCode Plugin Lifecycle & Terminal Signals Citation Pack

## Goal
Provide a compact, evidence-based citation pack for OpenCode plugin lifecycle events and terminal signals.

## Scope
- **Lifecycle Events**: `session.idle`, `session.deleted`, `session.status`, `session.updated`.
- **Terminal Signals**: `SIGINT`, `SIGTERM`, `SIGHUP`.
- **Plugin Events**: `finished`, `exited`, `restart`, `shutdown`.

## Structure
The citation pack will be a Markdown table with the following columns:
- **Event/Signal**: Name of the event or signal.
- **Type**: Hook Event, OS Signal, or Client Call.
- **Status**: Confirmed (Core), Plugin-specific, or Non-existent.
- **Evidence (Permalink)**: GitHub permalink to the source code or documentation.
- **Snippet**: Quoted code or documentation snippet.

## Evidence Sources
- **Official Docs**: `https://open-code.ai/en/docs/plugins`
- **Core Repository**: `anomalyco/opencode`
- **PTY Plugin**: `shekohex/opencode-pty`
- **Session Tracker**: `Ithril-Laydec/opencode-session-tracker`

## Implementation Plan
1.  Verify exact permalinks for each event/signal.
2.  Extract relevant snippets.
3.  Format into a compact Markdown table.
4.  Provide a summary of findings for non-existent events.
