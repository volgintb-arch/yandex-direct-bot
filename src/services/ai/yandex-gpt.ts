import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { db } from '../../lib/db.js';

/**
 * Yandex Foundation Models — text completion API.
 * Docs: https://yandex.cloud/ru/docs/foundation-models/text-generation/api-ref/
 *
 * Tiers:
 *   - 'lite' → yandexgpt-lite/latest (fast, cheap, smaller context)
 *   - 'pro'  → yandexgpt/rc (5.1 Pro — best for creative + analysis)
 */

const ENDPOINT = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

export type ModelTier = 'lite' | 'pro';

const MODEL_NAME_BY_TIER: Record<ModelTier, string> = {
  lite: 'yandexgpt-lite/rc',
  pro: 'yandexgpt/rc', // 5.1 Pro
};

function modelUri(tier: ModelTier): string {
  return `gpt://${config.YANDEX_CLOUD_FOLDER_ID}/${MODEL_NAME_BY_TIER[tier]}`;
}

interface YgptMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

interface YgptResponse {
  result: {
    alternatives: Array<{
      message: { role: string; text: string };
      status: string;
    }>;
    usage?: { inputTextTokens: string; completionTokens: string; totalTokens: string };
    modelVersion?: string;
  };
}

export interface GenerateOptions {
  prompt: string;
  system?: string;
  temperature?: number; // 0..1
  maxTokens?: number;
  jsonObject?: boolean; // hint to AI for JSON output
}

export async function generate(tier: ModelTier, opts: GenerateOptions): Promise<string> {
  const messages: YgptMessage[] = [];
  if (opts.system) messages.push({ role: 'system', text: opts.system });
  messages.push({ role: 'user', text: opts.prompt });

  const payload = {
    modelUri: modelUri(tier),
    completionOptions: {
      stream: false,
      temperature: opts.temperature ?? 0.6,
      maxTokens: String(opts.maxTokens ?? 2000),
    },
    messages,
    ...(opts.jsonObject && { jsonObject: true }),
  };

  const start = Date.now();
  let status: number | undefined;
  let errorMsg: string | undefined;
  let responseSize: number | undefined;

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${config.YANDEX_GPT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    status = res.status;
    const text = await res.text();
    responseSize = text.length;

    if (!res.ok) {
      throw new ApiError(
        `YandexGPT HTTP ${res.status}: ${text.slice(0, 300)}`,
        'yandex_gpt',
        res.status
      );
    }

    const json = JSON.parse(text) as YgptResponse;
    const out = json.result?.alternatives?.[0]?.message?.text;
    if (!out) {
      throw new ApiError('YandexGPT returned empty response', 'yandex_gpt');
    }
    return out;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ tier, err: errorMsg }, 'yandex-gpt call failed');
    throw err;
  } finally {
    void db.apiCallLog
      .create({
        data: {
          service: 'yandex_gpt',
          endpoint: MODEL_NAME_BY_TIER[tier],
          status,
          durationMs: Date.now() - start,
          error: errorMsg,
          requestSize: opts.prompt.length,
          responseSize,
        },
      })
      .catch(() => {});
  }
}

/** Generate and parse JSON. Strips markdown fences if model wraps them. */
export async function generateJson<T = unknown>(
  tier: ModelTier,
  opts: GenerateOptions
): Promise<T> {
  const text = await generate(tier, { ...opts, jsonObject: true });
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    logger.error({ text: text.slice(0, 500), err }, 'failed to parse YandexGPT JSON');
    throw new ApiError('YandexGPT returned malformed JSON', 'yandex_gpt');
  }
}

/** Health check — minimal call. Returns true if model produces any non-empty response. */
export async function ping(tier: ModelTier = 'lite'): Promise<boolean> {
  try {
    const r = await generate(tier, {
      prompt: 'Скажи "pong"',
      maxTokens: 10,
      temperature: 0,
    });
    return r.trim().length > 0;
  } catch {
    return false;
  }
}
