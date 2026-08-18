import { Effect, Option } from "effect"
import { runViewerCli } from "@opencode-ai/session-viewer"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(Commands.commands.sessions, (input) =>
  Effect.promise(() => {
    const requested = Option.getOrUndefined(input.session)
    const mode = input.live ? "live" : input.all || input.json || requested ? "all" : "live"
    return runViewerCli({
      home: Option.getOrUndefined(input.home),
      agent: Option.getOrUndefined(input.agent),
      mode,
      query: Option.getOrUndefined(input.query),
      json: input.json || Boolean(requested),
      session: requested,
    })
  }),
)
