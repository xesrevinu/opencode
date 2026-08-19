import { describe, expect, test } from "bun:test"
import { reduceSessionRows } from "../../tui/src/routes/session/rows-reduce"
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
      name: "read",
      state: { status: "completed", input: { path: "index.html" }, content: [{ type: "text", text: "<html>" }] },
    })
    expect(reduceSessionRows(messages).map((row) => row.type)).toEqual(["message", "part", "group"])
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
      name: "read",
      state: { status: "completed", content: [{ type: "text", text: "" }] },
    })
  })

  test("maps Cursor native tool names onto OpenCode read/glob/shell rows", () => {
    const transcript: SessionTranscript = {
      summary: {
        id: "comp-1",
        agent: "cursor",
        title: "fix",
        createdAt: 1,
        updatedAt: 2,
        live: false,
        sourcePath: "/tmp/state.vscdb",
      },
      parts: [
        { type: "user", id: "u1", text: "fix", timestamp: 1 },
        { type: "tool", id: "t1", name: "read_file_v2", input: '{"path":"a.ts"}', output: "export {}", status: "completed" },
        { type: "tool", id: "t2", name: "glob_file_search", input: '{"pattern":"*.ts"}', output: "a.ts", status: "completed" },
        {
          type: "tool",
          id: "t3",
          name: "run_terminal_command_v2",
          input: '{"command":"pwd"}',
          output: "/repo",
          status: "completed",
        },
      ],
    }
    const messages = toOpenCodeMessages(transcript)
    const content = messages[1] && messages[1].type === "assistant" ? messages[1].content : []
    expect(content.map((part) => (part.type === "tool" ? part.name : part.type))).toEqual(["read", "glob", "shell"])
    expect(reduceSessionRows(messages).map((row) => row.type)).toEqual(["message", "group", "part"])
  })
})
