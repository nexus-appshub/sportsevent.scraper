# XubiTV Sports Scraper

Standalone Node.js + Playwright sports-event service for XubiTV.

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

This repo includes a Dockerfile based on the official Playwright image, so Chromium is already available.

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
CRICKET_ENABLED=true
CRICKET_REGION=bd
CRICKET_TIMEZONE=Asia/Dhaka
ESPN_LEAGUES=soccer:eng.1,soccer:esp.1,basketball:nba,baseball:mlb,icehockey:nhl,football:nfl
ADMIN_SYNC_TOKEN=

## XubiTV integration

Point XubiTV's server-side Sports Scraper URL to:

https://YOUR-RAILWAY-DOMAIN/api/sports/events

Do not make every client scrape the upstream sites. XubiTV should fetch this one API and continue using its existing realtime Firebase SportsEvent pipeline.

## Upstream notice

The included adapters use public/undocumented web endpoints and can change. Add or replace adapters under src/sources/ without changing the public XubiTV API contract.

Check the upstream provider's terms and applicable rules before production deployment or redistribution of data.