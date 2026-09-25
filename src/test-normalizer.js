import assert from 'node:assert/strict';
import { buildEvent, mergeEvents, pruneEvents } from './normalize.js';

const a = buildEvent({
  id: 'x',
  sportCategory: 'Football',
  tournament: 'Demo League',
  title: 'A vs B',
  startTime: '2026-09-26T00:00:00Z',
  status: 'live',
  teamA: { name: 'A', score: '1' },
  teamB: { name: 'B', score: '0' }
});
assert.equal(a.status, 'live');
assert.equal(a.teamA.score, '1');

const b = {
  ...a,
  teamA: { ...a.teamA, score: '2' },
  lastScrapedAt: new Date().toISOString()
};
const merged = mergeEvents([a], [b]);
assert.equal(merged[0].teamA.score, '2');

const kept = pruneEvents(merged, new Set(['x']), Date.now(), 1000, 1000);
assert.equal(kept.length, 1);

console.log('normalizer tests passed');