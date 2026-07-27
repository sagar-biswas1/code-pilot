import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
    findSupportedChatModel,
  type SupportedChatModel,
  type SupportedChatModelID,
  type SupportedProvider,
} from "@codepilot/shared";
import type { LanguageModel } from "ai";

type AnthropicModelId = Extract<
  SupportedChatModel,
  { provider: "anthropic" }
>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai" }>["id"];

export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: SupportedChatModelID;
};

type UnimplementedProvider = Exclude<
  SupportedChatModel["provider"],
  "anthropic" | "openai"
>;

function assertUnsupportedProvider(provider: UnimplementedProvider): never {
  throw new Error(`Unsupported provider: ${provider}`);
}

function resolveAnthropicModel(modelId: AnthropicModelId): ResolvedModel {
  return {
    model: anthropic(modelId),
    provider: "anthropic",
    modelId,
  };
}

function resolveOpenAIModel(modelId: OpenAIModelId): ResolvedModel {
  return {
    model: openai(modelId),
    provider: "openai",
    modelId,
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

export function isSupportedChatModel(
  modelId: string,
): modelId is SupportedChatModelID {
  return findSupportedChatModel(modelId) !== null;
}

export function resolveModel(modelId: string): ResolvedModel {
  if (!isSupportedChatModel(modelId)) {
    throw new Error(`Unsupported model: ${modelId}`);
  }
  return resolveSupportedModel(findSupportedChatModel(modelId)!);
}