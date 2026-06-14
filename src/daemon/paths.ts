import os from "node:os"
import path from "node:path"

const BASE_DIR_ENV_KEY = "TMUX_OPENCODE_DAEMON_DIR"

export function daemonBaseDirectory(): string {
  return process.env[BASE_DIR_ENV_KEY] ?? path.join(process.env.TMPDIR ?? os.tmpdir(), "tmux-opencode-daemon")
}

export function daemonSocketPath(): string {
  return path.join(daemonBaseDirectory(), "daemon.sock")
}

export function daemonDatabasePath(): string {
  return path.join(daemonBaseDirectory(), "status.sqlite")
}
