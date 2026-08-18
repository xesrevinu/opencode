import { buildCatalog } from "./catalog"
import { listSessions, loadTranscript } from "./discover"
import { parseAgent, resolveHomes } from "./homes"
import type { AgentHomes, FilterMode, SessionFilter } from "./model"

export type ViewerOptions = {
  home?: string
  homes?: AgentHomes
  agent?: string
  mode?: FilterMode
  query?: string
  json?: boolean
  session?: string
}

export async function runViewerCli(options: ViewerOptions) {
  const homes = resolveHomes(options.homes, options.home)
  const sessions = await listSessions(homes)
  const filter: SessionFilter = {
    mode: options.mode ?? "all",
    agent: parseAgent(options.agent),
    query: options.query,
  }
  const catalog = buildCatalog(sessions, filter)
  if (options.session) {
    const summary = sessions.find((session) => session.id === options.session)
    if (!summary) {
      process.stderr.write(`Session not found: ${options.session}\n`)
      process.exitCode = 1
      return
    }
    const transcript = await loadTranscript(summary)
    process.stdout.write(`${JSON.stringify(transcript, null, 2)}\n`)
    return
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`)
    return
  }
  const { runSessionViewer } = await import("./tui/run")
  await runSessionViewer({ homes, filter })
}
