import { chromium } from 'playwright';
import { buildEvent, mapStatus, normalizeText } from '../normalize.js';

const HEADER_URL = (region, timezone) =>
  `https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=${encodeURIComponent(region)}&tz=${encodeURIComponent(timezone)}`;

const CORE_BASE = 'https://sports.core.api.espn.com/v2/sports/cricket/leagues';

function valueFrom(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function scrapeCricket({ timeoutMs, region, timezone }) {
  const browser = await chromium.launch({ headless: true });
  const request = await browser.request.newContext({
    extraHTTPHeaders: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'XubiTV-Sports-Scraper/1.0'
    }
  });
  const out = [];
  const errors = [];
  try {
    let header;
    try {
      const h = await request.get(HEADER_URL(region, timezone), { timeout: timeoutMs, failOnStatusCode: false });
      if (!h.ok()) throw new Error(`HTTP ${h.status()}`);
      header = await h.json();
    } catch (err) {
      errors.push({ source: 'espn-cricket-header', error: err?.message || String(err) });
      return { events: out, errors };
    }

    const leagues = header?.sports?.find(s => String(s?.name || '').toLowerCase().includes('cricket'))?.leagues
      || header?.sports?.[0]?.leagues
      || [];

    for (const league of leagues.slice(0, 80)) {
      const leagueId = league?.id;
      if (!leagueId) continue;
      try {
        const endpoint = `${CORE_BASE}/${encodeURIComponent(leagueId)}/events?limit=100`;
        const r = await request.get(endpoint, { timeout: timeoutMs, failOnStatusCode: false });
        if (!r.ok()) continue;
        const data = await r.json();
        const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.events) ? data.events : [];
        for (const item of items) {
          const ref = item?.$ref || item?.ref;
          let ev = item;
          if (ref) {
            const rr = await request.get(ref, { timeout: timeoutMs, failOnStatusCode: false });
            if (rr.ok()) ev = await rr.json();
          }
          const eventId = ev?.id || item?.id;
          if (!eventId) continue;
          const startTime = parseDate(valueFrom(ev, ['date', 'startDate', 'startTime']));
          const comp = ev?.competitions?.[0] || ev?.competition || {};
          const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
          const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
          const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
          const st = comp?.status || ev?.status || {};
          const status = mapStatus(st?.type?.state || st?.state, Boolean(st?.type?.completed || st?.completed));
          out.push(buildEvent({
            id: `espn-cricket-${leagueId}-${eventId}`,
            sportCategory: 'Cricket',
            tournament: normalizeText(league?.name || league?.shortName || `Cricket ${leagueId}`),
            title: normalizeText(ev?.name || ev?.shortName || `${home?.team?.displayName || home?.team?.name || 'TBA'} vs ${away?.team?.displayName || away?.team?.name || 'TBA'}`),
            startTime,
            status,
            teamA: { name: home?.team?.displayName || home?.team?.name || home?.name, logo: home?.team?.logo, score: valueFrom(home, ['score', 'displayValue']) },
            teamB: { name: away?.team?.displayName || away?.team?.name || away?.name, logo: away?.team?.logo, score: valueFrom(away, ['score', 'displayValue']) },
            badgeText: status === 'live' ? '🔴 LIVE NOW' : status === 'upcoming' ? '⏳ UPCOMING' : '🏁 ENDED',
            gameState: {
              ...(st?.displayClock ? { clock: String(st.displayClock) } : {}),
              ...(st?.period ? { period: String(st.period) } : {})
            },
            venue: comp?.venue?.fullName || comp?.venue?.displayName,
            source: 'espn-cricket',
            sourceUrl: `https://www.espncricinfo.com/series/${encodeURIComponent(String(league?.slug || leagueId))}`,
          }));
        }
      } catch (err) {
        errors.push({ source: `espn-cricket:${leagueId}`, error: err?.message || String(err) });
      }
    }
  } finally {
    await request.dispose();
    await browser.close();
  }
  return { events: dedupe(out), errors };
}

function dedupe(items) {
  const m = new Map();
  for (const item of items) m.set(item.id, item);
  return [...m.values()];
}