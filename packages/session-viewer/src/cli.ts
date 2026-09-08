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
  help?: boolean
}

export function parseViewerArgs(argv: readonly string[]): ViewerOptions {
  const options: ViewerOptions = {}
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") {
      options.help = true
      continue
    }
    if (arg === "--json") {
      options.json = true
      continue
    }
    if (arg === "--live") {
      options.mode = "live"
      continue
    }
    if (arg === "--all") {
      if (options.mode !== "live") options.mode = "all"
      continue
    }
    const value = argv[index + 1]
    if (arg === "--agent") {
      options.agent = requireValue(arg, value)
      index++
      continue
    }
    if (arg === "--query" || arg === "-q") {
      options.query = requireValue(arg, value)
      index++
      continue
    }
    if (arg === "--session" || arg === "-s") {
      options.session = requireValue(arg, value)
      index++
      continue
    }
    if (arg === "--home") {
      options.home = requireValue(arg, value)
      index++
      continue
    }
    throw new Error(`Unknown flag: ${arg}`)
  }
  if (!options.mode) options.mode = options.json || options.session ? "all" : "live"
  return options
}

function requireValue(flag: string, value: string | undefined) {
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`)
  return value
}

export async function runViewerCli(options: ViewerOptions) {
  const homes = resolveHomes(options.homes, options.home)
  const sessions = await listSessions(homes)
  const filter: SessionFilter = {
    mode: options.mode ?? (options.json || options.session ? "all" : "live"),
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
