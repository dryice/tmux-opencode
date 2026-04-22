import { execFile } from "node:child_process"

export type TmuxContext = {
  tmuxSessionID: string
  tmuxWindowID: string
  tmuxPaneID: string
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
  try {
    await execTmux(["rename-window", "-t", input.tmuxWindowID, `${input.projectName}-${input.sessionTitle}`])
  } catch {
    return
  }
}
