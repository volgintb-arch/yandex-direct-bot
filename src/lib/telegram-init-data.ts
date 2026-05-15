import { createHmac } from 'node:crypto';
import { config } from './config.js';

/**
 * Validate Telegram WebApp initData per spec:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key = HMAC_SHA256("WebAppData", bot_token)
 *   data_check_string = key=value pairs (excl. hash) joined by \n, sorted
 *   expected_hash = HMAC_SHA256(secret_key, data_check_string).hex
 *
 * Returns parsed user data on success, null on failure.
 */
export interface TgWebAppUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgInitData {
  user: TgWebAppUser;
  authDate: Date;
  queryId?: string;
}

const MAX_AUTH_AGE_SECONDS = 24 * 3600; // 24h

export function validateInitData(initData: string): TgInitData | null {
  if (!initData) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // Build data_check_string
  const entries: string[] = [];
  for (const [k, v] of params.entries()) entries.push(`${k}=${v}`);
  entries.sort();
  const dataCheckString = entries.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(config.TELEGRAM_BOT_TOKEN).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (expectedHash !== hash) return null;

  // Freshness — reject ancient initData (replay attacks)
  const authDateRaw = parseInt(params.get('auth_date') ?? '0', 10);
  if (!authDateRaw) return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - authDateRaw;
  if (ageSeconds > MAX_AUTH_AGE_SECONDS) return null;

  // Parse user
  const userRaw = params.get('user');
  if (!userRaw) return null;
  let user: TgWebAppUser;
  try {
    user = JSON.parse(userRaw) as TgWebAppUser;
  } catch {
    return null;
  }
  if (!user || typeof user.id !== 'number') return null;

  return {
    user,
    authDate: new Date(authDateRaw * 1000),
    queryId: params.get('query_id') ?? undefined,
  };
}
