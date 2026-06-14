import { afterEach, beforeEach, describe, expect, it } from "vitest"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

describe("daemon store", () => {
  let tempDir: string
  let dbPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tmux-opencode-daemon-store-"))
    dbPath = path.join(tempDir, "status.sqlite")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("writes a root session mutation and returns it in visible rows", async () => {
    const { createStore } = await import("../daemon/store")
    const store = await createStore({ dbPath })

    await store.applyMutation({
      type: "upsert-session",
      sessionID: "ses-root",
      parentID: null,
      kind: "root",
      title: "Main session",
      projectName: "tmux-opencode",
      processPID: 1234,
      tmuxSessionID: "$1",
      tmuxWindowID: "@2",
      tmuxPaneID: "%3",
      status: "working",
      summary: "Generating code",
      updatedAt: 4102444800000,
    })

    await expect(store.listVisibleRows()).resolves.toEqual([
      expect.objectContaining({
        sessionID: "ses-root",
        title: "Main session",
        projectName: "tmux-opencode",
        tmuxSessionID: "$1",
        tmuxWindowID: "@2",
        tmuxPaneID: "%3",
        status: "working",
      }),
    ])
  })

  it("deletes a stale root and its descendants during prune", async () => {
    const { createStore } = await import("../daemon/store")
    const store = await createStore({ dbPath })

    await store.applyMutation({
      type: "upsert-session",
      sessionID: "ses-root",
      parentID: null,
      kind: "root",
      title: "Root",
      processPID: 999999,
      status: "idle",
      summary: "Session is idle",
      updatedAt: 1,
    })
    await store.applyMutation({
      type: "upsert-session",
      sessionID: "ses-child",
      parentID: "ses-root",
      kind: "subagent",
      title: "Child",
      status: "waiting",
      summary: "Waiting on permission",
      updatedAt: 2,
    })

    await store.prune({ runningPIDs: new Set<number>(), liveTmuxTargets: new Set<string>() })
    await expect(store.listVisibleRows()).resolves.toEqual([])
  })
})
