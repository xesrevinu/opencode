import { For, Show } from "solid-js"
import type { CatalogRow } from "../catalog"
import type { Catalog, SessionFilter } from "../model"
import { AGENT_LABEL, type AgentKind } from "../model"
import { formatRelative, shortPath } from "../format"
import { theme } from "./theme"

export function Home(props: {
  catalog: Catalog
  rows: CatalogRow[]
  selectedId?: string
  filter: SessionFilter
  searching: boolean
  now: number
}) {
  const mode = () => props.filter.mode
  const agent = () => props.filter.agent ?? "all"
  return (
    <box flexGrow={1} flexDirection="column">
      <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1}>
        <text fg={theme.accent}>session viewer</text>
        <text fg={theme.dim}>  read-only</text>
        <box flexGrow={1} />
        <text fg={mode() === "live" ? theme.live : theme.muted}>[{mode()}]</text>
        <text fg={theme.muted}>  {agent()}</text>
      </box>
      <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1}>
        <text fg={props.searching ? theme.accent : theme.muted}>
          {props.searching ? "/" : "filter"} {props.filter.query || (props.searching ? "" : "· / search  tab agent  l live/all/history")}
        </text>
      </box>
      <box flexGrow={1} flexDirection="column" paddingLeft={1} paddingRight={1}>
        <Show
          when={props.rows.length > 0}
          fallback={
            <box paddingTop={1}>
              <text fg={theme.muted}>
                {mode() === "live" ? "No live sessions. Press l to view history." : "No sessions match this filter."}
              </text>
            </box>
          }
        >
          <For each={props.rows}>
            {(row) =>
              row.kind === "header" ? (
                <GroupHeader agent={row.agent} liveCount={row.liveCount} totalCount={row.totalCount} mode={mode()} />
              ) : (
                <SessionRow
                  selected={row.session.id === props.selectedId}
                  title={row.session.title}
                  cwd={row.session.cwd}
                  model={row.session.model}
                  live={row.session.live}
                  updatedAt={row.session.updatedAt}
                  now={props.now}
                />
              )
            }
          </For>
        </Show>
      </box>
      <box height={1} paddingLeft={1}>
        <text fg={theme.dim}>
          {props.catalog.liveCount} live · {props.catalog.totalCount} shown · enter open · esc back · q quit
        </text>
      </box>
    </box>
  )
}

function GroupHeader(props: { agent: AgentKind; liveCount: number; totalCount: number; mode: string }) {
  const count = props.mode === "live" ? props.liveCount : props.totalCount
  return (
    <box height={1} marginTop={1}>
      <text fg={theme.header}>
        {AGENT_LABEL[props.agent]}  {props.liveCount} live / {count} {props.mode === "live" ? "running" : "sessions"}
      </text>
    </box>
  )
}

function SessionRow(props: {
  selected: boolean
  title: string
  cwd?: string
  model?: string
  live: boolean
  updatedAt: number
  now: number
}) {
  return (
    <box height={1} backgroundColor={props.selected ? theme.selected : undefined}>
      <text fg={props.live ? theme.live : theme.dim}>{props.live ? "●" : "○"}</text>
      <text fg={props.selected ? theme.text : theme.text}> {props.title}</text>
      <text fg={theme.muted}>  {shortPath(props.cwd)}</text>
      <text fg={theme.dim}>  {props.model ?? ""}  {formatRelative(props.updatedAt, props.now)}</text>
    </box>
  )
}
