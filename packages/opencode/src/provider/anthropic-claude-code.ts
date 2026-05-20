import crypto from "crypto"
import { Hash } from "@opencode-ai/core/util/hash"
import { unique } from "remeda"

const CLAUDE_CODE_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK."
const CLAUDE_CODE_VERSION = "2.1.133"
const CLAUDE_CODE_USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION} (external, sdk-cli)`
const CLAUDE_CODE_STAINLESS_PACKAGE_VERSION = "0.81.0"
const CLAUDE_CODE_BETA_BASE = [
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "advisor-tool-2026-03-01",
  "advanced-tool-use-2025-11-20",
  "effort-2025-11-24",
]
const CLAUDE_CODE_BETA_STRUCTURED_OUTPUT = [...CLAUDE_CODE_BETA_BASE, "structured-outputs-2025-12-15"]
const CLAUDE_CODE_BETA_FULL_AGENT = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "advisor-tool-2026-03-01",
  "advanced-tool-use-2025-11-20",
  "context-1m-2025-08-07",
  "effort-2025-11-24",
  "extended-cache-ttl-2025-04-11",
  "cache-diagnosis-2026-04-07",
]
const CLAUDE_CODE_BODY_FIELD_ORDER = [
  "model",
  "messages",
  "system",
  "tools",
  "tool_choice",
  "metadata",
  "max_tokens",
  "temperature",
  "thinking",
  "context_management",
  "output_config",
  "diagnostics",
  "stream",
  "speed",
]

export const TOOL_PREFIX = "mcp_"
export const IDENTITY = CLAUDE_CODE_IDENTITY

export function applyHeaders(headers: Headers, input: { sessionID: string; body: Record<string, unknown> }) {
  headers.set("anthropic-beta", selectBetas(input.body, headers.get("anthropic-beta")))
  headers.set("user-agent", CLAUDE_CODE_USER_AGENT)
  headers.set("x-claude-code-session-id", input.sessionID)
  headers.delete("x-session-affinity")
  headers.set("accept", "application/json")
  headers.set("content-type", "application/json")
  headers.set("anthropic-dangerous-direct-browser-access", "true")
  headers.set("anthropic-version", "2023-06-01")
  headers.set("x-app", "cli")
  headers.set("x-client-request-id", crypto.randomUUID())
  headers.set("x-stainless-arch", process.arch)
  headers.set("x-stainless-lang", "js")
  headers.set("x-stainless-os", stainlessOS())
  headers.set("x-stainless-package-version", CLAUDE_CODE_STAINLESS_PACKAGE_VERSION)
  headers.set("x-stainless-retry-count", "0")
  headers.set("x-stainless-runtime", "node")
  headers.set("x-stainless-runtime-version", `v${process.versions.node}`)
  headers.set("x-stainless-timeout", "600")
  const apiKey = headers.get("x-api-key")
  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`)
    headers.delete("x-api-key")
  }
  return headers
}

export function applyMetadata(body: Record<string, unknown>, sessionID: string) {
  body.metadata = {
    ...(isRecord(body.metadata) ? body.metadata : {}),
    user_id: JSON.stringify({
      device_id: Hash.fast(process.cwd()),
      account_uuid: "",
      session_id: sessionID,
    }),
  }
}

export function extractBodyFields(options: Record<string, unknown>) {
  return Object.fromEntries(
    ["context_management", "diagnostics", "output_config", "speed"].flatMap((key) =>
      Object.hasOwn(options, key) ? [[key, options[key]]] : [],
    ),
  )
}

export function orderBody<T extends Record<string, unknown>>(body: T): T {
  return {
    ...Object.fromEntries(
      CLAUDE_CODE_BODY_FIELD_ORDER.flatMap((key) => (Object.hasOwn(body, key) ? [[key, body[key]]] : [])),
    ),
    ...Object.fromEntries(Object.entries(body).filter(([key]) => !CLAUDE_CODE_BODY_FIELD_ORDER.includes(key))),
  } as T
}

export function prefixName(name: string) {
  return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

export function unprefixName(name: string) {
  if (name === "StructuredOutput") return name
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}`
}

export function stripMessageCache(messages: unknown[]) {
  return messages.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content.map((block) => {
        if (!isRecord(block) || !("cache_control" in block)) return block
        const { cache_control, ...rest } = block
        return rest
      }),
    }
  })
}

function selectBetas(body: Record<string, unknown>, incomingBeta: string | null) {
  return unique([
    ...(hasFullAgentShape(body)
      ? CLAUDE_CODE_BETA_FULL_AGENT
      : hasStructuredOutput(body)
        ? CLAUDE_CODE_BETA_STRUCTURED_OUTPUT
        : CLAUDE_CODE_BETA_BASE),
    ...(body.speed === "fast" ? ["fast-mode-2026-02-01"] : []),
    ...(incomingBeta ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  ]).join(",")
}

function hasStructuredOutput(body: Record<string, unknown>) {
  return (
    isRecord(body.output_config) &&
    isRecord(body.output_config.format) &&
    body.output_config.format.type === "json_schema"
  )
}

function hasFullAgentShape(body: Record<string, unknown>) {
  return (
    Array.isArray(body.tools) &&
    body.tools.length > 0 &&
    Array.isArray(body.system) &&
    isRecord(body.thinking) &&
    isRecord(body.context_management) &&
    isRecord(body.output_config) &&
    isRecord(body.diagnostics)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function stainlessOS() {
  if (process.platform === "darwin") return "MacOS"
  if (process.platform === "win32") return "Windows"
  if (process.platform === "linux") return "Linux"
  if (process.platform === "freebsd") return "FreeBSD"
  return "Unknown"
}

export * as AnthropicClaudeCode from "./anthropic-claude-code"
