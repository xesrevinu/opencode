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

export function windowCatalogRows(rows: CatalogRow[], selectedId: string | undefined, height: number) {
  if (rows.length === 0) return rows
  const size = Math.max(1, height)
  const selected = Math.max(
    0,
    rows.findIndex((row) => row.kind === "session" && row.session.id === selectedId),
  )
  if (rows.length <= size) return rows
  const start = Math.min(rows.length - size, Math.max(0, selected - Math.floor(size / 3)))
  const slice = rows.slice(start, start + size)
  if (slice[0]?.kind !== "session") return slice
  const header = rows.slice(0, start).findLast((row) => row.kind === "header")
  if (!header) return slice
  const keep = selected - start >= size - 1 ? slice.slice(1) : slice.slice(0, size - 1)
  return [header, ...keep]
}

export type CatalogRow = ReturnType<typeof flattenCatalog>[number]
