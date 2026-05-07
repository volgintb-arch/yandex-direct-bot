import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { db } from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';

/**
 * Generate a short Russian description of an image for the РСЯ image bank.
 * Uses Yandex AI Studio multimodal endpoint (Gemma 3 27B).
 *
 * Returns null if vision is not available — caller treats as best-effort
 * (image will be saved without a description).
 */
const VISION_ENDPOINT =
  'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

const VISION_MODEL = 'gemma3-27b-it/latest'; // adjust if Yandex publishes a different URI

const SYSTEM_PROMPT = `Ты — копирайтер. Опиши картинку для базы рекламных креативов.

Формат ответа (только JSON, без markdown):
{
  "description": "1-2 коротких предложения, что на картинке: люди, действие, эмоция, обстановка, цветовая гамма",
  "tags": ["3-7 ключевых слов через запятую — атмосфера, аудитория, тематика"]
}`;

export interface ImageDescription {
  description: string;
  tags: string[];
}

/** Describe one image. base64 — without data:URL prefix. */
export async function describeImage(
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<ImageDescription | null> {
  const start = Date.now();
  let status: number | undefined;
  let errorMsg: string | undefined;

  try {
    const res = await fetch(VISION_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${config.YANDEX_GPT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modelUri: `gpt://${config.YANDEX_CLOUD_FOLDER_ID}/${VISION_MODEL}`,
        completionOptions: { stream: false, temperature: 0.3, maxTokens: '400' },
        messages: [
          {
            role: 'system',
            text: SYSTEM_PROMPT,
          },
          {
            role: 'user',
            // Some Yandex multimodal payloads use { image: ... }; fallback if shape differs.
            text: 'Опиши картинку.',
            image: { mimeType, data: imageBase64 },
          },
        ],
        jsonObject: true,
      }),
    });
    status = res.status;
    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(`Vision HTTP ${res.status}: ${text.slice(0, 200)}`, 'yandex_gpt', res.status);
    }
    const json = JSON.parse(text) as {
      result?: { alternatives?: Array<{ message?: { text?: string } }> };
    };
    const out = json.result?.alternatives?.[0]?.message?.text;
    if (!out) return null;
    const parsed = JSON.parse(out.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!parsed?.description) return null;
    return {
      description: String(parsed.description).trim(),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: unknown) => String(t)).slice(0, 10) : [],
    };
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: errorMsg }, 'vision describe failed (non-fatal)');
    return null;
  } finally {
    void db.apiCallLog
      .create({
        data: {
          service: 'yandex_gpt',
          endpoint: VISION_MODEL,
          status,
          durationMs: Date.now() - start,
          error: errorMsg,
          requestSize: imageBase64.length,
        },
      })
      .catch(() => {});
  }
}
