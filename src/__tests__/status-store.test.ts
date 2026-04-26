import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeSnapshot, deleteSnapshot, listSnapshots, snapshotExists, readSnapshot, deleteSnapshotTree } from "../status-store"

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

describe("snapshotExists", () => {
  it("returns true when the snapshot file exists", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "existing",
      parentID: null,
      kind: "root",
      title: "Existing",
      status: "working",
      summary: "Present",
      updatedAt: 1,
    })

    await expect(snapshotExists(directory, "existing")).resolves.toBe(true)
  })

  it("returns false when the snapshot file is missing", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))

    await expect(snapshotExists(directory, "missing")).resolves.toBe(false)
  })
})

describe("readSnapshot", () => {
  it("returns the parsed snapshot when the file exists", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "readable",
      parentID: null,
      kind: "root",
      title: "Readable",
      status: "idle",
      summary: "Done",
      updatedAt: 1,
    })

    await expect(readSnapshot(directory, "readable")).resolves.toEqual(
      expect.objectContaining({ sessionID: "readable", title: "Readable" }),
    )
  })

  it("returns null when the snapshot file is missing", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))

    await expect(readSnapshot(directory, "missing")).resolves.toBeNull()
  })

  it("returns null when the snapshot file is malformed", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    writeFileSync(path.join(directory, "broken.json"), "{not valid json}\n", "utf8")

    await expect(readSnapshot(directory, "broken")).resolves.toBeNull()
  })
})

describe("deleteSnapshotTree", () => {
  it("deletes the root snapshot and all descendants", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "root",
      parentID: null,
      kind: "root",
      title: "Root",
      status: "working",
      summary: "Active",
      updatedAt: 1,
    })
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "child",
      parentID: "root",
      kind: "subagent",
      title: "Child",
      status: "working",
      summary: "Active",
      updatedAt: 1,
    })
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "grandchild",
      parentID: "child",
      kind: "subagent",
      title: "Grandchild",
      status: "working",
      summary: "Active",
      updatedAt: 1,
    })
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "other-root",
      parentID: null,
      kind: "root",
      title: "Other root",
      status: "idle",
      summary: "Other",
      updatedAt: 1,
    })
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "other-child",
      parentID: "other-root",
      kind: "subagent",
      title: "Other child",
      status: "idle",
      summary: "Other",
      updatedAt: 1,
    })

    await deleteSnapshotTree(directory, "root")

    expect(existsSync(path.join(directory, "root.json"))).toBe(false)
    expect(existsSync(path.join(directory, "child.json"))).toBe(false)
    expect(existsSync(path.join(directory, "grandchild.json"))).toBe(false)
    expect(existsSync(path.join(directory, "other-root.json"))).toBe(true)
    expect(existsSync(path.join(directory, "other-child.json"))).toBe(true)
  })

  it("does not throw when the root snapshot is already missing", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))

    await expect(deleteSnapshotTree(directory, "missing-root")).resolves.toBeUndefined()
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

  it("keeps older snapshots until they are explicitly deleted", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-"))
    await writeSnapshot(directory, {
      version: 1,
      sessionID: "stale-1",
      parentID: null,
      kind: "root",
      title: "Stale",
      status: "working",
      summary: "Old",
      updatedAt: 1,
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
    expect(snapshots).toHaveLength(2)
    expect(snapshots.map((snapshot) => snapshot.sessionID).sort()).toEqual(["fresh-2", "stale-1"])
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
