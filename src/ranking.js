import { normalizeText, slug } from './normalize.js';

const COMPETITION_WEIGHTS = [
  [/world cup|fifa world cup/, 100],
  [/uefa champions league|champions league/, 98],
  [/europa league|conference league/, 86],
  [/premier league|english premier league/, 90],
  [/la liga/, 88],
  [/serie a/, 86],
  [/bundesliga/, 86],
  [/ligue 1/, 80],
  [/copa america/, 92],
  [/euro(\s|$)|uefa european championship/, 95],
  [/afcon|african cup of nations/, 88],
  [/world cup qualifier|qualifier/, 78],
  [/club world cup/, 94],
  [/nations league/, 82],
  [/icc world cup/, 100],
  [/t20 world cup/, 98],
  [/champions trophy/, 94],
  [/asia cup/, 92],
  [/ipl|indian premier league/, 96],
  [/psl|pakistan super league/, 88],
  [/bbl|big bash/, 84],
  [/cpl|caribbean premier league/, 84],
  [/the hundred/, 80],
  [/test series|test match/, 82],
  [/odi|one day international/, 84],
  [/t20 international|t20i/, 86],
];

const POPULAR_TEAMS = [
  'real madrid', 'barcelona', 'manchester united', 'manchester city',
  'liverpool', 'arsenal', 'chelsea', 'tottenham', 'bayern munich',
  'borussia dortmund', 'juventus', 'ac milan', 'inter milan',
  'paris saint-germain', 'psg', 'atletico madrid',
  'argentina', 'brazil', 'france', 'england', 'germany', 'spain',
  'portugal', 'italy', 'netherlands',
  'india', 'australia', 'england', 'pakistan', 'bangladesh',
  'south africa', 'new zealand', 'sri lanka',
];

const MATCH_IMPORTANCE_TERMS = [
  [/final/, 28, 'Final'],
  [/semi[- ]?final/, 22, 'Semi-final'],
  [/quarter[- ]?final/, 16, 'Quarter-final'],
  [/third place|3rd place/, 8, 'Third-place match'],
  [/derby/, 16, 'Derby'],
  [/el clasico|el clásico|clasico/, 20, 'El Clasico'],
  [/decider|decisive/, 18, 'Decider'],
  [/play[- ]?off|playoff/, 12, 'Playoff'],
  [/knockout/, 10, 'Knockout'],
];

function textOf(event) {
  return normalizeText([
    event?.title,
    event?.tournament,
    event?.teamA?.name,
    event?.teamB?.name,
  ].filter(Boolean).join(' ')).toLowerCase();
}

function competitionScore(text) {
  for (const [pattern, score] of COMPETITION_WEIGHTS) {
    if (pattern.test(text)) return score;
  }
  return 45;
}

function teamScore(event) {
  const teams = [
    slug(event?.teamA?.name || '').replaceAll('-', ' '),
    slug(event?.teamB?.name || '').replaceAll('-', ' '),
  ];
  return Math.min(
    teams.reduce((sum, team) => sum + (POPULAR_TEAMS.includes(team) ? 8 : 0), 0),
    16
  );
}

function matchTermScore(text, reasons) {
  let score = 0;
  for (const [pattern, points, label] of MATCH_IMPORTANCE_TERMS) {
    if (pattern.test(text)) {
      score += points;
      reasons.push(label);
    }
  }
  return score;
}

function timingScore(event, now) {
  if (event?.status === 'live') return 32;
  if (event?.status !== 'upcoming') return 0;
  const start = Date.parse(event?.startTime || '');
  if (!Number.isFinite(start)) return 0;
  const hours = (start - now) / 3_600_000;
  if (hours < 0) return 0;
  if (hours <= 1) return 24;
  if (hours <= 3) return 18;
  if (hours <= 12) return 12;
  if (hours <= 24) return 8;
  if (hours <= 72) return 4;
  return 0;
}

export function calculateImportance(event, now = Date.now()) {
  const text = textOf(event);
  const reasons = [];
  const score = Math.min(
    100,
    competitionScore(text) * 0.55 +
    teamScore(event) +
    matchTermScore(text, reasons) +
    timingScore(event, now)
  );

  if (event?.status === 'live') reasons.unshift('Live now');
  if (competitionScore(text) >= 90) reasons.push('Major competition');
  if (teamScore(event) > 0) reasons.push('Popular team');

  return {
    score: Math.round(score),
    reasons: [...new Set(reasons)].slice(0, 5),
  };
}

export function rankEvents(events, now = Date.now()) {
  return [...events].map(event => {
    const importance = calculateImportance(event, now);
    return {
      ...event,
      importanceScore: importance.score,
      importanceReasons: importance.reasons,
    };
  }).sort((a, b) => {
    const statusOrder = { live: 0, upcoming: 1, ended: 2 };
    const statusDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;

    const scoreDiff = (b.importanceScore ?? 0) - (a.importanceScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;

    const ta = Date.parse(a.startTime || '') || 0;
    const tb = Date.parse(b.startTime || '') || 0;
    return ta - tb;
  });
}
