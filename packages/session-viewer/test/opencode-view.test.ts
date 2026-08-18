import { describe, expect, test } from "bun:test"
import { toOpenCodeMessages } from "../src/opencode-view"
import type { SessionTranscript } from "../src/model"

describe("toOpenCodeMessages", () => {
  test("projects foreign agent parts into OpenCode TUI message/content shapes", () => {
    const transcript: SessionTranscript = {
      summary: {
        id: "cur-1",
        agent: "cursor",
        title: "redesign",
        model: "cursor/grok-4.6",
        createdAt: 10,
        updatedAt: 20,
        live: false,
        sourcePath: "/tmp/cur-1.jsonl",
      },
      parts: [
        { type: "user", id: "u1", text: "redesign the website", timestamp: 10 },
        { type: "assistant", id: "a1", text: "looking at pages", timestamp: 11 },
        { type: "tool", id: "t1", name: "Read", input: '{"path":"index.html"}', output: "<html>", status: "completed", timestamp: 12 },
      ],
    }
    const messages = toOpenCodeMessages(transcript)
    expect(messages[0]).toMatchObject({ type: "user", text: "redesign the website" })
    expect(messages[1]).toMatchObject({
      type: "assistant",
      agent: "cursor",
      model: { providerID: "cursor", id: "grok-4.6" },
    })
    const content = messages[1] && messages[1].type === "assistant" ? messages[1].content : []
    expect(content[0]).toEqual({ type: "text", text: "looking at pages" })
    expect(content[1]).toMatchObject({
      type: "tool",
      id: "t1",
      name: "Read",
      state: { status: "completed", input: { path: "index.html" }, content: [{ type: "text", text: "<html>" }] },
    })
  })

  test("maps Cursor-style completed tools without output into OpenCode completed state", () => {
    const transcript: SessionTranscript = {
      summary: {
        id: "cur-2",
        agent: "cursor",
        title: "read file",
        createdAt: 1,
        updatedAt: 2,
        live: false,
        sourcePath: "/tmp/cur-2.jsonl",
      },
      parts: [{ type: "tool", id: "tool-1", name: "Read", input: '{"path":"a.ts"}', status: "completed" }],
    }
    const [message] = toOpenCodeMessages(transcript)
    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.content[0]).toMatchObject({
      type: "tool",
      name: "Read",
      state: { status: "completed", content: [{ type: "text", text: "" }] },
    })
  })
})
