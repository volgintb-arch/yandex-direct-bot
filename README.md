# Yandex Direct Bot

Telegram-бот для управления рекламой в Яндекс.Директ через ИИ (Gemini).

- **Стек:** Node 20 + TypeScript + grammy + Hono + Prisma + PostgreSQL + Gemini SDK
- **Порт:** 3004
- **Прод:** https://direct-bot.questlegends.ru (158.255.0.229)
- **Связанный проект:** [QuestLegends OS](../questlegends) — поставляет CRM-данные для ROI-обучения

## Структура

```
src/
├── server.ts            Hono entry: webhook + Mini App API
├── bot/                 Telegram-логика (grammy)
├── services/
│   ├── yandex-direct/   API v5 клиент
│   ├── wordstat/        Wordstat API
│   ├── ai/              Gemini Flash + Pro + Vision
│   ├── metrika/         Metrika Logs API → yclid mapping
│   ├── crm-questlegends/ Опрос /api/leads/by-yclid
│   └── knowledge/       База знаний ИИ
├── jobs/                Шедулер (node-cron)
├── miniapp-api/         API для Telegram Mini App
└── lib/                 config, db, logger
```

## Старт (локально)

```bash
# 1. Установить зависимости
npm install

# 2. Заполнить .env (см. .env.example)

# 3. Применить схему БД
npm run db:push

# 4. Запустить в dev-режиме
npm run dev
```

## Команды

```bash
npm run dev         # tsx watch
npm run build       # tsc
npm run start       # production (после build)
npm run db:push     # apply Prisma schema
npm run db:studio   # GUI для БД
npm run typecheck   # tsc --noEmit
```

## Деплой

См. [Phase 8 в плане](../questlegends/YANDEX_BOT_INTEGRATION_CONTRACT.md). Кратко:

```bash
docker compose up -d --build
```

## Контракт интеграции с CRM

Все детали в [YANDEX_BOT_INTEGRATION_CONTRACT.md](../questlegends/YANDEX_BOT_INTEGRATION_CONTRACT.md) в репозитории QuestLegends OS.
