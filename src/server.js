import express from 'express';
import { config } from './config.js';
import { sportsScraper } from './scraper.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.get('/', (_req, res) => {
  res.json({
    name: 'XubiTV Sports Scraper',
    status: 'ok',
    endpoints: {
      events: '/api/sports/events',
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