import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRange, layoutGrid, computeStats, availableYears, topLanguages } from '../../js/stats.js';

const day = (date, count) => ({ date, count, level: count ? 1 : 0 });

test('buildRange: last year has 365 days ending today', () => {
  const r = buildRange({ contributions: [], totals: {} }, 'last', '2026-11-06');
  assert.equal(r.length, 365);
  assert.equal(r.at(-1).date, '2026-11-06');
  assert.equal(r[0].date, '2025-11-07');
});

test('buildRange: past leap year is complete, current year stops today', () => {
  assert.equal(buildRange({ contributions: [], totals: {} }, '2024', '2026-11-06').length, 366);
  const cur = buildRange({ contributions: [], totals: {} }, '2026', '2026-01-10');
  assert.equal(cur.length, 10);
});

test('buildRange: fills counts from data', () => {
  const r = buildRange({ contributions: [day('2025-03-04', 7)], totals: {} }, '2025', '2026-01-01');
  assert.equal(r.find((d) => d.date === '2025-03-04').count, 7);
});

test('layoutGrid: columns are weeks, rows Sunday..Saturday', () => {
  // 2025-01-01 was a Wednesday
  const g = layoutGrid(['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'].map((d) => day(d, 0)));
  assert.equal(g.cells[0].dow, 3);
  assert.equal(g.cells[0].week, 0);
  assert.equal(g.cells[4].dow, 0); // Sunday starts a new column
  assert.equal(g.cells[4].week, 1);
  assert.equal(g.weeks, 2);
});

test('computeStats: totals, streaks, best day, weekday', () => {
  const days = [day('2025-01-01', 2), day('2025-01-02', 3), day('2025-01-03', 0), day('2025-01-04', 5), day('2025-01-05', 1), day('2025-01-06', 1), day('2025-01-07', 0)];
  const s = computeStats(days);
  assert.equal(s.total, 12);
  assert.equal(s.longest, 3);
  assert.equal(s.longestStart, '2025-01-04');
  assert.equal(s.best.date, '2025-01-04');
  assert.equal(s.active, 5);
  assert.equal(s.current, 0);
  assert.equal(s.favoriteWeekday, 6); // 2025-01-04 is a Saturday
});

test('computeStats: today without contributions keeps the streak alive', () => {
  const days = [day('2025-01-01', 1), day('2025-01-02', 1), day('2025-01-03', 0)];
  assert.equal(computeStats(days, { endsToday: true }).current, 2);
  assert.equal(computeStats(days, { endsToday: false }).current, 0);
});

test('availableYears: newest first, no future years', () => {
  const ys = availableYears({ contributions: [day('2027-01-01', 1)], totals: { 2024: 1, 2025: 2, 2007: 1 } }, '2026-05-01');
  assert.deepEqual(ys, [2025, 2024]);
});

test('topLanguages groups the rest as Other', () => {
  const repos = ['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].map((language) => ({ language }));
  const langs = topLanguages(repos, 3);
  assert.equal(langs[0].name, 'A');
  assert.equal(langs.at(-1).name, 'Other');
  assert.equal(Math.round(langs.reduce((a, l) => a + l.pct, 0)), 100);
});
