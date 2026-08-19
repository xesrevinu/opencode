import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { buildCatalog, flattenCatalog } from "../catalog"
import { listSessions, loadTranscript } from "../discover"
import { AGENTS, type AgentHomes, type FilterMode, type SessionFilter, type SessionSummary, type SessionTranscript } from "../model"
import { Home } from "./home"
import { SessionView } from "./session"

export type ViewerAppProps = {
  homes: Required<AgentHomes>
  initialFilter: SessionFilter
  now?: number
}

export function ViewerApp(props: ViewerAppProps) {
  const [sessions, setSessions] = createSignal<SessionSummary[]>([])
  const [filter, setFilter] = createSignal<SessionFilter>(props.initialFilter)
  const [selected, setSelected] = createSignal(0)
  const [searching, setSearching] = createSignal(false)
  const [opened, setOpened] = createSignal<SessionSummary>()
  const [transcript, setTranscript] = createSignal<SessionTranscript>()
  const [now, setNow] = createSignal(props.now ?? Date.now())

  const catalog = createMemo(() => buildCatalog(sessions(), filter()))
  const rows = createMemo(() => flattenCatalog(catalog()))
  const sessionRows = createMemo(() => rows().flatMap((row, index) => (row.kind === "session" ? [{ index, session: row.session }] : [])))

  let listing: { agent?: SessionFilter["agent"]; promise: Promise<SessionSummary[]> } | undefined
  let transcriptKey = ""

  const refresh = async () => {
    const agent = filter().agent
    setNow(Date.now())
    if (!listing || listing.agent !== agent) {
      listing = {
        agent,
        promise: listSessions(props.homes, Date.now(), agent).finally(() => {
          if (listing?.agent === agent) listing = undefined
        }),
      }
    }
    setSessions(await listing.promise)
  }

  createEffect(() => {
    filter().agent
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const items = sessionRows()
    if (selected() >= items.length) setSelected(Math.max(0, items.length - 1))
  })

  createEffect(() => {
    const current = opened()
    if (!current) {
      transcriptKey = ""
      setTranscript(undefined)
      return
    }
    const latest = sessions().find((session) => session.id === current.id && session.agent === current.agent) ?? current
    const key = `${latest.agent}:${latest.id}:${latest.updatedAt}:${latest.sourcePath}`
    if (key === transcriptKey) return
    transcriptKey = key
    void loadTranscript(latest).then((next) => {
      if (transcriptKey === key) setTranscript(next)
    })
  })

  const cycleMode = () => {
    const order: FilterMode[] = ["live", "all", "history"]
    const index = order.indexOf(filter().mode)
    setFilter({ ...filter(), mode: order[(index + 1) % order.length] })
    setSelected(0)
  }

  const cycleAgent = (delta: number) => {
    const current = filter().agent
    const values = [undefined, ...AGENTS] as const
    const index = values.findIndex((agent) => agent === current)
    const next = values[(index + delta + values.length) % values.length]
    setFilter({ ...filter(), agent: next })
    setSelected(0)
  }

  const move = (delta: number) => {
    const count = sessionRows().length
    if (count === 0) return
    setSelected((value) => (value + delta + count) % count)
  }

  const openSelected = () => {
    const row = sessionRows()[selected()]
    if (!row) return
    setOpened(row.session)
  }

  useKeyboard((event) => {
    if (opened()) {
      if (event.name === "escape") {
        setOpened(undefined)
        event.preventDefault()
      }
      return
    }
    if (searching()) {
      if (event.name === "escape") {
        setSearching(false)
        event.preventDefault()
        return
      }
      if (event.name === "return") {
        setSearching(false)
        event.preventDefault()
        return
      }
      if (event.name === "backspace") {
        setFilter({ ...filter(), query: (filter().query ?? "").slice(0, -1) })
        event.preventDefault()
        return
      }
      if (event.sequence && event.sequence.length === 1 && !event.ctrl) {
        setFilter({ ...filter(), query: `${filter().query ?? ""}${event.sequence}` })
        setSelected(0)
        event.preventDefault()
      }
      return
    }
    if (event.name === "q" || (event.ctrl && event.name === "c")) {
      process.exit(0)
    }
    if (event.name === "/") {
      setSearching(true)
      event.preventDefault()
      return
    }
    if (event.name === "escape") {
      if (filter().query || filter().agent || filter().mode !== "live") {
        setFilter({ mode: "live" })
        setSelected(0)
        event.preventDefault()
        return
      }
      process.exit(0)
    }
    if (event.name === "l") {
      cycleMode()
      event.preventDefault()
      return
    }
    if (event.name === "tab") {
      cycleAgent(event.shift ? -1 : 1)
      event.preventDefault()
      return
    }
    if (event.name === "down" || event.name === "j") {
      move(1)
      event.preventDefault()
      return
    }
    if (event.name === "up" || event.name === "k") {
      move(-1)
      event.preventDefault()
      return
    }
    if (event.name === "return") {
      openSelected()
      event.preventDefault()
    }
  })

  return (
    <box flexGrow={1} flexDirection="column">
      <Show
        when={opened()}
        fallback={
          <Home
            catalog={catalog()}
            rows={rows()}
            selectedId={sessionRows()[selected()]?.session.id}
            filter={filter()}
            searching={searching()}
            now={now()}
          />
        }
      >
        <SessionView
          transcript={transcript()}
          now={now()}
        />
      </Show>
    </box>
  )
}
