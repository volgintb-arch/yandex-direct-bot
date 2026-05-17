import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { db } from '../../lib/db.js';

/**
 * DeepSeek V3.2 via Yandex AI Studio's OpenAI-compatible endpoint.
 *
 * - Endpoint: /v1/chat/completions (NOT /foundationModels/v1/completion)
 * - Model URI must be set in env (e.g. gpt://<folder>/deepseek-v32/latest)
 * - DeepSeek "thinks" before answering: response has reasoning_content
 *   (chain of thought) and content (final answer). Need large max_tokens
 *   so the final answer fits after the reasoning.
 */
const ENDPOINT = 'https://llm.api.cloud.yandex.net/v1/chat/completions';

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string;
    };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface DeepseekGenerateOptions {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Call DeepSeek with system + user message. Returns the final `content`,
 * stripping markdown fences. Reasoning is logged but not returned.
 */
export async function generate(opts: DeepseekGenerateOptions): Promise<string> {
  if (!config.DEEPSEEK_MODEL_URI) {
    throw new ApiError('DEEPSEEK_MODEL_URI is not configured', 'deepseek');
  }

  const messages: OpenAiMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.prompt });

  const payload = {
    model: config.DEEPSEEK_MODEL_URI,
    messages,
    temperature: opts.temperature ?? 0.5,
    // DeepSeek "thinks" before answering. Reasoning eats tokens — give
    // plenty so there's room for the actual final answer afterwards.
    max_tokens: Math.max(opts.maxTokens ?? 0, 12000),
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
        `DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}`,
        'deepseek',
        res.status
      );
    }

    const json = JSON.parse(text) as OpenAiResponse;
    const choice = json.choices?.[0];
    if (!choice) throw new ApiError('DeepSeek returned no choices', 'deepseek');

    const content = choice.message?.content;
    const reasoning = choice.message?.reasoning_content;
    const finish = choice.finish_reason;

    if (finish === 'length' && !content) {
      logger.warn(
        { reasoningPreview: reasoning?.slice(0, 200) },
        'DeepSeek hit token limit during reasoning, no final content'
      );
      throw new ApiError(
        'DeepSeek reached token limit before producing an answer (try simpler prompt or larger maxTokens)',
        'deepseek'
      );
    }

    if (!content) {
      throw new ApiError('DeepSeek returned empty content', 'deepseek');
    }
    return content;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errorMsg }, 'deepseek call failed');
    throw err;
  } finally {
    void db.apiCallLog
      .create({
        data: {
          service: 'deepseek',
          endpoint: 'v1/chat/completions',
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

/** Generate JSON, sanitising raw control chars in string literals. */
export async function generateJson<T = unknown>(opts: DeepseekGenerateOptions): Promise<T> {
  const text = await generate({
    ...opts,
    prompt: opts.prompt + '\n\nReturn ONLY valid JSON, no markdown fences, no commentary.',
  });
  const stripped = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const cleaned = sanitizeControlChars(stripped);
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    logger.error({ text: text.slice(0, 500), err }, 'failed to parse DeepSeek JSON');
    throw new ApiError('DeepSeek returned malformed JSON', 'deepseek');
  }
}

function sanitizeControlChars(text: string): string {
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
    if (ch === '\\') { out += ch; escapeNext = true; continue; }
    if (ch === '"') { out += ch; inString = !inString; continue; }
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

export async function ping(): Promise<boolean> {
  try {
    const r = await generate({ prompt: 'Ответь одним словом: pong', maxTokens: 200, temperature: 0 });
    return r.trim().length > 0;
  } catch {
    return false;
  }
}
