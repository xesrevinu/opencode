import { AGENTS, type AgentGroup, type Catalog, type SessionFilter, type SessionSummary } from "./model"

export function matchesQuery(session: SessionSummary, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [session.title, session.id, session.agent, session.cwd ?? "", session.model ?? ""]
    .join("\n")
    .toLowerCase()
  return haystack.includes(needle)
}

export function filterSessions(sessions: readonly SessionSummary[], filter: SessionFilter) {
  return sessions.filter((session) => {
    if (filter.agent && session.agent !== filter.agent) return false
    if (filter.mode === "live" && !session.live) return false
    if (filter.mode === "history" && session.live) return false
    return matchesQuery(session, filter.query ?? "")
  })
}

export function sortSessions(sessions: readonly SessionSummary[]) {
  return sessions.toSorted((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}

export function groupSessions(sessions: readonly SessionSummary[]): AgentGroup[] {
  return AGENTS.flatMap((agent) => {
    const items = sessions.filter((session) => session.agent === agent)
    if (items.length === 0) return []
    return [
      {
        agent,
        liveCount: items.filter((session) => session.live).length,
        totalCount: items.length,
        sessions: items,
      },
    ]
  })
}

export function buildCatalog(sessions: readonly SessionSummary[], filter: SessionFilter): Catalog {
  const filtered = sortSessions(filterSessions(sessions, filter))
  return {
    groups: groupSessions(filtered),
    sessions: filtered,
    liveCount: filtered.filter((session) => session.live).length,
    totalCount: filtered.length,
  }
}

export function flattenCatalog(catalog: Catalog) {
  return catalog.groups.flatMap((group) => [
    { kind: "header" as const, agent: group.agent, liveCount: group.liveCount, totalCount: group.totalCount },
    ...group.sessions.map((session) => ({ kind: "session" as const, session })),
  ])
}

export type CatalogRow = ReturnType<typeof flattenCatalog>[number]
