# Home Air TV Sports Scraper

Standalone Node.js sports-event service for Home Air TV.

## Scope

Only **Football** and **Cricket** events are allowed into the public event store. Other sports are filtered out even if an upstream adapter returns them.

## What it does

- Polls configured public sports feeds through replaceable adapters.
- Normalizes events into a single JSON shape.
- Supports live, upcoming and ended states.
- Extracts team names, logos, scores and live game state when upstream exposes them.
- Keeps last-known-good events if an upstream temporarily fails.
- Deduplicates events using stable IDs.
- Refreshes more frequently while live matches exist.

## API

GET /health

GET /api/sports/events

GET /api/sports/events?status=live

GET /api/sports/events?sport=Football

GET /api/sports/status

POST /api/sports/sync

If ADMIN_SYNC_TOKEN is configured, POST /api/sports/sync requires x-admin-token.

## Railway deployment

This repo uses a lightweight Node.js Docker runtime. The production scraper does not launch Chromium; it fetches the configured upstream sports JSON feeds directly, which avoids browser/thread resource limits on Railway.

Railway can deploy directly from this repository.

Recommended service settings:
- Build: Dockerfile
- Start command: handled by Dockerfile
- Port: use Railway's injected PORT automatically

Optional variables:
PORT=3000
TIMEZONE=Asia/Dhaka
REFRESH_INTERVAL_MS=30000
LIVE_REFRESH_INTERVAL_MS=10000
REQUEST_TIMEOUT_MS=12000
STALE_RETENTION_MINUTES=60
ENDED_RETENTION_MINUTES=360
CRICKET_ENABLED=false
SCORES365_ENABLED=true
SPORTS365_IDS=1,10
CRICKET_REGION=bd
CRICKET_TIMEZONE=Asia/Dhaka
ESPN_LEAGUES=soccer:eng.1,soccer:esp.1,football:nfl
ADMIN_SYNC_TOKEN=

## Home Air TV integration

Point Home Air TV's server-side Sports Scraper URL to:

https://YOUR-RAILWAY-DOMAIN/api/sports/events

Do not make every client scrape the upstream sites. Home Air TV should fetch this one API and continue using its existing realtime Firebase SportsEvent pipeline.

## Upstream notice

The default source is a 365Scores web data adapter restricted to Football (sport ID 1) and Cricket (sport ID 10), with ESPN adapters available but disabled by default because the ESPN endpoints returned HTTP 403 from the Railway runtime during testing. Add or replace adapters under src/sources/ without changing the public Home Air TV API contract.

Check the upstream provider's terms and applicable rules before production deployment or redistribution of data.