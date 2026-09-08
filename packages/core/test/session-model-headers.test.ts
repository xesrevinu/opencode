import { expect, test } from "bun:test"
import { LanguageModel } from "@opencode/ai"
import { AnthropicMessages, OpenAIResponses } from "@opencode/ai/protocols"
import { App } from "@opencode/core/app"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { SessionModelHeaders } from "@opencode/core/session/model-headers"

const session = {
  id: Session.ID.make("ses_header_test"),
  projectID: Project.ID.global,
  parentID: undefined,
}

test("adds sticky routing headers for OpenAI Responses", () => {
  const model = LanguageModel.make({ id: "gpt-5.4", provider: "OpenAI", route: OpenAIResponses.route })

  expect(SessionModelHeaders.make(session, App.make(), model)).toMatchObject({
    session_id: session.id,
    conversation_id: session.id,
  })
})

test("does not add OpenAI routing headers to other protocols", () => {
  const model = LanguageModel.make({ id: "claude-opus-4-8", provider: "Anthropic", route: AnthropicMessages.route })
  const headers = SessionModelHeaders.make(session, App.make(), model)

  expect(headers).not.toHaveProperty("session_id")
  expect(headers).not.toHaveProperty("conversation_id")
})

test("does not add OpenAI routing headers to custom Responses endpoints", () => {
  const model = LanguageModel.make({
    id: "gpt-5.4",
    provider: "Custom",
    route: OpenAIResponses.route.with({ endpoint: { baseURL: "https://example.com/v1" } }),
  })
  const headers = SessionModelHeaders.make(session, App.make(), model)

  expect(headers).not.toHaveProperty("session_id")
  expect(headers).not.toHaveProperty("conversation_id")
})

test("does not add OpenAI routing headers to Azure Responses endpoints", () => {
  const model = LanguageModel.make({
    id: "gpt-5.4",
    provider: "Azure",
    route: OpenAIResponses.route.with({ endpoint: { baseURL: "https://example.openai.azure.com/openai/v1" } }),
  })
  const headers = SessionModelHeaders.make(session, App.make(), model)

  expect(headers).not.toHaveProperty("session_id")
  expect(headers).not.toHaveProperty("conversation_id")
})

test("adds OpenAI routing headers to the Codex endpoint", () => {
  const model = LanguageModel.make({
    id: "gpt-5.4",
    provider: "OpenAI",
    route: OpenAIResponses.route.with({ endpoint: { baseURL: "https://chatgpt.com/backend-api/codex" } }),
  })

  expect(SessionModelHeaders.make(session, App.make(), model)).toMatchObject({
    session_id: session.id,
    conversation_id: session.id,
  })
})
