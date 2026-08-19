import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { listClaude, loadClaude } from "../src/adapters/claude"
import { listCodex, loadCodex } from "../src/adapters/codex"
import { listCursor, loadCursor } from "../src/adapters/cursor"
import { listGrok, loadGrok } from "../src/adapters/grok"
import { listOpencode, loadOpencode } from "../src/adapters/opencode"
import { listPi, loadPi } from "../src/adapters/pi"
import { listSessions, loadTranscript } from "../src/discover"
import { resetListCache, withListIO } from "../src/list-cache"
import { LIVE_WINDOW_MS } from "../src/live"
import { openReadonlyDatabase, sqliteReadonlyUri } from "../src/sqlite"
import { tempRoot, writeCursorStore, writeJson, writeJsonl } from "./helpers"

const now = Date.parse("2026-08-19T00:00:00.000Z")

describe("adapters", () => {
  test("reads Codex sessions and joins tool output", async () => {
    const root = await tempRoot("codex")
    const file = path.join(root, "sessions", "2026", "08", "19", "rollout-2026-08-19T00-00-00-sess-1.jsonl")
    await writeJsonl(path.join(root, "session_index.jsonl"), [
      { id: "sess-1", thread_name: "Refactor effect atoms", updated_at: "2026-08-19T00:00:00Z" },
    ])
    await writeJsonl(file, [
      { timestamp: "2026-08-19T00:00:00Z", type: "session_meta", payload: { id: "sess-1", cwd: "/repo", model_provider: "openai" } },
      {
        timestamp: "2026-08-19T00:00:01Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix the atoms" }] },
      },
      {
        timestamp: "2026-08-19T00:00:02Z",
        type: "response_item",
        payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"pwd\"}", call_id: "call-1" },
      },
      {
        timestamp: "2026-08-19T00:00:03Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-1", output: "/repo" },
      },
    ])
    const listed = await listCodex(root, now)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.title).toBe("Refactor effect atoms")
    expect(listed[0]?.cwd).toBe("/repo")
    expect(listed[0]?.live).toBe(true)
    const transcript = await loadCodex(listed[0]!)
    expect(transcript.parts.map((part) => part.type)).toEqual(["user", "tool"])
    expect(transcript.parts[1]).toMatchObject({ name: "exec_command", output: "/repo", status: "completed" })
  })

  test("reads PI sessions including tool results", async () => {
    const root = await tempRoot("pi")
    const file = path.join(root, "agent", "sessions", "--Users-kee-repo--", "2026-08-19T00-00-00_pi-1.jsonl")
    await writeJsonl(file, [
      { type: "session", version: 3, id: "pi-1", timestamp: "2026-08-19T00:00:00Z", cwd: "/Users/kee/repo" },
      { type: "model_change", modelId: "gpt-5.5", timestamp: "2026-08-19T00:00:00Z" },
      { type: "message", id: "m1", timestamp: "2026-08-19T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
      {
        type: "message",
        id: "m2",
        timestamp: "2026-08-19T00:00:02Z",
        message: { role: "assistant", content: [{ type: "text", text: "working" }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }] },
      },
      {
        type: "message",
        id: "m3",
        timestamp: "2026-08-19T00:00:03Z",
        message: { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "file body" }] },
      },
    ])
    const listed = await listPi(root, now)
    expect(listed[0]).toMatchObject({ id: "pi-1", title: "hi", cwd: "/Users/kee/repo", model: "gpt-5.5" })
    const transcript = await loadPi(listed[0]!)
    expect(transcript.parts.map((part) => part.type)).toEqual(["user", "assistant", "tool"])
    expect(transcript.parts[2]).toMatchObject({ name: "read", output: "file body", status: "completed" })
  })

  test("reads Grok summaries and chat history, honoring active_sessions", async () => {
    const root = await tempRoot("grok")
    const dir = path.join(root, "sessions", encodeURIComponent("/repo"), "g-1")
    await writeJson(path.join(root, "active_sessions.json"), ["g-1"])
    await writeJson(path.join(dir, "summary.json"), {
      info: { id: "g-1", cwd: "/repo" },
      generated_title: "Audit Metal APIs",
      current_model_id: "grok-4.6",
      created_at: "2026-08-18T00:00:00Z",
      last_active_at: "2026-08-18T00:00:00Z",
      num_messages: 3,
    })
    await writeJsonl(path.join(dir, "chat_history.jsonl"), [
      { type: "system", content: "You are Grok" },
      { type: "user", content: [{ type: "text", text: "<user_query>audit native apis</user_query>" }] },
      { type: "assistant", content: "looking", tool_calls: [{ id: "c1", name: "read_file", arguments: { path: "a.ts" } }] },
      { type: "tool_result", tool_call_id: "c1", content: "native metal" },
    ])
    const listed = await listGrok(root, now)
    expect(listed[0]).toMatchObject({ id: "g-1", title: "Audit Metal APIs", live: true, model: "grok-4.6" })
    const transcript = await loadGrok(listed[0]!)
    expect(transcript.parts.map((part) => part.type)).toEqual(["user", "assistant", "tool"])
    expect(transcript.parts[2]).toMatchObject({ output: "native metal", status: "completed" })
  })

  test("reads Claude project jsonl and expands tool calls", async () => {
    const root = await tempRoot("claude")
    const file = path.join(root, "projects", "-Users-kee-repo", "cl-1.jsonl")
    await writeJsonl(file, [
      {
        type: "user",
        sessionId: "cl-1",
        cwd: "/Users/kee/repo",
        timestamp: "2026-08-19T00:00:00Z",
        message: { role: "user", content: "fix the certs" },
      },
      {
        type: "assistant",
        timestamp: "2026-08-19T00:00:01Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "checking" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { path: "nginx.conf" } },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-08-19T00:00:02Z",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "server {}" }] },
      },
    ])
    const listed = await listClaude(root, now)
    expect(listed[0]).toMatchObject({ id: "cl-1", title: "fix the certs", cwd: "/Users/kee/repo" })
    const transcript = await loadClaude(listed[0]!)
    expect(transcript.parts.map((part) => part.type)).toEqual(["user", "assistant", "tool"])
    expect(transcript.parts[2]).toMatchObject({ name: "Read", output: "server {}", status: "completed" })
  })

  test("reads OpenCode sqlite sessions and pending live flags", async () => {
    const root = await tempRoot("opencode")
    const file = path.join(root, "opencode-v2.db")
    const db = new Database(file)
    db.run(`CREATE TABLE session_v2 (
      id text PRIMARY KEY,
      title text,
      directory text NOT NULL,
      model text,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      time_archived integer
    )`)
    db.run(`CREATE TABLE session_pending (id text PRIMARY KEY, session_id text NOT NULL)`)
    db.run(`CREATE TABLE session_message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      type text NOT NULL,
      seq integer NOT NULL,
      time_created integer NOT NULL,
      data text NOT NULL
    )`)
    db.run("INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?)", [
      "ses_1",
      "Check upstream",
      "/repo",
      JSON.stringify({ id: "grok-4.6", providerID: "SubGrok" }),
      now - 10_000,
      now - LIVE_WINDOW_MS - 10_000,
      null,
    ])
    db.run("INSERT INTO session_pending VALUES (?, ?)", ["p1", "ses_1"])
    db.run("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)", [
      "msg_1",
      "ses_1",
      "user",
      1,
      now,
      JSON.stringify({ text: "rebase please" }),
    ])
    db.run("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)", [
      "msg_2",
      "ses_1",
      "assistant",
      2,
      now,
      JSON.stringify({
        content: [
          { type: "text", text: "reading docs" },
          {
            type: "tool",
            id: "call-1",
            name: "read",
            state: { status: "completed", input: { path: "README.md" }, content: [{ type: "text", text: "# docs" }] },
          },
        ],
      }),
    ])
    db.close()

    const listed = await listOpencode(root, now)
    expect(listed[0]).toMatchObject({
      id: "ses_1",
      title: "Check upstream",
      model: "SubGrok/grok-4.6",
      live: true,
    })
    const transcript = await loadOpencode(listed[0]!)
    expect(transcript.parts.map((part) => part.type)).toEqual(["user", "assistant", "tool"])
    expect(transcript.parts[2]).toMatchObject({ name: "read", output: "# docs", status: "completed" })
  })

  test("reads Cursor agent transcripts and skips subagents", async () => {
    const root = await tempRoot("cursor")
    const file = path.join(
      root,
      "projects",
      "Users-kee-Workspace-github-com-effect-anything-activitywatch",
      "agent-transcripts",
      "cur-1",
      "cur-1.jsonl",
    )
    await writeJsonl(file, [
      { role: "user", message: { content: [{ type: "text", text: "<user_query>redesign the website</user_query>" }] } },
      {
        role: "assistant",
        message: {
          content: [
            { type: "text", text: "looking at pages" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { path: "index.html" } },
          ],
        },
      },
      { type: "turn_ended" },
    ])
    await writeJsonl(
      path.join(
        root,
        "projects",
        "Users-kee-Workspace-github-com-effect-anything-activitywatch",
        "agent-transcripts",
        "cur-1",
        "subagents",
        "child.jsonl",
      ),
      [{ role: "user", message: { content: [{ type: "text", text: "subagent only" }] } }],
    )
    const listed = await listCursor(root, now)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe("cur-1")
    expect(listed[0]?.title).toBe("redesign the website")
    expect(listed[0]?.cwd).toContain("activitywatch")
    const transcript = await loadCursor(listed[0]!)
    expect(transcript.parts.map((part) => part.type)).toEqual(["user", "assistant", "tool"])
    expect(transcript.parts[2]).toMatchObject({ name: "Read", status: "running" })
  })

  test("lists Cursor sessions from composerHeaders and keeps jsonl as fallback", async () => {
    const root = await tempRoot("cursor-store")
    await writeCursorStore(path.join(root, "state.vscdb"), {
      headers: [
        {
          composerId: "comp-1",
          value: {
            name: "Fix atoms",
            isDraft: false,
            workspaceIdentifier: { uri: { fsPath: "/repo" } },
          },
        },
        { composerId: "sub-1", isSubagent: 1, value: { name: "Subagent work", isDraft: false } },
        { composerId: "draft-1", value: { name: "Draft chat", isDraft: true } },
        { composerId: "eph-1", value: { name: "Ephemeral", isEphemeral: true } },
        { composerId: "empty-state-draft", value: { name: "Empty draft", isDraft: false } },
      ],
      kv: [
        {
          key: "composerData:hidden-1",
          value: {
            name: "Should not list from composerData",
            fullConversationHeadersOnly: [{ bubbleId: "h1", type: 1 }],
          },
        },
        {
          key: "composerData:comp-1",
          value: {
            name: "Fix atoms",
            modelConfig: { modelName: "claude-sonnet" },
            workspaceIdentifier: { uri: { fsPath: "/repo" } },
            fullConversationHeadersOnly: [
              { bubbleId: "b1", type: 1, createdAt: "2026-08-19T00:00:00.000Z" },
              { bubbleId: "b2", type: 2, createdAt: "2026-08-19T00:00:01.000Z" },
              { bubbleId: "b3", type: 2, createdAt: "2026-08-19T00:00:02.000Z" },
              { bubbleId: "b4", type: 2, createdAt: "2026-08-19T00:00:03.000Z" },
            ],
          },
        },
        { key: "bubbleId:comp-1:b1", value: { type: 1, text: "fix the atoms" } },
        { key: "bubbleId:comp-1:b2", value: { type: 2, text: "running", thinking: { text: "plan first" } } },
        {
          key: "bubbleId:comp-1:b3",
          value: {
            type: 2,
            text: "",
            toolFormerData: {
              name: "run_terminal_command_v2",
              status: "completed",
              toolCallId: "call-1",
              params: { command: "pwd" },
              result: { output: "/repo" },
            },
          },
        },
        {
          key: "bubbleId:comp-1:b4",
          value: {
            type: 2,
            text: "",
            toolFormerData: { name: "task_v2", status: "cancelled", toolCallId: "call-2", params: {} },
          },
        },
        {
          key: "bubbleId:hidden-1:h1",
          value: { type: 1, text: "hidden composerData only" },
        },
      ],
    })
    await writeJsonl(
      path.join(root, "projects", "Users-kee-repo", "agent-transcripts", "comp-1", "comp-1.jsonl"),
      [{ role: "user", message: { content: [{ type: "text", text: "lossy jsonl should lose" }] } }],
    )
    await writeJsonl(
      path.join(root, "projects", "Users-kee-repo", "agent-transcripts", "jsonl-only", "jsonl-only.jsonl"),
      [{ role: "user", message: { content: [{ type: "text", text: "only in jsonl" }] } }],
    )
    const listed = await listCursor(root, now)
    expect(listed.map((session) => session.id).sort()).toEqual(["comp-1", "jsonl-only"])
    expect(listed.find((session) => session.id === "comp-1")).toMatchObject({
      title: "Fix atoms",
      cwd: "/repo",
      sourcePath: path.join(root, "state.vscdb"),
    })
    const transcript = await loadCursor(listed.find((session) => session.id === "comp-1")!)
    expect(transcript.parts.map((part) => part.type)).toEqual(["user", "reasoning", "assistant", "tool", "tool"])
    expect(transcript.parts[0]).toMatchObject({ text: "fix the atoms" })
    expect(transcript.parts[1]).toMatchObject({ text: "plan first" })
    expect(transcript.parts[3]).toMatchObject({
      id: "call-1",
      name: "run_terminal_command_v2",
      output: "/repo",
      status: "completed",
    })
    expect(transcript.parts[4]).toMatchObject({ id: "call-2", name: "task_v2", status: "cancelled" })
  })

  test("discover lists every agent and can reload a transcript", async () => {
    const root = await tempRoot("all")
    await writeJsonl(path.join(root, ".codex", "sessions", "s.jsonl"), [
      { timestamp: "2026-08-19T00:00:00Z", type: "session_meta", payload: { id: "cx", cwd: "/x" } },
      {
        timestamp: "2026-08-19T00:00:01Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "codex hello" }] },
      },
    ])
    const sessions = await listSessions(
      {
        opencode: path.join(root, "missing-opencode"),
        cursor: path.join(root, "missing-cursor"),
        codex: path.join(root, ".codex"),
        pi: path.join(root, "missing-pi"),
        grok: path.join(root, "missing-grok"),
        claude: path.join(root, "missing-claude"),
      },
      now,
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.agent).toBe("codex")
    const transcript = await loadTranscript(sessions[0]!)
    expect(transcript.parts[0]).toMatchObject({ type: "user", text: "codex hello" })
  })

  test("readonly sqlite cannot write after query_only", async () => {
    const root = await tempRoot("ro")
    const file = path.join(root, "store.db")
    const writable = new Database(file)
    writable.run("CREATE TABLE notes (id text PRIMARY KEY)")
    writable.run("INSERT INTO notes VALUES (?)", ["keep"])
    writable.close()

    const readonly = openReadonlyDatabase(file)
    expect(readonly).toBeDefined()
    expect(() => readonly!.run("INSERT INTO notes VALUES (?)", ["leak"])).toThrow()
    readonly!.close()

    const check = new Database(file)
    expect(check.query("SELECT id FROM notes").all()).toEqual([{ id: "keep" }])
    check.close()
  })

  test("encodes ? and # in sqlite readonly URIs", () => {
    expect(sqliteReadonlyUri("/tmp/a?b#c.db")).toBe("file:/tmp/a%3Fb%23c.db?mode=ro")
  })

  test("reuses list stamps without walking or reopening sqlite", async () => {
    resetListCache()
    const root = await tempRoot("list-cache")
    const dbFile = path.join(root, "opencode", "opencode-v2.db")
    await mkdir(path.dirname(dbFile), { recursive: true })
    const db = new Database(dbFile)
    db.run(`CREATE TABLE session_v2 (
      id text PRIMARY KEY, title text, directory text NOT NULL, model text,
      time_created integer NOT NULL, time_updated integer NOT NULL, time_archived integer
    )`)
    db.run("CREATE TABLE session_pending (id text PRIMARY KEY, session_id text NOT NULL)")
    db.run("INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?)", ["ses_1", "Cached", "/repo", null, now, now, null])
    db.close()
    await writeJsonl(path.join(root, "codex", "sessions", "s.jsonl"), [
      { timestamp: "2026-08-19T00:00:00Z", type: "session_meta", payload: { id: "cx", cwd: "/x" } },
      {
        timestamp: "2026-08-19T00:00:01Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      },
    ])

    const walks: string[] = []
    const opens: string[] = []
    await withListIO(
      {
        walk: (dir) => walks.push(dir),
        openSqlite: (file) => opens.push(file),
      },
      async () => {
        expect(await listOpencode(path.join(root, "opencode"), now)).toHaveLength(1)
        expect(await listOpencode(path.join(root, "opencode"), now)).toHaveLength(1)
        expect(opens.filter((file) => file.endsWith("opencode-v2.db"))).toHaveLength(1)

        expect(await listCodex(path.join(root, "codex"), now)).toHaveLength(1)
        expect(await listCodex(path.join(root, "codex"), now)).toHaveLength(1)
        expect(walks.filter((dir) => dir.includes(`${path.sep}codex${path.sep}sessions`))).toHaveLength(1)
      },
    )
  })

  test("agent filter skips Cursor and OpenCode stores", async () => {
    resetListCache()
    const root = await tempRoot("agent-filter")
    const dbFile = path.join(root, "opencode", "opencode-v2.db")
    await mkdir(path.dirname(dbFile), { recursive: true })
    const db = new Database(dbFile)
    db.run(`CREATE TABLE session_v2 (
      id text PRIMARY KEY, title text, directory text NOT NULL, model text,
      time_created integer NOT NULL, time_updated integer NOT NULL, time_archived integer
    )`)
    db.run("CREATE TABLE session_pending (id text PRIMARY KEY, session_id text NOT NULL)")
    db.run("INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?)", ["ses_1", "Skip me", "/repo", null, now, now, null])
    db.close()
    await writeCursorStore(path.join(root, "cursor", "state.vscdb"), {
      headers: [{ composerId: "comp-1", value: { name: "Skip cursor", isDraft: false } }],
    })
    await writeJsonl(path.join(root, "codex", "sessions", "s.jsonl"), [
      { timestamp: "2026-08-19T00:00:00Z", type: "session_meta", payload: { id: "cx", cwd: "/x" } },
      {
        timestamp: "2026-08-19T00:00:01Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "codex only" }] },
      },
    ])

    const walks: string[] = []
    const opens: string[] = []
    const sessions = await withListIO(
      {
        walk: (dir) => walks.push(dir),
        openSqlite: (file) => opens.push(file),
      },
      () =>
        listSessions(
          {
            opencode: path.join(root, "opencode"),
            cursor: path.join(root, "cursor"),
            codex: path.join(root, "codex"),
            pi: path.join(root, "missing-pi"),
            grok: path.join(root, "missing-grok"),
            claude: path.join(root, "missing-claude"),
          },
          now,
          "codex",
        ),
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.agent).toBe("codex")
    expect(opens).toEqual([])
    expect(walks.some((dir) => dir.includes("cursor") || dir.includes("opencode"))).toBe(false)
  })
})
