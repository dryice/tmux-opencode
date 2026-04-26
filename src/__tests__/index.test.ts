import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { mkdtempSync, readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin from "../index"
import { STATUS_DIR_ENV_KEY } from "../types"

const { resolveTmuxContextMock, renameTmuxWindowMock, buildTmuxWindowNameMock } = vi.hoisted(() => ({
  resolveTmuxContextMock: vi.fn(),
  renameTmuxWindowMock: vi.fn(),
  buildTmuxWindowNameMock: vi.fn(),
}))

vi.mock("../tmux", () => ({
  resolveTmuxContext: resolveTmuxContextMock,
  renameTmuxWindow: renameTmuxWindowMock,
  buildTmuxWindowName: buildTmuxWindowNameMock,
}))

type SessionRecord = {
  id: string
  projectID: string
  directory: string
  title: string
  parentID?: string
  version: string
  time: { created: number; updated: number }
}

function makeSession(sessionID: string, overrides: { title?: string; parentID?: string } = {}): SessionRecord {
  return {
    id: sessionID,
    projectID: "proj-1",
    directory: "/tmp",
    title: overrides.title ?? "Main session",
    parentID: overrides.parentID,
    version: "1",
    time: { created: 0, updated: 0 },
  }
}

function makeClient(overrides: { title?: string; parentID?: string; sessions?: Record<string, SessionRecord> } = {}) {
  const fallback = makeSession("test-id", overrides)

  return {
    session: {
      get: vi.fn().mockImplementation(async ({ path: { id } }: { path: { id: string } }) => ({
        data: overrides.sessions?.[id] ?? { ...fallback, id },
      })),
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

function directStatusEvent(sessionID: string, status: "idle" | "busy" | "retry") {
  return {
    event: {
      type: "session.status" as const,
      properties: {
        sessionID,
        status,
      },
    },
  }
}

function topLevelStatusEvent(sessionID: string, status: "idle" | "busy" | "retry") {
  return {
    event: {
      type: "session.status" as const,
      status,
      properties: {
        sessionID,
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

function sessionCreatedEvent(sessionID: string, title: string) {
  return {
    event: {
      type: "session.created" as const,
      properties: {
        sessionID,
        info: makeSession(sessionID, { title }),
      },
    },
  }
}

function sessionSelectEvent(sessionID: string) {
  return {
    event: {
      type: "tui.session.select" as const,
      properties: { sessionID },
    },
  }
}

function commandExecutedEvent(sessionID: string, name: string) {
  return {
    event: {
      type: "command.executed" as const,
      properties: {
        name,
        sessionID,
        arguments: "",
        messageID: "msg-1",
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

function commandBeforeInput(sessionID: string, command: string, args = "") {
  return {
    command,
    sessionID,
    arguments: args,
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
    resolveTmuxContextMock.mockReset()
    renameTmuxWindowMock.mockReset()
    buildTmuxWindowNameMock.mockReset()
    resolveTmuxContextMock.mockResolvedValue(null)
    buildTmuxWindowNameMock.mockImplementation(({ projectName }: { projectName: string; sessionTitle: string }) => {
      const sanitize = (value: string, maxLength: number) =>
        value
          .replace(/[\r\n\t]+/g, " ")
          .replace(/[\x00-\x1F\x7F]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, maxLength)

      return sanitize(projectName, 160)
    })
  })

  afterEach(() => {
    delete process.env[STATUS_DIR_ENV_KEY]
  })

  it("returns an object with event and permission.ask hooks", async () => {
    const hooks = await plugin({ client: makeClient() } as never)
    expect(typeof hooks.event).toBe("function")
    expect(typeof hooks["permission.ask"]).toBe("function")
    expect(typeof hooks["command.execute.before"]).toBe("function")
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

  it("includes projectName from plugin project context", async () => {
    const client = makeClient({ title: "Coding task" })
    const hooks = await plugin({
      client,
      project: { name: "my-project", worktree: "/tmp/my-project" },
    } as never)
    await hooks.event!(busyEvent("ses-project"))

    const snap = readSnapshot(tmpDir, "ses-project")
    expect(snap.projectName).toBe("my-project")
  })

  it("writes tmux ids into snapshots when tmux context is available", async () => {
    resolveTmuxContextMock.mockResolvedValue({
      tmuxSessionID: "$3",
      tmuxWindowID: "@4",
      tmuxPaneID: "%5",
    })

    const client = makeClient({ title: "Coding task" })
    const hooks = await plugin({ client, project: { name: "my-project", worktree: "/tmp/my-project" } } as never)
    await hooks.event!(busyEvent("ses-tmux"))

    const snap = readSnapshot(tmpDir, "ses-tmux")
    expect(snap.tmuxSessionID).toBe("$3")
    expect(snap.tmuxWindowID).toBe("@4")
    expect(snap.tmuxPaneID).toBe("%5")
  })

  it("does not re-resolve tmux context when the caller already knows it is unavailable", async () => {
    const client = makeClient({ title: "Coding task" })
    const hooks = await plugin({ client, project: { name: "my-project", worktree: "/tmp/my-project" } } as never)

    await hooks.event!(busyEvent("ses-tmux-null"))

    expect(resolveTmuxContextMock).toHaveBeenCalledTimes(1)
  })

  it("renames the tmux window for root sessions when tmux context is available", async () => {
    resolveTmuxContextMock.mockResolvedValue({
      tmuxSessionID: "$3",
      tmuxWindowID: "@4",
      tmuxPaneID: "%5",
    })

    const client = makeClient({ title: "Main session" })
    const hooks = await plugin({ client, project: { name: "tmux-opencode", worktree: "/tmp/tmux-opencode" } } as never)
    await hooks.event!(busyEvent("ses-root-rename"))

    expect(renameTmuxWindowMock).toHaveBeenCalledWith({
      tmuxWindowID: "@4",
      projectName: "tmux-opencode",
    })
  })

  it("does not rename the tmux window again when the desired root title is unchanged", async () => {
    resolveTmuxContextMock.mockResolvedValue({
      tmuxSessionID: "$3",
      tmuxWindowID: "@4",
      tmuxPaneID: "%5",
    })

    const client = makeClient({ title: "Main session" })
    const hooks = await plugin({ client, project: { name: "tmux-opencode", worktree: "/tmp/tmux-opencode" } } as never)

    await hooks.event!(busyEvent("ses-root-rename-once"))
    await hooks.event!(idleEvent("ses-root-rename-once"))

    expect(renameTmuxWindowMock).toHaveBeenCalledTimes(1)
  })

  it("does not rename the tmux window again when raw titles sanitize to the same effective name", async () => {
    resolveTmuxContextMock.mockResolvedValue({
      tmuxSessionID: "$3",
      tmuxWindowID: "@4",
      tmuxPaneID: "%5",
    })

    const client = {
      session: {
        get: vi.fn()
          .mockResolvedValueOnce({ data: makeSession("ses-root-sanitize-once", { title: "Main\tsession" }) })
          .mockResolvedValueOnce({ data: makeSession("ses-root-sanitize-once", { title: "Main  session" }) }),
      },
    }

    const hooks = await plugin({ client, project: { name: "tmux-opencode", worktree: "/tmp/tmux-opencode" } } as never)

    await hooks.event!(busyEvent("ses-root-sanitize-once"))
    await hooks.event!(idleEvent("ses-root-sanitize-once"))

    expect(renameTmuxWindowMock).toHaveBeenCalledTimes(1)
  })

  it("does not rename the tmux window for subagent sessions", async () => {
    resolveTmuxContextMock.mockResolvedValue({
      tmuxSessionID: "$3",
      tmuxWindowID: "@4",
      tmuxPaneID: "%5",
    })

    const client = makeClient({ parentID: "parent-1", title: "Subagent helper" })
    const hooks = await plugin({ client, project: { name: "tmux-opencode", worktree: "/tmp/tmux-opencode" } } as never)
    await hooks.event!(busyEvent("ses-subagent"))

    expect(renameTmuxWindowMock).not.toHaveBeenCalled()
  })

  it("falls back to the worktree folder name when project.name is missing", async () => {
    const client = makeClient({ title: "Coding task" })
    const hooks = await plugin({
      client,
      project: { worktree: "/tmp/fallback-project" },
    } as never)
    await hooks.event!(busyEvent("ses-project-fallback"))

    const snap = readSnapshot(tmpDir, "ses-project-fallback")
    expect(snap.projectName).toBe("fallback-project")
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
    const client = makeClient({
      sessions: {
        "parent-1": makeSession("parent-1", { title: "Root session" }),
        "ses-child": makeSession("ses-child", { parentID: "parent-1" }),
      },
    })
    const hooks = await plugin({ client } as never)
    await hooks.event!(busyEvent("parent-1"))
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

  it("writes an idle snapshot when session.status becomes idle", async () => {
    const client = makeClient()
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-cleanup"))
    expect(existsSync(path.join(tmpDir, "ses-cleanup.json"))).toBe(true)

    await hooks.event!(idleEvent("ses-cleanup"))
    const snap = readSnapshot(tmpDir, "ses-cleanup")
    expect(snap.status).toBe("idle")
    expect(snap.summary).toContain("idle")
  })

  it("writes an idle snapshot when a session.idle event arrives", async () => {
    const client = makeClient()
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-idle-event"))
    expect(existsSync(path.join(tmpDir, "ses-idle-event.json"))).toBe(true)

    await hooks.event!(sessionIdleEvent("ses-idle-event") as never)
    const snap = readSnapshot(tmpDir, "ses-idle-event")
    expect(snap.status).toBe("idle")
    expect(snap.summary).toContain("idle")
  })

  it("normalizes direct string session.status payloads", async () => {
    const client = makeClient({ title: "Direct status" })
    const hooks = await plugin({ client } as never)

    await hooks.event!(directStatusEvent("ses-direct", "busy") as never)
    let snap = readSnapshot(tmpDir, "ses-direct")
    expect(snap.status).toBe("working")
    expect(snap.summary).toContain("busy")

    await hooks.event!(directStatusEvent("ses-direct", "retry") as never)
    snap = readSnapshot(tmpDir, "ses-direct")
    expect(snap.status).toBe("working")
    expect(snap.summary).toContain("busy")

    await hooks.event!(directStatusEvent("ses-direct", "idle") as never)
    snap = readSnapshot(tmpDir, "ses-direct")
    expect(snap.status).toBe("idle")
    expect(snap.summary).toContain("idle")
  })

  it("normalizes top-level session.status payloads", async () => {
    const client = makeClient({ title: "Top level status" })
    const hooks = await plugin({ client } as never)

    await hooks.event!(topLevelStatusEvent("ses-top-level", "busy") as never)
    let snap = readSnapshot(tmpDir, "ses-top-level")
    expect(snap.status).toBe("working")
    expect(snap.summary).toContain("busy")

    await hooks.event!(topLevelStatusEvent("ses-top-level", "idle") as never)
    snap = readSnapshot(tmpDir, "ses-top-level")
    expect(snap.status).toBe("idle")
    expect(snap.summary).toContain("idle")
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
    const client = makeClient({
      sessions: {
        "root-1": makeSession("root-1", { title: "Root session" }),
        "ses-sub-perm": makeSession("ses-sub-perm", { parentID: "root-1", title: "Sub task" }),
      },
    })
    const hooks = await plugin({ client } as never)
    await hooks.event!(busyEvent("root-1"))
    await hooks["permission.ask"]!(permissionInput("ses-sub-perm", "write") as never, {
      status: "ask",
    })

    const snap = readSnapshot(tmpDir, "ses-sub-perm")
    expect(snap.kind).toBe("subagent")
    expect(snap.parentID).toBe("root-1")
    expect(snap.status).toBe("waiting")
  })

  it("does not write a child snapshot when its parent snapshot is missing", async () => {
    const client = makeClient({
      sessions: {
        "ses-child-missing-parent": makeSession("ses-child-missing-parent", {
          parentID: "ses-missing-root",
          title: "Orphan child",
        }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-child-missing-parent"))

    expect(existsSync(path.join(tmpDir, "ses-child-missing-parent.json"))).toBe(false)
  })

  it("writes a child snapshot when its parent snapshot exists", async () => {
    const client = makeClient({
      sessions: {
        "ses-root-present": makeSession("ses-root-present", { title: "Root session" }),
        "ses-child-present": makeSession("ses-child-present", {
          parentID: "ses-root-present",
          title: "Child session",
        }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-root-present"))
    await hooks.event!(busyEvent("ses-child-present"))

    const snap = readSnapshot(tmpDir, "ses-child-present")
    expect(snap.kind).toBe("subagent")
    expect(snap.parentID).toBe("ses-root-present")
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

  it("removes the previous snapshot and writes the new session after session.new", async () => {
    const client = makeClient({
      sessions: {
        "ses-old": makeSession("ses-old", { title: "Old session" }),
        "ses-new": makeSession("ses-new", { title: "New session" }),
      },
    })
    const otherHooks = await plugin({ client: makeClient({ title: "Other instance" }) } as never)
    const hooks = await plugin({ client } as never)

    await otherHooks.event!(busyEvent("ses-other"))
    await hooks.event!(busyEvent("ses-old"))
    expect(existsSync(path.join(tmpDir, "ses-old.json"))).toBe(true)

    await hooks["command.execute.before"]!(commandBeforeInput("ses-old", "session.new") as never, { parts: [] })

    expect(existsSync(path.join(tmpDir, "ses-old.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-other.json"))).toBe(true)

    await hooks.event!(sessionCreatedEvent("ses-new", "New session") as never)

    const snap = readSnapshot(tmpDir, "ses-new")
    expect(snap.status).toBe("idle")
    expect(snap.summary).toContain("idle")
    expect(snap.title).toBe("New session")
    expect(existsSync(path.join(tmpDir, "ses-other.json"))).toBe(true)
  })

  it("removes the previous root snapshot tree when a new root session is created", async () => {
    const client = makeClient({
      sessions: {
        "ses-old-root": makeSession("ses-old-root", { title: "Old root" }),
        "ses-old-child": makeSession("ses-old-child", {
          parentID: "ses-old-root",
          title: "Old child",
        }),
        "ses-new-root": makeSession("ses-new-root", { title: "New root" }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-old-root"))
    await hooks.event!(busyEvent("ses-old-child"))
    await hooks.event!(sessionCreatedEvent("ses-new-root", "New root") as never)

    expect(existsSync(path.join(tmpDir, "ses-old-root.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-old-child.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-new-root.json"))).toBe(true)
  })

  it("replaces the visible session snapshot when selecting another session", async () => {
    const client = makeClient({
      sessions: {
        "ses-current": makeSession("ses-current", { title: "Current session" }),
        "ses-current-child": makeSession("ses-current-child", {
          parentID: "ses-current",
          title: "Current child",
        }),
        "ses-selected": makeSession("ses-selected", { title: "Selected session" }),
      },
    })
    const otherHooks = await plugin({ client: makeClient({ title: "Other instance" }) } as never)
    const hooks = await plugin({ client } as never)

    await otherHooks.event!(busyEvent("ses-other"))
    await hooks.event!(busyEvent("ses-current"))
    await hooks.event!(busyEvent("ses-current-child"))

    await hooks.event!(sessionSelectEvent("ses-selected") as never)

    expect(existsSync(path.join(tmpDir, "ses-current.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-current-child.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-other.json"))).toBe(true)

    const snap = readSnapshot(tmpDir, "ses-selected")
    expect(snap.status).toBe("idle")
    expect(snap.summary).toContain("idle")
    expect(snap.title).toBe("Selected session")
  })

  it("keeps the root snapshot when selecting one of its child sessions", async () => {
    const client = makeClient({
      sessions: {
        "ses-root-selected-child": makeSession("ses-root-selected-child", { title: "Root session" }),
        "ses-selected-child": makeSession("ses-selected-child", {
          parentID: "ses-root-selected-child",
          title: "Selected child",
        }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-root-selected-child"))
    await hooks.event!(sessionSelectEvent("ses-selected-child") as never)
    await hooks.event!(busyEvent("ses-selected-child"))

    expect(existsSync(path.join(tmpDir, "ses-root-selected-child.json"))).toBe(true)
    expect(existsSync(path.join(tmpDir, "ses-selected-child.json"))).toBe(true)
  })

  it("deletes only the local session snapshot for an exit command", async () => {
    const hooks = await plugin({ client: makeClient({ title: "Exiting session" }) } as never)
    const otherHooks = await plugin({ client: makeClient({ title: "Other instance" }) } as never)

    await hooks.event!(busyEvent("ses-exit"))
    await otherHooks.event!(busyEvent("ses-other"))

    await hooks.event!(commandExecutedEvent("ses-exit", "/exit") as never)

    expect(existsSync(path.join(tmpDir, "ses-exit.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-other.json"))).toBe(true)
  })

  it("deletes the root snapshot and all descendants for an exit command", async () => {
    const client = makeClient({
      sessions: {
        "ses-root-exit": makeSession("ses-root-exit", { title: "Root session" }),
        "ses-child-exit": makeSession("ses-child-exit", {
          parentID: "ses-root-exit",
          title: "Child session",
        }),
        "ses-grandchild-exit": makeSession("ses-grandchild-exit", {
          parentID: "ses-child-exit",
          title: "Grandchild session",
        }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-root-exit"))
    await hooks.event!(busyEvent("ses-child-exit"))
    await hooks.event!(busyEvent("ses-grandchild-exit"))

    await hooks.event!(commandExecutedEvent("ses-root-exit", "/exit") as never)

    expect(existsSync(path.join(tmpDir, "ses-root-exit.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-child-exit.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-grandchild-exit.json"))).toBe(false)
  })

  it("keeps a child snapshot when the child session exits", async () => {
    const client = makeClient({
      sessions: {
        "ses-root-child-exit": makeSession("ses-root-child-exit", { title: "Root session" }),
        "ses-child-keep": makeSession("ses-child-keep", {
          parentID: "ses-root-child-exit",
          title: "Child session",
        }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-root-child-exit"))
    await hooks.event!(busyEvent("ses-child-keep"))
    await hooks.event!(commandExecutedEvent("ses-child-keep", "/exit") as never)

    expect(existsSync(path.join(tmpDir, "ses-child-keep.json"))).toBe(true)
  })

  it("deletes the root snapshot and descendants when the root session is deleted", async () => {
    const client = makeClient({
      sessions: {
        "ses-root-deleted": makeSession("ses-root-deleted", { title: "Root session" }),
        "ses-child-deleted": makeSession("ses-child-deleted", {
          parentID: "ses-root-deleted",
          title: "Child session",
        }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-root-deleted"))
    await hooks.event!(busyEvent("ses-child-deleted"))
    await hooks.event!(sessionDeletedEvent("ses-root-deleted") as never)

    expect(existsSync(path.join(tmpDir, "ses-root-deleted.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-child-deleted.json"))).toBe(false)
  })

  it("keeps a child snapshot when the child session is deleted", async () => {
    const client = makeClient({
      sessions: {
        "ses-root-child-deleted": makeSession("ses-root-child-deleted", { title: "Root session" }),
        "ses-child-deleted-keep": makeSession("ses-child-deleted-keep", {
          parentID: "ses-root-child-deleted",
          title: "Child session",
        }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-root-child-deleted"))
    await hooks.event!(busyEvent("ses-child-deleted-keep"))
    await hooks.event!(sessionDeletedEvent("ses-child-deleted-keep") as never)

    expect(existsSync(path.join(tmpDir, "ses-child-deleted-keep.json"))).toBe(true)
  })

  it("removes descendant snapshots before creating a replacement session with session.new", async () => {
    const client = makeClient({
      sessions: {
        "ses-root-new": makeSession("ses-root-new", { title: "Old session" }),
        "ses-child-new": makeSession("ses-child-new", {
          parentID: "ses-root-new",
          title: "Child session",
        }),
        "ses-replacement": makeSession("ses-replacement", { title: "New session" }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-root-new"))
    await hooks.event!(busyEvent("ses-child-new"))
    await hooks["command.execute.before"]!(commandBeforeInput("ses-root-new", "session.new") as never, { parts: [] })

    expect(existsSync(path.join(tmpDir, "ses-root-new.json"))).toBe(false)
    expect(existsSync(path.join(tmpDir, "ses-child-new.json"))).toBe(false)
  })

  it("does not recreate a child snapshot after the root topic has exited", async () => {
    const client = makeClient({
      sessions: {
        "ses-root-late": makeSession("ses-root-late", { title: "Root session" }),
        "ses-child-late": makeSession("ses-child-late", {
          parentID: "ses-root-late",
          title: "Child session",
        }),
      },
    })
    const hooks = await plugin({ client } as never)

    await hooks.event!(busyEvent("ses-root-late"))
    await hooks.event!(busyEvent("ses-child-late"))
    await hooks.event!(commandExecutedEvent("ses-root-late", "/exit") as never)
    await hooks.event!(busyEvent("ses-child-late"))

    expect(existsSync(path.join(tmpDir, "ses-child-late.json"))).toBe(false)
  })
})
