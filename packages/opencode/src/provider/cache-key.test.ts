import { describe, expect, test } from "bun:test"
import { generateCacheKey, selectAnthropicPrefix, stableEnd } from "./cache-key"
import type { ModelMessage } from "ai"

describe("cache-key", () => {
  test("generates consistent keys for the same content", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
    ]

    expect(generateCacheKey(msgs, "session-1")).toBe(generateCacheKey(msgs, "session-1"))
  })

  test("uses the session id in the generic cache key", () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "Hello" }]

    expect(generateCacheKey(msgs, "session-1")).not.toBe(generateCacheKey(msgs, "session-2"))
  })

  test("stableEnd skips the active user turn", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "assistant", content: "done" },
      { role: "user", content: "latest" },
    ]

    expect(stableEnd(msgs)).toBe(2)
  })

  test("stableEnd skips the active tool loop", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "read file" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_1", toolName: "read", args: {} }] as any },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call_1", result: "done" }] as any },
    ]

    expect(stableEnd(msgs)).toBe(1)
  })

  test("selectAnthropicPrefix keeps the stable prefix only", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a".repeat(1200) },
      { role: "assistant", content: "b".repeat(1200) },
      { role: "user", content: "latest" },
    ]

    expect(Array.from(selectAnthropicPrefix(msgs))).toEqual([0, 1, 2])
  })

  test("selectAnthropicPrefix caps breakpoints at four", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a".repeat(1200) },
      { role: "assistant", content: "b".repeat(1200) },
      { role: "user", content: "c".repeat(1200) },
      { role: "assistant", content: "d".repeat(1200) },
      { role: "user", content: "latest" },
    ]

    expect(Array.from(selectAnthropicPrefix(msgs))).toEqual([1, 2, 3, 4])
  })

  test("selectAnthropicPrefix skips tiny tail growth", () => {
    const msgs: ModelMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "a".repeat(1200) },
      { role: "assistant", content: "ok" },
      { role: "user", content: "latest" },
    ]

    expect(Array.from(selectAnthropicPrefix(msgs))).toEqual([0, 1])
  })
})
