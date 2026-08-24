import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  findSupportedChatModel,
  type SupportedChatModel,
  type SupportedChatModelID,
  type SupportedProvider,
} from "@codepilot/shared";
import type { LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
type AnthropicModelId = Extract<
  SupportedChatModel,
  { provider: "anthropic" }
>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai" }>["id"];

export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: SupportedChatModelID;
  providerOptions?: ProviderOptions;
};

/**
 * Adaptive thinking, not a fixed budget: `budgetTokens` is rejected outright by
 * the current Claude models, which decide their own depth. `display` has to be
 * asked for as well — these models omit the reasoning summary by default, and
 * without it the CLI shows a long silence instead of a "thinking" aside.
 */
const ANTHROPIC_PROVIDER_OPTIONS: Partial<
  Record<AnthropicModelId, ProviderOptions>
> = {
  "claude-sonnet-5": {
    anthropic: { thinking: { type: "adaptive", display: "summarized" } },
  },
  "claude-opus-5": {
    anthropic: { thinking: { type: "adaptive", display: "summarized" } },
  },
  "claude-haiku-4-5": {
    anthropic: { thinking: { type: "adaptive", display: "summarized" } },
  },
};

/**
 * One entry per model id — and currently no entries at all.
 *
 * `reasoningSummary` used to be set here, but neither `gpt-4o` nor
 * `gpt-4o-mini` is a reasoning model, so the provider dropped it with a
 * warning on every single request. (It was previously nested *inside* the
 * `gpt-4o-mini` entry, which made every other lookup return `undefined` and
 * gave `gpt-4o-mini` an options object containing two model ids as keys.)
 *
 * Add an entry when a model that actually reasons is added to the catalogue;
 * the lookup below already handles the empty case.
 */
export const OPENAI_PROVIDER_OPTIONS: Partial<
  Record<OpenAIModelId, ProviderOptions>
> = {};
/**
 * Providers listed in the shared catalogue that this server can actually talk
 * to. `@codepilot/shared` advertises google and azure models, but no SDK is
 * wired up for them yet — requests for those must be rejected at validation
 * time (400) rather than blowing up mid-stream (500).
 */
const IMPLEMENTED_PROVIDERS = ["anthropic", "openai"] as const;

type ImplementedProvider = (typeof IMPLEMENTED_PROVIDERS)[number];
type UnimplementedProvider = Exclude<
  SupportedChatModel["provider"],
  ImplementedProvider
>;

function isImplementedProvider(
  provider: SupportedProvider,
): provider is ImplementedProvider {
  return (IMPLEMENTED_PROVIDERS as readonly SupportedProvider[]).includes(
    provider,
  );
}

function assertUnsupportedProvider(provider: UnimplementedProvider): never {
  throw new Error(`Unsupported provider: ${provider}`);
}

function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
  return {
    model: anthropic(modelId),
    provider: "anthropic",
    modelId,
    providerOptions: ANTHROPIC_PROVIDER_OPTIONS[modelId],
  };
}

function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
  return {
    model: openai(modelId),
    provider: "openai",
    modelId,
    providerOptions: OPENAI_PROVIDER_OPTIONS[modelId],
  };
}

function resolveSupportedModel(model: SupportedChatModel): ResolvedModel {
  switch (model.provider) {
    case "anthropic":
      return resolveAnthropicModel(model.id);
    case "openai":
      return resolveOpenAIModel(model.id);
    default:
      return assertUnsupportedProvider(model.provider);
  }
}

/**
 * True only for models this server can actually run.
 *
 * `findSupportedChatModel` is `Array.prototype.find`, so a miss is `undefined`
 * — never `null`. Comparing against `null` made this predicate accept every
 * string, which let unsupported model ids pass validation and then crash
 * inside the SSE stream. The provider check is part of the same question:
 * "supported" is worthless to a caller if the request still 500s.
 */
export function isSupportedChatModel(
  modelId: string,
): modelId is SupportedChatModelID {
  const model = findSupportedChatModel(modelId);
  return model !== undefined && isImplementedProvider(model.provider);
}

export function resolveModel(modelId: string): ResolvedModel {
  const model = findSupportedChatModel(modelId);
  if (!model || !isImplementedProvider(model.provider)) {
    throw new Error(`Unsupported model: ${modelId}`);
  }
  return resolveSupportedModel(model);
}
