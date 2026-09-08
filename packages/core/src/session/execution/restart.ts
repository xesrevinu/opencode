export * as SessionRestart from "./restart.js"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionExecution } from "../execution.js"
import { SessionStore } from "../store.js"

export interface Options {
  /**
   * Times a single turn may be resumed before it is terminalized instead.
   * Unused by this fork: startup never resumes claimed Sessions automatically.
   */
  readonly maxAttempts?: number
}

export interface Interface {
  /**
   * Intentionally a no-op. Claims stay as recovery markers until an explicit
   * user action starts a new drain; boot must not write a continuation
   * message or call SessionExecution.resume.
   */
  readonly resumeSuspendedSessions: Effect.Effect<void>
}

/**
 * Restart recovery is inert on this fork. Claims are still written at turn
 * start by SessionExecution so a later explicit resume can see them, but the
 * managed server never consumes them at boot.
 */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRestart") {}

export const layer = (_options?: Options) =>
  Layer.effect(
    Service,
    Effect.succeed(
      Service.of({
        resumeSuspendedSessions: Effect.void,
      }),
    ),
  )

export const node = makeGlobalNode({
  service: Service,
  layer: layer(),
  deps: [SessionStore.node, SessionExecution.node],
})
