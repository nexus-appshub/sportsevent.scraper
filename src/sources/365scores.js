import { buildEvent, mapStatus, normalizeText } from '../normalize.js';

const BASE = 'https://webws.365scores.com/web/games';

const SPORT_MAP = {
  1: 'Football',
  2: 'Basketball',
  3: 'Tennis',
  4: 'Baseball',
  5: 'Hockey',
  6: 'American Football',
  7: 'Rugby',
  8: 'Handball',
  9: 'Volleyball',
  10: 'Cricket',
};

const headers = {
  Accept: 'application/json,text/plain,*/*',
  'User-Agent': 'Mozilla/5.0 (compatible; XubiTV-Sports-Scraper/1.1)',
  Referer: 'https://www.365scores.com/',
};

async function fetchJson(url, timeoutMs) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function statusFrom(game) {
  const text = String(game?.statusText || game?.shortStatusText || '').toLowerCase();
  if (text.includes('cancel') || text.includes('postpon')) return 'ended';
  if (text.includes('finish') || text.includes('ended') || text === 'ft' || text.includes('after')) return 'ended';
  if (text.includes('live') || text.includes('playing') || text.includes('half') || text.includes('period')) return 'live';
  if (game?.statusGroup === 2 || game?.statusGroup === 3) return 'live';
  if (game?.statusGroup >= 4) return 'ended';
  return 'upcoming';
}

function competitor(c) {
  return {
    name: normalizeText(c?.name || c?.shortName || c?.longName || 'TBA'),
    score: c?.score ?? c?.currentScore ?? c?.gameScore ?? undefined,
  };
}

function gameState(game, status) {
  const state = {};
  if (game?.gameTimeDisplay) state.statusText = String(game.gameTimeDisplay);
  if (game?.gameTime) state.minute = String(game.gameTime);
  if (game?.period) state.period = String(game.period);
  if (game?.clock) state.clock = String(game.clock);
  if (game?.currentPeriod) state.period = String(game.currentPeriod);
  if (status === 'live' && !state.statusText && game?.statusText) state.statusText = String(game.statusText);
  return state;
}

function normalizeGame(game, sourceUrl) {
  const home = competitor(game?.homeCompetitor || {});
  const away = competitor(game?.awayCompetitor || {});
  const sport = SPORT_MAP[Number(game?.sportId)] || normalizeText(game?.sportName || 'Other');
  const competition = normalizeText(
    game?.competitionDisplayName ||
    game?.competition?.name ||
    game?.competitionName ||
    'Sports'
  );
  const status = statusFrom(game);
  const start = game?.startTime || game?.startDate || game?.date;
  return buildEvent({
    id: game?.id ? `365scores-${game.id}` : undefined,
    sportCategory: sport,
    tournament: competition,
    title: normalizeText(game?.name || `${home.name} vs ${away.name}`),
    startTime: start,
    status,
    teamA: home,
    teamB: away,
    badgeText: status === 'live' ? '🔴 LIVE NOW' : status === 'upcoming' ? '⏳ UPCOMING' : '🏁 ENDED',
    gameState: gameState(game, status),
    venue: game?.venue?.name || game?.venueName,
    source: '365scores',
    sourceUrl: game?.url || sourceUrl,
    rawUpdatedAt: game?.lastUpdate || game?.updatedAt || null,
  });
}

function dedupe(games) {
  const map = new Map();
  for (const g of games) map.set(g.id, g);
  return [...map.values()];
}

export async function scrape365Scores({ timeoutMs, timezone }) {
  const errors = [];
  const all = [];
  const date = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    langId: '29',
    timezoneName: timezone || 'Asia/Dhaka',
    userCountryId: '-1',
    appTypeId: '5',
  });

  // 365Scores' web feed is tried in a few compatible modes because its consumer endpoint
  // names can vary between deployments.
  const candidates = [
    `${BASE}/current/?${params}`,
    `${BASE}/results/?${params}&startDate=${date}&endDate=${date}`,
  ];

  for (const url of candidates) {
    try {
      const data = await fetchJson(url, timeoutMs);
      const games = Array.isArray(data?.games)
        ? data.games
        : Array.isArray(data?.data)
          ? data.data
          : [];
      for (const game of games) all.push(normalizeGame(game, url));
      if (games.length > 0) break;
    } catch (err) {
      errors.push({ source: url, error: err?.message || String(err) });
    }
  }

  return { events: dedupe(all), errors };
}
