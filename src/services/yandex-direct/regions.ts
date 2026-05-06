import { direct } from './client.js';
import { db } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

export interface YandexRegion {
  GeoRegionId: number;
  GeoRegionName: string;
  GeoRegionType: string; // "Country" | "Region" | "City" | "Village" | ...
  ParentId?: number;
}

interface RegionsResponse {
  Regions: YandexRegion[];
}

/**
 * Sync the entire region dictionary from Yandex into local cache.
 * Run once at startup or daily — dictionary is huge (~150k entries).
 */
export async function syncRegions(): Promise<number> {
  const r = await direct<RegionsResponse>('dictionaries', 'get', {
    DictionaryNames: ['GeoRegions'],
  });
  const regions = r.Regions ?? [];
  if (regions.length === 0) {
    logger.warn('regions sync returned 0 entries');
    return 0;
  }

  // Upsert in chunks of 1000 to avoid huge transactions.
  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < regions.length; i += CHUNK) {
    const chunk = regions.slice(i, i + CHUNK);
    await db.$transaction(
      chunk.map((reg) =>
        db.regionCache.upsert({
          where: { yandexId: reg.GeoRegionId },
          create: {
            yandexId: reg.GeoRegionId,
            name: reg.GeoRegionName,
            parentId: reg.ParentId ?? null,
            type: reg.GeoRegionType,
          },
          update: {
            name: reg.GeoRegionName,
            parentId: reg.ParentId ?? null,
            type: reg.GeoRegionType,
            cachedAt: new Date(),
          },
        })
      )
    );
    written += chunk.length;
  }
  logger.info({ count: written }, 'regions synced');
  return written;
}

/**
 * Find a region by name (case-insensitive). Returns the most likely match —
 * prefers exact match, then City type, then Region type.
 */
export async function findRegionByName(name: string): Promise<{ yandexId: number; name: string } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const candidates = await db.regionCache.findMany({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
    take: 20,
  });

  if (candidates.length === 0) return null;

  const exact = candidates.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  const byPriority = (
    arr: typeof candidates
  ): typeof candidates[number] | undefined => {
    return (
      arr.find((c) => c.type === 'City') ??
      arr.find((c) => c.type === 'Region') ??
      arr[0]
    );
  };

  const winner = exact ?? byPriority(candidates);
  return winner ? { yandexId: winner.yandexId, name: winner.name } : null;
}

/** Get region by id (from cache). */
export async function getRegion(id: number): Promise<{ yandexId: number; name: string } | null> {
  const r = await db.regionCache.findUnique({ where: { yandexId: id } });
  return r ? { yandexId: r.yandexId, name: r.name } : null;
}

/** Ensure cache has at least basic data. */
export async function ensureRegionsCache(): Promise<void> {
  const count = await db.regionCache.count();
  if (count < 1000) {
    logger.info({ count }, 'region cache empty/small, syncing from Yandex');
    await syncRegions();
  }
}
