import { describe, expect, test } from "bun:test"
import { buildCatalog, filterSessions, flattenCatalog, matchesQuery, windowCatalogRows } from "../src/catalog"
import type { SessionSummary } from "../src/model"

function session(partial: Partial<SessionSummary> & Pick<SessionSummary, "id" | "agent">): SessionSummary {
  return {
    title: partial.title ?? partial.id,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    live: partial.live ?? false,
    sourcePath: partial.sourcePath ?? `/tmp/${partial.id}`,
    cwd: partial.cwd,
    model: partial.model,
    ...partial,
  }
}

const sessions = [
  session({ id: "oc-1", agent: "opencode", title: "Fix login", cwd: "/repo/app", live: true, updatedAt: 30 }),
  session({ id: "cx-1", agent: "codex", title: "Review PR", cwd: "/repo", live: false, updatedAt: 20 }),
  session({ id: "pi-1", agent: "pi", title: "Explore activitywatch", cwd: "/aw", live: true, updatedAt: 40 }),
  session({ id: "gk-1", agent: "grok", title: "Audit Metal APIs", model: "grok-4.6", live: false, updatedAt: 10 }),
]

describe("catalog", () => {
  test("groups sessions by agent and counts live ones", () => {
    const catalog = buildCatalog(sessions, { mode: "all" })
    expect(catalog.groups.map((group) => [group.agent, group.liveCount, group.totalCount])).toEqual([
      ["opencode", 1, 1],
      ["codex", 0, 1],
      ["pi", 1, 1],
      ["grok", 0, 1],
    ])
    expect(catalog.groups.some((group) => group.agent === "cursor")).toBe(false)
    expect(catalog.liveCount).toBe(2)
    expect(catalog.sessions[0]?.id).toBe("pi-1")
  })

  test("live mode hides idle sessions", () => {
    const filtered = filterSessions(sessions, { mode: "live" })
    expect(filtered.map((item) => item.id)).toEqual(["oc-1", "pi-1"])
  })

  test("history mode hides live sessions", () => {
    expect(filterSessions(sessions, { mode: "history" }).map((item) => item.id)).toEqual(["cx-1", "gk-1"])
  })

  test("filters by agent and search query", () => {
    expect(filterSessions(sessions, { mode: "all", agent: "grok" }).map((item) => item.id)).toEqual(["gk-1"])
    expect(matchesQuery(sessions[3]!, "metal")).toBe(true)
    expect(filterSessions(sessions, { mode: "all", query: "login" }).map((item) => item.id)).toEqual(["oc-1"])
    expect(filterSessions(sessions, { mode: "all", query: "/aw" }).map((item) => item.id)).toEqual(["pi-1"])
  })

  test("flattens groups into header and session rows", () => {
    const rows = flattenCatalog(buildCatalog(sessions, { mode: "live" }))
    expect(rows.map((row) => (row.kind === "header" ? row.agent : row.session.id))).toEqual([
      "opencode",
      "oc-1",
      "pi",
      "pi-1",
    ])
  })

  test("windows flattened rows around the selected session", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      session({ id: `oc-${index}`, agent: "opencode", title: `S${index}`, updatedAt: index }),
    )
    const rows = flattenCatalog(buildCatalog(many, { mode: "all" }))
    const windowed = windowCatalogRows(rows, "oc-10", 6)
    expect(windowed).toHaveLength(6)
    expect(windowed[0]).toMatchObject({ kind: "header", agent: "opencode" })
    expect(windowed.some((row) => row.kind === "session" && row.session.id === "oc-10")).toBe(true)
    expect(windowCatalogRows(rows, "oc-0", 6).at(-1)).toMatchObject({ kind: "session", session: { id: "oc-0" } })
  })
})
