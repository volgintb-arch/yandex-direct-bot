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

const KIND_REGEX = /(?:создай(?:те)?|создать|create|сделай)\s+(поиск\S*|search|рся|rsya|network|сеть)/i;

const ALIAS_TO_KEY: Record<string, 'geo' | 'budget' | 'cpl' | 'url'> = {
  гео: 'geo',
  город: 'geo',
  geo: 'geo',
  city: 'geo',
  бюджет: 'budget',
  budget: 'budget',
  цена: 'cpl',
  cpl: 'cpl',
  cpa: 'cpl',
  ссылка: 'url',
  url: 'url',
  link: 'url',
  href: 'url',
};

/**
 * Tokenize header by `key:value` pairs. We match `key:` markers, slice
 * the value as everything until the next marker — handles multi-word
 * Russian values (e.g. "гео:Нижний Новгород бюджет:1500").
 */
function parseHeader(header: string): {
  geo?: string;
  budget?: number;
  cpl?: number;
  url?: string;
} {
  const aliasPattern = Object.keys(ALIAS_TO_KEY).join('|');
  // global, case-insensitive — find every "alias:" marker
  const markerRe = new RegExp(`(?:^|\\s)(${aliasPattern})\\s*[:=]\\s*`, 'gi');
  type Marker = {
    key: 'geo' | 'budget' | 'cpl' | 'url';
    matchStart: number; // index where ` alias:` begins
    valueStart: number; // index where the value starts
  };
  const markers: Marker[] = [];

  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(header)) !== null) {
    const alias = m[1]!.toLowerCase();
    const key = ALIAS_TO_KEY[alias];
    if (key) {
      markers.push({ key, matchStart: m.index, valueStart: m.index + m[0].length });
    }
  }

  const result: { geo?: string; budget?: number; cpl?: number; url?: string } = {};
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.valueStart;
    const end = i + 1 < markers.length ? markers[i + 1]!.matchStart : header.length;
    const value = header.slice(start, end).trim();
    if (!value) continue;

    const key = markers[i]!.key;
    if (key === 'budget' || key === 'cpl') {
      const num = parseInt(value.replace(/[^\d]/g, ''), 10);
      if (!isNaN(num)) result[key] = num;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function parseCreateCampaignCommand(rawText: string): ParsedCreateCampaign | null {
  if (!rawText) return null;
  const text = rawText.trim();

  const typeMatch = text.match(KIND_REGEX);
  if (!typeMatch) return null;

  const kindWord = typeMatch[1]!.toLowerCase();
  const kind: CampaignKind = /поиск|search/.test(kindWord) ? 'search' : 'network';

  // Split brief from header
  let header = text;
  let brief: string | undefined;

  const briefMarker = text.match(/\n|\b(?:бриф|brief|описание)\s*:/i);
  if (briefMarker && briefMarker.index !== undefined) {
    header = text.slice(0, briefMarker.index).trim();
    const tail = text.slice(briefMarker.index + briefMarker[0].length).trim();
    if (tail) brief = tail;
  }

  const fields = parseHeader(header);

  return { kind, ...fields, brief };
}

/** What fields are still missing — used to decide what to ask the user. */
export function missingFields(p: ParsedCreateCampaign): Array<'geo' | 'budget' | 'brief'> {
  const missing: Array<'geo' | 'budget' | 'brief'> = [];
  if (!p.geo) missing.push('geo');
  if (!p.budget || p.budget <= 0) missing.push('budget');
  if (!p.brief || p.brief.length < 10) missing.push('brief');
  return missing;
}
