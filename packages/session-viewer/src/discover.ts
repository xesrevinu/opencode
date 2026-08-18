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

export async function listSessions(homes?: AgentHomes, now = Date.now()): Promise<SessionSummary[]> {
  const resolved = resolveHomes(homes)
  const groups = await Promise.all([
    listOpencode(resolved.opencode, now),
    listCursor(resolved.cursor, now),
    listCodex(resolved.codex, now),
    listPi(resolved.pi, now),
    listGrok(resolved.grok, now),
    listClaude(resolved.claude, now),
  ])
  return groups.flat()
}

export function loadTranscript(summary: SessionSummary) {
  return loaders[summary.agent](summary)
}
