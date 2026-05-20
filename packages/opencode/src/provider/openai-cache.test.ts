import { describe, expect, test } from "bun:test"
import { openAICacheKey, openAIRetention, patchOpenAIBody, summarizeOpenAIBody } from "./openai-cache"

describe("openai-cache", () => {
  test("builds stable prompt cache key from reusable prefix", () => {
    const key = openAICacheKey({
      modelID: "gpt-5.4",
      instructions: "a".repeat(5000),
      messages: [{ role: "user", content: "Hello" }],
    })

    expect(key).toBe("opencode:gpt-5.4:v1")
  })

  test("uses one stable bucket for reusable prefixes on the same model", () => {
    const a = openAICacheKey({
      modelID: "gpt-5.4",
      instructions: "a".repeat(5000),
      messages: [
        { role: "assistant", content: "stable reply" },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "call_1", result: "one" }] as any },
        { role: "user", content: "latest one" },
      ],
    })
    const b = openAICacheKey({
      modelID: "gpt-5.4",
      instructions: "b".repeat(5000),
      messages: [
        { role: "assistant", content: "other stable reply" },
        { role: "user", content: "another ask" },
      ],
    })

    expect(a).toBe(b)
  })

  test("uses one stable bucket for prompts with the same reusable prefix", () => {
    const a = openAICacheKey({
      modelID: "gpt-5.4",
      instructions: "a".repeat(5000),
      messages: [
        { role: "system", content: "stable system" },
        { role: "assistant", content: "old reply" },
        { role: "user", content: "new ask" },
      ],
    })
    const b = openAICacheKey({
      modelID: "gpt-5.4",
      instructions: "a".repeat(5000),
      messages: [
        { role: "system", content: "stable system" },
        { role: "assistant", content: "different reply" },
        { role: "user", content: "another ask" },
      ],
    })

    expect(a).toBe(b)
  })

  test("skips prompt cache key for short prompts", () => {
    expect(
      openAICacheKey({
        modelID: "gpt-5.4",
        instructions: "short",
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).toBeUndefined()
  })

  test("injects prompt cache fields from the reusable body prefix", () => {
    const body = JSON.stringify({
      model: "gpt-5.4",
      instructions: "a".repeat(5000),
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
    })
    const next = JSON.parse(patchOpenAIBody(body, { "x-opencode-session": "sess-1" }, "gpt-5.4"))

    expect(next.prompt_cache_key).toBe("opencode:gpt-5.4:v1")
    expect(next.prompt_cache_retention).toBeUndefined()
  })

  test("injects prompt cache fields for chat-style messages payloads", () => {
    const body = JSON.stringify({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: "a".repeat(5000) },
        { role: "assistant", content: "stable reply" },
        { role: "user", content: "Hello" },
      ],
    })
    const next = JSON.parse(patchOpenAIBody(body, undefined, "gpt-5.4"))

    expect(next.prompt_cache_key).toBe("opencode:gpt-5.4:v1")
    expect(next.prompt_cache_retention).toBeUndefined()
  })

  test("summarizes chat-style messages payloads", () => {
    const summary = summarizeOpenAIBody(
      JSON.stringify({
        model: "gpt-5.4",
        messages: [
          { role: "system", content: "a".repeat(5000) },
          { role: "assistant", content: "stable reply" },
          { role: "user", content: "Hello" },
        ],
      }),
    )

    expect(summary.promptCacheKey).toBe("opencode:gpt-5.4:v1")
    expect(summary.inputCount).toBe(3)
    expect(summary.cacheableInputCount).toBe(2)
  })

  test("keeps explicit prompt cache key", () => {
    const body = JSON.stringify({ model: "gpt-5.4", prompt_cache_key: "fixed", input: [] })
    const next = JSON.parse(patchOpenAIBody(body, { "x-opencode-session": "sess-1" }, "gpt-5.4"))

    expect(next.prompt_cache_key).toBe("fixed")
    expect(next.prompt_cache_retention).toBeUndefined()
  })

  test("uses session cache key for openai-compatible payloads", () => {
    const body = JSON.stringify({
      model: "gpt-5.4",
      instructions: "a".repeat(5000),
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
    })
    const next = JSON.parse(patchOpenAIBody(body, { "x-opencode-session": "sess-1" }, "gpt-5.4"))

    expect(next.prompt_cache_key).toBe("opencode:gpt-5.4:v1")
  })

  test("normalizes explicit in-memory retention", () => {
    const body = JSON.stringify({
      model: "gpt-5.4",
      prompt_cache_key: "fixed",
      prompt_cache_retention: "in-memory",
      input: [],
    })
    const next = JSON.parse(patchOpenAIBody(body, undefined, "gpt-5.4"))

    expect(next.prompt_cache_retention).toBe("in_memory")
  })

  test("drops unsupported 24h retention", () => {
    const body = JSON.stringify({
      model: "gpt-5.4",
      prompt_cache_key: "fixed",
      prompt_cache_retention: "24h",
      input: [],
    })
    const next = JSON.parse(patchOpenAIBody(body, undefined, "gpt-5.4"))

    expect(next.prompt_cache_retention).toBeUndefined()
  })

  test("keeps supported 24h retention", () => {
    expect(openAIRetention("gpt-5.1", "24h")).toBe("24h")
  })

  test("leaves short bodies without cache fields", () => {
    const body = JSON.stringify({ model: "gpt-5.4", input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }] })

    expect(patchOpenAIBody(body, undefined, "gpt-5.4")).toBe(body)
  })
})
