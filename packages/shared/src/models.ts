export type ModelPricing ={
    inputUSDPerMillionTokens: number;
    outputUSDPerMillionTokens: number;
}

export type SupportedProvider = "openai" | "anthropic" | "google" | "azure";

type SupportedChatModelDefinition = {
    provider: SupportedProvider;
    id: string;
    pricing: ModelPricing;
}

export const SUPPORTED_CHAT_MODELS = [
    {
        provider: "openai",
        id: "gpt-4o-mini",
        pricing: {
            inputUSDPerMillionTokens: 0.0015,
            outputUSDPerMillionTokens: 0.006,
        },
    },
    {
        provider: "openai",
        id: "gpt-4o",
        pricing: {
            inputUSDPerMillionTokens: 0.0015,
            outputUSDPerMillionTokens: 0.006,
        },
    },
    {
        provider: "openai",
        id: "gpt-5.4-preview",
        pricing: {
            inputUSDPerMillionTokens: 0.0015,
            outputUSDPerMillionTokens: 0.006,
        },
    },
    {
        provider: "anthropic",
        id: "claude-3-5-sonnet-20260319",
        pricing: {
            inputUSDPerMillionTokens: 0.0015,
            outputUSDPerMillionTokens: 0.006,
        },
    },
    {
        provider: "google",
        id: "gemini-2.5-flash",
        pricing: {
            inputUSDPerMillionTokens: 0.0015,
            outputUSDPerMillionTokens: 0.006,
        },
    },
    {
        provider: "azure",
        id: "gpt-4o-mini",
        pricing: {
            inputUSDPerMillionTokens: 0.0015,
            outputUSDPerMillionTokens: 0.006,
        },
    },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelID = SupportedChatModel["id"];


export function findSupportedChatModel(id: string): SupportedChatModel | undefined {
    return SUPPORTED_CHAT_MODELS.find(model => model.id === id);
}

export const DEFAULT_CHAT_MODEL_ID:SupportedChatModelID = "gpt-4o-mini";

