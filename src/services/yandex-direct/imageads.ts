import { direct } from './client.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

export interface AdImageSummary {
  AdImageHash: string;
  OriginalUrl?: string;
  PreviewUrl?: string;
  Name?: string;
  Type?: string; // REGULAR | WIDE | ...
  Subtype?: string;
  AssociatedWith?: string; // CAMPAIGN | AD | NONE
}

interface GetAdImagesResponse {
  AdImages?: AdImageSummary[];
}

/** List all images uploaded to the Direct account. */
export async function listAdImages(): Promise<AdImageSummary[]> {
  const r = await direct<GetAdImagesResponse>('adimages', 'get', {
    SelectionCriteria: {},
    FieldNames: ['AdImageHash', 'OriginalUrl', 'PreviewUrl', 'Name', 'Type', 'Subtype'],
  });
  return r.AdImages ?? [];
}

interface AddAdImagesResponse {
  AddResults: Array<{
    AdImageHash?: string;
    Errors?: Array<{ Code: number; Message: string; Details?: string }>;
    Warnings?: Array<{ Code: number; Message: string; Details?: string }>;
  }>;
}

function formatAdImageErrors(errors?: Array<{ Code: number; Message: string; Details?: string }>): string {
  if (!errors || errors.length === 0) return 'unknown';
  return errors
    .map((e) => `[${e.Code}] ${e.Message}${e.Details ? ' — ' + e.Details : ''}`)
    .join('; ');
}

/**
 * Upload an image to the Direct account image bank.
 * `imageData` is base64-encoded image content.
 * Direct accepts JPG/PNG/GIF, min 450×450 (REGULAR), max 10 MB.
 */
export async function uploadAdImage(input: {
  imageBase64: string;
  name?: string;
}): Promise<string> {
  const r = await direct<AddAdImagesResponse>('adimages', 'add', {
    AdImages: [
      {
        ImageData: input.imageBase64,
        Name: input.name,
      },
    ],
  });
  const result = r.AddResults?.[0];
  if (!result?.AdImageHash) {
    throw new Error(`Failed to upload image: ${formatAdImageErrors(result?.Errors)}`);
  }
  return result.AdImageHash;
}

interface DeleteResponse {
  DeleteResults: Array<{
    AdImageHash?: string;
    Errors?: Array<{ Code: number; Message: string; Details?: string }>;
  }>;
}

/** Delete an image from the Direct account. Fails if image is in use. */
export async function deleteAdImage(hash: string): Promise<void> {
  const r = await direct<DeleteResponse>('adimages', 'delete', {
    SelectionCriteria: { AdImageHashes: [hash] },
  });
  const result = r.DeleteResults?.[0];
  if (result?.Errors && result.Errors.length > 0) {
    const msg = result.Errors.map((e) => `[${e.Code}] ${e.Message}${e.Details ? ' — ' + e.Details : ''}`).join('; ');
    throw new Error(`Failed to delete image: ${msg}`);
  }
}

/**
 * Sync all images from Direct account into local YandexImage table.
 * Idempotent — preserves AI descriptions on rows that already exist.
 */
export async function syncImagesToDb(): Promise<{ synced: number; new: number }> {
  const remote = await listAdImages();
  const existing = await db.yandexImage.findMany({ select: { hash: true } });
  const existingSet = new Set(existing.map((r) => r.hash));

  let added = 0;
  for (const img of remote) {
    if (existingSet.has(img.AdImageHash)) {
      // Update non-text fields in case URL changed.
      await db.yandexImage.update({
        where: { hash: img.AdImageHash },
        data: {
          name: img.Name ?? null,
          format: img.Subtype ?? null,
          url: img.OriginalUrl ?? img.PreviewUrl ?? null,
          syncedAt: new Date(),
        },
      });
    } else {
      await db.yandexImage.create({
        data: {
          hash: img.AdImageHash,
          name: img.Name ?? null,
          format: img.Subtype ?? null,
          url: img.OriginalUrl ?? img.PreviewUrl ?? null,
        },
      });
      added++;
    }
  }
  logger.info({ remote: remote.length, added }, 'images synced');
  return { synced: remote.length, new: added };
}

/**
 * Pick image candidates for a network ad concept.
 * Currently — simple keyword overlap with description/tags/name; later can
 * use embeddings.  Returns at most `take` images, prioritising those with
 * AI descriptions.
 */
export async function findImagesForConcept(
  conceptText: string,
  take = 6
): Promise<Array<{ hash: string; description: string | null; url: string | null }>> {
  const all = await db.yandexImage.findMany({
    orderBy: [{ description: { sort: 'desc', nulls: 'last' } }, { syncedAt: 'desc' }],
  });
  if (all.length === 0) return [];

  const conceptLower = conceptText.toLowerCase();
  const conceptWords = new Set(
    conceptLower.split(/\s+/).filter((w) => w.length >= 4)
  );

  const scored = all.map((img) => {
    const haystack = [img.description ?? '', img.name ?? '', ...(img.tags ?? [])]
      .join(' ')
      .toLowerCase();
    let score = 0;
    for (const w of conceptWords) {
      if (haystack.includes(w)) score++;
    }
    return { img, score };
  });
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, take).map(({ img }) => ({
    hash: img.hash,
    description: img.description,
    url: img.url,
  }));
}
