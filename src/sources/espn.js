import { buildEvent, mapStatus, normalizeText } from '../normalize.js';

const SPORT_LABELS = {
  soccer: 'Football',
  basketball: 'Basketball',
  baseball: 'Baseball',
  icehockey: 'Hockey',
  nfl: 'American Football',
  football: 'American Football',
};

const SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

function headers() {
  return {
    Accept: 'application/json,text/plain,*/*',
    'User-Agent': 'XubiTV-Sports-Scraper/1.1',
  };
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: headers(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function eventState(comp) {
  const st = comp?.status || {};
  return mapStatus(st?.type?.state, Boolean(st?.type?.completed));
}

function clockState(comp) {
  const st = comp?.status || {};
  return {
    ...(st.displayClock ? { clock: String(st.displayClock) } : {}),
    ...(st.period ? { period: String(st.period) } : {}),
    ...(st.type?.description ? { statusText: String(st.type.description) } : {}),
  };
}

function detailsFromCompetition(comp) {
  return (comp?.details || []).map(d => ({
    type: d?.type?.text || '',
    clock: d?.clock?.displayValue || '',
    teamId: d?.team?.id || null,
    scoreValue: d?.scoreValue ?? null,
    scoringPlay: Boolean(d?.scoringPlay),
    redCard: Boolean(d?.redCard),
    yellowCard: Boolean(d?.yellowCard),
  })).filter(x => x.type || x.clock);
}

export async function scrapeEspnLeagues(leagues, { timeoutMs }) {
  const results = [];
  const errors = [];
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');

  for (const cfg of leagues) {
    const url = `${SCOREBOARD_BASE}/${encodeURIComponent(cfg.sport)}/${encodeURIComponent(cfg.league)}/scoreboard?dates=${today}`;
    try {
      const data = await fetchJson(url, timeoutMs);
      for (const event of Array.isArray(data?.events) ? data.events : []) {
        const comp = event?.competitions?.[0];
        const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
        const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
        const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
        const status = eventState(comp);
        const title = normalizeText(event?.name || `${home?.team?.displayName || 'TBA'} vs ${away?.team?.displayName || 'TBA'}`);
        const sportCategory = SPORT_LABELS[cfg.sport] || normalizeText(data?.leagues?.[0]?.name || cfg.sport);
        const tournament = normalizeText(data?.leagues?.[0]?.name || data?.leagues?.[0]?.abbreviation || cfg.league);
        const sourceUrl = event?.links?.find(l => Array.isArray(l?.rel) && l.rel.includes('desktop'))?.href || event?.links?.[0]?.href || url;

        results.push(buildEvent({
          id: `espn-${cfg.sport}-${cfg.league}-${event.id}`,
          sportCategory,
          tournament,
          title,
          startTime: event?.date,
          status,
          teamA: { name: home?.team?.displayName, logo: home?.team?.logo, score: home?.score },
          teamB: { name: away?.team?.displayName, logo: away?.team?.logo, score: away?.score },
          badgeText: status === 'live' ? '🔴 LIVE NOW' : status === 'upcoming' ? '⏳ UPCOMING' : '🏁 ENDED',
          gameState: clockState(comp),
          venue: comp?.venue?.fullName || comp?.venue?.displayName,
          source: 'espn',
          sourceUrl,
          details: detailsFromCompetition(comp),
          rawUpdatedAt: comp?.status?.type?.completed ? comp?.date : new Date().toISOString(),
        }));
      }
    } catch (err) {
      errors.push({ source: `espn:${cfg.sport}:${cfg.league}`, error: err?.message || String(err) });
    }
  }

  return { events: results, errors };
}