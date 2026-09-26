import { buildEvent, mapStatus, normalizeText } from '../normalize.js';

const BASE = 'https://webws.365scores.com/web/games/';
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

const SPORT_IDS = String(process.env.SPORTS365_IDS || '1,10')
  .split(',')
  .map(v => Number.parseInt(v.trim(), 10))
  .filter(Number.isFinite);

const DAYS_AHEAD = Math.max(1, Number.parseInt(process.env.SPORTS365_DAYS_AHEAD || '3', 10));

const headers = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
  Referer: 'https://www.365scores.com/',
  Origin: 'https://www.365scores.com',
};

function localDateParts(date = new Date(), timeZone = 'Asia/Dhaka') {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = type => p.find(x => x.type === type)?.value;
  return { day: Number(get('day')), month: Number(get('month')), year: Number(get('year')) };
}

function addDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + days);
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth() + 1,
    year: d.getUTCFullYear()
  };
}

function formatDate(parts) {
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

async function fetchJson(url, timeoutMs) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function statusFrom(game) {
  const text = String(game?.statusText || game?.shortStatusText || '').toLowerCase();
  const group = Number(game?.statusGroup);

  if (text.includes('cancel') || text.includes('postpon') || text.includes('abandon')) return 'ended';
  if (
    text.includes('live') ||
    text.includes('playing') ||
    text.includes('in progress') ||
    text.includes('half time') ||
    text === 'ht' ||
    /(^|\s)[12]h(\s|$)/.test(text) ||
    /^q[1-4]/.test(text)
  ) return 'live';
  if (group === 2) return 'upcoming';
  if (group >= 4) return 'ended';
  if (group === 1 || group === 3) return 'live';
  return 'upcoming';
}

function competitor(c) {
  if (!c) return { name: 'TBA' };
  return {
    name: normalizeText(c.name || c.shortName || c.longName || 'TBA'),
    ...(c.score !== undefined && c.score !== null && Number(c.score) >= 0 ? { score: String(c.score) } : {}),
  };
}

function gameState(game, status) {
  const state = {};
  if (game?.gameTimeDisplay) state.statusText = String(game.gameTimeDisplay);
  if (game?.gameTime !== undefined && game?.gameTime !== null && Number(game.gameTime) >= 0) {
    state.minute = String(game.gameTime);
  }
  if (game?.period !== undefined && game?.period !== null) state.period = String(game.period);
  if (game?.clock) state.clock = String(game.clock);
  if (status === 'live' && game?.statusText) state.statusText = String(game.statusText);
  if (game?.statusText && !state.statusText) state.statusText = String(game.statusText);
  return state;
}

function normalizeGame(game, sourceUrl) {
  const home = competitor(game?.homeCompetitor);
  const away = competitor(game?.awayCompetitor);
  const sport = SPORT_MAP[Number(game?.sportId)] || normalizeText(game?.sportName || 'Other');
  const competition = normalizeText(
    game?.competitionDisplayName ||
    game?.competition?.name ||
    game?.competitionName ||
    'Sports'
  );
  const status = statusFrom(game);

  return buildEvent({
    id: game?.id ? `365scores-${game.id}` : undefined,
    sportCategory: sport,
    tournament: competition,
    title: normalizeText(game?.name || `${home.name} vs ${away.name}`),
    startTime: game?.startTime || game?.startDate || game?.date,
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
  const tz = timezone || 'Asia/Dhaka';
  const today = localDateParts(new Date(), tz);
  const end = addDays(today, DAYS_AHEAD);
  const startDate = formatDate(today);
  const endDate = formatDate(end);

  for (const sportId of SPORT_IDS) {
    const params = new URLSearchParams({
      langId: '29',
      timezoneName: tz,
      userCountryId: '-1',
      appTypeId: '5',
      sports: String(sportId),
      startDate,
      endDate,
    });
    const url = `${BASE}?${params.toString()}`;

    try {
      const data = await fetchJson(url, timeoutMs);
      const games = Array.isArray(data?.games)
        ? data.games
        : Array.isArray(data?.data?.games)
          ? data.data.games
          : [];

      for (const game of games) {
        if (game?.id) all.push(normalizeGame(game, url));
      }
    } catch (err) {
      errors.push({
        source: `365scores:sport:${sportId}`,
        error: err?.message || String(err)
      });
    }
  }

  return { events: dedupe(all), errors };
}
