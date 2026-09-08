import { addDefaultParsers, RGBA, TextAttributes } from "@opentui/core"
import { For, Show, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type {
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode/client"
import { useConfig } from "../config"
import { createSyntaxStyleMemo, useTheme, useThemes } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { SplitBorder } from "../ui/border"
import { reasoningSummary } from "../context/thinking"
import { generateThinkingSyntax } from "../routes/session/thinking-syntax"
import { Locale } from "../util/locale"
import { formatPath } from "../util/path-format"
import {
  canonicalToolName,
  finiteNumber,
  toolDisplayContent,
  toolDisplayMetadata,
} from "../util/tool-display"
import { collapseToolOutput } from "../util/collapse-tool-output"
import { reduceSessionRows, resolvePart, type PartRef, type SessionRow } from "../routes/session/rows-reduce"
import parsers from "../parsers-config"

addDefaultParsers(parsers.parsers)

const TOOL_ICONS: Record<string, string> = {
  read: "→",
  write: "←",
  edit: "←",
  glob: "✱",
  grep: "✱",
  webfetch: "%",
  websearch: "◈",
  shell: "$",
  subagent: "✓",
  execute: "▸",
  patch: "←",
  question: "?",
  skill: "*",
}

export function sessionMessageRows(messages: readonly SessionMessageInfo[]) {
  return reduceSessionRows([...messages])
}

export function SessionMessageList(props: {
  messages: readonly SessionMessageInfo[]
  cwd?: string
  home?: string
  keyboard?: boolean
  footer?: boolean
}) {
  const theme = useTheme()
  const dialog = useDialog()
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [cursor, setCursor] = createSignal(0)
  const byID = createMemo(() => new Map(props.messages.map((message) => [message.id, message])))
  const rows = createMemo(() => sessionMessageRows(props.messages))
  const tools = createMemo(() =>
    rows().flatMap((row) => {
      if (row.type === "part") {
        const message = byID().get(row.ref.messageID)
        if (message?.type !== "assistant") return []
        const part = resolvePart(message, row.ref.partID)
        return part?.type === "tool" ? [part.id] : []
      }
      if (row.type === "group") return [groupKey(row)]
      return []
    }),
  )

  const toggle = (id: string) => {
    const next = new Set(expanded())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  useKeyboard((event) => {
    if (props.keyboard === false) return
    if (dialog.stack.length) return
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
      const id = tools()[cursor()]
      if (id) toggle(id)
      event.preventDefault()
    }
  })

  const message = (id: string) => byID().get(id)

  return (
    <box flexGrow={1} flexDirection="column" backgroundColor={theme.background.default}>
      <For each={rows()}>
        {(row) =>
          row.type === "assistant-footer" && props.footer === false ? null : (
            <box marginTop={1} flexShrink={0}>
              <RowView
                row={row}
                message={message}
                cwd={props.cwd}
                home={props.home}
                expanded={expanded()}
                focused={props.keyboard === false ? undefined : tools()[cursor()]}
                onToggle={toggle}
              />
            </box>
          )
        }
      </For>
    </box>
  )
}

function RowView(props: {
  row: SessionRow
  message: (id: string) => SessionMessageInfo | undefined
  cwd?: string
  home?: string
  expanded: Set<string>
  focused?: string
  onToggle: (id: string) => void
}) {
  const theme = useTheme()
  const config = useConfig().data
  const thinkingShow = () => config.session?.thinking === "show"
  const groupExploration = () => config.session?.grouping !== "none"
  const toolsShow = () => config.session?.tools === "show"
  const row = props.row
  if (row.type === "message") {
    const item = props.message(row.messageID)
    if (item?.type === "user") return <UserMessageView message={item} />
    if (item?.type === "assistant") return null
    if (!item) return null
    return (
      <box paddingLeft={3}>
        <text fg={theme.text.subdued}>{noticeText(item)}</text>
      </box>
    )
  }
  if (row.type === "part") {
    const item = props.message(row.ref.messageID)
    if (item?.type !== "assistant") return null
    const part = resolvePart(item, row.ref.partID)
    if (!part) return null
    if (part.type === "text") return <TextView part={part} />
    if (part.type === "reasoning") return <ReasoningView part={part} message={item} />
    return (
      <ToolView
        part={part}
        cwd={props.cwd}
        home={props.home}
        expanded={props.expanded.has(part.id) !== toolsShow()}
        focused={props.focused === part.id}
        onToggle={() => props.onToggle(part.id)}
      />
    )
  }
  if (row.type === "group" && row.kind === "reasoning") {
    if (thinkingShow()) {
      return (
        <For each={row.refs}>
          {(ref) => {
            const item = props.message(ref.messageID)
            if (item?.type !== "assistant") return null
            const part = resolvePart(item, ref.partID)
            if (part?.type !== "reasoning") return null
            return <ReasoningView part={part} message={item} />
          }}
        </For>
      )
    }
    return (
      <ReasoningGroupView
        refs={row.refs}
        completed={row.completed}
        message={props.message}
        expanded={props.expanded.has(groupKey(row))}
        focused={props.focused === groupKey(row)}
        onToggle={() => props.onToggle(groupKey(row))}
      />
    )
  }
  if (row.type === "group" && row.kind === "exploration") {
    if (!groupExploration()) {
      return (
        <For each={row.refs}>
          {(ref) => {
            const item = props.message(ref.messageID)
            if (item?.type !== "assistant") return null
            const part = resolvePart(item, ref.partID)
            if (part?.type !== "tool") return null
            return (
              <ToolView
                part={part}
                cwd={props.cwd}
                home={props.home}
                expanded={props.expanded.has(part.id) !== toolsShow()}
                focused={props.focused === part.id}
                onToggle={() => props.onToggle(part.id)}
              />
            )
          }}
        </For>
      )
    }
    return (
      <ExplorationGroupView
        refs={row.refs}
        completed={row.completed}
        message={props.message}
        cwd={props.cwd}
        home={props.home}
        expanded={props.expanded.has(groupKey(row))}
        focused={props.focused === groupKey(row)}
        onToggle={() => props.onToggle(groupKey(row))}
      />
    )
  }
  if (row.type === "assistant-footer") {
    const item = props.message(row.messageID)
    if (item?.type !== "assistant") return null
    return <FooterView message={item} />
  }
  return null
}

function UserMessageView(props: { message: SessionMessageUser }) {
  const theme = useTheme()
  return (
    <Show when={props.message.text.trim()}>
      <box
        border={["left"]}
        borderColor={theme.text.action.primary.default}
        customBorderChars={SplitBorder.customBorderChars}
        backgroundColor={theme.contextual.elevated.background.default}
      >
        <box paddingTop={1} paddingBottom={1} paddingLeft={2} flexShrink={0}>
          <text fg={theme.text.default}>{props.message.text}</text>
        </box>
      </box>
    </Show>
  )
}

function TextView(props: { part: SessionMessageAssistantText }) {
  const theme = useTheme()
  const syntax = useThemes().currentSyntax
  const config = useConfig().data
  return (
    <Show when={props.part.text.trim()}>
      <box paddingLeft={3} flexShrink={0}>
        <markdown
          syntaxStyle={syntax()}
          streaming={true}
          internalBlockMode="top-level"
          content={props.part.text.trim()}
          tableOptions={{ style: "grid", cellPaddingX: 1 }}
          conceal={config.session?.markdown !== "source"}
          fg={theme.markdown.text}
          bg={theme.background.default}
        />
      </box>
    </Show>
  )
}

function ReasoningView(props: { part: SessionMessageAssistantReasoning; message: SessionMessageAssistant }) {
  const theme = useTheme()
  const themes = useThemes()
  const config = useConfig().data
  const thinkingStyle = createSyntaxStyleMemo(() => generateThinkingSyntax(themes.currentSyntax(), theme.text.subdued))
  const content = props.part.text.replace("[REDACTED]", "").trim()
  const done = props.part.time?.completed !== undefined || props.message.time.completed !== undefined
  return (
    <Show when={content}>
      <box paddingLeft={3} flexDirection="column" flexShrink={0}>
        <text fg={warning(theme, 0.6)}>{done ? "Thought" : "Thinking"}</text>
        <box
          marginTop={1}
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.raise(theme.background.default)}
          paddingLeft={1}
        >
          <code
            filetype="markdown"
            drawUnstyledText={false}
            streaming={!done}
            syntaxStyle={thinkingStyle()}
            content={content}
            conceal={config.session?.markdown !== "source"}
            fg={theme.text.subdued}
          />
        </box>
      </box>
    </Show>
  )
}

function ReasoningGroupView(props: {
  refs: PartRef[]
  completed: boolean
  message: (id: string) => SessionMessageInfo | undefined
  expanded: boolean
  focused: boolean
  onToggle: () => void
}) {
  const theme = useTheme()
  const themes = useThemes()
  const config = useConfig().data
  const thinkingStyle = createSyntaxStyleMemo(() => generateThinkingSyntax(themes.currentSyntax(), theme.text.subdued))
  const parts = createMemo(() =>
    props.refs.flatMap((ref) => {
      const message = props.message(ref.messageID)
      if (message?.type !== "assistant") return []
      const part = resolvePart(message, ref.partID)
      if (part?.type !== "reasoning") return []
      const text = part.text.replace("[REDACTED]", "").trim()
      return text ? [{ message, part, text }] : []
    }),
  )
  const latest = createMemo(() => {
    const item = parts().at(-1)
    return item ? reasoningSummary(item.text).title : null
  })
  const duration = createMemo(() =>
    parts().reduce((total, item) => {
      const start = item.part.time?.created
      const end = item.part.time?.completed
      return total + (start === undefined || end === undefined ? 0 : Math.max(0, end - start))
    }, 0),
  )
  const color = () => (props.focused || props.expanded ? theme.text.feedback.warning.default : warning(theme, 0.6))
  return (
    <Show when={parts().length > 0}>
      <box flexDirection="column" flexShrink={0}>
        <InlineRow icon={props.expanded ? "-" : "+"} color={color()} focused={props.focused} onToggle={props.onToggle}>
          {props.completed ? "Thought" : latest() ? `Thinking: ${latest()}` : "Thinking"}
          <Show when={props.completed && !props.expanded && latest()}>: {latest()}</Show>
          <Show when={props.completed && parts().length > 1}> · {parts().length} steps</Show>
          <Show when={props.completed && duration()}> · {Locale.duration(duration())}</Show>
        </InlineRow>
        <Show when={props.expanded}>
          <box paddingLeft={3}>
            <For each={parts()}>
              {(item) => (
                <box marginTop={1}>
                  <box
                    border={["left"]}
                    customBorderChars={SplitBorder.customBorderChars}
                    borderColor={theme.raise(theme.background.surface.offset)}
                    paddingLeft={1}
                  >
                    <code
                      filetype="markdown"
                      drawUnstyledText={false}
                      streaming={item.part.time?.completed === undefined && item.message.time.completed === undefined}
                      syntaxStyle={thinkingStyle()}
                      content={item.text}
                      conceal={config.session?.markdown !== "source"}
                      fg={theme.text.subdued}
                    />
                  </box>
                </box>
              )}
            </For>
          </box>
        </Show>
      </box>
    </Show>
  )
}

function ExplorationGroupView(props: {
  refs: PartRef[]
  completed: boolean
  message: (id: string) => SessionMessageInfo | undefined
  cwd?: string
  home?: string
  expanded: boolean
  focused: boolean
  onToggle: () => void
}) {
  const theme = useTheme()
  const parts = createMemo(() =>
    props.refs.flatMap((ref) => {
      const message = props.message(ref.messageID)
      if (message?.type !== "assistant") return []
      const part = resolvePart(message, ref.partID)
      return part?.type === "tool" ? [part] : []
    }),
  )
  const label = createMemo(() => {
    const counts = parts().reduce<Record<string, number>>((result, part) => {
      const tool = displayName(part.name)
      const name = tool === "grep" || tool === "glob" ? "search" : tool
      result[name] = (result[name] ?? 0) + 1
      return result
    }, {})
    const tools = Object.entries(counts).map(
      ([name, count]) => `${count} ${count === 1 ? name : name === "search" ? "searches" : `${name}s`}`,
    )
    return `${props.completed ? "Explored" : "Exploring"} — ${tools.join(", ")}`
  })
  return (
    <Show when={parts().length > 0}>
      <box flexDirection="column" flexShrink={0}>
        <InlineRow
          icon={props.completed ? "→" : "✱"}
          color={props.focused ? theme.text.default : theme.text.subdued}
          focused={props.focused}
          onToggle={props.onToggle}
        >
          {label()}
        </InlineRow>
        <Show when={props.expanded}>
          <For each={parts()}>
            {(part) => <ToolView part={part} cwd={props.cwd} home={props.home} expanded={false} />}
          </For>
        </Show>
      </box>
    </Show>
  )
}

function ToolView(props: {
  part: SessionMessageAssistantTool
  cwd?: string
  home?: string
  expanded: boolean
  focused?: boolean
  onToggle?: () => void
}) {
  const theme = useTheme()
  const input = typeof props.part.state.input === "string" ? {} : props.part.state.input
  const metadata = toolDisplayMetadata(props.part.state)
  const output = toolDisplayContent(props.part.state)
    .flatMap((content) => (content.type === "text" ? [content.text] : [content.name ?? content.uri]))
    .join("\n")
  const kind = displayName(props.part.name)
  const path = (value?: string) => formatPath(value, { base: props.cwd ?? process.cwd(), home: props.home })
  const running = props.part.state.status === "running" || props.part.state.status === "streaming"
  const failed = props.part.state.status === "error"
  const title = toolTitle(kind, input, metadata, path)
  const color = failed
    ? theme.text.feedback.error.default
    : props.focused
      ? theme.text.default
      : theme.text.subdued
  const expandable = Boolean(output.trim() || Object.keys(input).length > 0)
  if (kind === "shell" || kind === "generic") {
    const preview = output.trim() ? collapseToolOutput(output.trim(), 10, 400) : undefined
    return (
      <box
        paddingLeft={3}
        flexDirection="column"
        backgroundColor={props.focused ? theme.raise(theme.background.default) : undefined}
        onMouseUp={expandable ? props.onToggle : undefined}
      >
        <text fg={color}>
          {props.focused ? "› " : "  "}
          {kind === "shell" ? title : `◆ ${props.part.name}`}
        </text>
        <Show when={props.expanded && output.trim()}>
          <text fg={theme.text.default}>{output}</text>
        </Show>
        <Show when={!props.expanded && preview?.overflow}>
          <text fg={theme.text.subdued}>{preview!.output}</text>
        </Show>
        <Show when={props.part.state.status === "error"}>
          <text fg={theme.text.feedback.error.default}>
            {props.part.state.status === "error" ? props.part.state.error.message : ""}
          </text>
        </Show>
      </box>
    )
  }
  return (
    <InlineRow
      icon={TOOL_ICONS[kind] ?? "◆"}
      color={color}
      focused={Boolean(props.focused)}
      onToggle={expandable ? props.onToggle : undefined}
    >
      {running && !title ? pendingLabel(kind) : title}
    </InlineRow>
  )
}

function FooterView(props: { message: SessionMessageAssistant }) {
  const theme = useTheme()
  const interrupted = props.message.error?.message === "Step interrupted"
  return (
    <box paddingLeft={3} flexDirection="column">
      <Show when={props.message.error && !interrupted && !props.message.retry}>
        <text fg={theme.text.feedback.error.default}>Error: {props.message.error!.message}</text>
      </Show>
      <text>
        <span style={{ fg: theme.text.action.primary.default }}>{Locale.titlecase(props.message.agent)}</span>
        <span style={{ fg: theme.text.subdued }}>
          {" "}
          · {props.message.model.providerID}/{props.message.model.id}
        </span>
        <Show when={interrupted}>
          <span style={{ fg: theme.text.subdued }}> · interrupted</span>
        </Show>
      </text>
    </box>
  )
}

function InlineRow(props: {
  icon: string
  color: RGBA
  focused: boolean
  onToggle?: () => void
  children: import("@opentui/solid").JSX.Element
}) {
  const theme = useTheme()
  return (
    <box
      paddingLeft={3}
      backgroundColor={props.focused ? theme.raise(theme.background.default) : undefined}
      onMouseUp={props.onToggle}
    >
      <box flexDirection="row">
        <text width={2} fg={props.color} attributes={props.focused ? TextAttributes.BOLD : undefined}>
          {props.icon}
        </text>
        <text flexGrow={1} fg={props.color}>
          {props.children}
        </text>
      </box>
    </box>
  )
}

function groupKey(row: Extract<SessionRow, { type: "group" }>) {
  return `${row.kind}:${row.refs[0]?.messageID}:${row.refs[0]?.partID}`
}

function displayName(name: string) {
  const normalized = canonicalToolName(name.toLowerCase())
  return (
    {
      read: "read",
      write: "write",
      edit: "edit",
      glob: "glob",
      grep: "grep",
      webfetch: "webfetch",
      websearch: "websearch",
      shell: "shell",
      subagent: "subagent",
      execute: "execute",
      patch: "patch",
      question: "question",
      skill: "skill",
    } as const
  )[normalized] ?? "generic"
}

function toolTitle(
  kind: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
  path: (value?: string) => string,
) {
  const text = (key: string) => (typeof input[key] === "string" ? input[key] : undefined)
  if (kind === "read") return `Read ${path(text("path"))}`
  if (kind === "write") return `Write ${path(text("path"))}`
  if (kind === "edit") return `Edit ${path(text("path"))}`
  if (kind === "glob") {
    const count = finiteNumber(metadata.count)
    return `Glob "${text("pattern") ?? ""}"${text("path") ? ` in ${path(text("path"))}` : ""}${count === undefined ? "" : ` (${count} ${count === 1 ? "match" : "matches"})`}`
  }
  if (kind === "grep") {
    const matches = finiteNumber(metadata.matches)
    return `Grep "${text("pattern") ?? ""}"${text("path") ? ` in ${path(text("path"))}` : ""}${matches === undefined ? "" : ` (${matches} ${matches === 1 ? "match" : "matches"})`}`
  }
  if (kind === "webfetch") return `WebFetch ${text("url") ?? ""}`
  if (kind === "websearch") return `Web Search "${text("query") ?? ""}"`
  if (kind === "shell") {
    const command = text("command")
    return command ? `$ ${command}` : "Writing command..."
  }
  if (kind === "subagent") return `${Locale.titlecase(text("agent") ?? text("subagent_type") ?? "General")} Subagent — ${text("description") ?? "Subagent"}`
  if (kind === "skill") return `Skill ${text("name") ?? text("skill") ?? ""}`
  if (kind === "question") return "Question"
  if (kind === "patch") return "Apply patch"
  if (kind === "execute") return `Execute ${text("tool") ?? ""}`
  return ""
}

function pendingLabel(kind: string) {
  if (kind === "read") return "Reading file..."
  if (kind === "write") return "Preparing write..."
  if (kind === "edit") return "Preparing edit..."
  if (kind === "glob") return "Finding files..."
  if (kind === "grep") return "Searching content..."
  if (kind === "webfetch") return "Fetching from the web..."
  if (kind === "websearch") return "Searching web..."
  if (kind === "shell") return "Writing command..."
  if (kind === "subagent") return "Delegating..."
  return "Running..."
}

function noticeText(message: SessionMessageInfo) {
  if (message.type === "system") return message.description ?? "Instructions updated"
  if (message.type === "synthetic") return message.description ?? ""
  if (message.type === "skill") return `Skill ${message.name}`
  if (message.type === "shell") return `$ ${message.command}`
  if (message.type === "compaction") return message.status === "completed" ? "Compacted" : "Compacting"
  return ""
}

function warning(theme: ReturnType<typeof useTheme>, alpha: number) {
  const color = theme.text.feedback.warning.default
  return RGBA.fromValues(color.r, color.g, color.b, alpha)
}
