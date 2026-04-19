import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin from "../index"
import { STATUS_DIR_ENV_KEY } from "../types"

function makeClient(overrides: { title?: string; parentID?: string } = {}) {
  return {
    session: {
      get: vi.fn().mockResolvedValue({
        data: {
          id: "test-id",
          projectID: "proj-1",
          directory: "/tmp",
          title: overrides.title ?? "Main session",
          parentID: overrides.parentID,
          version: "1",
          time: { created: 0, updated: 0 },
        },
      }),
    },
  }
}

function busyEvent(sessionID: string) {
  return {
    event: {
      type: "session.status" as const,
      properties: {
        sessionID,
        status: { type: "busy" as const },
      },
    },
  }
}

function idleEvent(sessionID: string) {
  return {
    event: {
      type: "session.status" as const,
      properties: {
        sessionID,
        status: { type: "idle" as const },
      },
    },
  }
}

function unexpectedStatusEvent(sessionID: string) {
  return {
    event: {
      type: "session.status" as const,
      properties: {
        sessionID,
        status: { type: "retry" as const },
      },
    },
  }
}

function sessionIdleEvent(sessionID: string) {
  return {
    event: {
      type: "session.idle" as const,
      properties: { sessionID },
    },
  }
}

function sessionDeletedEvent(sessionID: string) {
  return {
    event: {
      type: "session.deleted" as const,
      properties: { sessionID },
    },
  }
}

function sessionDeletedInfoEvent(sessionID: string) {
  return {
    event: {
      type: "session.deleted" as const,
      properties: {
        info: {
          id: sessionID,
          title: "Deleted session",
          projectID: "proj-1",
          directory: "/tmp",
          version: "1",
          time: { created: 0, updated: 0 },
        },
      },
    },
  }
}

function permissionAskedEvent(sessionID: string, permType: string) {
  return {
    event: {
      type: "permission.asked" as const,
      properties: { sessionID, type: permType },
    },
  }
}

function messageDeltaEvent(sessionID: string) {
  return {
    event: {
      type: "message.part.delta" as const,
      properties: { sessionID },
    },
  }
}

function questionEvent(sessionID: string) {
  return {
    event: {
      type: "question.asked" as const,
      properties: { sessionID, id: "q-1", questions: [] },
    },
  }
}

function permissionInput(sessionID: string, permType: string) {
  return {
    id: "perm-1",
    type: permType,
    tool: permType,
    sessionID,
    messageID: "msg-1",
    title: `Permission: ${permType}`,
    metadata: {},
    time: { created: Date.now() },
  }
}

function readSnapshot(dir: string, sessionID: string) {
  return JSON.parse(readFileSync(path.join(dir, `${sessionID}.json`), "utf8"))
}

describe("tmux-opencode plugin", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tmux-opencode-plugin-"))
    process.env[STATUS_DIR_ENV_KEY] = tmpDir
  })

  afterEach(() => {
    delete process.env[STATUS_DIR_ENV_KEY]
  })

  it("returns an object with event and permission.ask hooks", async () => {
    const hooks = await plugin({ client: makeClient() } as never)
    expect(typeof hooks.event).toBe("function")
    expect(typeof hooks["permission.ask"]).toBe("function")
  })

  it("writes a working snapshot for session.status busy events", async () => {
    const client = makeClient({ title: "Coding task" })
    const hooks = await plugin({ client } as never)
    await hooks.event!(busyEvent("ses-busy"))

    const snap = readSnapshot(tmpDir, "ses-busy")
    expect(snap.status).toBe("working")
    expect(snap.title).toBe("Coding task")
    expect(snap.kind).toBe("root")
    expect(snap.summary).toContain("busy")
  })

  it("writes a question snapshot for question.asked events", async () => {
    const client = makeClient({ title: "Asking" })
    const hooks = await plugin({ client } as never)
    await hooks.event!(questionEvent("ses-question") as never)

    const snap = readSnapshot(tmpDir, "ses-question")
    expect(snap.status).toBe("question")
    expect(snap.summary).toContain("Question")
  })

  it("sets kind to subagent when parentID is present", async () => {
    const client = makeClient({ parentID: "parent-1" })
    const hooks = await plugin({ client } as never)
    await hooks.event!(busyEvent("ses-child"))

    const snap = readSnapshot(tmpDir, "ses-child")
    expect(snap.kind).toBe("subagent")
    expect(snap.parentID).toBe("parent-1")
  })

  it("ignores unrecognized event types", async () => {
    const client = makeClient()
    const hooks = await plugin({ client } as never)
    await hooks.event!({
      event: { type: "file.edited", properties: { file: "test.ts" } } as never,
    })

    expect(existsSync(path.join(tmpDir, "test.ts.json"))).toBe(false)
    expect(client.session.get).not.toHaveBeenCalled()
  })

  it("deletes the snapshot when session.status becomes idle", async () => {
    const client = makeClient()
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-cleanup"))
    expect(existsSync(path.join(tmpDir, "ses-cleanup.json"))).toBe(true)

    await hooks.event!(idleEvent("ses-cleanup"))
    expect(existsSync(path.join(tmpDir, "ses-cleanup.json"))).toBe(false)
  })

  it("deletes the snapshot when a session.idle event arrives", async () => {
    const client = makeClient()
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-idle-event"))
    expect(existsSync(path.join(tmpDir, "ses-idle-event.json"))).toBe(true)

    await hooks.event!(sessionIdleEvent("ses-idle-event") as never)
    expect(existsSync(path.join(tmpDir, "ses-idle-event.json"))).toBe(false)
  })

  it("deletes the snapshot when a session is deleted", async () => {
    const client = makeClient()
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-deleted"))
    expect(existsSync(path.join(tmpDir, "ses-deleted.json"))).toBe(true)

    await hooks.event!(sessionDeletedEvent("ses-deleted") as never)
    expect(existsSync(path.join(tmpDir, "ses-deleted.json"))).toBe(false)
  })

  it("deletes the snapshot when session.deleted provides the id in properties.info", async () => {
    const client = makeClient()
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-deleted-info"))
    expect(existsSync(path.join(tmpDir, "ses-deleted-info.json"))).toBe(true)

    await hooks.event!(sessionDeletedInfoEvent("ses-deleted-info") as never)
    expect(existsSync(path.join(tmpDir, "ses-deleted-info.json"))).toBe(false)
  })

  it("ignores non-busy non-idle session.status updates", async () => {
    const client = makeClient({ title: "Still active" })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-retry"))
    await hooks.event!(unexpectedStatusEvent("ses-retry") as never)

    const snap = readSnapshot(tmpDir, "ses-retry")
    expect(snap.status).toBe("working")
    expect(snap.title).toBe("Still active")
  })

  it("writes a waiting snapshot for permission.ask events", async () => {
    const client = makeClient({ title: "Needs approval" })
    const hooks = await plugin({ client } as never)
    await hooks["permission.ask"]!(permissionInput("ses-perm", "shell") as never, {
      status: "ask",
    })

    const snap = readSnapshot(tmpDir, "ses-perm")
    expect(snap.status).toBe("waiting")
    expect(snap.summary).toContain("shell")
    expect(snap.title).toBe("Needs approval")
  })

  it("writes a waiting snapshot for permission.asked events", async () => {
    const client = makeClient({ title: "Needs approval" })
    const hooks = await plugin({ client } as never)
    await hooks.event!(permissionAskedEvent("ses-perm-event", "shell") as never)

    const snap = readSnapshot(tmpDir, "ses-perm-event")
    expect(snap.status).toBe("waiting")
    expect(snap.summary).toContain("shell")
    expect(snap.title).toBe("Needs approval")
  })

  it("ignores message delta events (status driven by session.status only)", async () => {
    const client = makeClient({ title: "Streaming reply" })
    const hooks = await plugin({ client } as never)
    await hooks.event!(messageDeltaEvent("ses-delta") as never)

    expect(existsSync(path.join(tmpDir, "ses-delta.json"))).toBe(false)
    expect(client.session.get).not.toHaveBeenCalled()
  })

  it("marks permission.ask snapshots as subagent when parentID is present", async () => {
    const client = makeClient({ parentID: "root-1", title: "Sub task" })
    const hooks = await plugin({ client } as never)
    await hooks["permission.ask"]!(permissionInput("ses-sub-perm", "write") as never, {
      status: "ask",
    })

    const snap = readSnapshot(tmpDir, "ses-sub-perm")
    expect(snap.kind).toBe("subagent")
    expect(snap.parentID).toBe("root-1")
    expect(snap.status).toBe("waiting")
  })

  it("keeps snapshots from another running instance when a new plugin instance initializes", async () => {
    const firstHooks = await plugin({ client: makeClient({ title: "First session" }) } as never)
    await firstHooks.event!(busyEvent("ses-first"))

    expect(existsSync(path.join(tmpDir, "ses-first.json"))).toBe(true)

    const secondHooks = await plugin({ client: makeClient({ title: "Second session" }) } as never)
    await secondHooks.event!(busyEvent("ses-second"))

    expect(existsSync(path.join(tmpDir, "ses-first.json"))).toBe(true)
    expect(readSnapshot(tmpDir, "ses-first").title).toBe("First session")
    expect(readSnapshot(tmpDir, "ses-second").title).toBe("Second session")
  })
})
