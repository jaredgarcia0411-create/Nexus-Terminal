// Per-model LLM pricing for cost accounting.
// Rates are cents per 1M tokens. Source: provider public pricing page.
// Update when Groq (or a future provider) publishes new rates, or when a
// new model is added to the rotation.

interface ModelRate {
  inputCentsPerMToken: number;
  outputCentsPerMToken: number;
}

export const MODEL_PRICING: Record<string, ModelRate> = {
  'llama-3.3-70b-versatile': {
    inputCentsPerMToken: 59,
    outputCentsPerMToken: 79,
  },
};

// Warn-once cache: prevents a blueprint that retries N times on an unknown
// model from spamming N identical warnings. Each cold start resets the set,
// which is intentional — fresh warnings on every deploy surface any new
// unknown model at least once.
const warnedModels = new Set<string>();

function warnUnknownModelOnce(model: string): void {
  if (warnedModels.has(model)) return;
  warnedModels.add(model);
  console.warn(
    `[model-pricing] Unknown model "${model}" — logging cost as 0. Add it to MODEL_PRICING in lib/agents/model-pricing.ts.`,
  );
}

/** Test-only: reset the warn-once cache between vitest cases. */
export function __resetWarnedModelsForTests(): void {
  warnedModels.clear();
}

/**
 * Cost in cents for a completed LLM call. Returns a float — fractional
 * cents are preserved so budget sums trip at the right threshold.
 * Unknown model → warns once per model per process and returns 0.
 */
export function estimateCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = MODEL_PRICING[model];
  if (!rate) {
    warnUnknownModelOnce(model);
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * rate.inputCentsPerMToken;
  const outputCost = (outputTokens / 1_000_000) * rate.outputCentsPerMToken;
  return inputCost + outputCost;
}
