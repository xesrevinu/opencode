import type {
  JsonValue,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode-ai/client"
import type { SessionTranscript, TranscriptPart } from "./model"

export type OpenCodeViewMessage = SessionMessageInfo

export function toOpenCodeMessages(transcript: SessionTranscript): SessionMessageInfo[] {
  const messages: SessionMessageInfo[] = []
  let assistant: SessionMessageAssistant | undefined
  const model = splitModel(transcript.summary.model)
  for (const part of transcript.parts) {
    if (part.type === "user") {
      assistant = undefined
      messages.push(toUser(part, transcript.summary.createdAt))
      continue
    }
    if (part.type === "system") continue
    if (!assistant) {
      assistant = {
        type: "assistant",
        id: `asst-${part.id}`,
        agent: transcript.summary.agent,
        model,
        time: { created: part.timestamp ?? transcript.summary.updatedAt, completed: transcript.summary.live ? undefined : transcript.summary.updatedAt },
        content: [],
      }
      messages.push(assistant)
    }
    assistant.content.push(toContent(part))
  }
  return messages
}

function toUser(part: Extract<TranscriptPart, { type: "user" }>, fallback: number): SessionMessageUser {
  return {
    type: "user",
    id: part.id,
    text: part.text,
    time: { created: part.timestamp ?? fallback },
  }
}

function toContent(part: TranscriptPart): SessionMessageAssistant["content"][number] {
  const created = part.timestamp ?? 0
  if (part.type === "reasoning") {
    return { type: "reasoning", text: part.text, time: { created, completed: part.completed ? created : undefined } }
  }
  if (part.type === "tool") {
    return {
      type: "tool",
      id: part.id,
      name: normalizeToolName(part.name),
      time: { created },
      state: toToolState(part),
    }
  }
  return { type: "text", text: part.type === "assistant" ? part.text : "" }
}

function toToolState(part: Extract<TranscriptPart, { type: "tool" }>): SessionMessageAssistantTool["state"] {
  const input = parseInput(part.input)
  const metadata = asJsonRecord(part.metadata)
  if (part.status === "error" || part.status === "cancelled") {
    return { status: "error", input, error: { type: "error", message: part.output ?? part.status }, metadata }
  }
  if (part.status === "completed") {
    return { status: "completed", input, content: [{ type: "text", text: part.output ?? "" }], metadata }
  }
  return { status: "running", input, metadata }
}

function parseInput(raw: string): { [x: string]: JsonValue } {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return asJsonRecord(parsed)
  } catch {
    // keep the raw string as a single field so TUI tool blocks still have input
  }
  return { value: raw }
}

function asJsonRecord(value: unknown): { [x: string]: JsonValue } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as { [x: string]: JsonValue }
}

function normalizeToolName(name: string) {
  const normalized = name.trim().toLowerCase()
  if (normalized === "bash" || normalized === "shell" || normalized === "run_terminal_command_v2") return "shell"
  if (normalized === "read" || normalized === "readfile" || normalized === "read_file" || normalized === "read_file_v2") {
    return "read"
  }
  if (normalized === "edit" || normalized === "strreplace" || normalized === "edit_file_v2") return "edit"
  if (normalized === "glob" || normalized === "glob_file_search") return "glob"
  if (normalized === "grep" || normalized === "rg" || normalized === "ripgrep_raw_search") return "grep"
  if (normalized === "websearch" || normalized === "web_search") return "websearch"
  if (normalized === "webfetch" || normalized === "web_fetch") return "webfetch"
  if (normalized === "task" || normalized === "task_v2") return "subagent"
  if (normalized === "apply_patch") return "patch"
  return normalized
}

function splitModel(model?: string) {
  if (!model) return { id: "unknown", providerID: "unknown" }
  const [providerID, id] = model.includes("/") ? model.split("/", 2) : ["unknown", model]
  return { id: id ?? model, providerID: providerID ?? "unknown" }
}
