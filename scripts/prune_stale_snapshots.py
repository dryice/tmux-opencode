import json
import os
import subprocess
from collections import deque
from pathlib import Path


TMUX_TIMEOUT_SECONDS = 1


def status_directory() -> Path:
    configured = os.environ.get("TMUX_OPENCODE_STATUS_DIR")
    if configured is not None:
        configured = configured.strip()
    if configured:
        return Path(configured)
    return Path(os.environ.get("TMPDIR", "/tmp")) / "opencode-status"


def read_snapshots(status_dir: Path):
    snapshots = {}
    paths = {}

    if not status_dir.exists():
        return snapshots, paths

    for path in status_dir.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        if not isinstance(payload, dict):
            continue

        session_id = payload.get("sessionID")
        if not isinstance(session_id, str):
            continue

        snapshots[session_id] = payload
        paths[session_id] = path

    return snapshots, paths


def build_children(snapshots):
    children = {}
    for session_id, payload in snapshots.items():
        parent_id = payload.get("parentID")
        if isinstance(parent_id, str):
            children.setdefault(parent_id, []).append(session_id)
    return children


def delete_snapshot_tree(root_id: str, paths, children) -> None:
    pending = deque([root_id])
    seen = {root_id}

    while pending:
        session_id = pending.popleft()
        path = paths.get(session_id)
        if path is not None:
            try:
                path.unlink()
            except FileNotFoundError:
                pass

        for child_id in children.get(session_id, []):
            if child_id in seen:
                continue
            seen.add(child_id)
            pending.append(child_id)


def pid_is_alive(payload) -> bool:
    pid = payload.get("processPID")
    if isinstance(pid, bool) or not isinstance(pid, int):
        return True
    if pid <= 0:
        return False

    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except ProcessLookupError:
        return False
    except OSError:
        return False


def tmux_output(args):
    try:
        completed = subprocess.run(
            ["tmux", *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            timeout=TMUX_TIMEOUT_SECONDS,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None

    if completed.returncode != 0:
        return None
    return completed.stdout.splitlines()


def tmux_metadata_is_alive(payload) -> bool:
    tmux_session_id = payload.get("tmuxSessionID")
    tmux_window_id = payload.get("tmuxWindowID")
    tmux_pane_id = payload.get("tmuxPaneID")

    if not all(isinstance(value, str) and value for value in [tmux_session_id, tmux_window_id, tmux_pane_id]):
        return True

    if tmux_output(["has-session", "-t", tmux_session_id]) is None:
        return False

    windows = tmux_output(["list-windows", "-t", tmux_session_id, "-F", "#{window_id}"])
    if windows is None or tmux_window_id not in windows:
        return False

    panes = tmux_output(["list-panes", "-t", tmux_window_id, "-F", "#{pane_id}"])
    if panes is None or tmux_pane_id not in panes:
        return False

    return True


def main() -> None:
    snapshots, paths = read_snapshots(status_directory())
    children = build_children(snapshots)

    for session_id, payload in snapshots.items():
        if payload.get("kind") != "root":
            continue
        if not pid_is_alive(payload) or not tmux_metadata_is_alive(payload):
            delete_snapshot_tree(session_id, paths, children)


if __name__ == "__main__":
    main()
