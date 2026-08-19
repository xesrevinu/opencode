import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"

export type PartRef = {
  messageID: string
  partID: string
}

export type CacheUsage = {
  read: number
  model: SessionMessageAssistant["model"]
}

export type SessionRow =
  | { type: "message"; messageID: string }
  | { type: "compaction-queued"; inboxID: string }
  | { type: "part"; ref: PartRef }
  | {
      type: "group"
      kind: "reasoning"
      refs: PartRef[]
      completed: boolean
    }
  | {
      type: "group"
      kind: "exploration"
      refs: PartRef[]
      pending: PartRef[]
      completed: boolean
    }
  | { type: "assistant-footer"; messageID: string }
  | { type: "turn-usage"; messageIDs: string[]; previousCache?: CacheUsage }

export function reduceSessionRows(messages: SessionMessageInfo[], inputs = new Set<string>(), turnTokens = false) {
  const isInput = (message: SessionMessageInfo) => inputs.has(message.id)
  const pendingCompactions = messages.filter((message) => message.type === "compaction" && message.status === "running")
  const pending = new Set([...pendingCompactions.map((message) => message.id), ...inputs])
  const usage = turnTokens
    ? { steps: [] as SessionMessageAssistant[], previousTurnCache: undefined as CacheUsage | undefined }
    : undefined
  return [
    ...messages.filter((message) => !pending.has(message.id)),
    ...pendingCompactions,
    ...messages.filter(isInput),
  ].reduce<SessionRow[]>((rows, message) => {
    if (message.type !== "assistant") {
      if (message.type === "synthetic" && !message.description?.trim()) return rows
      if (message.type === "compaction" && message.status === "completed" && usage) usage.previousTurnCache = undefined
      if (!pending.has(message.id)) completePrevious(rows)
      rows.push({ type: "message", messageID: message.id })
      return rows
    }
    usage?.steps.push(message)
    const ordinals = { text: 0, reasoning: 0 }
    message.content.forEach((part) => {
      const partID = part.type === "tool" ? part.id : `${part.type}:${ordinals[part.type]++}`
      if ((part.type === "text" || part.type === "reasoning") && !part.text.trim()) return
      append(rows, { messageID: message.id, partID }, part)
    })
    const terminal = (message.finish && !["tool-calls", "unknown"].includes(message.finish)) || message.error
    if (terminal || message.retry) {
      completePrevious(rows)
      rows.push({ type: "assistant-footer", messageID: message.id })
    }
    if (terminal && usage) {
      const stepsWithUsage = usage.steps.filter(hasTokenUsage)
      const last = stepsWithUsage.at(-1)
      if (last) {
        rows.push({
          type: "turn-usage",
          messageIDs: stepsWithUsage.map((step) => step.id),
          ...(usage.previousTurnCache === undefined ? {} : { previousCache: usage.previousTurnCache }),
        })
        usage.previousTurnCache = { read: last.tokens.cache.read, model: last.model }
      }
      usage.steps.length = 0
    }
    return rows
  }, [])
}

export function cacheReuseDrop(previous: CacheUsage | undefined, current: CacheUsage) {
  if (previous === undefined) return
  if (
    previous.model.providerID !== current.model.providerID ||
    previous.model.id !== current.model.id ||
    previous.model.variant !== current.model.variant
  )
    return
  const drop = previous.read - current.read
  // OpenAI cache reads can move between one and two 1,024-token buckets without a material loss of reuse.
  if (current.model.providerID === "openai" && drop >= 1_024 && drop <= 2_048) return
  return drop > 0 ? drop : undefined
}

export function turnDuration(message: SessionMessageAssistant, messages: SessionMessageInfo[], position?: number) {
  if (message.time.completed === undefined) return 0
  const index = position ?? messages.findIndex((item) => item.id === message.id)
  const input = messages[inputIndex(messages, index === -1 ? messages.length : index)]
  return Math.max(0, message.time.completed - (input?.time.created ?? message.time.created))
}

export function turnTokensPerSecond(
  message: SessionMessageAssistant,
  messages: SessionMessageInfo[],
  position?: number,
) {
  const index = position ?? messages.findIndex((item) => item.id === message.id)
  const end = index === -1 ? messages.length : index + 1
  const start = inputIndex(messages, end)
  const steps = messages
    .slice(start + 1, end)
    .filter((item): item is SessionMessageAssistant => item.type === "assistant")
  const durations = steps.flatMap((step) =>
    step.time.streamed === undefined ? [] : [Math.max(0, step.time.streamed - step.time.created)],
  )
  if (steps.length === 0 || durations.length !== steps.length) return
  const output = steps.reduce((total, step) => total + (step.tokens?.output ?? 0), 0)
  const duration = durations.reduce((total, value) => total + value, 0)
  if (output <= 0 || duration <= 0) return
  return output / (duration / 1_000)
}

function inputIndex(messages: SessionMessageInfo[], end: number) {
  // Reading a sliced prefix subscribes every footer to unrelated historical messages.
  for (let index = end - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type === "user" || message.type === "synthetic") return index
  }
  return -1
}

export function messageBoundaryIDs(rows: SessionRow[], messages: SessionMessageInfo[]) {
  const byID = new Map(messages.map((message) => [message.id, message]))
  const seen = new Set<string>()
  return rows.map((row) => {
    const id = rowBoundaryMessageID(row, byID)
    if (!id || seen.has(id)) return undefined
    seen.add(id)
    return id
  })
}

export function resolvePart(message: SessionMessageAssistant, partID: string) {
  const tool = message.content.find((part) => part.type === "tool" && part.id === partID)
  if (tool) return tool
  const match = /^(text|reasoning):(\d+)$/.exec(partID)
  if (!match) return
  const ordinal = Number(match[2])
  return message.content.filter((part) => part.type === match[1])[ordinal]
}

export function partitionPending(rows: SessionRow[], pending: Set<string>) {
  rows.forEach((row) => {
    if (row.type !== "group" || row.kind !== "exploration") return
    const refs = [...row.refs, ...row.pending]
    row.refs = refs.filter((ref) => !pending.has(ref.partID))
    row.pending = refs.filter((ref) => pending.has(ref.partID))
  })
}

export function hasPart(rows: SessionRow[], ref: PartRef) {
  return rows.some((row) => {
    if (row.type === "part") return row.ref.messageID === ref.messageID && row.ref.partID === ref.partID
    if (row.type !== "group") return false
    const refs = row.kind === "exploration" ? [...row.refs, ...row.pending] : row.refs
    return refs.some((item) => item.messageID === ref.messageID && item.partID === ref.partID)
  })
}

function hasTokenUsage(
  message: SessionMessageAssistant,
): message is SessionMessageAssistant & { tokens: NonNullable<SessionMessageAssistant["tokens"]> } {
  return message.tokens !== undefined && tokenTotal(message.tokens) > 0
}

function tokenTotal(tokens: NonNullable<SessionMessageAssistant["tokens"]>) {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function rowBoundaryMessageID(row: SessionRow, messages: Map<string, SessionMessageInfo>) {
  if (row.type === "message") {
    const message = messages.get(row.messageID)
    if (message?.type === "user" && message.text.trim()) return message.id
    return undefined
  }
  const messageID =
    row.type === "part"
      ? row.ref.messageID
      : row.type === "group"
        ? row.refs[0]?.messageID
        : row.type === "assistant-footer"
          ? row.messageID
          : row.type === "turn-usage"
            ? row.messageIDs[0]
            : undefined
  if (!messageID) return undefined
  const message = messages.get(messageID)
  if (message?.type === "assistant") return message.id
}

export type BackgroundToolTarget = { source: "shell"; id: string }

export function sessionRowID(row: SessionRow, boundaryID?: string) {
  if (boundaryID) return boundaryID
  if (row.type === "part") return `session-part:${row.ref.messageID}:${row.ref.partID}`
}

export function backgroundToolRowIndex(
  rows: SessionRow[],
  messages: SessionMessageInfo[],
  target: BackgroundToolTarget,
  beforeMessageID: string,
) {
  const byID = new Map(messages.map((message) => [message.id, message]))
  const end = rows.findIndex((row) => row.type === "message" && row.messageID === beforeMessageID)
  return rows.slice(0, end === -1 ? rows.length : end).findLastIndex((row) => {
    if (row.type !== "part") return false
    if (row.ref.partID === target.id) return true
    const message = byID.get(row.ref.messageID)
    if (message?.type !== "assistant") return false
    const part = resolvePart(message, row.ref.partID)
    return (
      part?.type === "tool" &&
      part.name.toLowerCase() === "shell" &&
      part.state.status !== "streaming" &&
      part.state.metadata?.shellID === target.id
    )
  })
}

export type AppendPart = { type: "text" } | { type: "reasoning" } | { type: "tool"; name: string }

export function append(rows: SessionRow[], ref: PartRef, part: AppendPart, index = rows.length) {
  if (part.type === "reasoning") {
    const previous = rows[index - 1]
    if (previous?.type === "group" && previous.kind === "reasoning") {
      previous.refs.push(ref)
      return
    }
    completePrevious(rows, index)
    rows.splice(index, 0, { type: "group", kind: "reasoning", refs: [ref], completed: false })
    return
  }
  if (part.type === "tool" && exploration(part.name)) {
    const previous = rows[index - 1]
    if (previous?.type === "group" && previous.kind === "exploration") {
      previous.refs.push(ref)
      return
    }
    completePrevious(rows, index)
    rows.splice(index, 0, { type: "group", kind: "exploration", refs: [ref], pending: [], completed: false })
    return
  }
  completePrevious(rows, index)
  rows.splice(index, 0, { type: "part", ref })
}

export function completePrevious(rows: SessionRow[], index = rows.length) {
  const previous = rows[index - 1]
  if (previous?.type === "group") previous.completed = true
}

function exploration(name: string) {
  return ["read", "glob", "grep"].includes(name.toLowerCase())
}
