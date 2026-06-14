import { describe, expect, it, vi } from "vitest"

const requestMock = vi.fn()

vi.mock("../daemon/client", () => ({
  createDaemonClient: () => ({ request: requestMock }),
}))

describe("daemon client integration", () => {
  it("sends upsert-session mutations", async () => {
    requestMock.mockResolvedValue({ type: "ok" })
    const { sendSessionMutation } = await import("../index")
    await sendSessionMutation({
      type: "upsert-session",
      sessionID: "ses-1",
      parentID: null,
      kind: "root",
      title: "Main session",
      status: "working",
      summary: "Generating code",
      updatedAt: 4102444800000,
    })
    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ type: "mutate" }))
  })

  it("does not throw when the daemon is unreachable", async () => {
    requestMock.mockRejectedValue(new Error("connect ECONNREFUSED"))
    const { sendSessionMutation } = await import("../index")
    await expect(sendSessionMutation({
      type: "upsert-session",
      sessionID: "ses-2",
      parentID: null,
      kind: "root",
      title: "Main session",
      status: "working",
      summary: "Generating code",
      updatedAt: 4102444800000,
    })).resolves.toBeUndefined()
  })

  it("does not throw when the daemon returns an error response", async () => {
    requestMock.mockResolvedValue({ type: "error", code: "INVALID_REQUEST", message: "bad mutation" })
    const { sendSessionMutation } = await import("../index")
    await expect(sendSessionMutation({
      type: "upsert-session",
      sessionID: "ses-3",
      parentID: null,
      kind: "root",
      title: "Main session",
      status: "working",
      summary: "Generating code",
      updatedAt: 4102444800000,
    })).resolves.toBeUndefined()
  })
})
