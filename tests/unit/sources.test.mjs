import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDays, normalizeProfile, normalizeRepos, buildSources, createClient, ApiError } from '../../js/sources.js';

test('normalizeDays accepts every source format', () => {
  const days = normalizeDays([
    { date: '2025-01-02', count: 3, level: 2 },                                   // jogruber
    { date: '2025-01-01', contributionCount: 1, contributionLevel: 'FIRST_QUARTILE' }, // GraphQL / deno
    { date: '2025-01-03T00:00:00Z', count: '4', level: 9 },
    { date: 'nope', count: 1 },
    null,
  ]);
  assert.deepEqual(days.map((d) => d.date), ['2025-01-01', '2025-01-02', '2025-01-03']);
  assert.equal(days[0].level, 1);
  assert.equal(days[2].level, 4);
  assert.equal(days[2].count, 4);
});

test('normalizeDays: counts without level get level 1, duplicates collapse', () => {
  const d = normalizeDays([{ date: '2025-01-01', count: 2 }, { date: '2025-01-01', count: 5, level: 3 }]);
  assert.equal(d.length, 1);
  assert.equal(d[0].count, 5);
  assert.equal(normalizeDays([{ date: '2025-01-01', count: 2 }])[0].level, 1);
});

test('normalizeProfile handles GitHub and ungh shapes', () => {
  const gh = normalizeProfile({ login: 'a', name: null, avatar_url: 'x', followers: 3, public_repos: 2, created_at: '2020-01-01T00:00:00Z' });
  assert.equal(gh.name, 'a');
  assert.equal(gh.followers, 3);
  const ungh = normalizeProfile({ id: 7, username: 'b', login: 'b', name: 'B' });
  assert.equal(ungh.avatar, 'https://avatars.githubusercontent.com/u/7?v=4');
  assert.equal(ungh.followers, null);
  assert.throws(() => normalizeProfile(null), ApiError);
});

test('normalizeRepos drops forks and maps ungh fields', () => {
  const r = normalizeRepos([{ name: 'x', fork: true }, { name: 'y', repo: 'u/y', stars: 5, forks: 1 }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, 'https://github.com/u/y');
  assert.equal(r[0].stars, 5);
});

test('buildSources: worker first when configured', () => {
  assert.equal(buildSources('').contributions[0].name, 'github-contributions-api');
  const s = buildSources('https://w.example.workers.dev/');
  assert.equal(s.profile[0].name, 'gridscape-api');
  assert.equal(s.profile[0].url('octo'), 'https://w.example.workers.dev/api/user/octo');
});

function fakeFetch(handlers, calls) {
  return async (url) => {
    calls.push(url);
    for (const [pattern, fn] of handlers) if (url.includes(pattern)) return fn(url);
    throw new TypeError('network');
  };
}
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k] ?? null }, json: async () => body });

test('client falls back to the next source and remembers broken ones', async () => {
  const calls = [];
  const sources = buildSources('');
  let t = 0;
  const client = createClient({
    now: () => t,
    fetchImpl: fakeFetch([
      ['api.github.com', () => res(403, {}, { 'x-ratelimit-reset': '100' })],
      ['ungh.cc', () => res(200, { user: { id: 1, username: 'octo', name: 'Octo' } })],
    ], calls),
  });
  const r1 = await client.run(sources.profile, 'octo', { notFoundIsFinal: true });
  assert.equal(r1.source.name, 'ungh.cc');
  assert.equal(client.isBroken('GitHub API'), true);
  calls.length = 0;
  await client.run(sources.profile, 'octo');
  assert.ok(calls.every((u) => u.includes('ungh.cc')), 'skips the rate limited source');
  t = 100_001; // after the reset time
  calls.length = 0;
  await client.run(sources.profile, 'octo');
  assert.ok(calls[0].includes('api.github.com'), 'retries after cooldown');
});

test('client: 404 on profile is final, all failures give all_failed', async () => {
  const sources = buildSources('');
  const calls = [];
  const client = createClient({ fetchImpl: fakeFetch([['api.github.com', () => res(404, {})]], calls) });
  await assert.rejects(client.run(sources.profile, 'ghost', { notFoundIsFinal: true }), (e) => e.code === 'not_found');
  assert.equal(calls.length, 1);
  const client2 = createClient({ fetchImpl: fakeFetch([], []) });
  await assert.rejects(client2.run(sources.contributions, 'x'), (e) => e.code === 'all_failed' && e.errors.length === 2);
});

test('client: timeout moves on to the next source', async () => {
  const sources = buildSources('');
  const client = createClient({
    timeoutMs: 30,
    fetchImpl: (url, { signal }) => (url.includes('jogruber')
      ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      : Promise.resolve(res(200, { contributions: [{ date: '2025-01-01', contributionCount: 2, contributionLevel: 'FIRST_QUARTILE' }] }))),
  });
  const r = await client.run(sources.contributions, 'octo');
  assert.equal(r.source.name, 'deno-github-contributions-api');
  assert.equal(r.value.complete, false);
});
