import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}))

const tmuxModulePath = "../tmux"

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}))

describe("tmux helpers", () => {
  const originalPane = process.env.TMUX_PANE

  beforeEach(() => {
    vi.resetModules()
    execFileMock.mockReset()
    process.env.TMUX_PANE = "%42"
  })

  afterEach(() => {
    if (originalPane === undefined) {
      delete process.env.TMUX_PANE
    } else {
      process.env.TMUX_PANE = originalPane
    }
  })

  it("resolves tmux session, window, and pane ids from TMUX_PANE", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, "$7\t@9\t%42\n", "")
      },
    )

    const { resolveTmuxContext } = await import(tmuxModulePath)

    await expect(resolveTmuxContext()).resolves.toEqual({
      tmuxSessionID: "$7",
      tmuxWindowID: "@9",
      tmuxPaneID: "%42",
    })
  })

  it("returns null when TMUX_PANE is missing", async () => {
    delete process.env.TMUX_PANE

    const { resolveTmuxContext } = await import(tmuxModulePath)

    await expect(resolveTmuxContext()).resolves.toBeNull()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it("renames the tmux window with a sanitized human-readable context", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, "", "")
      },
    )

    const { renameTmuxWindow } = await import(tmuxModulePath)

    await renameTmuxWindow({ tmuxWindowID: "@9", projectName: "tmux-opencode\t" })

    expect(execFileMock).toHaveBeenCalledWith(
      "tmux",
      ["rename-window", "-t", "@9", "tmux-opencode"],
      expect.any(Function),
    )
  })
})
