// Server-side data fetching with several backups per data type and a two-level cache:
//   fresh cache (1 h)  ->  primary source  ->  backup sources  ->  stale cache (7 days)
import { normalizeDays, normalizeProfile, normalizeRepos, totalsFromDays, ApiError } from '../../js/sources.js';

const UA = 'gridscape-worker (+https://github.com/hjorven/gridscape)';
const FRESH_TTL = 3600;
const STALE_TTL = 7 * 24 * 3600;
const TIMEOUT = 8000;

export class NotFound extends Error {}

async function fetchJSON(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) } });
  if (res.status === 404) throw new NotFound(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const ghHeaders = (env) => (env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {});

/* ------------------------------------------------------------------ cache helpers */

const cacheKey = (kind, user, stale = false) => new Request(`https://cache.gridscape.internal/${stale ? 'stale' : 'fresh'}/${kind}/${user.toLowerCase()}`);

async function cacheGet(kind, user, stale = false) {
  try {
    const hit = await caches.default.match(cacheKey(kind, user, stale));
    return hit ? hit.json() : null;
  } catch {
    return null;
  }
}

function cachePut(ctx, kind, user, value) {
  const body = JSON.stringify(value);
  const put = (stale, ttl) => caches.default.put(cacheKey(kind, user, stale), new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` },
  }));
  ctx.waitUntil(Promise.all([put(false, FRESH_TTL), put(true, STALE_TTL)]).catch(() => {}));
}

/** Runs the chain: fresh cache -> sources in order -> stale cache. */
async function withFallbacks(ctx, kind, user, sources) {
  const fresh = await cacheGet(kind, user);
  if (fresh) return { ...fresh, cache: 'hit' };
  const errors = [];
  for (const [name, fn] of sources) {
    try {
      const value = await fn();
      const result = { ...value, source: name };
      cachePut(ctx, kind, user, result);
      return result;
    } catch (err) {
      if (err instanceof NotFound && kind === 'profile') throw err;
      errors.push(`${name}: ${err.message}`);
    }
  }
  const stale = await cacheGet(kind, user, true);
  if (stale) return { ...stale, cache: 'stale' };
  if (errors.length && errors.every((e) => /NotFound|404/.test(e))) throw new NotFound(user);
  throw new Error(`All sources failed: ${errors.join(' | ')}`);
}

/* ------------------------------------------------------------------ profile + repos */

export function getProfile(env, ctx, user) {
  const e = encodeURIComponent(user);
  return withFallbacks(ctx, 'profile', user, [
    ['github-rest-token', async () => ({ profile: normalizeProfile(await fetchJSON(`https://api.github.com/users/${e}`, { headers: ghHeaders(env) })) })],
    ['github-rest', async () => ({ profile: normalizeProfile(await fetchJSON(`https://api.github.com/users/${e}`)) })],
    ['ungh', async () => {
      const j = await fetchJSON(`https://ungh.cc/users/${e}`);
      return { profile: normalizeProfile(j && j.user ? { ...j.user, login: j.user.username } : null) };
    }],
  ]);
}

export function getRepos(env, ctx, user) {
  const e = encodeURIComponent(user);
  const rest = (headers) => async () => ({
    repos: normalizeRepos(await fetchJSON(`https://api.github.com/users/${e}/repos?per_page=100&sort=pushed&type=owner`, { headers })),
  });
  return withFallbacks(ctx, 'repos', user, [
    ['github-rest-token', rest(ghHeaders(env))],
    ['github-rest', rest({})],
    ['ungh', async () => ({ repos: normalizeRepos((await fetchJSON(`https://ungh.cc/users/${e}/repos`)).repos) })],
  ]);
}

/* ------------------------------------------------------------------ contributions */

async function graphql(env, query, variables) {
  if (!env.GITHUB_TOKEN) throw new Error('no token');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Authorization: `Bearer ${env.GITHUB_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`graphql ${res.status}`);
  const j = await res.json();
  if (j.errors && j.errors.length) {
    if (j.errors.some((x) => x.type === 'NOT_FOUND')) throw new NotFound('graphql');
    throw new Error(`graphql: ${j.errors[0].message}`);
  }
  return j.data;
}

async function contributionsGraphQL(env, user) {
  const meta = await graphql(env, 'query($l:String!){user(login:$l){createdAt contributionsCollection{contributionYears}}}', { l: user });
  if (!meta.user) throw new NotFound(user);
  const years = meta.user.contributionsCollection.contributionYears || [];
  if (!years.length) return { contributions: [], totals: {} };
  const fields = years.map((y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } }`).join('\n');
  const data = await graphql(env, `query($l:String!){user(login:$l){${fields}}}`, { l: user });
  const days = [];
  const totals = {};
  for (const y of years) {
    const cal = data.user[`y${y}`].contributionCalendar;
    totals[y] = cal.totalContributions;
    for (const w of cal.weeks) days.push(...w.contributionDays);
  }
  return { contributions: normalizeDays(days), totals };
}

async function contributionsJogruber(user) {
  const j = await fetchJSON(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(user)}?y=all`);
  const contributions = normalizeDays(j.contributions);
  if (!contributions.length) throw new Error('empty');
  return { contributions, totals: { ...totalsFromDays(contributions), ...(j.total || {}) } };
}

async function contributionsDeno(user, createdAt) {
  const base = `https://github-contributions-api.kawarimidoll.deno.net/${encodeURIComponent(user)}.json?flat=true`;
  const thisYear = new Date().getUTCFullYear();
  const first = Math.max(2008, createdAt ? Number(String(createdAt).slice(0, 4)) : thisYear - 4);
  const years = [];
  for (let y = thisYear; y >= first; y--) years.push(y);
  const all = [];
  // A few parallel requests at a time
  for (let i = 0; i < years.length; i += 4) {
    const chunk = years.slice(i, i + 4);
    const parts = await Promise.allSettled(chunk.map((y) => fetchJSON(`${base}&from=${y}-01-01&to=${y}-12-31`)));
    for (const p of parts) if (p.status === 'fulfilled') all.push(...(p.value.contributions || []).flat(2));
  }
  const contributions = normalizeDays(all);
  if (!contributions.length) throw new Error('empty');
  return { contributions, totals: totalsFromDays(contributions) };
}

export function getContributions(env, ctx, user, createdAt = null) {
  return withFallbacks(ctx, 'contrib', user, [
    ['github-graphql', () => contributionsGraphQL(env, user)],
    ['github-contributions-api', () => contributionsJogruber(user)],
    ['deno-github-contributions-api', () => contributionsDeno(user, createdAt)],
  ]);
}

export { ApiError };
