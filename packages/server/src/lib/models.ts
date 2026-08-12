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

const ANTROPIC_PROVIDER_OPTIONS: Partial<
  Record<AnthropicModelId, ProviderOptions>
> = {
  "claude-3-5-sonnet-20260319": {
    anthropic: {
      thinking: {
        type: "enabled",
        budgetTokens: 100000,
      },
    },
  },
};

export const OPENAI_PROVIDER_OPTIONS: Partial<
  Record<OpenAIModelId, ProviderOptions>
> = {
  "gpt-4o-mini": {
    openai: {
      thinking: {
        reasoningSummary: "detailed",
      },
    },
    "gpt-4o": {
      openai: {
        thinking: {
          reasoningSummary: "detailed",
        },
      },
    },
    "gpt-5.4-preview": {
      openai: {
        thinking: {
          reasoningSummary: "detailed",
        },
      },
    },
  },
};
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
    providerOptions: ANTROPIC_PROVIDER_OPTIONS[modelId],
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
