import { createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { SessionTranscript } from "../model"
import { AGENT_LABEL } from "../model"
import { flattenOpenCodeContent, toOpenCodeMessages, type OpenCodeViewRow } from "../opencode-view"
import { collapseToolOutput } from "../text"
import { formatWhen, shortPath } from "../format"
import { theme } from "./theme"

export function SessionView(props: { transcript?: SessionTranscript; now: number }) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [cursor, setCursor] = createSignal(0)
  const rows = createMemo(() => (props.transcript ? flattenOpenCodeContent(toOpenCodeMessages(props.transcript)) : []))
  const tools = createMemo(() => rows().filter((row) => row.kind === "tool"))

  useKeyboard((event) => {
    if (event.name === "down" || event.name === "j") {
      setCursor((value) => Math.min(tools().length - 1, value + 1))
      event.preventDefault()
      return
    }
    if (event.name === "up" || event.name === "k") {
      setCursor((value) => Math.max(0, value - 1))
      event.preventDefault()
      return
    }
    if (event.name === "return" || event.name === "space") {
      const tool = tools()[cursor()]
      if (!tool) return
      const next = new Set(expanded())
      if (next.has(tool.id)) next.delete(tool.id)
      else next.add(tool.id)
      setExpanded(next)
      event.preventDefault()
    }
  })

  return (
    <box flexGrow={1} flexDirection="column">
      <Show
        when={props.transcript}
        fallback={
          <box padding={1}>
            <text fg={theme.muted}>Loading session…</text>
          </box>
        }
      >
        {(transcript) => (
          <>
            <box paddingLeft={1} paddingRight={1} height={1}>
              <text fg={theme.accent}>{AGENT_LABEL[transcript().summary.agent]}</text>
              <text fg={theme.text}>  {transcript().summary.title}</text>
              <Show when={transcript().summary.live}>
                <text fg={theme.live}>  live</text>
              </Show>
            </box>
            <box paddingLeft={1} height={1}>
              <text fg={theme.muted}>
                {shortPath(transcript().summary.cwd)}  {transcript().summary.model ?? ""}  {formatWhen(transcript().summary.updatedAt)}
              </text>
            </box>
            <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
              <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1}>
                <For each={rows()}>
                  {(row) => (
                    <PartView
                      row={row}
                      expanded={row.kind === "tool" && expanded().has(row.id)}
                      focused={row.kind === "tool" && tools()[cursor()]?.id === row.id}
                    />
                  )}
                </For>
              </box>
            </scrollbox>
            <box height={1} paddingLeft={1}>
              <text fg={theme.dim}>esc home · j/k tools · enter expand tool · read-only</text>
            </box>
          </>
        )}
      </Show>
    </box>
  )
}

function PartView(props: {
  row: OpenCodeViewRow
  expanded: boolean
  focused: boolean
}) {
  const row = props.row
  if (row.kind === "user") {
    return (
      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.user}>user</text>
        <text fg={theme.text}>{row.text}</text>
      </box>
    )
  }
  if (row.kind === "assistant") {
    return (
      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.assistant}>assistant</text>
        <text fg={theme.text}>{row.text}</text>
      </box>
    )
  }
  if (row.kind === "reasoning") {
    return (
      <box flexDirection="column" marginBottom={1}>
        <text fg={theme.reasoning}>thinking</text>
        <text fg={theme.muted}>{row.text}</text>
      </box>
    )
  }
  const preview = row.output ? collapseToolOutput(row.output) : undefined
  return (
    <box flexDirection="column" marginBottom={1} backgroundColor={props.focused ? theme.selected : undefined}>
      <text fg={theme.tool}>
        {props.focused ? "› " : "  "}
        {row.name}  {row.status}
        {props.expanded ? "  ▼" : "  ▶"}
      </text>
      <Show when={row.input}>
        <text fg={theme.muted}>{collapseToolOutput(row.input, 4, 200).output}</text>
      </Show>
      <Show when={props.expanded && row.output}>
        <text fg={theme.text}>{row.output}</text>
      </Show>
      <Show when={!props.expanded && preview}>
        <text fg={theme.dim}>{preview!.output}</text>
      </Show>
    </box>
  )
}
