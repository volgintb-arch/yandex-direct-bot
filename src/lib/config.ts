import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN required'),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
  TELEGRAM_USE_POLLING: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  // Bootstrap admin
  BOOTSTRAP_ADMIN_TG_ID: z.coerce.number().int().positive(),

  // Yandex Direct
  YANDEX_DIRECT_TOKEN: z.string().min(1),
  YANDEX_DIRECT_CLIENT_LOGIN: z.string().min(1),
  YANDEX_DIRECT_API_URL: z.string().url().default('https://api.direct.yandex.com/json/v5'),

  // Wordstat
  YANDEX_WORDSTAT_TOKEN: z.string().min(1),
  YANDEX_WORDSTAT_API_URL: z.string().url().default('https://api.wordstat.yandex.net/v1'),

  // Metrika (optional — needed only for Phase 6)
  YANDEX_METRIKA_TOKEN: z.string().optional(),
  YANDEX_METRIKA_COUNTER_ID: z.string().optional(),

  // YandexGPT (Foundation Models)
  YANDEX_GPT_API_KEY: z.string().min(1),
  YANDEX_CLOUD_FOLDER_ID: z.string().min(1),
  // DeepSeek V3.2 via Yandex AI Studio OpenAI-compatible endpoint (optional).
  // When set + AI_PRO_PROVIDER=deepseek, all 'pro' tier calls route here.
  DEEPSEEK_MODEL_URI: z.string().optional().default(''),
  AI_PRO_PROVIDER: z.enum(['yandex', 'deepseek']).default('yandex'),

  // CRM (QL OS)
  CRM_BASE_URL: z.string().url(),
  CRM_INTEGRATION_API_KEY: z.string().min(16),

  // Database
  DATABASE_URL: z.string().min(1),

  // Server
  PORT: z.coerce.number().int().default(3004),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Business profile
  BUSINESS_NAME: z.string().min(1),
  BUSINESS_DESCRIPTION: z.string().min(1),
  BUSINESS_SITE: z.string().url(),
  BUSINESS_AVG_CHECK: z.coerce.number().int(),
  BUSINESS_CITIES: z.string().min(1),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Pretty-print missing/invalid env at startup so we don't ship a broken bot.
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  ...parsed.data,
  businessCities: parsed.data.BUSINESS_CITIES.split(',').map((s) => s.trim()),
  isDev: parsed.data.NODE_ENV === 'development',
  isProd: parsed.data.NODE_ENV === 'production',
};

export type AppConfig = typeof config;
