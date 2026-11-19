export interface ModelListPrice {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export const MODEL_LIST_PRICES: Record<string, ModelListPrice> = {
  'gpt-5': { inputUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.125, outputUsdPerMillion: 10 },
  'gpt-5-mini': {
    inputUsdPerMillion: 0.25,
    cachedInputUsdPerMillion: 0.025,
    outputUsdPerMillion: 2,
  },
  'gpt-4o': { inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  'gpt-4o-mini': {
    inputUsdPerMillion: 0.15,
    cachedInputUsdPerMillion: 0.075,
    outputUsdPerMillion: 0.6,
  },
  'text-embedding-3-small': {
    inputUsdPerMillion: 0.02,
    cachedInputUsdPerMillion: 0.02,
    outputUsdPerMillion: 0,
  },
};

export interface BilledTokens {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
}

export function estimatedCostUsd(model: string, tokens: BilledTokens): number | null {
  const price = MODEL_LIST_PRICES[model.trim()];
  if (!price) return null;
  const cached = Math.min(tokens.cachedPromptTokens, tokens.promptTokens);
  const uncached = tokens.promptTokens - cached;
  return (
    (uncached * price.inputUsdPerMillion +
      cached * price.cachedInputUsdPerMillion +
      tokens.completionTokens * price.outputUsdPerMillion) /
    1_000_000
  );
}
