import { execFile } from "node:child_process"

export type TmuxContext = {
  tmuxSessionID: string
  tmuxWindowID: string
  tmuxPaneID: string
}

function sanitizeTmuxWindowNamePart(value: string, maxLength: number): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

export function buildTmuxWindowName(input: { projectName: string; sessionTitle: string }): string {
  const projectName = sanitizeTmuxWindowNamePart(input.projectName, 80)
  const sessionTitle = sanitizeTmuxWindowNamePart(input.sessionTitle, 80)
  return sanitizeTmuxWindowNamePart(`${projectName}-${sessionTitle}`, 160)
}

function execTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }

      resolve(stdout)
    })
  })
}

export async function resolveTmuxContext(): Promise<TmuxContext | null> {
  const tmuxPaneID = process.env.TMUX_PANE
  if (!tmuxPaneID) {
    return null
  }

  try {
    const output = await execTmux(["display-message", "-p", "-t", tmuxPaneID, "#{session_id}\t#{window_id}\t#{pane_id}"])
    const [tmuxSessionID, tmuxWindowID, paneID] = output.trim().split("\t")

    if (!tmuxSessionID || !tmuxWindowID || !paneID) {
      return null
    }

    return { tmuxSessionID, tmuxWindowID, tmuxPaneID: paneID }
  } catch {
    return null
  }
}

export async function renameTmuxWindow(input: {
  tmuxWindowID: string
  projectName: string
  sessionTitle: string
}): Promise<void> {
  const windowName = buildTmuxWindowName({
    projectName: input.projectName,
    sessionTitle: input.sessionTitle,
  })
  if (!windowName) {
    return
  }

  try {
    await execTmux(["rename-window", "-t", input.tmuxWindowID, windowName])
  } catch {
    return
  }
}
