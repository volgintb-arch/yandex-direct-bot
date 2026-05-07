/**
 * Parse a free-form "create campaign" command.
 *
 * Examples:
 *   "создай поиск гео:Краснодар бюджет:1500"
 *   "создай поиск гео:Омск бюджет:2000 цена:600 ссылка:https://...
 *    Реклама квестов на день рождения для детей 10-14 лет"
 *   "/create search geo:Krasnodar budget:1500 cpl:800"
 *
 * Anything after the first newline (or after a "бриф:" / "brief:" marker) is the brief.
 */

export type CampaignKind = 'search' | 'network';

export interface ParsedCreateCampaign {
  kind: CampaignKind;
  geo?: string;
  budget?: number;
  cpl?: number;
  url?: string;
  brief?: string;
}

const TYPE_PATTERN = /(?:^|\s)(?:создай(?:те)?|создать|create|сделай)\s+(поиск(?:ов\w*)?|search|рся|rsya|network|сеть)/i;

const FIELDS: Array<{ key: keyof ParsedCreateCampaign; aliases: string[] }> = [
  { key: 'geo', aliases: ['гео', 'город', 'geo', 'city'] },
  { key: 'budget', aliases: ['бюджет', 'budget'] },
  { key: 'cpl', aliases: ['цена', 'cpl', 'cpa'] },
  { key: 'url', aliases: ['ссылка', 'url', 'link', 'href'] },
];

export function parseCreateCampaignCommand(rawText: string): ParsedCreateCampaign | null {
  if (!rawText) return null;
  const text = rawText.trim();

  const typeMatch = text.match(TYPE_PATTERN);
  if (!typeMatch) return null;

  const kindWord = typeMatch[1]!.toLowerCase();
  const kind: CampaignKind = /поиск|search/.test(kindWord) ? 'search' : 'network';

  // Split brief from params: brief is everything after first newline,
  // OR after explicit "бриф:" / "brief:" / "описание:" marker.
  let header = text;
  let brief: string | undefined;

  const briefMarker = text.match(/\n|\b(?:бриф|brief|описание)\s*:/i);
  if (briefMarker && briefMarker.index !== undefined) {
    header = text.slice(0, briefMarker.index).trim();
    const tail = text
      .slice(briefMarker.index + briefMarker[0].length)
      .trim();
    if (tail) brief = tail;
  }

  const result: ParsedCreateCampaign = { kind, brief };

  for (const field of FIELDS) {
    for (const alias of field.aliases) {
      // Match "field:value" — value is everything until next "word:" or end-of-line.
      const re = new RegExp(`\\b${alias}\\s*[:=]\\s*([^\\n]+?)(?=\\s+\\b\\w+\\s*[:=]|$)`, 'i');
      const m = header.match(re);
      if (m) {
        const raw = m[1]!.trim();
        if (field.key === 'budget' || field.key === 'cpl') {
          const num = parseInt(raw.replace(/[^\d]/g, ''), 10);
          if (!isNaN(num)) (result[field.key] as number) = num;
        } else if (field.key === 'geo') {
          result.geo = raw;
        } else if (field.key === 'url') {
          result.url = raw;
        }
        break;
      }
    }
  }

  return result;
}

/** What fields are still missing — used to decide what to ask the user. */
export function missingFields(p: ParsedCreateCampaign): Array<'geo' | 'budget' | 'brief'> {
  const missing: Array<'geo' | 'budget' | 'brief'> = [];
  if (!p.geo) missing.push('geo');
  if (!p.budget || p.budget <= 0) missing.push('budget');
  if (!p.brief || p.brief.length < 10) missing.push('brief');
  return missing;
}
