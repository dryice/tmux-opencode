import { afterEach, beforeEach, describe, expect, it } from "vitest"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

describe("daemon server", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "tmux-opencode-daemon-server-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("accepts a mutation request and returns visible rows after prune-and-list", async () => {
    const { startDaemonServer } = await import("../daemon/server")
    const { createDaemonClient } = await import("../daemon/client")

    const socketPath = path.join(tempDir, "daemon.sock")
    const dbPath = path.join(tempDir, "status.sqlite")
    const server = await startDaemonServer({ socketPath, dbPath })
    const client = createDaemonClient({ socketPath })

    await client.request({
      type: "mutate",
      protocolVersion: 1,
      mutation: {
        type: "upsert-session",
        sessionID: "ses-root",
        parentID: null,
        kind: "root",
        title: "Main session",
        projectName: "tmux-opencode",
        status: "idle",
        summary: "Session is idle",
        updatedAt: 4102444800000,
      },
    })

    const response = await client.request({ type: "prune-and-list", protocolVersion: 1 })
    expect(response).toEqual({
      type: "rows",
      rows: [expect.objectContaining({ sessionID: "ses-root", title: "Main session" })],
    })

    await server.close()
  })

  it("rejects protocol version mismatches clearly", async () => {
    const { startDaemonServer } = await import("../daemon/server")
    const { createDaemonClient } = await import("../daemon/client")

    const socketPath = path.join(tempDir, "daemon.sock")
    const dbPath = path.join(tempDir, "status.sqlite")
    const server = await startDaemonServer({ socketPath, dbPath })
    const client = createDaemonClient({ socketPath })

    await expect(client.request({ type: "prune-and-list", protocolVersion: 999 })).resolves.toEqual({
      type: "error",
      code: "PROTOCOL_VERSION_MISMATCH",
      message: expect.stringContaining("protocol"),
    })

    await server.close()
  })

  it("keeps rows during prune-and-list when real liveness inputs are unavailable", async () => {
    const { startDaemonServer } = await import("../daemon/server")
    const { createDaemonClient } = await import("../daemon/client")

    const socketPath = path.join(tempDir, "daemon.sock")
    const dbPath = path.join(tempDir, "status.sqlite")
    const server = await startDaemonServer({ socketPath, dbPath })
    const client = createDaemonClient({ socketPath })

    await client.request({
      type: "mutate",
      protocolVersion: 1,
      mutation: {
        type: "upsert-session",
        sessionID: "ses-external-root",
        parentID: null,
        kind: "root",
        title: "External OpenCode session",
        status: "idle",
        summary: "Session is idle",
        updatedAt: 4102444800000,
      },
    })

    const response = await client.request({ type: "prune-and-list", protocolVersion: 1 })
    expect(response).toEqual({
      type: "rows",
      rows: [expect.objectContaining({ sessionID: "ses-external-root", title: "External OpenCode session" })],
    })

    await server.close()
  })

  it("prunes roots with dead PIDs during prune-and-list", async () => {
    const { startDaemonServer } = await import("../daemon/server")
    const { createDaemonClient } = await import("../daemon/client")

    const socketPath = path.join(tempDir, "daemon.sock")
    const dbPath = path.join(tempDir, "status.sqlite")
    const server = await startDaemonServer({ socketPath, dbPath })
    const client = createDaemonClient({ socketPath })

    await client.request({
      type: "mutate",
      protocolVersion: 1,
      mutation: {
        type: "upsert-session",
        sessionID: "ses-dead-pid",
        parentID: null,
        kind: "root",
        title: "Dead process session",
        processPID: 999999,
        status: "idle",
        summary: "Session is idle",
        updatedAt: 4102444800000,
      },
    })

    const response = await client.request({ type: "prune-and-list", protocolVersion: 1 })
    expect(response).toEqual({ type: "rows", rows: [] })

    await server.close()
  })
})
