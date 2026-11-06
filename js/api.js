// Data layer used by the app: input parsing, caching and the multi-source fallback chain.
import { WORKER_URL } from './config.js';
import { ApiError, buildSources, createClient, normalizeDays, totalsFromDays } from './sources.js';

export { ApiError };

const CACHE_TTL = 10 * 60 * 1000;
const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

const sources = buildSources(WORKER_URL);
const client = createClient();

/** Accepts "user", "@user", "github.com/user", "https://github.com/user/repo?x" and returns "user" or null. */
export function parseUsername(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^@/, '');
  if (/github\.com/i.test(s)) {
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      const url = new URL(s);
      if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
      s = url.pathname.split('/').filter(Boolean)[0] || '';
    } catch {
      return null;
    }
  }
  s = s.split(/[/?#]/)[0];
  return USERNAME_RE.test(s) ? s : null;
}

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > CACHE_TTL) return null;
    return v;
  } catch {
    return null;
  }
}

function cacheSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value }));
  } catch { /* storage full or blocked */ }
}

async function cached(kind, user, fn) {
  const key = `gs2:${kind}:${user.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const value = await fn();
  cacheSet(key, value);
  return value;
}

export function fetchProfile(user, { signal } = {}) {
  return cached('profile', user, async () => {
    const { value, source } = await client.run(sources.profile, user, { signal, notFoundIsFinal: true });
    return { ...value, _source: source.name };
  });
}

export async function fetchRepos(user, { signal } = {}) {
  try {
    return await cached('repos', user, async () => {
      const { value, source } = await client.run(sources.repos, user, { signal });
      return { list: value, source: source.name, partial: source.name === 'ungh.cc' };
    });
  } catch (err) {
    if (err.name === 'AbortError' || (signal && signal.aborted)) throw err;
    return { error: err.code === 'not_found' ? 'No repositories found.' : 'Repositories are unavailable right now.' };
  }
}

/**
 * Loads the contribution calendar. Returns
 *   { contributions, totals, source, complete, loadRest(onProgress) }
 * When the winning source cannot return all years at once, `loadRest` fetches the
 * remaining years one by one (oldest data is loaded last).
 */
export async function fetchContributions(user, { signal, createdAt = null } = {}) {
  const key = `gs2:contrib:${user.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit && hit.complete) return { ...hit, loadRest: async () => hit };

  const { value, source } = await client.run(sources.contributions, user, { signal });
  const result = {
    contributions: value.days,
    totals: value.totals,
    source: source.name,
    complete: value.complete,
  };
  if (result.complete) cacheSet(key, result);

  result.loadRest = async (onProgress, createdAtLater = null) => {
    if (result.complete || !source.rangeUrl) return result;
    const thisYear = new Date().getFullYear();
    const created = createdAtLater || createdAt;
    const firstYear = Math.max(2008, created ? Number(String(created).slice(0, 4)) : thisYear - 4);
    const all = new Map(result.contributions.map((d) => [d.date, d]));
    for (let y = thisYear; y >= firstYear; y--) {
      if (signal && signal.aborted) return result;
      try {
        const part = await client.fetchRange(source, user, `${y}-01-01`, `${y}-12-31`, signal);
        for (const d of part.days) all.set(d.date, d);
      } catch (err) {
        if (signal && signal.aborted) return result;
        // One year failing is not fatal; keep what we have.
      }
      result.contributions = normalizeDays([...all.values()]);
      result.totals = totalsFromDays(result.contributions);
      onProgress?.(result);
    }
    result.complete = true;
    cacheSet(key, { contributions: result.contributions, totals: result.totals, source: result.source, complete: true });
    return result;
  };
  return result;
}
