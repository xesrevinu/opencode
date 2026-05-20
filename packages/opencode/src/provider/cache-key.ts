import type { ModelMessage } from "ai"
import { createHash } from "crypto"
export function generateCacheKey(msgs: ModelMessage[], sessionID: string): string {
  const hash = createHash("sha256")
  hash.update(sessionID)
  for (const msg of msgs) {
    hash.update(msg.role)
    if (typeof msg.content === "string") {
      hash.update(msg.content)
      continue
    }
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      hash.update(part.type)
      if ("text" in part) hash.update(part.text)
      if ("toolName" in part) hash.update(part.toolName)
      if ("toolCallId" in part) hash.update(part.toolCallId)
    }
  }
  return hash.digest("hex").slice(0, 16)
}

export function estimateTokens(msg: ModelMessage): number {
  let chars = 0
  if (typeof msg.content === "string") {
    chars = msg.content.length
  }
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if ("text" in part) chars += part.text.length
      if ("toolName" in part) chars += part.toolName.length
    }
  }
  return Math.ceil(chars / 4)
}

const ANTHROPIC_TAIL_MIN = 512
const ANTHROPIC_TAIL_TOKENS = 128

export function stableEnd(msgs: ModelMessage[]) {
  const last = msgs.at(-1)
  if (!last || (last.role !== "user" && last.role !== "tool")) return msgs.length

  let end = msgs.length
  while (end > 0) {
    const msg = msgs[end - 1]
    if (msg.role === "assistant" || msg.role === "tool") {
      end--
      continue
    }
    if (msg.role === "user") return end - 1
    return end
  }

  return end
}

export function selectAnthropicPrefix(msgs: ModelMessage[]): Set<number> {
  const end = stableEnd(msgs)
  if (end === 0) return new Set<number>()

  const sum = msgs.reduce((arr, msg) => {
    arr.push((arr.at(-1) ?? 0) + estimateTokens(msg))
    return arr
  }, [] as number[])
  const raw = new Set<number>()

  for (let i = 0; i < end; i++) {
    const msg = msgs[i]
    if (msg.role === "system" || estimateTokens(msg) >= 256) raw.add(i)
  }

  const tail = end - 1
  if (raw.size === 0) raw.add(tail)
  if (!raw.has(tail)) {
    const prev = Array.from(raw).sort((a, b) => a - b).at(-1)
    const delta = prev === undefined ? sum[tail] : sum[tail] - sum[prev]
    if (delta >= ANTHROPIC_TAIL_MIN || estimateTokens(msgs[tail]) >= ANTHROPIC_TAIL_TOKENS) raw.add(tail)
  }

  return new Set(Array.from(raw).sort((a, b) => a - b).slice(-4))
}
