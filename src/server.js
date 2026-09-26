import express from 'express';
import { config } from './config.js';
import { sportsScraper } from './scraper.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// Public read-only CORS: allows a static/serverless frontend to fetch the scraper directly.
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/', (_req, res) => {
  res.json({
    name: 'XubiTV Sports Scraper',
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

app.get('/health', (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

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
  res.json(sportsScraper.snapshot());
});

app.post('/api/sports/sync', async (req, res) => {
  if (config.adminSyncToken) {
    const provided = req.get('x-admin-token') || req.body?.token || '';
    if (provided !== config.adminSyncToken) return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  res.setHeader('Cache-Control', 'no-store');
  const result = await sportsScraper.sync();
  res.status(result.ok === false ? 502 : 200).json({ success: result.ok !== false, ...result });
});

app.use((_req, res) => res.status(404).json({ success: false, error: 'Not found' }));

app.listen(config.port, config.host, () => {
  console.log(`XubiTV Sports Scraper listening on http://${config.host}:${config.port}`);
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