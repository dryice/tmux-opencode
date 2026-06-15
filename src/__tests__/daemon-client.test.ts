import { describe, expect, it, vi } from "vitest"

const requestMock = vi.fn()

vi.mock("../daemon/client", () => ({
  createDaemonClient: () => ({ request: requestMock }),
}))

describe("daemon client integration", () => {
  it("sends upsert-session mutations", async () => {
    requestMock.mockResolvedValue({ type: "ok" })
    const plugin = (await import("../index")).default
    const hooks = await plugin({ client: { session: { get: async () => ({ data: { title: "test" } }) } } } as never)

    await hooks.event!({ event: { type: "session.status", properties: { sessionID: "ses-1", status: { type: "busy" } } } } as never)

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ type: "mutate" }))
  })

  it("does not throw when the daemon is unreachable", async () => {
    requestMock.mockRejectedValue(new Error("connect ECONNREFUSED"))
    const plugin = (await import("../index")).default
    const hooks = await plugin({ client: { session: { get: async () => ({ data: { title: "test" } }) } } } as never)

    await expect(hooks.event!({ event: { type: "session.status", properties: { sessionID: "ses-2", status: { type: "busy" } } } } as never)).resolves.toBeUndefined()
  })

  it("does not throw when the daemon returns an error response", async () => {
    requestMock.mockResolvedValue({ type: "error", code: "INVALID_REQUEST", message: "bad mutation" })
    const plugin = (await import("../index")).default
    const hooks = await plugin({ client: { session: { get: async () => ({ data: { title: "test" } }) } } } as never)

    await expect(hooks.event!({ event: { type: "session.status", properties: { sessionID: "ses-3", status: { type: "busy" } } } } as never)).resolves.toBeUndefined()
  })
})
