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
const IMAGE_ENRICH_ENABLED = String(process.env.SPORTS365_IMAGE_ENRICH_ENABLED ?? 'true').toLowerCase() !== 'false';
const BANNER_ENRICH_LIMIT = Math.max(0, Number.parseInt(process.env.SPORTS365_BANNER_ENRICH_LIMIT || '12', 10));
const BANNER_CACHE_MS = Math.max(10 * 60_000, Number.parseInt(process.env.SPORTS365_BANNER_CACHE_MINUTES || '360', 10) * 60_000);

const bannerCache = new Map();

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

function firstUrl(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    if (typeof value === 'object') {
      const nested = firstUrl(
        value.url, value.href, value.src, value.imageUrl, value.image,
        value.imageUrlLarge, value.imageUrlSmall, value.logo, value.logoUrl
      );
      if (nested) return nested;
    }
  }
  return '';
}

function competitorLogo(c) {
  const direct = firstUrl(
    c?.logo, c?.logoUrl, c?.imageUrl, c?.image, c?.picture,
    c?.imageUrlLarge, c?.imageUrlSmall, c?.images, c?.media
  );
  if (direct) return direct;

  // 365Scores exposes competitor id + imageVersion; this mirrors its public image-cache pattern.
  const id = Number(c?.id);
  const version = Number(c?.imageVersion);
  if (Number.isFinite(id) && id > 0 && Number.isFinite(version) && version > 0) {
    return `https://imagecache.365scores.com/image/upload/f_png,w_128,h_128,c_limit,q_auto:eco,dpr_2,d_Competitors:default1.png/v${version}/Competitors/${id}`;
  }
  return '';
}

function competitor(c) {
  if (!c) return { name: 'TBA' };
  const logo = competitorLogo(c);
  return {
    name: normalizeText(c.name || c.shortName || c.longName || 'TBA'),
    ...(logo ? { logo } : {}),
    ...(c.score !== undefined && c.score !== null && Number(c.score) >= 0 ? { score: String(c.score) } : {}),
  };
}

function extractBannerUrl(game) {
  const direct = firstUrl(
    game?.bannerUrl, game?.banner, game?.eventBanner,
    game?.imageUrl, game?.image, game?.posterUrl, game?.poster,
    game?.media?.banner, game?.media?.image,
    game?.images, game?.media
  );
  if (direct) return direct;

  const competition = game?.competition || {};
  return firstUrl(
    competition?.bannerUrl, competition?.banner,
    competition?.imageUrl, competition?.image,
    competition?.logoUrl, competition?.logo,
    competition?.media?.banner, competition?.media?.image
  );
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
  const bannerUrl = extractBannerUrl(game);

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
    bannerUrl,
    gameState: gameState(game, status),
    venue: game?.venue?.name || game?.venueName,
    source: '365scores',
    sourceUrl: game?.url || game?.gameUrl || game?.link || game?.links?.find?.(x => /^https?:\/\//i.test(x?.href || x?.url || ''))?.href || sourceUrl,
    rawUpdatedAt: game?.lastUpdate || game?.updatedAt || null,
  });
}

function dedupe(games) {
  const map = new Map();
  for (const g of games) map.set(g.id, g);
  return [...map.values()];
}

async function fetchPageBanner(url, timeoutMs) {
  if (!url) return '';
  const cached = bannerCache.get(url);
  if (cached && Date.now() - cached.at < BANNER_CACHE_MS) return cached.value;

  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': headers['User-Agent'],
        Referer: 'https://www.365scores.com/',
      },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 8000)),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = (await r.text()).slice(0, 2_000_000);
    const matches = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ];
    let value = '';
    for (const re of matches) {
      const m = html.match(re);
      if (m?.[1] && /^https?:\/\//i.test(m[1])) {
        value = m[1].replaceAll('&amp;', '&');
        break;
      }
    }
    bannerCache.set(url, { at: Date.now(), value });
    return value;
  } catch {
    bannerCache.set(url, { at: Date.now(), value: '' });
    return '';
  }
}

async function enrichBanners(events, timeoutMs) {
  if (!IMAGE_ENRICH_ENABLED || BANNER_ENRICH_LIMIT <= 0) return events;

  const candidates = events
    .filter(e => !e.bannerUrl && e.sourceUrl && /\/(match|game)\//i.test(e.sourceUrl))
    .sort((a, b) => {
      const live = (b.status === 'live') - (a.status === 'live');
      if (live) return live;
      const ia = Number(a.importanceScore) || 0;
      const ib = Number(b.importanceScore) || 0;
      return ib - ia;
    })
    .slice(0, BANNER_ENRICH_LIMIT);

  const byId = new Map(events.map(e => [e.id, e]));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const event = candidates[cursor++];
      const bannerUrl = await fetchPageBanner(event.sourceUrl, timeoutMs);
      if (bannerUrl) byId.set(event.id, { ...event, bannerUrl });
    }
  });
  await Promise.all(workers);
  return [...byId.values()];
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

  const deduped = dedupe(all);
  const enriched = await enrichBanners(deduped, timeoutMs);
  return { events: enriched, errors };
}
