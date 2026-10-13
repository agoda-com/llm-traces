// Pricing in USD per 1M tokens.
// Source: LiteLLM model_prices_and_context_window.json (fetched 2026-03)
// https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json
const PRICING: Record<string, { input: number; output: number }> = {
  // ── Anthropic Claude ──────────────────────────────────────────────────────
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-6-20260205': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-opus-4-5-20251101': { input: 5, output: 25 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4-1-20250805': { input: 15, output: 75 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-4-opus-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-4-sonnet-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-3-7-sonnet-20250219': { input: 3, output: 15 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-sonnet-20240620': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-sonnet-20240229': { input: 3, output: 15 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  // Bedrock-hosted Anthropic (anthropic.xxx format)
  'anthropic.claude-3-5-sonnet-20241022-v2:0': { input: 3, output: 15 },
  'anthropic.claude-3-5-sonnet-20240620-v1:0': { input: 3, output: 15 },
  'anthropic.claude-3-5-haiku-20241022-v1:0': { input: 0.8, output: 4 },
  'anthropic.claude-3-7-sonnet-20250219-v1:0': { input: 3, output: 15 },
  'anthropic.claude-3-opus-20240229-v1:0': { input: 15, output: 75 },
  'anthropic.claude-3-sonnet-20240229-v1:0': { input: 3, output: 15 },
  'anthropic.claude-3-haiku-20240307-v1:0': { input: 0.25, output: 1.25 },
  'anthropic.claude-haiku-4-5-20251001-v1:0': { input: 1, output: 5 },
  'anthropic.claude-sonnet-4-20250514-v1:0': { input: 3, output: 15 },
  'anthropic.claude-sonnet-4-5-20250929-v1:0': { input: 3, output: 15 },
  'anthropic.claude-sonnet-4-6': { input: 3, output: 15 },
  'anthropic.claude-opus-4-20250514-v1:0': { input: 15, output: 75 },
  'anthropic.claude-opus-4-1-20250805-v1:0': { input: 15, output: 75 },
  'anthropic.claude-opus-4-5-20251101-v1:0': { input: 5, output: 25 },
  'anthropic.claude-opus-4-6-v1': { input: 5, output: 25 },
  // Bedrock cross-region inference profiles
  'us.anthropic.claude-3-5-sonnet-20241022-v2:0': { input: 3, output: 15 },
  'us.anthropic.claude-3-7-sonnet-20250219-v1:0': { input: 3, output: 15 },
  'us.anthropic.claude-3-haiku-20240307-v1:0': { input: 0.25, output: 1.25 },
  'us.anthropic.claude-3-opus-20240229-v1:0': { input: 15, output: 75 },
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': { input: 1.1, output: 5.5 },
  'us.anthropic.claude-sonnet-4-20250514-v1:0': { input: 3, output: 15 },
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': { input: 3.3, output: 16.5 },
  'us.anthropic.claude-sonnet-4-6': { input: 3.3, output: 16.5 },
  'us.anthropic.claude-opus-4-20250514-v1:0': { input: 15, output: 75 },
  'us.anthropic.claude-opus-4-1-20250805-v1:0': { input: 15, output: 75 },
  'us.anthropic.claude-opus-4-5-20251101-v1:0': { input: 5.5, output: 27.5 },
  'us.anthropic.claude-opus-4-6-v1': { input: 5.5, output: 27.5 },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-5-pro': { input: 15, output: 120 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-2025-04-14': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-mini-2025-04-14': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4.1-nano-2025-04-14': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-2024-08-06': { input: 2.5, output: 10 },
  'gpt-4o-2024-11-20': { input: 2.5, output: 10 },
  'gpt-4o-2024-05-13': { input: 5, output: 15 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.6 },
  'chatgpt-4o-latest': { input: 5, output: 15 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4-turbo-2024-04-09': { input: 10, output: 30 },
  'gpt-4-turbo-preview': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-4-0613': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gpt-3.5-turbo-0125': { input: 0.5, output: 1.5 },
  'gpt-3.5-turbo-1106': { input: 1, output: 2 },
  // Reasoning models
  'o1': { input: 15, output: 60 },
  'o1-2024-12-17': { input: 15, output: 60 },
  'o1-pro': { input: 150, output: 600 },
  'o3': { input: 2, output: 8 },
  'o3-2025-04-16': { input: 2, output: 8 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o3-mini-2025-01-31': { input: 1.1, output: 4.4 },
  'o3-pro': { input: 20, output: 80 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'o4-mini-2025-04-16': { input: 1.1, output: 4.4 },
  'codex-mini-latest': { input: 1.5, output: 6 },

  // ── Google Embeddings ─────────────────────────────────────────────────────
  'gemini-embedding-001': { input: 0.0, output: 0.0 },  // free in Gemini API
  'text-embedding-004': { input: 0.0, output: 0.0 },    // free in Gemini API
  // OpenAI embeddings
  'text-embedding-3-small': { input: 0.02, output: 0.0 },
  'text-embedding-3-large': { input: 0.13, output: 0.0 },
  'text-embedding-ada-002': { input: 0.1, output: 0.0 },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.0-flash-001': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.0-pro': { input: 0.5, output: 1.5 },
  'gemini-flash-latest': { input: 0.3, output: 2.5 },
  'gemini-pro-latest': { input: 1.25, output: 10 },

  // ── Mistral ───────────────────────────────────────────────────────────────
  'mistral-large-latest': { input: 2, output: 6 },
  'mistral-large-2407': { input: 2, output: 6 },
  'mistral-small-latest': { input: 0.1, output: 0.3 },
  'mistral-medium-latest': { input: 0.4, output: 2 },
  'mistral-7b-instruct': { input: 0.25, output: 0.25 },
  'mixtral-8x7b-instruct': { input: 0.7, output: 0.7 },
  'mixtral-8x22b-instruct': { input: 2, output: 6 },
  'codestral-latest': { input: 0.2, output: 0.6 },

  // ── Cohere ────────────────────────────────────────────────────────────────
  'command-a-03-2025': { input: 2.5, output: 10 },
  'command-r-plus': { input: 2.5, output: 10 },
  'command-r-plus-08-2024': { input: 2.5, output: 10 },
  'command-r': { input: 0.15, output: 0.6 },
  'command-r-08-2024': { input: 0.15, output: 0.6 },
  'command-r7b-12-2024': { input: 0.15, output: 0.0375 },
  'command': { input: 1, output: 2 },
  'command-light': { input: 0.3, output: 0.6 },

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  'deepseek-chat': { input: 0.28, output: 0.42 },
  'deepseek-reasoner': { input: 0.28, output: 0.42 },

  // ── Amazon Bedrock native models ──────────────────────────────────────────
  'amazon.nova-pro-v1:0': { input: 0.8, output: 3.2 },
  'amazon.nova-lite-v1:0': { input: 0.06, output: 0.24 },
  'amazon.nova-micro-v1:0': { input: 0.035, output: 0.14 },
  'amazon.titan-text-express-v1': { input: 1.3, output: 1.7 },
  'amazon.titan-text-lite-v1': { input: 0.3, output: 0.4 },
  'meta.llama3-3-70b-instruct-v1:0': { input: 0.72, output: 0.72 },
  'meta.llama3-1-405b-instruct-v1:0': { input: 5.32, output: 16 },
  'meta.llama3-1-70b-instruct-v1:0': { input: 0.99, output: 0.99 },
  'meta.llama3-1-8b-instruct-v1:0': { input: 0.22, output: 0.22 },
  'meta.llama3-2-90b-instruct-v1:0': { input: 2, output: 2 },
  'meta.llama3-2-11b-instruct-v1:0': { input: 0.35, output: 0.35 },
  'meta.llama3-2-3b-instruct-v1:0': { input: 0.15, output: 0.15 },
  'meta.llama3-2-1b-instruct-v1:0': { input: 0.1, output: 0.1 },
  'meta.llama4-maverick-17b-instruct-v1:0': { input: 0.24, output: 0.97 },
  'meta.llama4-scout-17b-instruct-v1:0': { input: 0.17, output: 0.66 },
  'mistral.mistral-large-2407-v1:0': { input: 3, output: 9 },
  'mistral.mixtral-8x7b-instruct-v0:1': { input: 0.45, output: 0.7 },
};

// Cache prices in USD per 1M tokens for the models above that have them: reads of cached input and
// writes to the cache. Source: the same LiteLLM file (cache_read_input_token_cost,
// cache_creation_input_token_cost). OpenAI and Google bill no separate cache write.
const CACHE_PRICING: Record<string, { read?: number; write?: number }> = {
'claude-opus-4-6': { read: 0.5, write: 6.25 },
  'claude-opus-4-6-20260205': { read: 0.5, write: 6.25 },
  'claude-opus-4-5': { read: 0.5, write: 6.25 },
  'claude-opus-4-5-20251101': { read: 0.5, write: 6.25 },
  'claude-sonnet-4-6': { read: 0.3, write: 3.75 },
  'claude-sonnet-4-5': { read: 0.3, write: 3.75 },
  'claude-sonnet-4-5-20250929': { read: 0.3, write: 3.75 },
  'claude-haiku-4-5': { read: 0.1, write: 1.25 },
  'claude-haiku-4-5-20251001': { read: 0.1, write: 1.25 },
  'anthropic.claude-3-5-sonnet-20241022-v2:0': { read: 0.3, write: 3.75 },
  'anthropic.claude-3-5-sonnet-20240620-v1:0': { read: 0.3, write: 3.75 },
  'anthropic.claude-3-5-haiku-20241022-v1:0': { read: 0.08, write: 1 },
  'anthropic.claude-3-7-sonnet-20250219-v1:0': { read: 0.3, write: 3.75 },
  'anthropic.claude-3-opus-20240229-v1:0': { read: 1.5, write: 18.75 },
  'anthropic.claude-haiku-4-5-20251001-v1:0': { read: 0.1, write: 1.25 },
  'anthropic.claude-sonnet-4-20250514-v1:0': { read: 0.3, write: 3.75 },
  'anthropic.claude-sonnet-4-5-20250929-v1:0': { read: 0.3, write: 3.75 },
  'anthropic.claude-sonnet-4-6': { read: 0.3, write: 3.75 },
  'anthropic.claude-opus-4-20250514-v1:0': { read: 1.5, write: 18.75 },
  'anthropic.claude-opus-4-1-20250805-v1:0': { read: 1.5, write: 18.75 },
  'anthropic.claude-opus-4-5-20251101-v1:0': { read: 0.5, write: 6.25 },
  'anthropic.claude-opus-4-6-v1': { read: 0.5, write: 6.25 },
  'us.anthropic.claude-3-5-sonnet-20241022-v2:0': { read: 0.3, write: 3.75 },
  'us.anthropic.claude-3-7-sonnet-20250219-v1:0': { read: 0.3, write: 3.75 },
  'us.anthropic.claude-3-opus-20240229-v1:0': { read: 1.5, write: 18.75 },
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': { read: 0.11, write: 1.375 },
  'us.anthropic.claude-sonnet-4-20250514-v1:0': { read: 0.3, write: 3.75 },
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': { read: 0.33, write: 4.125 },
  'us.anthropic.claude-sonnet-4-6': { read: 0.33, write: 4.125 },
  'us.anthropic.claude-opus-4-20250514-v1:0': { read: 1.5, write: 18.75 },
  'us.anthropic.claude-opus-4-1-20250805-v1:0': { read: 1.5, write: 18.75 },
  'us.anthropic.claude-opus-4-5-20251101-v1:0': { read: 0.55, write: 6.875 },
  'us.anthropic.claude-opus-4-6-v1': { read: 0.55, write: 6.875 },
  'gpt-5': { read: 0.125 },
  'gpt-5-mini': { read: 0.025 },
  'gpt-5-nano': { read: 0.005 },
  'gpt-4.1': { read: 0.5 },
  'gpt-4.1-2025-04-14': { read: 0.5 },
  'gpt-4.1-mini': { read: 0.1 },
  'gpt-4.1-mini-2025-04-14': { read: 0.1 },
  'gpt-4.1-nano': { read: 0.025 },
  'gpt-4.1-nano-2025-04-14': { read: 0.025 },
  'gpt-4o': { read: 1.25 },
  'gpt-4o-2024-08-06': { read: 1.25 },
  'gpt-4o-2024-11-20': { read: 1.25 },
  'gpt-4o-mini': { read: 0.075 },
  'gpt-4o-mini-2024-07-18': { read: 0.075 },
  'o1': { read: 7.5 },
  'o1-2024-12-17': { read: 7.5 },
  'o3': { read: 0.5 },
  'o3-2025-04-16': { read: 0.5 },
  'o3-mini': { read: 0.55 },
  'o3-mini-2025-01-31': { read: 0.55 },
  'o4-mini': { read: 0.275 },
  'o4-mini-2025-04-16': { read: 0.275 },
  'gemini-2.5-pro': { read: 0.125 },
  'gemini-2.5-flash': { read: 0.03 },
  'gemini-2.5-flash-lite': { read: 0.01 },
  'deepseek-chat': { read: 0.028 },
  'deepseek-reasoner': { read: 0.028 },
  'amazon.nova-pro-v1:0': { read: 0.2 },
  'amazon.nova-lite-v1:0': { read: 0.015 },
  'amazon.nova-micro-v1:0': { read: 0.00875 },
};

export interface CostEstimate {
  usd: number;
  // True when cached tokens were priced at the plain input rate because the table has no cache price for the model.
  approximate: boolean;
}

export interface CachedTokenCounts {
  cacheRead?: number;
  cacheWrite?: number;
}

function findPricingKey(model: string): string | undefined {
  const m = model.toLowerCase().replace(/^models\//, '');
  // Exact match first
  if (PRICING[m]) {
    return m;
  }
  // BUG-004: substring match with word-boundary check to prevent short keys like "o1", "o3",
  // "command" from matching inside longer unrelated model names (e.g. "my-recommender-o3-agent").
  // Keys are sorted longest-first so "gpt-4o-mini" still matches before "gpt-4o".
  const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  return keys.find((k) => {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-zA-Z0-9])' + escaped + '$').test(m);
  });
}

/**
 * Returns the estimated USD cost, or undefined if the model is unknown or no token count is available.
 * Input tokens include the cached ones (cache reads and cache writes), as the OTel GenAI conventions define
 * gen_ai.usage.input_tokens. Cached tokens are priced at the model's cache prices and only the rest at the
 * input price, so they are not charged twice.
 */
export function estimateCostDetailed(
  model: string,
  usage: CachedTokenCounts & { input?: number; output?: number }
): CostEstimate | undefined {
  // BUG-009: treat null as undefined so null token counts from coercion don't produce misleading $0
  const input = usage.input == null ? undefined : usage.input;
  const output = usage.output == null ? undefined : usage.output;
  // Cannot estimate cost when neither input nor output token counts are available
  if (input === undefined && output === undefined) { return undefined; }
  const key = findPricingKey(model);
  if (!key) { return undefined; }
  const price = PRICING[key];
  const cachePrice = CACHE_PRICING[key] ?? {};
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const uncachedInput = Math.max((input ?? 0) - cacheRead - cacheWrite, 0);
  const usd = (
    uncachedInput * price.input +
    cacheRead * (cachePrice.read ?? price.input) +
    cacheWrite * (cachePrice.write ?? price.input) +
    (output ?? 0) * price.output
  ) / 1_000_000;
  const approximate = (cacheRead > 0 && cachePrice.read === undefined) || (cacheWrite > 0 && cachePrice.write === undefined);
  return { usd, approximate };
}

/** Returns estimated USD cost, or undefined if model is unknown or both token counts are missing. */
export function estimateCost(model: string, inputTokens?: number, outputTokens?: number, cache: CachedTokenCounts = {}): number | undefined {
  return estimateCostDetailed(model, { input: inputTokens, output: outputTokens, ...cache })?.usd;
}

export function formatCost(usd: number): string {
  // BUG-010: handle negative values cleanly (e.g. credit adjustments)
  if (usd < 0) { return '-' + formatCost(-usd); }
  if (usd === 0) { return '$0'; }
  if (usd < 0.0001) { return '<$0.0001'; }
  if (usd < 0.01) { return `$${usd.toFixed(4)}`; }
  if (usd < 1) { return `$${usd.toFixed(3)}`; }
  return `$${usd.toFixed(2)}`;
}
