import express from 'express';
import { config } from './config.js';
import { sportsScraper } from './scraper.js';

const app = express();

const STATUS_ONLINE_GRACE_MS = 5 * 60_000;
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// Public read-only CORS: allows a static/serverless frontend to fetch the scraper directly.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Home Air TV Sports Scraper',
    status: 'ok',
    endpoints: {
      events: '/api/sports/events',
      live: '/api/sports/live',
      upcoming: '/api/sports/upcoming',
      ended: '/api/sports/ended',
      summary: '/api/sports/summary',
      status: '/api/sports/status',
      sync: 'POST /api/sports/sync'
    }
  });
});

app.get('/health', (_req, res) => res.json({
  success: true,
  ok: true,
  status: 'ONLINE',
  timestamp: new Date().toISOString()
}));

app.get('/api/sports/events', (req, res) => {
  const status = String(req.query.status || '').toLowerCase();
  const sport = String(req.query.sport || '').toLowerCase();
  const search = String(req.query.search || '').toLowerCase();
  let events = sportsScraper.events;
  if (status && ['live', 'upcoming', 'ended'].includes(status)) events = events.filter(e => e.status === status);
  if (sport && sport !== 'all') events = events.filter(e => e.sportCategory.toLowerCase() === sport);
  if (search) events = events.filter(e => `${e.title} ${e.tournament} ${e.teamA?.name} ${e.teamB?.name}`.toLowerCase().includes(search));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, updatedAt: sportsScraper.lastSuccess, count: events.length, events });
});

app.get('/api/sports/live', (_req, res) => {
  const events = sportsScraper.events.filter(e => e.status === 'live');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, updatedAt: sportsScraper.lastSuccess, count: events.length, events });
});

app.get('/api/sports/upcoming', (_req, res) => {
  const events = sportsScraper.events.filter(e => e.status === 'upcoming');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, updatedAt: sportsScraper.lastSuccess, count: events.length, events });
});

app.get('/api/sports/ended', (_req, res) => {
  const events = sportsScraper.events.filter(e => e.status === 'ended');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, updatedAt: sportsScraper.lastSuccess, count: events.length, events });
});

app.get('/api/sports/summary', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    updatedAt: sportsScraper.lastSuccess,
    total: sportsScraper.events.length,
    live: sportsScraper.events.filter(e => e.status === 'live').length,
    upcoming: sportsScraper.events.filter(e => e.status === 'upcoming').length,
    ended: sportsScraper.events.filter(e => e.status === 'ended').length,
    sports: [...new Set(sportsScraper.events.map(e => e.sportCategory).filter(Boolean))],
    tournaments: [...new Set(sportsScraper.events.map(e => e.tournament).filter(Boolean))],
    lastError: sportsScraper.lastError
  });
});

app.get('/api/sports/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const now = Date.now();
  const lastSuccessMs = sportsScraper.lastSuccess ? Date.parse(sportsScraper.lastSuccess) : 0;
  const online = Boolean(
    sportsScraper.lastSuccess &&
    (now - lastSuccessMs) <= Math.max(
      STATUS_ONLINE_GRACE_MS,
      config.refreshIntervalMs * 4,
      config.liveRefreshIntervalMs * 10
    )
  );
  const status = online ? 'ONLINE' : 'OFFLINE';

  res.json({
    success: true,
    status: {
      status,
      lastSuccessfulUpdate: sportsScraper.lastSuccess,
      totalEvents: sportsScraper.events.length,
      liveEvents: sportsScraper.events.filter(e => e.status === 'live').length,
      upcomingEvents: sportsScraper.events.filter(e => e.status === 'upcoming').length,
      endedEvents: sportsScraper.events.filter(e => e.status === 'ended').length
    },
    meta: {
      syncing: sportsScraper.isSyncing,
      lastAttempt: sportsScraper.lastAttempt,
      lastError: sportsScraper.lastError,
      updatedAt: sportsScraper.lastSuccess
    }
  });
});

app.post('/api/sports/sync', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (config.adminSyncToken) {
      const auth = req.get('authorization') || '';
      const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      const provided = req.get('x-admin-token') || bearer || req.body?.token || '';
      if (provided !== config.adminSyncToken) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Provide x-admin-token or Authorization: Bearer <ADMIN_SYNC_TOKEN>.'
        });
      }
    }

    const result = await sportsScraper.sync();

    if (result?.skipped) {
      return res.status(409).json({
        success: false,
        message: 'Scrape is already running',
        syncedCount: sportsScraper.events.length,
        updatedAt: sportsScraper.lastSuccess,
        syncing: true
      });
    }

    if (result?.ok === false) {
      return res.status(502).json({
        success: false,
        message: 'Scrape failed upstream; last known events were retained.',
        syncedCount: sportsScraper.events.length,
        updatedAt: sportsScraper.lastSuccess,
        error: result.error || sportsScraper.lastError
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Scrape completed successfully',
      syncedCount: sportsScraper.events.length,
      updatedAt: sportsScraper.lastSuccess,
      liveEvents: sportsScraper.events.filter(e => e.status === 'live').length,
      upcomingEvents: sportsScraper.events.filter(e => e.status === 'upcoming').length,
      endedEvents: sportsScraper.events.filter(e => e.status === 'ended').length,
      durationMs: result.durationMs || null,
      upstreamErrors: result.upstreamErrors || 0
    });
  } catch (error) {
    console.error('Manual sync route error:', error);
    return res.status(500).json({
      success: false,
      message: 'Manual scrape request failed.',
      syncedCount: sportsScraper.events.length,
      updatedAt: sportsScraper.lastSuccess,
      error: error?.message || String(error)
    });
  }
});

app.use((_req, res) => res.status(404).json({ success: false, error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled HTTP error:', err);
  if (res.headersSent) return;
  res.status(500).json({
    success: false,
    error: err?.message || 'Internal server error'
  });
});

app.listen(config.port, config.host, () => {
  console.log(`Home Air TV Sports Scraper listening on http://${config.host}:${config.port}`);
  console.log(`Configured ESPN leagues: ${config.espnLeagues.length}`);
  console.log(`Cricket discovery: ${config.cricketEnabled ? 'enabled' : 'disabled'}`);
  sportsScraper.sync().then(r => console.log('Initial sync:', JSON.stringify({ ok: r.ok, count: sportsScraper.events.length })));
});

let syncing = false;
const loop = async () => {
  if (syncing) return;
  syncing = true;
  try {
    await sportsScraper.sync();
  } finally {
    syncing = false;
  }
  const nextDelay = sportsScraper.events.some(e => e.status === 'live')
    ? config.liveRefreshIntervalMs
    : config.refreshIntervalMs;
  setTimeout(loop, nextDelay).unref();
};
setTimeout(loop, 1000).unref();