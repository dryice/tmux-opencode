import os from "node:os"
import path from "node:path"

export const STATUS_DIR_ENV_KEY = "TMUX_OPENCODE_STATUS_DIR"

export type SessionStatus = "working" | "waiting" | "question" | "idle" | "error"
export type SessionKind = "root" | "subagent"

export interface SessionSnapshot {
  version: 1
  sessionID: string
  parentID: string | null
  kind: SessionKind
  title: string
  status: SessionStatus
  summary: string
  updatedAt: number
}

export function defaultStatusDirectory(): string {
  const base = process.env.TMPDIR ?? os.tmpdir()
  return path.join(base, "opencode-status")
}
