# Production deploy on 158.255.0.229

Domain: `direct-bot.questlegends.ru` (DNS A → 158.255.0.229).

Architecture:
```
HTTPS → nginx (host) → 127.0.0.1:3004 → Docker (host network) → Postgres (host:5432)
```

## One-time setup

### 1. Clone repo on the server

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/volgintb-arch/yandex-direct-bot.git
cd yandex-direct-bot
```

### 2. Provision the .env

Copy values from your dev `.env`. Key differences for production:

- `TELEGRAM_USE_POLLING=false` (set automatically by docker-compose.prod.yml)
- `NODE_ENV=production` (auto)
- `LOG_LEVEL=info` (auto)
- `DATABASE_URL=postgresql://yandex_bot:<PASS>@localhost:5432/yandex_bot`
- `CRM_BASE_URL=https://легендаобискателях.рф`
- All other tokens identical to dev

Place at `/var/www/yandex-direct-bot/.env`.

### 3. Build & run the container

```bash
cd /var/www/yandex-direct-bot
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The container will:
1. Run `prisma db push` against the local Postgres
2. Start the server on port 3004 (host network)

Verify: `curl http://127.0.0.1:3004/health`

### 4. nginx + Let's Encrypt

```bash
# Stage 1 — HTTP only
cp deploy/nginx-direct-bot.conf /etc/nginx/sites-available/direct-bot.questlegends.ru
ln -s /etc/nginx/sites-available/direct-bot.questlegends.ru /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Stage 2 — get cert + auto-rewrite to HTTPS
certbot --nginx -d direct-bot.questlegends.ru --non-interactive --agree-tos -m volgin.tb@gmail.com
```

### 5. Tell Telegram about the webhook

```bash
TOKEN=$(grep ^TELEGRAM_BOT_TOKEN /var/www/yandex-direct-bot/.env | cut -d= -f2)
SECRET=$(grep ^TELEGRAM_WEBHOOK_SECRET /var/www/yandex-direct-bot/.env | cut -d= -f2)

curl -s "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://direct-bot.questlegends.ru/api/telegram/webhook" \
  -d "secret_token=$SECRET" \
  -d "drop_pending_updates=true"
```

### 6. Verify

```bash
# Server side
docker compose ps
docker compose logs -f --tail=50

# Telegram side
curl "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
```

Then in Telegram: `/health` should return all green, `/start` should respond.

## Updates

```bash
cd /var/www/yandex-direct-bot
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
