import { describe, expect } from "bun:test"
import { Message, SystemPart } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session } from "@opencode/schema/session"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(PluginHooks.node))

describe("PluginHooks", () => {
  it.effect("registers scoped session hooks and triggers them sequentially", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      const seen: string[] = []
      yield* hooks.register("session", "context", (event) =>
        Effect.sync(() => {
          seen.push("first")
          event.system.push(SystemPart.make("second"))
        }),
      )
      yield* hooks.register("session", "context", (event) =>
        Effect.sync(() => {
          seen.push(event.system[1]?.text ?? "missing")
          event.messages = [Message.user("changed")]
        }),
      )
      const event = {
        sessionID: Session.ID.make("ses_hooks"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("model") }),
        system: [SystemPart.make("first")],
        messages: [Message.user("original")],
        tools: {},
        generation: {},
        providerOptions: {},
      }

      expect(yield* hooks.trigger("session", "context", event)).toBe(event)
      expect(seen).toEqual(["first", "second"])
      expect(event.messages).toEqual([Message.user("changed")])
    }),
  )

  it.effect("mutates shell creation input", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("shell", "create.before", (event) =>
        Effect.sync(() => {
          event.command = "echo changed"
        }),
      )
      const event = {
        command: "echo original",
        cwd: "/tmp",
        timeout: 0,
        shell: "/bin/sh",
        env: {},
        startupFiles: true,
      }

      expect(yield* hooks.trigger("shell", "create.before", event)).toBe(event)
      expect(event.command).toBe("echo changed")
    }),
  )

  it.effect("supplies an authoritative shell environment", () =>
    Effect.gen(function* () {
      const hooks = yield* PluginHooks.Service
      yield* hooks.register("shell", "create.before", (event) =>
        Effect.sync(() => {
          Object.assign(event.env, { OPENCODE_TEST_DIRENV: "loaded" })
          event.startupFiles = false
        }),
      )
      const event = {
        command: "env",
        cwd: "/tmp",
        timeout: 0,
        shell: "/bin/zsh",
        env: { PATH: "/project/bin:/usr/bin" } as Record<string, string | undefined>,
        startupFiles: true,
      }

      yield* hooks.trigger("shell", "create.before", event)

      expect(event.env).toEqual({ PATH: "/project/bin:/usr/bin", OPENCODE_TEST_DIRENV: "loaded" })
      expect(event.startupFiles).toBe(false)
    }),
  )
})
