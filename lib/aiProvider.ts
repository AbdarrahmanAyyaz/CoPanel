import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { PROVIDER_DEFAULTS } from "./limits";

export type ProviderName = "gemini" | "anthropic";

function readGeminiKey(): string | undefined {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    undefined
  );
}

function readAnthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || undefined;
}

export function activeProvider(): ProviderName | "none" {
  if (readGeminiKey()) return "gemini";
  if (readAnthropicKey()) return "anthropic";
  return "none";
}

/**
 * Returns a Vercel AI SDK language model for the configured provider.
 * Prefers Gemini if its key is present; falls back to Anthropic; throws if neither.
 */
export function pickModel() {
  const geminiKey = readGeminiKey();
  if (geminiKey) {
    const google = createGoogleGenerativeAI({ apiKey: geminiKey });
    return google(PROVIDER_DEFAULTS.geminiModel);
  }
  const anthropicKey = readAnthropicKey();
  if (anthropicKey) {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    return anthropic(PROVIDER_DEFAULTS.anthropicModel);
  }
  throw new Error(
    "No AI provider key found. Set GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) for Gemini, or ANTHROPIC_API_KEY for Anthropic.",
  );
}
