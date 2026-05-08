import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { db } from '../../lib/db.js';
import * as deepseek from './deepseek.js';

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
  // Route 'pro' tier to DeepSeek when configured.
  if (tier === 'pro' && config.AI_PRO_PROVIDER === 'deepseek' && config.DEEPSEEK_MODEL_URI) {
    return deepseek.generate({
      prompt: opts.prompt,
      system: opts.system,
      temperature: opts.temperature,
      maxTokens: Math.max(opts.maxTokens ?? 0, 4000),
    });
  }

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

/** Generate and parse JSON. Strips markdown fences and escapes raw control chars. */
export async function generateJson<T = unknown>(
  tier: ModelTier,
  opts: GenerateOptions
): Promise<T> {
  // Route 'pro' tier to DeepSeek when configured.
  if (tier === 'pro' && config.AI_PRO_PROVIDER === 'deepseek' && config.DEEPSEEK_MODEL_URI) {
    return deepseek.generateJson<T>({
      prompt: opts.prompt,
      system: opts.system,
      temperature: opts.temperature,
      maxTokens: Math.max(opts.maxTokens ?? 0, 4000),
    });
  }

  const text = await generate(tier, { ...opts, jsonObject: true });
  const stripped = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const cleaned = sanitizeJsonControlChars(stripped);
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    logger.error({ text: text.slice(0, 500), err }, 'failed to parse YandexGPT JSON');
    throw new ApiError('YandexGPT returned malformed JSON', 'yandex_gpt');
  }
}

/**
 * YandexGPT sometimes returns JSON with raw \n / \t / \r inside string literals,
 * which breaks JSON.parse. Walk the text and escape any 0x00..0x1F char that
 * appears inside a "string" (skipping content protected by backslash).
 */
function sanitizeJsonControlChars(text: string): string {
  let out = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const code = ch.charCodeAt(0);
    if (escapeNext) {
      out += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (inString && code < 0x20) {
      switch (ch) {
        case '\n': out += '\\n'; break;
        case '\r': out += '\\r'; break;
        case '\t': out += '\\t'; break;
        case '\b': out += '\\b'; break;
        case '\f': out += '\\f'; break;
        default: out += '\\u' + code.toString(16).padStart(4, '0');
      }
    } else {
      out += ch;
    }
  }
  return out;
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
