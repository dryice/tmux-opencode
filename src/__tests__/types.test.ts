import { describe, expect, it } from "vitest"
import { STATUS_DIR_ENV_KEY, defaultStatusDirectory, STALE_AFTER_MS } from "../types"

describe("status contract", () => {
  it("exposes the env key constant for the snapshot directory", () => {
    expect(STATUS_DIR_ENV_KEY).toBe("TMUX_OPENCODE_STATUS_DIR")
  })

  it("provides a default status directory under the system tmp", () => {
    const dir = defaultStatusDirectory()
    expect(dir).toContain("opencode-status")
  })

  it("defines a 60-second stale threshold", () => {
    expect(STALE_AFTER_MS).toBe(60_000)
  })
})
