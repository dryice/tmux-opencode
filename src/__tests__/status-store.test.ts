import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeSnapshot, deleteSnapshot, listSnapshots } from "../status-store"
import { STALE_AFTER_MS } from "../types"

describe("writeSnapshot", () => {
  it("writes an atomic session snapshot file", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "session-1",
      parentID: null,
      kind: "root",
      title: "Main session",
      status: "working",
      summary: "Generating code",
      updatedAt: 1,
    })

    const filePath = path.join(directory, "session-1.json")
    expect(existsSync(filePath)).toBe(true)

    const written = JSON.parse(readFileSync(filePath, "utf8"))
    expect(written.sessionID).toBe("session-1")
    expect(written.status).toBe("working")
    expect(written.title).toBe("Main session")
  })

  it("leaves no temp file behind after a successful write", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "session-2",
      parentID: null,
      kind: "root",
      title: "Test",
      status: "idle",
      summary: "Done",
      updatedAt: 1,
    })

    const files = readdirSync(directory)
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"))
    expect(tmpFiles).toHaveLength(0)
  })

  it("creates the directory if it does not exist", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    const nested = path.join(base, "nested", "dir")
    await writeSnapshot(nested, {
      version: 1,
      sessionID: "session-3",
      parentID: null,
      kind: "root",
      title: "Nested",
      status: "working",
      summary: "Test",
      updatedAt: 1,
    })

    expect(existsSync(path.join(nested, "session-3.json"))).toBe(true)
  })
})

describe("deleteSnapshot", () => {
  it("removes an existing session snapshot file", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "to-delete",
      parentID: null,
      kind: "root",
      title: "Delete me",
      status: "working",
      summary: "Will be deleted",
      updatedAt: 1,
    })

    expect(existsSync(path.join(directory, "to-delete.json"))).toBe(true)
    await deleteSnapshot(directory, "to-delete")
    expect(existsSync(path.join(directory, "to-delete.json"))).toBe(false)
  })

  it("does not throw when deleting a non-existent snapshot", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await expect(deleteSnapshot(directory, "no-such-file")).resolves.toBeUndefined()
  })
})

describe("listSnapshots", () => {
  it("returns fresh snapshots from the directory", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "fresh-1",
      parentID: null,
      kind: "root",
      title: "Fresh",
      status: "working",
      summary: "Active",
      updatedAt: Date.now(),
    })

    const snapshots = await listSnapshots(directory)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].sessionID).toBe("fresh-1")
  })

  it("filters out snapshots older than STALE_AFTER_MS", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "stale-1",
      parentID: null,
      kind: "root",
      title: "Stale",
      status: "working",
      summary: "Old",
      updatedAt: Date.now() - STALE_AFTER_MS - 1,
    })
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "fresh-2",
      parentID: null,
      kind: "root",
      title: "Fresh",
      status: "working",
      summary: "New",
      updatedAt: Date.now(),
    })

    const snapshots = await listSnapshots(directory)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].sessionID).toBe("fresh-2")
  })

  it("returns an empty array for an empty directory", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    const snapshots = await listSnapshots(directory)
    expect(snapshots).toHaveLength(0)
  })

  it("skips malformed json files instead of failing the whole listing", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    writeFileSync(path.join(directory, "broken.json"), "{not valid json}\n", "utf8")
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "fresh-3",
      parentID: null,
      kind: "root",
      title: "Fresh",
      status: "working",
      summary: "Still readable",
      updatedAt: Date.now(),
    })

    await expect(listSnapshots(directory)).resolves.toEqual([
      expect.objectContaining({ sessionID: "fresh-3" }),
    ])
  })

  it("creates the directory if it does not exist", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    const nested = path.join(base, "auto-created")
    const snapshots = await listSnapshots(nested)
    expect(snapshots).toHaveLength(0)
    expect(existsSync(nested)).toBe(true)
  })
})
