import { listClaude, loadClaude } from "./adapters/claude"
import { listCodex, loadCodex } from "./adapters/codex"
import { listCursor, loadCursor } from "./adapters/cursor"
import { listGrok, loadGrok } from "./adapters/grok"
import { listOpencode, loadOpencode } from "./adapters/opencode"
import { listPi, loadPi } from "./adapters/pi"
import { resolveHomes } from "./homes"
import type { AgentHomes, AgentKind, SessionSummary, SessionTranscript } from "./model"

const loaders: Record<AgentKind, (summary: SessionSummary) => Promise<SessionTranscript>> = {
  opencode: loadOpencode,
  cursor: loadCursor,
  codex: loadCodex,
  pi: loadPi,
  grok: loadGrok,
  claude: loadClaude,
}

const listers: Record<AgentKind, (home: string, now: number) => Promise<SessionSummary[]>> = {
  opencode: listOpencode,
  cursor: listCursor,
  codex: listCodex,
  pi: listPi,
  grok: listGrok,
  claude: listClaude,
}

export async function listSessions(homes?: AgentHomes, now = Date.now(), agent?: AgentKind): Promise<SessionSummary[]> {
  const resolved = resolveHomes(homes)
  const kinds = agent ? [agent] : (Object.keys(listers) as AgentKind[])
  const groups = await Promise.all(kinds.map((kind) => listers[kind](resolved[kind], now)))
  return groups.flat()
}

export function loadTranscript(summary: SessionSummary) {
  return loaders[summary.agent](summary)
}
