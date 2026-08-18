import type { SessionTranscript, TranscriptPart } from "./model"

export type OpenCodeUserMessage = {
  type: "user"
  id: string
  text: string
  time: { created: number }
}

export type OpenCodeToolContent = { type: "text"; text: string }

export type OpenCodeToolState =
  | { status: "running"; input: Record<string, unknown> }
  | { status: "completed"; input: Record<string, unknown>; content: [OpenCodeToolContent, ...OpenCodeToolContent[]] }
  | { status: "error"; input: Record<string, unknown>; error: { message: string } }

export type OpenCodeAssistantContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; time?: { created: number; completed?: number } }
  | { type: "tool"; id: string; name: string; time: { created: number }; state: OpenCodeToolState }

export type OpenCodeAssistantMessage = {
  type: "assistant"
  id: string
  agent: string
  model: { id: string; providerID: string }
  time: { created: number }
  content: OpenCodeAssistantContent[]
}

export type OpenCodeViewMessage = OpenCodeUserMessage | OpenCodeAssistantMessage

export type OpenCodeViewRow =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; status: OpenCodeToolState["status"]; input: string; output?: string }

export function toOpenCodeMessages(transcript: SessionTranscript): OpenCodeViewMessage[] {
  const messages: OpenCodeViewMessage[] = []
  let assistant: OpenCodeAssistantMessage | undefined
  const model = splitModel(transcript.summary.model)
  for (const part of transcript.parts) {
    if (part.type === "user") {
      assistant = undefined
      messages.push({
        type: "user",
        id: part.id,
        text: part.text,
        time: { created: part.timestamp ?? transcript.summary.createdAt },
      })
      continue
    }
    if (part.type === "system") continue
    if (!assistant) {
      assistant = {
        type: "assistant",
        id: `asst-${part.id}`,
        agent: transcript.summary.agent,
        model,
        time: { created: part.timestamp ?? transcript.summary.updatedAt },
        content: [],
      }
      messages.push(assistant)
    }
    assistant.content.push(toContent(part))
  }
  return messages
}

export function flattenOpenCodeContent(messages: readonly OpenCodeViewMessage[]): OpenCodeViewRow[] {
  const rows: OpenCodeViewRow[] = []
  for (const message of messages) {
    if (message.type === "user") {
      rows.push({ kind: "user", id: message.id, text: message.text })
      continue
    }
    for (const [index, item] of message.content.entries()) {
      if (item.type === "text") {
        rows.push({ kind: "assistant", id: `${message.id}-text-${index}`, text: item.text })
        continue
      }
      if (item.type === "reasoning") {
        rows.push({ kind: "reasoning", id: `${message.id}-reason-${index}`, text: item.text })
        continue
      }
      rows.push({
        kind: "tool",
        id: item.id,
        name: item.name,
        status: item.state.status,
        input: JSON.stringify(item.state.input, null, 2),
        output: item.state.status === "completed" ? item.state.content.map((entry) => entry.text).join("\n") : undefined,
      })
    }
  }
  return rows
}

function toContent(part: TranscriptPart): OpenCodeAssistantContent {
  const created = part.timestamp ?? 0
  if (part.type === "reasoning") {
    return { type: "reasoning", text: part.text, time: { created, completed: part.completed ? created : undefined } }
  }
  if (part.type === "tool") {
    const input = parseInput(part.input)
    if (part.status === "error") {
      return { type: "tool", id: part.id, name: part.name, time: { created }, state: { status: "error", input, error: { message: part.output ?? "error" } } }
    }
    if (part.status === "completed") {
      return {
        type: "tool",
        id: part.id,
        name: part.name,
        time: { created },
        state: { status: "completed", input, content: [{ type: "text", text: part.output ?? "" }] },
      }
    }
    return { type: "tool", id: part.id, name: part.name, time: { created }, state: { status: "running", input } }
  }
  return { type: "text", text: part.type === "assistant" ? part.text : "" }
}

function parseInput(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // keep the raw string as a single field so TUI tool blocks still have input
  }
  return { value: raw }
}

function splitModel(model?: string) {
  if (!model) return { id: "unknown", providerID: "unknown" }
  const [providerID, id] = model.includes("/") ? model.split("/", 2) : ["unknown", model]
  return { id: id ?? model, providerID: providerID ?? "unknown" }
}
