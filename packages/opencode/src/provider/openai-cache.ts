import type { AssistantModelMessage, ModelMessage, SystemModelMessage, TextPart, UserModelMessage } from "ai"
import { Hash } from "@opencode-ai/core/util/hash"
import { estimateTokens, stableEnd } from "./cache-key"

const OPENAI_CACHE_MIN = 1024
const OPENAI_24H = new Set([
  "gpt-4.1",
  "gpt-5",
  "gpt-5-chat-latest",
  "gpt-5-codex",
  "gpt-5.1",
  "gpt-5.1-chat-latest",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
])

export function isOpenAI(model: { api: { npm: string } }) {
  return model.api.npm === "@ai-sdk/openai"
}

export function openAIRetention(modelID: string, value?: unknown) {
  if (typeof value !== "string" || value === "" || value === "auto") return
  if (value === "in-memory") return "in_memory"
  if (value === "in_memory") return "in_memory"
  if (value === "24h" && OPENAI_24H.has(modelID)) return "24h"
}

export function openAICacheKey(input: {
  modelID: string
  instructions?: string
  messages?: ModelMessage[]
}) {
  const prefix = openAICachePrefix(input)
  if (!prefix) return
  return `opencode:${input.modelID}:v1`
}

export function openAICacheDebug() {
  return process.env["OPENCODE_OPENAI_CACHE_DEBUG"] === "1"
}

export function summarizeOpenAIBody(body: string) {
  const json: any = JSON.parse(body)
  const items = bodyItems(json)
  const text = items.flatMap((item: any) => {
    if (!item || typeof item !== "object") return []
    if (typeof item.content === "string") return [item.content.length]
    if (!Array.isArray(item.content)) return []
    return item.content.flatMap((part: any) => {
      if (!part || typeof part !== "object") return []
      if (typeof part.text === "string") return [part.text.length]
      if (typeof part.input_text === "string") return [part.input_text.length]
      return []
    })
  })

  const cacheKey = openAICacheKeyFromJSON(json)

  return {
    modelID: typeof json.model === "string" ? json.model : undefined,
    bodyHash: Hash.fast(body),
    promptHash: Hash.fast(
      JSON.stringify({
        instructions: typeof json.instructions === "string" ? json.instructions : undefined,
        input: items,
      }),
    ),
    promptCacheKey: typeof json.prompt_cache_key === "string" ? json.prompt_cache_key : cacheKey,
    promptCacheRetention:
      typeof json.prompt_cache_retention === "string"
        ? openAIRetention(typeof json.model === "string" ? json.model : "unknown", json.prompt_cache_retention)
        : undefined,
    hasInstructions: typeof json.instructions === "string" && json.instructions.length > 0,
    inputCount: items.length,
    inputChars: text.reduce((sum: number, item: number) => sum + item, 0),
    cacheableInputCount: countCacheableInput(items),
    store: json.store,
  }
}

export function patchOpenAIBody(body: string, _headers: HeadersInit | undefined, modelID: string) {
  const json = JSON.parse(body)
  if (!json || typeof json !== "object" || Array.isArray(json)) return body

  if (json.prompt_cache_key === undefined) {
    const cacheKey = openAICacheKeyFromJSON({ ...json, model: modelID })
    if (cacheKey) json.prompt_cache_key = cacheKey
  }

  const retention = openAIRetention(modelID, json.prompt_cache_retention)
  if (retention) {
    json.prompt_cache_retention = retention
  } else {
    delete json.prompt_cache_retention
  }

  return JSON.stringify(json)
}

function openAICacheKeyFromJSON(json: any) {
  return openAICacheKey({
    modelID: typeof json.model === "string" ? json.model : "unknown",
    instructions: typeof json.instructions === "string" ? json.instructions : undefined,
    messages: toModelMessages(bodyItems(json)),
  })
}

function bodyItems(json: any) {
  if (Array.isArray(json.input)) return json.input
  if (Array.isArray(json.messages)) return json.messages
  return []
}

function openAICachePrefix(input: { instructions?: string; messages?: ModelMessage[] }) {
  const msgs = input.messages ?? []
  const list = msgs.slice(0, stableEnd(msgs))
  const prefix = [
    ...(input.instructions?.trim() ? [`instructions:${input.instructions.trim()}`] : []),
    ...list.flatMap(normalize),
  ]
  if (prefix.length === 0) return

  const size = Math.ceil(prefix.join("\n").length / 4)
  if (size < OPENAI_CACHE_MIN) return
  return prefix.join("\n")
}

function normalize(msg: ModelMessage) {
  if (msg.role === "tool") return []

  if (typeof msg.content === "string") {
    const text = msg.content.trim()
    return text ? [`${msg.role}:${text}`] : []
  }

  if (!Array.isArray(msg.content)) return []
  const text = msg.content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return []
      if ("type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
        return [part.text]
      }
      if ("type" in part && part.type === "file") {
        const media = "mediaType" in part && typeof part.mediaType === "string" ? part.mediaType : "file"
        const name = "filename" in part && typeof part.filename === "string" ? part.filename : ""
        return [`[file:${media}:${name}]`]
      }
      return []
    })
    .join("\n")
    .trim()

  return text ? [`${msg.role}:${text}`] : []
}

function toModelMessages(input: unknown): ModelMessage[] {
  if (!Array.isArray(input)) return []
  return input.reduce<ModelMessage[]>((out, item) => {
    if (!item || typeof item !== "object") return out

    const msg = messageItem(item)
    if (msg) {
      out.push(msg)
      return out
    }

    const part = item as { type?: string; output?: unknown }
    if (part.type === "function_call_output" || part.type === "item_reference" || part.type === "reasoning") {
      return out
    }
    if (part.type === "function_call" || part.type === "local_shell_call" || part.type === "local_shell_call_output") {
      return out
    }
    return out
  }, [])
}

function messageItem(item: { role?: unknown; content?: unknown }) {
  if (typeof item.role !== "string") return
  if (item.role === "developer") {
    return { role: "system", content: toText(item.content) } satisfies SystemModelMessage
  }
  if (item.role === "system") {
    return { role: "system", content: toText(item.content) } satisfies SystemModelMessage
  }
  if (item.role === "user") {
    return { role: "user", content: toUser(item.content) } satisfies UserModelMessage
  }
  if (item.role === "assistant") {
    return { role: "assistant", content: toAssistant(item.content) } satisfies AssistantModelMessage
  }
  if (item.role === "tool") {
    return { role: "tool", content: [] } as ModelMessage
  }
}

function toText(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.flatMap(partText).join("\n")
}

function toUser(content: unknown): UserModelMessage["content"] {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.flatMap(partText).map((text) => ({ type: "text", text }) satisfies TextPart)
}

function toAssistant(content: unknown): AssistantModelMessage["content"] {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.flatMap(partText).map((text) => ({ type: "text", text }) satisfies TextPart)
}

function partText(part: unknown): string[] {
  if (!part || typeof part !== "object") return []
  if ("type" in part && part.type === "text") {
    if ("text" in part && typeof part.text === "string") return [part.text]
    return []
  }
  if ("type" in part && part.type === "input_text" && "text" in part && typeof part.text === "string") {
    return [part.text]
  }
  if ("type" in part && part.type === "output_text" && "text" in part && typeof part.text === "string") {
    return [part.text]
  }
  if ("type" in part && part.type === "image_url") return ["[image]"]
  if ("type" in part && part.type === "input_image") {
    const media = "detail" in part && typeof part.detail === "string" ? `image:${part.detail}` : "image"
    return [`[${media}]`]
  }
  if ("type" in part && part.type === "input_file") {
    const name = "filename" in part && typeof part.filename === "string" ? part.filename : "file"
    return [`[file:${name}]`]
  }
  if ("type" in part && part.type === "file") {
    const name = "filename" in part && typeof part.filename === "string" ? part.filename : "file"
    return [`[file:${name}]`]
  }
  return []
}

function countCacheableInput(input: unknown[]) {
  const msgs = toModelMessages(input)
  const list = msgs.slice(0, stableEnd(msgs))
  return list.filter((msg) => estimateTokens(msg) > 0).length
}
