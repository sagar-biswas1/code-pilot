export type ModelPricing = {
  inputUSDPerMillionTokens: number;
  outputUSDPerMillionTokens: number;
};

export type SupportedProvider = "openai" | "anthropic" | "google" | "azure";

type SupportedChatModelDefinition = {
  provider: SupportedProvider;
  id: string;
  pricing: ModelPricing;
};

/**
 * The models this product will bill for, and what they cost.
 *
 * Two things to keep true when editing this list:
 *
 * **Prices are per *million* tokens.** `credits.ts` divides by 1,000,000, so a
 * per-token figure entered here undercharges by six orders of magnitude — and
 * because credits are floored at 1, the damage is invisible: every turn simply
 * bills one credit regardless of size.
 *
 * **Ids are unique.** `findSupportedChatModel` looks a model up by id alone
 * (that is all the CLI sends), so two entries sharing an id would make the
 * second unreachable and its provider unresolvable.
 */
export const SUPPORTED_CHAT_MODELS = [
  {
    provider: "openai",
    id: "gpt-4o-mini",
    pricing: {
      inputUSDPerMillionTokens: 0.15,
      outputUSDPerMillionTokens: 0.6,
    },
  },
  {
    provider: "openai",
    id: "gpt-4o",
    pricing: {
      inputUSDPerMillionTokens: 2.5,
      outputUSDPerMillionTokens: 10.0,
    },
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5",
    pricing: {
      inputUSDPerMillionTokens: 3.0,
      outputUSDPerMillionTokens: 15.0,
    },
  },
  {
    provider: "anthropic",
    id: "claude-opus-5",
    pricing: {
      inputUSDPerMillionTokens: 5.0,
      outputUSDPerMillionTokens: 25.0,
    },
  },
  {
    provider: "anthropic",
    id: "claude-haiku-4-5",
    pricing: {
      inputUSDPerMillionTokens: 1.0,
      outputUSDPerMillionTokens: 5.0,
    },
  },
  // Listed so the UI can offer it, but `packages/server/src/lib/models.ts` has
  // no SDK wired up for Google — requests naming it are rejected at validation
  // time rather than failing mid-stream.
  {
    provider: "google",
    id: "gemini-2.5-flash",
    pricing: {
      inputUSDPerMillionTokens: 0.3,
      outputUSDPerMillionTokens: 2.5,
    },
  },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelID = SupportedChatModel["id"];

export function findSupportedChatModel(
  id: string,
): SupportedChatModel | undefined {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === id);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelID = "gpt-4o-mini";
