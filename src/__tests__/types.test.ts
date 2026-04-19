import { describe, expect, it } from "vitest"
import { STATUS_DIR_ENV_KEY, defaultStatusDirectory } from "../types"

describe("status contract", () => {
  it("exposes the env key constant for the snapshot directory", () => {
    expect(STATUS_DIR_ENV_KEY).toBe("TMUX_OPENCODE_STATUS_DIR")
  })

  it("provides a default status directory under the system tmp", () => {
    const dir = defaultStatusDirectory()
    expect(dir).toContain("opencode-status")
  })
})
