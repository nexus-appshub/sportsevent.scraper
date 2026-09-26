import crypto from 'node:crypto';

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function slug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function deterministicId(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}

export function mapStatus(state, completed) {
  const s = String(state || '').toLowerCase();
  if (completed || s === 'post' || s.includes('final') || s.includes('ended')) return 'ended';
  if (s === 'in' || s === 'live' || s.includes('in-progress') || s.includes('halftime') || s.includes('playing')) return 'live';
  return 'upcoming';
}

export function buildEvent({
  id,
  sportCategory,
  tournament,
  title,
  startTime,
  status,
  teamA,
  teamB,
  badgeText,
  bannerUrl,
  gameState,
  venue,
  source,
  sourceUrl,
  details = [],
  rawUpdatedAt,
}) {
  const stableId = id || deterministicId([
    sportCategory,
    tournament,
    slug(teamA?.name),
    slug(teamB?.name),
    startTime || title,
  ]);
  const live = status === 'live';
  const safeTeam = t => ({
    name: normalizeText(t?.name || 'TBA'),
    ...(t?.logo ? { logo: String(t.logo) } : {}),
    ...(t?.score !== undefined && t?.score !== null ? { score: String(t.score) } : {})
  });

  return {
    id: stableId,
    title: normalizeText(title || `${teamA?.name || 'TBA'} vs ${teamB?.name || 'TBA'}`),
    sportCategory: normalizeText(sportCategory || 'Other'),
    tournament: normalizeText(tournament || 'Sports'),
    teamA: safeTeam(teamA),
    teamB: safeTeam(teamB),
    status,
    ...(startTime ? { startTime: new Date(startTime).toISOString() } : {}),
    badgeText: badgeText || (live ? '🔴 LIVE NOW' : status === 'upcoming' ? '⏳ UPCOMING' : '🏁 ENDED'),
    ...(bannerUrl ? { bannerUrl: String(bannerUrl) } : {}),
    description: venue ? `Venue: ${normalizeText(venue)}` : '',
    servers: [],
    isPinned: false,
    isActive: status !== 'ended',
    source: source || 'scraper',
    sourceUrl: sourceUrl || '',
    gameState: gameState || {},
    details: Array.isArray(details) ? details.slice(0, 50) : [],
    lastScrapedAt: new Date().toISOString(),
    upstreamUpdatedAt: rawUpdatedAt || null,
  };
}

export function mergeEvents(existing, incoming, now = Date.now()) {
  const byId = new Map(existing.map(e => [e.id, e]));
  for (const event of incoming) {
    const prev = byId.get(event.id);
    byId.set(event.id, { ...prev, ...event, lastScrapedAt: new Date(now).toISOString() });
  }
  return [...byId.values()];
}

export function pruneEvents(events, seenIds, now = Date.now(), staleRetentionMs, endedRetentionMs) {
  return events.filter(ev => {
    const last = Date.parse(ev.lastScrapedAt || ev.updatedAt || ev.createdAt || 0) || now;
    const age = now - last;
    if (seenIds.has(ev.id)) return true;
    if (ev.status === 'ended') return age <= endedRetentionMs;
    return age <= staleRetentionMs;
  });
}