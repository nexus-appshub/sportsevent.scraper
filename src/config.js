import 'dotenv/config';

const asInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseLeagues = (raw) => String(raw || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean)
  .map(pair => {
    const [sport, league] = pair.split(':');
    return sport && league ? { sport, league } : null;
  })
  .filter(Boolean);

export const config = {
  port: asInt(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  timezone: process.env.TIMEZONE || 'Asia/Dhaka',
  refreshIntervalMs: asInt(process.env.REFRESH_INTERVAL_MS, 30000),
  liveRefreshIntervalMs: asInt(process.env.LIVE_REFRESH_INTERVAL_MS, 10000),
  requestTimeoutMs: asInt(process.env.REQUEST_TIMEOUT_MS, 12000),
  staleRetentionMs: asInt(process.env.STALE_RETENTION_MINUTES, 60) * 60_000,
  endedRetentionMs: asInt(process.env.ENDED_RETENTION_MINUTES, 360) * 60_000,
  adminSyncToken: process.env.ADMIN_SYNC_TOKEN || '',
  espnLeagues: parseLeagues(process.env.ESPN_LEAGUES),
  cricketEnabled: String(process.env.CRICKET_ENABLED ?? 'true').toLowerCase() !== 'false',
  cricketRegion: process.env.CRICKET_REGION || 'bd',
  cricketTimezone: process.env.CRICKET_TIMEZONE || 'Asia/Dhaka'
};