import { db } from '../../lib/db.js';

export interface KnowledgeContext {
  rules: string | null;
  topAds: Array<{ title1: string; title2?: string; text: string; ctr: number }>;
  failures: string | null;
  documents: string | null;
}

/**
 * Pull current knowledge for AI context. Filters by scope and city.
 * Returns the latest active entries — no hard limit, but typically used
 * with truncation downstream.
 */
export async function getKnowledgeContext(opts: {
  scope: 'search' | 'network';
  city?: string;
}): Promise<KnowledgeContext> {
  const cityFilter = opts.city ? [{ city: opts.city }, { city: null }] : [{ city: null }];

  const [rulesEntries, topAdEntries, failureEntries, documentEntries] = await Promise.all([
    db.knowledgeEntry.findMany({
      where: {
        type: 'learned_rules',
        isActive: true,
        scope: { in: [opts.scope, 'global'] },
        OR: cityFilter,
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    db.knowledgeEntry.findMany({
      where: {
        type: 'top_ad',
        isActive: true,
        scope: { in: [opts.scope, 'global'] },
        OR: cityFilter,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.knowledgeEntry.findMany({
      where: {
        type: 'failure_pattern',
        isActive: true,
        scope: { in: [opts.scope, 'global'] },
        OR: cityFilter,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    db.knowledgeEntry.findMany({
      where: {
        type: 'document',
        isActive: true,
        scope: { in: [opts.scope, 'global'] },
        OR: cityFilter,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  // Concatenate rules text
  const rules = rulesEntries.length
    ? rulesEntries
        .map((e) => {
          const data = e.data as { rules?: string; text?: string };
          return data.rules ?? data.text ?? '';
        })
        .filter(Boolean)
        .join('\n\n')
    : null;

  // Extract top ads
  const topAds = topAdEntries
    .map((e) => {
      const d = e.data as {
        title1?: string;
        title2?: string;
        text?: string;
        ctr?: number;
      };
      if (!d.title1 || !d.text || typeof d.ctr !== 'number') return null;
      return { title1: d.title1, title2: d.title2, text: d.text, ctr: d.ctr };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const failures = failureEntries.length
    ? failureEntries
        .map((e) => {
          const data = e.data as { pattern?: string; text?: string };
          return data.pattern ?? data.text ?? '';
        })
        .filter(Boolean)
        .join('\n')
    : null;

  // User-uploaded documents (briefs, offers, descriptions of services etc).
  const documents = documentEntries.length
    ? documentEntries
        .map((e) => {
          const d = e.data as { name?: string; text?: string };
          if (!d.text) return '';
          const heading = d.name ? `### ${d.name}\n` : '';
          return heading + d.text.slice(0, 3000);
        })
        .filter(Boolean)
        .join('\n\n')
    : null;

  return { rules, topAds, failures, documents };
}

/** Save a knowledge entry. Append-only — old entries stay (with isActive flag). */
export async function saveKnowledge(input: {
  type: 'learned_rules' | 'top_ad' | 'insight' | 'failure_pattern';
  scope: 'search' | 'network' | 'global';
  city?: string;
  data: Record<string, unknown>;
  generatedBy: string;
}): Promise<void> {
  await db.knowledgeEntry.create({
    data: {
      type: input.type,
      scope: input.scope,
      city: input.city ?? null,
      data: input.data as object,
      generatedBy: input.generatedBy,
    },
  });
}
