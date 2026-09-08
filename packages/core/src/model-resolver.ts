export * as ModelResolver from "./model-resolver.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LanguageModel } from "@opencode/ai"
import { Auth } from "@opencode/ai/route"
import { Context, Effect, Layer, Schema, Struct } from "effect"
import { Headers } from "effect/unstable/http"
import { AISDK } from "./aisdk.js"
import { AISDKNative } from "./aisdk-native.js"
import { Catalog } from "./catalog.js"
import { Credential } from "./credential.js"
import { Integration } from "./integration.js"
import { Capabilities, ID, Info, Ref, VariantID } from "./model.js"
import { Npm } from "@opencode/util/npm"
import { Provider } from "./provider.js"

export class VariantUnavailableError extends Schema.TaggedError<VariantUnavailableError>()(
  "SessionRunnerModel.VariantUnavailableError",
  {
    providerID: Provider.ID,
    modelID: ID,
    variant: VariantID,
  },
) {
  override get message() {
    return `Variant unavailable for ${this.providerID}/${this.modelID}: ${this.variant}`
  }
}

export class UnsupportedPackageError extends Schema.TaggedError<UnsupportedPackageError>()(
  "SessionRunnerModel.UnsupportedPackageError",
  {
    providerID: Provider.ID,
    modelID: ID,
    package: Schema.String,
  },
) {
  override get message() {
    return `Unsupported package for ${this.providerID}/${this.modelID}: ${this.package}`
  }
}

export class UnresolvedProviderVariablesError extends Schema.TaggedError<UnresolvedProviderVariablesError>()(
  "SessionRunnerModel.UnresolvedProviderVariablesError",
  {
    providerID: Provider.ID,
    modelID: ID,
    variables: Schema.Array(Schema.String),
  },
) {
  override get message() {
    return `Cannot initialize ${this.providerID}/${this.modelID}: ${this.variables.join(", ")} ${this.variables.length === 1 ? "is" : "are"} required to resolve the provider endpoint`
  }
}

export class UnsupportedCompactionError extends Schema.TaggedError<UnsupportedCompactionError>()(
  "SessionRunnerModel.UnsupportedCompactionError",
  {
    providerID: Provider.ID,
    modelID: ID,
    route: Schema.String,
  },
) {
  override get message() {
    return `Provider compaction is not supported by ${this.providerID}/${this.modelID} (${this.route})`
  }
}

export type Error =
  | VariantUnavailableError
  | UnsupportedPackageError
  | UnresolvedProviderVariablesError
  | UnsupportedCompactionError
  | Integration.AuthorizationError

export interface Resolved {
  /** Route-level model for provider requests; its id is the provider API model id, which may differ from the catalog id. */
  readonly model: LanguageModel
  /** Selected catalog identity. Durable records and displays must use this, never the API model id. */
  readonly ref: Ref
  /** Catalog capabilities used to shape requests before provider lowering. */
  readonly capabilities: Capabilities
  /** Catalog pricing in dollars per million tokens. */
  readonly cost: Info["cost"]
  /** Catalog token limits used by Core for context management. */
  readonly limit: Info["limit"]
  /** Model policy overrides the provider policy; omitted means local compaction. */
  readonly compaction?: Info["compaction"]
}

export interface Interface {
  readonly resolve: (requested?: Ref) => Effect.Effect<Resolved | undefined, Error>
  readonly resolveModel: (model: Info, variant?: VariantID) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelResolver") {}

// Catalog models are shared with the retained registry value and stay editable by later transforms, so
// resolution copies with spreads: immer's produce would deep-freeze the unchanged subtrees it shares with its input.
export const withVariant = (
  model: Info,
  variantID: VariantID | undefined,
): Effect.Effect<Info, VariantUnavailableError> => {
  const id = variantID === "default" ? undefined : variantID
  const variant = model.variants?.find((item) => item.id === id)
  if (!variant && id !== undefined)
    return Effect.fail(
      new VariantUnavailableError({
        providerID: model.providerID,
        modelID: model.id,
        variant: id,
      }),
    )
  return Effect.succeed(
    variant
      ? {
          ...model,
          settings: Provider.mergeOverlay(model.settings, variant.settings),
          headers: Provider.mergeHeaders(model.headers, variant.headers),
          body: Provider.mergeOverlay(model.body, variant.body),
        }
      : model,
  )
}

export interface Dependencies {
  readonly loadPackage?: (specifier: string) => Effect.Effect<Provider.ProviderPackage, Provider.LoadError>
  readonly loadAISDK?: (model: Info) => Effect.Effect<LanguageModel, AISDK.InitError>
}

export const fromCatalogModel = (
  model: Info,
  credential?: Credential.Value,
  dependencies?: Dependencies,
): Effect.Effect<
  LanguageModel,
  UnsupportedPackageError | UnresolvedProviderVariablesError | UnsupportedCompactionError
> =>
  resolveCatalogModel(model, credential, dependencies).pipe(
    Effect.flatMap((resolved) => validateProviderVariables(model, resolved)),
    Effect.flatMap((resolved) => {
      // Reject provider compaction policies up front so the misconfiguration surfaces before any step runs.
      if (model.compaction?.mode !== "provider" || resolved.route.compact?.trigger || resolved.route.compact?.endpoint)
        return Effect.succeed(resolved)
      return Effect.fail(
        new UnsupportedCompactionError({ providerID: model.providerID, modelID: model.id, route: resolved.route.id }),
      )
    }),
  )

const resolveCatalogModel = Effect.fn("ModelResolver.resolveCatalogModel")(function* (
  model: Info,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) {
  const resolved = prepareRuntimeModel(model, credential)
  const packageName = Provider.packageName(resolved.package)
  const configuration = credential?.type === "key" ? credential.configuration : undefined
  const configured = { ...resolved.settings, ...credential?.metadata, ...configuration }
  const mapping = Provider.isAISDK(resolved.package)
    ? AISDKNative.map({
        packageName,
        settings: configured,
        modelID: resolved.modelID ?? resolved.id,
        providerID: resolved.canonical ?? resolved.providerID,
      })
    : undefined
  const native = mapping?.package ?? packageName
  if (Provider.isAISDK(resolved.package) && !mapping) {
    const loadAISDK = dependencies?.loadAISDK
    if (!loadAISDK) return yield* unsupported(resolved)
    const settings = yield* prepareProviderSettings(
      resolved,
      Provider.mergeOverlay(resolved.settings, {
        ...nativeCredentialSettings(resolved.package ?? "", credential),
        ...credential?.metadata,
        ...configuration,
      }) ?? {},
    )
    return yield* loadAISDK({ ...resolved, settings }).pipe(
      Effect.map((model) => withProviderClientProfile(resolved, model)),
      Effect.mapError(() => unsupported(resolved)),
    )
  }
  if (!native) return yield* unsupported(resolved)

  const specifier = native
  const mapped = yield* prepareProviderSettings(resolved, mapping?.settings ?? configured)
  const module = yield* (dependencies?.loadPackage ?? Provider.loadPackage)(specifier).pipe(
    Effect.mapError(() => unsupported(resolved)),
  )
  const settings = {
    ...(credential ? Struct.omit(mapped, ["accessToken", "apiKey", "authToken"]) : mapped),
    ...(resolved.canonical === undefined ? {} : { provider: resolved.canonical }),
    ...nativeCredentialSettings(specifier, credential),
    headers: Provider.mergeHeaders(mapping?.headers, resolved.headers),
    body: Provider.mergeOverlay(mapping?.body, resolved.body),
  }
  return yield* Effect.try({
    try: () => {
      const runtime = module.model(resolved.modelID ?? resolved.id, settings)
      return withProviderClientProfile(
        resolved,
        LanguageModel.update(runtime, {
          compatibility: resolved.compatibility
            ? Object.assign({}, runtime.compatibility, resolved.compatibility)
            : runtime.compatibility,
        }),
      )
    },
    catch: () => unsupported(resolved),
  })
})

function prepareRuntimeModel(model: Info, credential: Credential.Value | undefined) {
  if (model.settings?.apiKey !== "" && (credential?.type !== "key" || credential.metadata === undefined)) return model
  return {
    ...model,
    ...(model.settings?.apiKey === "" ? { settings: Struct.omit(model.settings, ["apiKey"]) } : {}),
    ...(credential?.type === "key" && credential.metadata !== undefined
      ? { body: Provider.mergeOverlay(model.body, credential.metadata) }
      : {}),
  }
}

function validateProviderVariables(
  model: Info,
  resolved: LanguageModel,
): Effect.Effect<LanguageModel, UnresolvedProviderVariablesError> {
  const baseURL = resolved.route.endpoint.baseURL
  if (typeof baseURL !== "string") return Effect.succeed(resolved)
  const failure = unresolvedProviderVariables(model, baseURL)
  return failure ? Effect.fail(failure) : Effect.succeed(resolved)
}

function prepareProviderSettings(
  model: Info,
  settings: Readonly<Record<string, unknown>>,
): Effect.Effect<Readonly<Record<string, unknown>>, UnresolvedProviderVariablesError> {
  const baseURL = settings.baseURL
  if (typeof baseURL !== "string") return Effect.succeed(settings)
  return prepareProviderURL(model, baseURL).pipe(
    Effect.map((prepared) => (prepared === baseURL ? settings : { ...settings, baseURL: prepared })),
  )
}

function prepareProviderURL(model: Info, baseURL: string): Effect.Effect<string, UnresolvedProviderVariablesError> {
  if (!baseURL.includes("${")) return Effect.succeed(baseURL)
  const prepared = baseURL.replace(/\$\{([^}]+)\}/g, (placeholder, name: string) => process.env[name] ?? placeholder)
  const failure = unresolvedProviderVariables(model, prepared)
  return failure ? Effect.fail(failure) : Effect.succeed(prepared)
}

function unresolvedProviderVariables(model: Info, baseURL: string) {
  const variables = new Set(Array.from(baseURL.matchAll(/\$\{([^}]+)\}/g), (match) => match[1]))
  if (variables.size === 0) return
  return new UnresolvedProviderVariablesError({
    providerID: model.providerID,
    modelID: model.id,
    variables: Array.from(variables),
  })
}

const withProviderClientProfile = (resolved: Info, runtime: LanguageModel) =>
  LanguageModel.update(runtime, {
    provider: resolved.providerID,
    route: runtime.route.with({ auth: providerClientProfile(resolved, runtime.route.auth) }),
    compatibility: resolved.compatibility
      ? Object.assign({}, runtime.compatibility, resolved.compatibility)
      : runtime.compatibility,
  })

const nativeCredentialSettings = (specifier: string, credential: Credential.Value | undefined) => {
  if (!credential) return {}
  if (credential.type === "key") return { apiKey: credential.key }
  if (specifier === "@opencode/ai/providers/anthropic" || specifier === "@opencode/ai/providers/anthropic-compatible")
    return { authToken: credential.access }
  if (
    specifier === "@opencode/ai/providers/google-vertex" ||
    specifier.startsWith("@opencode/ai/providers/google-vertex/")
  )
    return { accessToken: credential.access }
  return { apiKey: credential.access }
}

const openAIClientProfile = (auth: Auth.Definition) =>
  auth.andThen(
    Auth.custom((input) => {
      const sessionID = input.headers["x-session-affinity"]
      const headers = Headers.setAll(input.headers, {
        "user-agent": "codex_cli_rs/0.145.0",
        ...(input.headers.originator === undefined ? { originator: "codex_cli_rs" } : {}),
        ...(input.headers["openai-beta"] === undefined ? { "openai-beta": "responses=experimental" } : {}),
        ...(input.headers.accept === undefined ? { accept: "text/event-stream" } : {}),
        ...(input.headers["content-type"] === undefined ? { "content-type": "application/json" } : {}),
        ...(sessionID === undefined ? {} : { session_id: sessionID, conversation_id: sessionID }),
      })
      return Effect.succeed(
        ["x-session-affinity", "x-opencode-small", "x-parent-session-id"].reduce(Headers.remove, headers),
      )
    }),
  )

const anthropicClientProfile = (auth: Auth.Definition) =>
  auth.andThen(
    Auth.custom((input) => {
      const body = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(input.body)
      const value = body._tag === "Some" && isRecord(body.value) ? body.value : {}
      const sessionID = input.headers["x-session-affinity"]
      const headers = Headers.setAll(input.headers, {
        "anthropic-beta": anthropicBetas(value, input.headers["anthropic-beta"]),
        "user-agent": "claude-cli/2.1.133 (external, sdk-cli)",
        ...(sessionID === undefined ? {} : { "x-claude-code-session-id": sessionID }),
        accept: "application/json",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-version": "2023-06-01",
        "x-app": "cli",
        "x-client-request-id": crypto.randomUUID(),
        "x-stainless-arch": process.arch,
        "x-stainless-lang": "js",
        "x-stainless-os": stainlessOS(),
        "x-stainless-package-version": "0.81.0",
        "x-stainless-retry-count": "0",
        "x-stainless-runtime": "node",
        "x-stainless-runtime-version": `v${process.versions.node}`,
        "x-stainless-timeout": "600",
      })
      return Effect.succeed(["x-session-affinity", "x-opencode-small"].reduce(Headers.remove, headers))
    }),
  )

const providerClientProfile = (model: Info, auth: Auth.Definition) => {
  const providerID = model.providerID.toLowerCase()
  if (providerID === Provider.ID.openai) return openAIClientProfile(auth)
  if (providerID === Provider.ID.anthropic) return anthropicClientProfile(auth)
  return auth
}

const anthropicBetas = (body: Record<string, unknown>, incoming: string | undefined) => {
  const base = [
    "claude-code-20250219",
    "interleaved-thinking-2025-05-14",
    "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05",
    "advisor-tool-2026-03-01",
    "advanced-tool-use-2025-11-20",
    "effort-2025-11-24",
  ]
  const full =
    Array.isArray(body.tools) &&
    body.tools.length > 0 &&
    Array.isArray(body.system) &&
    isRecord(body.thinking) &&
    isRecord(body.context_management) &&
    isRecord(body.output_config) &&
    isRecord(body.diagnostics)
  const structured =
    isRecord(body.output_config) &&
    isRecord(body.output_config.format) &&
    body.output_config.format.type === "json_schema"
  const selected = full
    ? [
        "claude-code-20250219",
        "oauth-2025-04-20",
        "interleaved-thinking-2025-05-14",
        "context-management-2025-06-27",
        "prompt-caching-scope-2026-01-05",
        "advisor-tool-2026-03-01",
        "advanced-tool-use-2025-11-20",
        "context-1m-2025-08-07",
        "effort-2025-11-24",
        "extended-cache-ttl-2025-04-11",
        "cache-diagnosis-2026-04-07",
      ]
    : structured
      ? [...base, "structured-outputs-2025-12-15"]
      : base
  return [
    ...new Set([
      ...selected,
      ...(body.speed === "fast" ? ["fast-mode-2026-02-01"] : []),
      ...(incoming ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ]),
  ].join(",")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stainlessOS = () => {
  if (process.platform === "darwin") return "MacOS"
  if (process.platform === "win32") return "Windows"
  if (process.platform === "linux") return "Linux"
  if (process.platform === "freebsd") return "FreeBSD"
  return "Unknown"
}

const unsupported = (model: Info) =>
  new UnsupportedPackageError({
    providerID: model.providerID,
    modelID: model.id,
    package: model.package ?? "unknown",
  })

export const resolveModel = (
  model: Info,
  variant: VariantID | undefined,
  credential?: Credential.Value,
  dependencies?: Dependencies,
) => withVariant(model, variant).pipe(Effect.flatMap((model) => fromCatalogModel(model, credential, dependencies)))

export const hasPackage = (model: Info) => Boolean(model.package)

/** Resolves catalog selections into runtime models for the current Location. */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const npm = yield* Npm.Service
    const aisdk = yield* AISDK.Service
    const load = Effect.fn("ModelResolver.resolveModel")(function* (selected: Info, variant?: VariantID) {
      const provider = yield* catalog.provider.get(selected.providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(selected.providerID),
      )
      const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
      const runtimeInfo = yield* withVariant(selected, variant)
      const model = yield* fromCatalogModel(runtimeInfo, credential, {
        loadPackage: (specifier) => Provider.loadPackage(specifier, npm),
        loadAISDK: (model) => aisdk.model(model),
      })
      const runtime =
        provider?.activation === "enabled" &&
        credential === undefined &&
        !hasConfiguredAuth(runtimeInfo) &&
        usesAPIKeyAuth(runtimeInfo.package)
          ? LanguageModel.update(model, { route: model.route.with({ auth: Auth.none }) })
          : model
      return {
        model: runtime,
        ref: Ref.make({
          id: selected.id,
          providerID: selected.providerID,
          ...(variant === undefined ? {} : { variant }),
        }),
        capabilities: selected.capabilities,
        cost: selected.cost,
        limit: selected.limit,
        compaction: selected.compaction,
      }
    })
    return Service.of({
      resolve: Effect.fn("ModelResolver.resolve")(function* (requested) {
        const selected = requested
          ? yield* catalog.model.get(requested.providerID, requested.id)
          : yield* catalog.model
              .default()
              .pipe(
                Effect.flatMap((model) =>
                  model && hasPackage(model)
                    ? Effect.succeed(model)
                    : Effect.map(catalog.model.available(), (models) => models.find(hasPackage)),
                ),
              )
        if (!selected) return undefined
        return yield* load(selected, requested?.variant)
      }),
      resolveModel: load,
    })
  }),
)

function hasConfiguredAuth(model: Info) {
  return [model.settings?.apiKey, model.settings?.authToken, model.settings?.accessToken].some(
    (value) => typeof value === "string" && value !== "",
  )
}

function usesAPIKeyAuth(packageName: string | undefined) {
  const name = Provider.packageName(packageName)
  return (
    name === "@ai-sdk/openai" ||
    name === "@ai-sdk/anthropic" ||
    name === "@ai-sdk/cerebras" ||
    name === "@ai-sdk/deepinfra" ||
    name === "@ai-sdk/openai-compatible" ||
    name === "@ai-sdk/google" ||
    name === "@ai-sdk/groq" ||
    name === "@ai-sdk/mistral" ||
    name === "@ai-sdk/togetherai" ||
    name === "@ai-sdk/xai" ||
    name === "@openrouter/ai-sdk-provider" ||
    name === "@ai-sdk/azure" ||
    name === "@opencode/ai/providers/openai" ||
    name?.startsWith("@opencode/ai/providers/openai/") === true ||
    name === "@opencode/ai/providers/anthropic" ||
    name === "@opencode/ai/providers/anthropic-compatible" ||
    name === "@opencode/ai/providers/baseten" ||
    name === "@opencode/ai/providers/cerebras" ||
    name === "@opencode/ai/providers/cloudflare-ai-gateway" ||
    name === "@opencode/ai/providers/cloudflare-workers-ai" ||
    name === "@opencode/ai/providers/deepinfra" ||
    name === "@opencode/ai/providers/deepseek" ||
    name === "@opencode/ai/providers/fireworks" ||
    name === "@opencode/ai/providers/openai-compatible" ||
    name === "@opencode/ai/providers/google" ||
    name === "@opencode/ai/providers/groq" ||
    name === "@opencode/ai/providers/mistral" ||
    name === "@opencode/ai/providers/togetherai" ||
    name === "@opencode/ai/providers/xai" ||
    name === "@opencode/ai/providers/openrouter" ||
    name === "@opencode/ai/providers/azure" ||
    name?.startsWith("@opencode/ai/providers/azure/") === true
  )
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Catalog.node, Integration.node, Npm.node, AISDK.node],
})
