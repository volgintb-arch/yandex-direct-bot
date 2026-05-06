import { GoogleGenAI, type Schema } from '@google/genai';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { db } from '../../lib/db.js';

const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

export type ModelTier = 'flash' | 'pro';

const MODEL_BY_TIER: Record<ModelTier, string> = {
  flash: config.GEMINI_MODEL_FLASH,
  pro: config.GEMINI_MODEL_PRO,
};

export interface GenerateOptions {
  /** Text prompt. */
  prompt: string;
  /** System instruction (persona, format rules). */
  system?: string;
  /** Sampling temperature (0..2). */
  temperature?: number;
  /** Force JSON output and validate against schema. */
  jsonSchema?: Schema;
  /** Image inputs as base64 + mime. */
  images?: { data: string; mimeType: string }[];
  /** Max output tokens. */
  maxOutputTokens?: number;
}

export async function generate(
  tier: ModelTier,
  opts: GenerateOptions
): Promise<string> {
  const model = MODEL_BY_TIER[tier];
  const start = Date.now();
  let errorMsg: string | undefined;
  let responseSize: number | undefined;

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: opts.prompt },
  ];
  for (const img of opts.images ?? []) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxOutputTokens,
        ...(opts.system && { systemInstruction: opts.system }),
        ...(opts.jsonSchema && {
          responseMimeType: 'application/json',
          responseSchema: opts.jsonSchema,
        }),
      },
    });

    const text = response.text;
    if (!text) {
      throw new ApiError('Gemini returned empty response', 'gemini');
    }
    responseSize = text.length;
    return text;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ tier, model, err: errorMsg }, 'gemini call failed');
    throw err;
  } finally {
    void db.apiCallLog
      .create({
        data: {
          service: 'gemini',
          endpoint: model,
          durationMs: Date.now() - start,
          error: errorMsg,
          requestSize: opts.prompt.length,
          responseSize,
        },
      })
      .catch(() => {});
  }
}

/** Generate and parse JSON in one shot. Pass a Schema in opts.jsonSchema for validation. */
export async function generateJson<T = unknown>(
  tier: ModelTier,
  opts: GenerateOptions
): Promise<T> {
  // Hint to AI — even without a schema we want JSON.
  const promptWithJsonHint = opts.jsonSchema
    ? opts.prompt
    : `${opts.prompt}\n\nReturn ONLY valid JSON with no markdown code fences.`;

  const text = await generate(tier, { ...opts, prompt: promptWithJsonHint });
  // Strip optional markdown fences in case the model adds them.
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    logger.error({ text: text.slice(0, 500), err }, 'failed to parse Gemini JSON');
    throw new ApiError('Gemini returned malformed JSON', 'gemini');
  }
}

/** Health check — minimal call to confirm model is reachable. */
export async function ping(tier: ModelTier = 'flash'): Promise<boolean> {
  try {
    const r = await generate(tier, {
      prompt: 'Ответь одним словом: pong',
      maxOutputTokens: 20,
      temperature: 0,
    });
    return r.toLowerCase().includes('pong');
  } catch {
    return false;
  }
}
