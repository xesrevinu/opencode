export * as SessionModelHeaders from "./model-headers.js"

import type { LanguageModel } from "@opencode/ai"
import { OpenAIResponses } from "@opencode/ai/protocols"
import { App } from "../app.js"
import { SessionSchema } from "./schema.js"

export const make = (
  session: Pick<SessionSchema.Info, "id" | "parentID" | "projectID">,
  app: App.Info,
  model?: LanguageModel,
) => ({
  "x-session-affinity": session.id,
  "X-Session-Id": session.id,
  ...(model?.route.protocol === "openai-responses" &&
  OpenAIResponses.supportsSessionRouting(model.route.endpoint.baseURL)
    ? { session_id: session.id, conversation_id: session.id }
    : {}),
  ...(session.parentID ? { "x-parent-session-id": session.parentID } : {}),
  "User-Agent": App.useragent(app),
  "x-opencode-project": session.projectID,
  "x-opencode-session": session.id,
  "x-opencode-client": app.name,
})
