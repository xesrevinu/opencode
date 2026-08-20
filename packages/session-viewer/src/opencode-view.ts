import type {
  JsonValue,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageUser,
} from "@opencode-ai/client"
import type { SessionTranscript, TranscriptPart } from "./model"
import { displayUserText, titleFromText } from "./text"

export type OpenCodeViewMessage = SessionMessageInfo

export function toOpenCodeMessages(transcript: SessionTranscript): SessionMessageInfo[] {
  const messages: SessionMessageInfo[] = []
  let assistant: SessionMessageAssistant | undefined
  const model = splitModel(transcript.summary.model)
  for (const part of transcript.parts) {
    if (part.type === "user") {
      const text = displayUserText(part.text)
      if (!text) continue
      assistant = undefined
      messages.push(toUser({ ...part, text }, transcript.summary.createdAt))
      continue
    }
    if (part.type === "system") {
      assistant = undefined
      messages.push({
        type: "system",
        id: part.id,
        text: part.text,
        description: titleFromText(part.text, "System"),
        time: { created: part.timestamp ?? transcript.summary.createdAt },
      })
      continue
    }
    if (part.type === "reasoning" && !part.text.trim()) continue
    if (part.type === "assistant" && !part.text.trim()) continue
    if (part.type === "reasoning" && assistant?.content.some((item) => item.type !== "reasoning")) {
      assistant = undefined
    }
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
  finalizeAssistants(messages)
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
  const input = remapInput(parseInput(part.input))
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

function finalizeAssistants(messages: SessionMessageInfo[]) {
  for (const message of messages) {
    if (message.type !== "assistant") continue
    const running = message.content.some(
      (part) => part.type === "tool" && (part.state.status === "running" || part.state.status === "streaming"),
    )
    if (running) continue
    message.time = { created: message.time.created, completed: message.time.completed ?? message.time.created }
    if (!message.finish) message.finish = message.error ? "error" : "stop"
  }
}

function remapInput(input: { [x: string]: JsonValue }) {
  const pathValue =
    stringField(input.path) ??
    stringField(input.targetFile) ??
    stringField(input.target_file) ??
    stringField(input.file_path) ??
    stringField(input.filePath) ??
    stringField(input.effectiveUri) ??
    stringField(input.relativeWorkspacePath)
  const pattern = stringField(input.pattern) ?? stringField(input.globPattern) ?? stringField(input.glob_pattern)
  const command = stringField(input.command) ?? stringField(input.cmd) ?? stringField(input.command_line)
  const query = stringField(input.query) ?? stringField(input.searchTerm) ?? stringField(input.search_term)
  return {
    ...input,
    ...(pathValue && !stringField(input.path) ? { path: pathValue } : {}),
    ...(pattern && !stringField(input.pattern) ? { pattern } : {}),
    ...(command && !stringField(input.command) ? { command } : {}),
    ...(query && !stringField(input.query) ? { query } : {}),
  }
}

function stringField(value: JsonValue | undefined) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizeToolName(name: string) {
  const normalized = name.trim().toLowerCase()
  if (
    normalized === "bash" ||
    normalized === "shell" ||
    normalized === "run_terminal_command" ||
    normalized === "run_terminal_command_v2" ||
    normalized === "exec_command" ||
    normalized === "shell_command" ||
    normalized === "bash_command"
  ) {
    return "shell"
  }
  if (normalized === "read" || normalized === "readfile" || normalized === "read_file" || normalized === "read_file_v2") {
    return "read"
  }
  if (normalized === "write" || normalized === "write_file" || normalized === "write_file_v2") return "write"
  if (
    normalized === "edit" ||
    normalized === "strreplace" ||
    normalized === "str_replace" ||
    normalized === "edit_file" ||
    normalized === "edit_file_v2" ||
    normalized === "search_replace" ||
    normalized === "search_replace_v2" ||
    normalized === "apply_diff"
  ) {
    return "edit"
  }
  if (normalized === "glob" || normalized === "glob_file_search" || normalized === "list_dir" || normalized === "listdir") {
    return "glob"
  }
  if (
    normalized === "grep" ||
    normalized === "rg" ||
    normalized === "ripgrep_raw_search" ||
    normalized === "grep_search" ||
    normalized === "codebase_search"
  ) {
    return "grep"
  }
  if (normalized === "websearch" || normalized === "web_search" || normalized === "web_search_v2") return "websearch"
  if (normalized === "webfetch" || normalized === "web_fetch" || normalized === "fetch_content") return "webfetch"
  if (normalized === "task" || normalized === "task_v2" || normalized === "agent" || normalized === "spawn_subagent") {
    return "subagent"
  }
  if (normalized === "apply_patch") return "patch"
  return normalized
}

function splitModel(model?: string) {
  if (!model) return { id: "unknown", providerID: "unknown" }
  if (model.includes("/")) {
    const [providerID, id] = model.split("/", 2)
    return { id: id ?? model, providerID: providerID ?? "unknown" }
  }
  return { id: model, providerID: model.startsWith("grok") ? "xai" : "unknown" }
}
