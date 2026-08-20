import {
  findSupportedChatModel,
  SUPPORTED_CHAT_MODELS,
  type ModelPricing,
} from "@codepilot/shared";
import type { LanguageModelUsage } from "ai";

type CalculateCreditsForUsagesParams = {
  provider: string;
  model: string;
  usages: LanguageModelUsage;
};

type BillableUsage = {
  credits: number;
};

type TokenCount = {
  inputTokens: number;
  outputTokens: number;
};

const TOKENS_PER_MILLION = 1_000_000;

const USD_PER_CREDIT = 0.01;

function getTokenCounts(usages: LanguageModelUsage): TokenCount {
  const inputTokens = usages.inputTokens;
  const outputTokens = usages.outputTokens;

  if (inputTokens === undefined || outputTokens === undefined) {
    throw new Error("Input and output tokens are required");
  }

  return {
    inputTokens,
    outputTokens,
  };
}

function getModelPricing(provider: string, modelId: string): ModelPricing {
  const supportedModel = findSupportedChatModel(modelId);

  if (!supportedModel || supportedModel.provider !== provider) {
    if (
      !SUPPORTED_CHAT_MODELS.some(
        (supportedModel) => supportedModel.provider === provider,
      )
    ) {
      throw new Error(`Unsupported provider: ${provider}`);
    }
    throw new Error(`Unsupported model: ${modelId}`);
  }

  return supportedModel.pricing;
}

function estimateCostUsd(
  { inputTokens, outputTokens }: TokenCount,
  pricing: ModelPricing,
) {
  return (
    (inputTokens * pricing.inputUSDPerMillionTokens +
      outputTokens * pricing.outputUSDPerMillionTokens) /
    TOKENS_PER_MILLION
  );
}

function convertUSDToCredits(estimatedCostUsd: number): number {
  if (estimatedCostUsd <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(estimatedCostUsd / USD_PER_CREDIT));
}


export function calculateCreditsForUsages({
  provider,
  model,
  usages,
}: CalculateCreditsForUsagesParams): BillableUsage {
  const tokenCounts = getTokenCounts(usages);
  const modelPricing = getModelPricing(provider, model);
  const estimatedCostUsd = estimateCostUsd(tokenCounts, modelPricing);
  const credits = convertUSDToCredits(estimatedCostUsd);
  return { credits };
}