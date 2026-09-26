import { config } from './config.js';
import { scrapeEspnLeagues } from './sources/espn.js';
import { scrape365Scores } from './sources/365scores.js';
import { scrapeCricket } from './sources/cricket.js';
import { mergeEvents, pruneEvents } from './normalize.js';

class SportsScraper {
  constructor() {
    this.events = [];
    this.isSyncing = false;
    this.lastAttempt = null;
    this.lastSuccess = null;
    this.lastError = null;
    this.lastRunStats = { fetched: 0, live: 0, upcoming: 0, ended: 0, inserted: 0, updated: 0, removed: 0 };
  }

  async sync() {
    if (this.isSyncing) return { skipped: true, reason: 'sync already running' };
    this.isSyncing = true;
    this.lastAttempt = new Date().toISOString();
    const started = Date.now();
    try {
      const [scores365Result, espnResult, cricketResult] = await Promise.all([
        config.scores365Enabled
          ? scrape365Scores({ timeoutMs: config.requestTimeoutMs, timezone: config.timezone })
          : Promise.resolve({ events: [], errors: [] }),
        config.espnEnabled
          ? scrapeEspnLeagues(config.espnLeagues, { timeoutMs: config.requestTimeoutMs })
          : Promise.resolve({ events: [], errors: [] }),
        config.cricketEnabled
          ? scrapeCricket({ timeoutMs: config.requestTimeoutMs, region: config.cricketRegion, timezone: config.cricketTimezone })
          : Promise.resolve({ events: [], errors: [] })
      ]);
      const incoming = [...scores365Result.events, ...espnResult.events, ...cricketResult.events];
      const errors = [...scores365Result.errors, ...espnResult.errors, ...cricketResult.errors];

      const old = this.events;
      const oldIds = new Set(old.map(e => e.id));
      const merged = mergeEvents(old, incoming);
      const seen = new Set(incoming.map(e => e.id));
      const pruned = incoming.length > 0
        ? pruneEvents(merged, seen, Date.now(), config.staleRetentionMs, config.endedRetentionMs)
        : merged;

      const newIds = new Set(pruned.map(e => e.id));
      const inserted = pruned.filter(e => !oldIds.has(e.id)).length;
      const updated = pruned.filter(e => oldIds.has(e.id)).length;
      const removed = old.filter(e => !newIds.has(e.id)).length;

      this.events = sortEvents(pruned);
      this.lastSuccess = new Date().toISOString();
      this.lastError = errors.length ? errors.slice(0, 10) : null;
      this.lastRunStats = {
        fetched: incoming.length,
        live: this.events.filter(e => e.status === 'live').length,
        upcoming: this.events.filter(e => e.status === 'upcoming').length,
        ended: this.events.filter(e => e.status === 'ended').length,
        inserted,
        updated,
        removed,
        durationMs: Date.now() - started,
        upstreamErrors: errors.length
      };
      return { ok: true, ...this.lastRunStats, events: this.events };
    } catch (err) {
      this.lastError = [{ source: 'scraper', error: err?.message || String(err) }];
      return { ok: false, error: err?.message || String(err), events: this.events };
    } finally {
      this.isSyncing = false;
    }
  }

  snapshot() {
    return {
      ok: true,
      updatedAt: this.lastSuccess,
      lastAttempt: this.lastAttempt,
      lastError: this.lastError,
      syncing: this.isSyncing,
      count: this.events.length,
      liveCount: this.events.filter(e => e.status === 'live').length,
      upcomingCount: this.events.filter(e => e.status === 'upcoming').length,
      endedCount: this.events.filter(e => e.status === 'ended').length,
      stats: this.lastRunStats,
      events: this.events,
    };
  }
}

function sortEvents(events) {
  const order = { live: 0, upcoming: 1, ended: 2 };
  return [...events].sort((a, b) => {
    const s = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (s !== 0) return s;
    const ta = Date.parse(a.startTime || 0) || 0;
    const tb = Date.parse(b.startTime || 0) || 0;
    return ta - tb;
  });
}

export const sportsScraper = new SportsScraper();