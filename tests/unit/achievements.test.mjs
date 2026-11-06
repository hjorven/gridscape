import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAchievements, activeRuns } from '../../js/achievements.js';

function series(start, counts) {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return counts.map((c, i) => ({ date: new Date(t0 + i * 86400000).toISOString().slice(0, 10), count: c }));
}
const get = (list, id) => list.find((a) => a.id === id);

test('activeRuns treats missing dates as breaks', () => {
  const days = [...series('2025-01-01', [1, 1, 1]), ...series('2025-01-05', [1, 1])];
  assert.deepEqual(activeRuns(days).map((r) => r.length), [3, 2]);
});

test('streak achievements and progress', () => {
  const days = series('2025-01-01', new Array(35).fill(1));
  const a = computeAchievements({ days, today: '2025-02-04' });
  assert.equal(get(a, 'on-a-roll').earned, true);
  assert.equal(get(a, 'unstoppable').earned, true);
  assert.equal(get(a, 'centurion').earned, false);
  assert.equal(get(a, 'centurion').progress, 0.35);
});

test('comeback needs a 30+ day break before a 7-day run', () => {
  const days = series('2025-01-01', [1, 1, ...new Array(31).fill(0), 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(get(computeAchievements({ days, today: '2025-03-01' }), 'comeback').earned, true);
  const short = series('2025-01-01', [1, ...new Array(10).fill(0), 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(get(computeAchievements({ days: short, today: '2025-03-01' }), 'comeback').earned, false);
});

test('repo based achievements are unknown without repos', () => {
  const a = computeAchievements({ days: [], today: '2025-01-01' });
  assert.equal(get(a, 'star-maker').known, false);
  assert.equal(get(a, 'star-maker').earned, false);
  const b = computeAchievements({ days: [], repos: [{ stars: 150, language: 'Go' }], today: '2025-01-01' });
  assert.equal(get(b, 'star-maker').earned, true);
  assert.equal(get(b, 'polyglot').earned, false);
});

test('veteran uses the account age', () => {
  const a = computeAchievements({ days: [], profile: { createdAt: '2015-01-01T00:00:00Z' }, today: '2025-01-01' });
  assert.equal(get(a, 'veteran').earned, true);
});

test('detail formatting', () => {
  const days = series('2025-01-01', new Array(200).fill(1));
  const a = computeAchievements({ days, today: '2025-07-19' });
  assert.match(get(a, 'consistent').detail, /^\d+% of days$/);
});
