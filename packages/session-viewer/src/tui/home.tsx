import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@opencode-ai/tui/context/theme"
import { windowCatalogRows, type CatalogRow } from "../catalog"
import type { Catalog, SessionFilter } from "../model"
import { AGENT_LABEL, type AgentKind } from "../model"
import { formatRelative, shortPath } from "../format"

export function Home(props: {
  catalog: Catalog
  rows: CatalogRow[]
  selectedId?: string
  filter: SessionFilter
  searching: boolean
  now: number
  onSelect: (id: string) => void
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const mode = () => props.filter.mode
  const agent = () => props.filter.agent ?? "all"
  const pad = () => (dimensions().width < 44 ? 1 : 2)
  const visible = () => windowCatalogRows(props.rows, props.selectedId, Math.max(8, dimensions().height - pad() - 4))

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={theme.background.default}
      paddingTop={pad()}
      paddingLeft={pad()}
      paddingRight={pad()}
    >
      <box flexDirection="row" height={1} flexShrink={0}>
        <text fg={theme.text.action.primary.default}>session viewer</text>
        <text fg={theme.text.subdued}>  read-only</text>
        <box flexGrow={1} />
        <text fg={mode() === "live" ? theme.text.feedback.success.default : theme.text.subdued}>[{mode()}]</text>
        <text fg={theme.text.subdued}>  {agent()}</text>
      </box>
      <box flexDirection="row" height={1} flexShrink={0}>
        <text fg={props.searching ? theme.text.action.primary.default : theme.text.subdued}>
          {props.searching ? "/" : "filter"} {props.filter.query || (props.searching ? "" : "· / search  tab agent  l live/all/history")}
        </text>
      </box>
      <box
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        onMouseScroll={(event) => {
          const direction = event.scroll?.direction
          if (direction !== "up" && direction !== "down") return
          const items = props.rows.flatMap((row) => (row.kind === "session" ? [row.session.id] : []))
          const index = items.indexOf(props.selectedId ?? "")
          const next = items[index + (direction === "down" ? 1 : -1)]
          if (next) props.onSelect(next)
        }}
      >
        <Show
          when={props.rows.length > 0}
          fallback={
            <box paddingTop={1}>
              <text fg={theme.text.subdued}>
                {mode() === "live" ? "No live sessions. Press l to view history." : "No sessions match this filter."}
              </text>
            </box>
          }
        >
          <For each={visible()}>
            {(row) =>
              row.kind === "header" ? (
                <GroupHeader agent={row.agent} liveCount={row.liveCount} totalCount={row.totalCount} mode={mode()} />
              ) : (
                <SessionRow
                  id={row.session.id}
                  selected={row.session.id === props.selectedId}
                  title={row.session.title}
                  cwd={row.session.cwd}
                  model={row.session.model}
                  live={row.session.live}
                  updatedAt={row.session.updatedAt}
                  now={props.now}
                  onSelect={() => props.onSelect(row.session.id)}
                />
              )
            }
          </For>
        </Show>
      </box>
      <box height={1} marginTop={1} flexShrink={0}>
        <text fg={theme.text.subdued} wrapMode="none">
          {props.catalog.liveCount} live · {props.catalog.totalCount} shown · enter open · s settings · esc back · q quit
        </text>
      </box>
    </box>
  )
}

function GroupHeader(props: { agent: AgentKind; liveCount: number; totalCount: number; mode: string }) {
  const theme = useTheme()
  const count = props.mode === "live" ? props.liveCount : props.totalCount
  return (
    <box height={1} marginTop={1} flexShrink={0}>
      <text fg={theme.text.default}>
        {AGENT_LABEL[props.agent]}  {props.liveCount} live / {count} {props.mode === "live" ? "running" : "sessions"}
      </text>
    </box>
  )
}

function SessionRow(props: {
  id: string
  selected: boolean
  title: string
  cwd?: string
  model?: string
  live: boolean
  updatedAt: number
  now: number
  onSelect: () => void
}) {
  const theme = useTheme()
  return (
    <box
      id={`session:${props.id}`}
      flexDirection="row"
      height={1}
      width="100%"
      flexShrink={0}
      backgroundColor={props.selected ? theme.background.formfield.hovered : undefined}
      onMouseUp={props.onSelect}
    >
      <text
        width={2}
        fg={props.selected ? theme.text.formfield.selected : props.live ? theme.text.feedback.success.default : theme.text.subdued}
        attributes={props.selected ? TextAttributes.BOLD : undefined}
      >
        {props.selected ? "›" : props.live ? "●" : "○"}
      </text>
      <text
        fg={theme.text.default}
        wrapMode="none"
        truncate
        flexGrow={1}
        flexShrink={1}
        minWidth={8}
        attributes={props.selected ? TextAttributes.BOLD : undefined}
      >
        {props.title}
      </text>
      <text fg={theme.text.subdued} wrapMode="none" truncate flexShrink={1} minWidth={0}>
        {"  "}
        {shortPath(props.cwd)}
      </text>
      <text fg={theme.text.subdued} wrapMode="none" truncate flexShrink={1} minWidth={0}>
        {"  "}
        {props.model ?? ""} {formatRelative(props.updatedAt, props.now)}
      </text>
    </box>
  )
}
