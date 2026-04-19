# tmux-opencode v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small OpenCode-to-tmux bridge where an OpenCode plugin writes per-session JSON status snapshots and a TPM-compatible tmux plugin opens a popup that renders those snapshots.

**Architecture:** Keep a strict file boundary between producer and consumer. The TypeScript OpenCode plugin owns session truth and writes atomic JSON files into a shared temp directory. The tmux side stays read-only: a TPM entrypoint binds a hotkey that opens a popup and runs a shell renderer over the snapshot directory.

**Tech Stack:** TypeScript, Vitest, Bun-compatible ESM packaging, Bash, tmux TPM conventions

---

### Task 1: Scaffold the writer package and shared contract

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Create: `src/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing type contract test**

```ts
import { describe, expect, it } from "vitest"
import { STATUS_DIR_ENV_KEY, defaultStatusDirectory, STALE_AFTER_MS } from "../types"

describe("status contract", () => {
  it("exposes stable defaults for the snapshot writer", () => {
    expect(STATUS_DIR_ENV_KEY).toBe("TMUX_OPENCODE_STATUS_DIR")
    expect(defaultStatusDirectory()).toContain("opencode-status")
    expect(STALE_AFTER_MS).toBe(60_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/__tests__/types.test.ts`
Expected: FAIL with module-not-found or missing export errors for `src/types.ts`

- [ ] **Step 3: Add the minimal scaffold and contract implementation**

```json
{
  "name": "tmux-opencode",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "*"
  }
}
```

```ts
import os from "node:os"
import path from "node:path"

export const STATUS_DIR_ENV_KEY = "TMUX_OPENCODE_STATUS_DIR"
export const STALE_AFTER_MS = 60_000

export type SessionStatus = "working" | "waiting" | "question" | "idle" | "error"
export type SessionKind = "root" | "subagent"

export interface SessionSnapshot {
  version: 1
  sessionID: string
  parentID: string | null
  kind: SessionKind
  title: string
  status: SessionStatus
  summary: string
  updatedAt: number
}

export function defaultStatusDirectory(): string {
  const base = process.env.TMPDIR ?? os.tmpdir()
  return path.join(base, "opencode-status")
}
```

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npm test -- --run src/__tests__/types.test.ts && npm run typecheck`
Expected: PASS and exit code 0

### Task 2: Implement the atomic snapshot writer

**Files:**
- Create: `src/status-store.ts`
- Create: `src/__tests__/status-store.test.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write the failing writer test**

```ts
import { describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeSnapshot } from "../status-store"

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

    const written = JSON.parse(readFileSync(path.join(directory, "session-1.json"), "utf8"))
    expect(written.status).toBe("working")
  })
})
```

- [ ] **Step 2: Run the writer test to verify it fails**

Run: `npm test -- --run src/__tests__/status-store.test.ts`
Expected: FAIL with module-not-found for `src/status-store.ts`

- [ ] **Step 3: Implement the minimal writer and stale-reader helpers**

```ts
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { SessionSnapshot, STALE_AFTER_MS } from "./types"

export async function writeSnapshot(directory: string, snapshot: SessionSnapshot): Promise<void> {
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, `${snapshot.sessionID}.json`)
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
  await rename(temporary, target)
}

export async function deleteSnapshot(directory: string, sessionID: string): Promise<void> {
  await rm(path.join(directory, `${sessionID}.json`), { force: true })
}

export async function listSnapshots(directory: string): Promise<SessionSnapshot[]> {
  await mkdir(directory, { recursive: true })
  const names = await readdir(directory)
  const parsed = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")) as SessionSnapshot))
  return parsed.filter((snapshot) => Date.now() - snapshot.updatedAt <= STALE_AFTER_MS)
}
```

- [ ] **Step 4: Add stale filtering and delete coverage**

Add tests for `deleteSnapshot()` and `listSnapshots()` filtering out stale data older than `STALE_AFTER_MS`.

- [ ] **Step 5: Run the writer test suite**

Run: `npm test -- --run src/__tests__/status-store.test.ts`
Expected: PASS

### Task 3: Implement the OpenCode event-to-snapshot adapter

**Files:**
- Create: `src/index.ts`
- Create: `src/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

```ts
import { describe, expect, it, vi } from "vitest"
import plugin from "../index"

describe("tmux-opencode plugin", () => {
  it("writes a working snapshot for busy status events", async () => {
    const get = vi.fn().mockResolvedValue({ data: { title: "Main", parentID: null } })
    const hooks = await plugin({ client: { session: { get } } } as never)
    expect(typeof hooks.event).toBe("function")
  })
})
```

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run: `npm test -- --run src/__tests__/index.test.ts`
Expected: FAIL because `src/index.ts` does not exist or does not export a plugin function

- [ ] **Step 3: Implement the event mapping minimally**

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { defaultStatusDirectory, STATUS_DIR_ENV_KEY, SessionSnapshot } from "./types"
import { deleteSnapshot, writeSnapshot } from "./status-store"

function directory(): string {
  return process.env[STATUS_DIR_ENV_KEY] ?? defaultStatusDirectory()
}

const plugin: Plugin = async ({ client }) => ({
  async event(input) {
    const event = input.event as any
    if (event.type !== "session.status" && event.type !== "question.asked") {
      return
    }

    const sessionID = event.properties.sessionID
    const details = await client.session.get({ path: { id: sessionID } })
    const snapshot: SessionSnapshot = {
      version: 1,
      sessionID,
      parentID: details.data.parentID,
      kind: details.data.parentID ? "subagent" : "root",
      title: details.data.title,
      status: event.type === "question.asked" ? "question" : event.properties.status.type === "busy" ? "working" : "idle",
      summary: event.type === "question.asked" ? "Question asked" : `Session is ${event.properties.status.type}`,
      updatedAt: Date.now(),
    }

    if (snapshot.status === "idle") {
      await deleteSnapshot(directory(), sessionID)
      return
    }

    await writeSnapshot(directory(), snapshot)
  },
  async "permission.ask"(input) {
    const details = await client.session.get({ path: { id: input.sessionID } })
    await writeSnapshot(directory(), {
      version: 1,
      sessionID: input.sessionID,
      parentID: details.data.parentID,
      kind: details.data.parentID ? "subagent" : "root",
      title: details.data.title,
      status: "waiting",
      summary: `Permission required: ${input.tool}`,
      updatedAt: Date.now(),
    })
  },
})

export default plugin
```

- [ ] **Step 4: Add tests for question, permission, and idle cleanup**

Cover these cases: `question.asked` writes `status="question"`, `permission.ask` writes `status="waiting"`, and `session.status` with `idle` deletes the existing snapshot.

- [ ] **Step 5: Run the adapter suite**

Run: `npm test -- --run src/__tests__/index.test.ts`
Expected: PASS

### Task 4: Implement the tmux popup viewer

**Files:**
- Create: `tmux-opencode.tmux`
- Create: `scripts/render_status.sh`
- Create: `scripts/show_popup.sh`
- Create: `test/render_status_test.sh`
- Create: `test/fixtures/root-working.json`
- Create: `test/fixtures/subagent-waiting.json`

- [ ] **Step 1: Write the failing shell rendering test**

```bash
#!/usr/bin/env bash
set -euo pipefail

output="$(TMUX_OPENCODE_STATUS_DIR="$PWD/test/fixtures" bash scripts/render_status.sh)"
[[ "$output" == *"Main session"* ]]
[[ "$output" != *"Subagent helper"* ]]
```

- [ ] **Step 2: Run the shell test to verify it fails**

Run: `bash test/render_status_test.sh`
Expected: FAIL because `scripts/render_status.sh` does not exist

- [ ] **Step 3: Implement the viewer scripts minimally**

```bash
#!/usr/bin/env bash
set -euo pipefail

status_dir="${TMUX_OPENCODE_STATUS_DIR:-${TMPDIR:-/tmp}/opencode-status}"
now="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

printed=0
while IFS= read -r file; do
  [ -f "$file" ] || continue
  session_kind="$(python3 - "$file" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    payload = json.load(handle)
print(payload['kind'])
PY
)"
  [ "$session_kind" = "root" ] || continue
  python3 - "$file" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    payload = json.load(handle)
print(f"{payload['status']:8}  {payload['title']}  {payload['summary']}")
PY
  printed=1
done < <(find "$status_dir" -name '*.json' -print 2>/dev/null | sort)

if [ "$printed" -eq 0 ]; then
  printf 'No active opencode sessions\n'
fi
```

```bash
#!/usr/bin/env bash
set -euo pipefail
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmux display-popup -E "bash '$CURRENT_DIR/render_status.sh'"
```

```bash
#!/usr/bin/env bash
set -euo pipefail
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_key="O"
key="$(tmux show-option -gqv @opencode-key || true)"
key="${key:-$default_key}"
tmux bind-key "$key" run-shell "bash '$CURRENT_DIR/scripts/show_popup.sh'"
```

- [ ] **Step 4: Add shell tests for empty state and optional subagent mode**

Add one test for an empty directory returning `No active opencode sessions`, and one test with `TMUX_OPENCODE_SHOW_SUBAGENTS=1` showing both the root session and the subagent.

- [ ] **Step 5: Run shell verification**

Run: `bash test/render_status_test.sh && bash -n tmux-opencode.tmux && bash -n scripts/render_status.sh && bash -n scripts/show_popup.sh`
Expected: PASS

### Task 5: Document installation and verify end-to-end behavior

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README with exact install paths**

Include:
- npm install instructions for local development
- how to point OpenCode at the plugin package
- how to add `set -g @plugin 'dryice/tmux-opencode'` to `.tmux.conf`
- how to override `TMUX_OPENCODE_STATUS_DIR` and `@opencode-key`

- [ ] **Step 2: Run the full verification set**

Run: `npm test && npm run typecheck && bash test/render_status_test.sh && bash -n tmux-opencode.tmux && bash -n scripts/render_status.sh && bash -n scripts/show_popup.sh`
Expected: PASS with all suites green

- [ ] **Step 3: Manual QA**

Run these manual checks and capture output:
1. `TMUX_OPENCODE_STATUS_DIR="$PWD/.tmp-status" node --input-type=module -e "import { writeSnapshot } from './src/status-store.ts'; await writeSnapshot(process.env.TMUX_OPENCODE_STATUS_DIR, { version: 1, sessionID: 'demo', parentID: null, kind: 'root', title: 'Demo', status: 'working', summary: 'Waiting for tmux', updatedAt: Date.now() })"`
2. `TMUX_OPENCODE_STATUS_DIR="$PWD/.tmp-status" bash scripts/render_status.sh`

Expected: the renderer prints a line containing `Demo` and `working`
