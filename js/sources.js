// Data sources with automatic fallback.
//
// Every kind of data (profile, repositories, contribution calendar) has an ordered list of
// sources. The first one that answers wins; if one fails, times out or is rate limited, the
// next one is tried. Sources that failed recently are skipped for a few minutes (circuit
// breaker) so a dead API does not slow down every request.
//
// This file has no DOM access so it can be unit tested in Node.

export class ApiError extends Error {
  constructor(message, code, source = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code; // 'not_found' | 'rate_limit' | 'network' | 'timeout' | 'http' | 'bad_data' | 'all_failed'
    this.source = source;
  }
}

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------------------------------------------------------- normalizers */

/** Accepts days from any source and returns [{date, count, level}] sorted by date, deduplicated. */
export function normalizeDays(list) {
  const byDate = new Map();
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || typeof d !== 'object') continue;
    const date = String(d.date || '').slice(0, 10);
    if (!DATE_RE.test(date)) continue;
    const count = Math.max(0, Number(d.count ?? d.contributionCount) || 0);
    let level = d.level ?? d.contributionLevel;
    level = typeof level === 'string' ? (LEVELS[level] ?? 0) : Number(level) || 0;
    level = Math.min(4, Math.max(0, level));
    if (count > 0 && level === 0) level = 1;
    byDate.set(date, { date, count, level });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function totalsFromDays(days) {
  const totals = {};
  for (const d of days) {
    const y = d.date.slice(0, 4);
    totals[y] = (totals[y] || 0) + d.count;
  }
  return totals;
}

export function normalizeProfile(p, source) {
  if (!p || !p.login) throw new ApiError('Unexpected profile data.', 'bad_data', source);
  return {
    login: String(p.login),
    name: p.name ? String(p.name) : String(p.login),
    avatar: p.avatar_url || p.avatar || (p.id ? `https://avatars.githubusercontent.com/u/${p.id}?v=4` : ''),
    bio: p.bio ? String(p.bio) : '',
    url: p.html_url || p.url || `https://github.com/${p.login}`,
    followers: Number.isFinite(p.followers) ? p.followers : null,
    following: Number.isFinite(p.following) ? p.following : null,
    publicRepos: Number.isFinite(p.public_repos) ? p.public_repos : Number.isFinite(p.publicRepos) ? p.publicRepos : null,
    location: p.location ? String(p.location) : '',
    createdAt: p.created_at || p.createdAt || null,
    type: p.type || 'User',
  };
}

export function normalizeRepos(list, source) {
  if (!Array.isArray(list)) throw new ApiError('Unexpected repository data.', 'bad_data', source);
  return list
    .filter((r) => r && r.name && !r.fork)
    .map((r) => ({
      name: String(r.name),
      url: r.html_url || r.url || (r.repo ? `https://github.com/${r.repo}` : ''),
      description: r.description ? String(r.description) : '',
      stars: Number(r.stargazers_count ?? r.stars) || 0,
      forks: Number(r.forks_count ?? r.forks) || 0,
      language: r.language || null,
    }));
}

/* ---------------------------------------------------------------- sources */

const GH = 'https://api.github.com';
const JOGRUBER = 'https://github-contributions-api.jogruber.de/v4';
const KAWARIMIDOLL = 'https://github-contributions-api.kawarimidoll.deno.net';
const UNGH = 'https://ungh.cc';

const enc = encodeURIComponent;

/**
 * Builds the source lists. `workerUrl` is optional: without it, only public APIs are used.
 * Contribution sources return { days, totals, complete, fetchRange? }.
 * `complete: false` means the source only returns one range per request; the app then loads
 * the remaining years in the background through `fetchRange(user, from, to)`.
 */
export function buildSources(workerUrl = '') {
  const w = workerUrl.replace(/\/+$/, '');
  const profile = [];
  const repos = [];
  const contributions = [];

  if (w) {
    profile.push({ name: 'gridscape-api', url: (u) => `${w}/api/user/${enc(u)}`, parse: (j) => normalizeProfile(j, 'gridscape-api') });
    repos.push({ name: 'gridscape-api', url: (u) => `${w}/api/repos/${enc(u)}`, parse: (j) => normalizeRepos(j, 'gridscape-api') });
    contributions.push({
      name: 'gridscape-api',
      url: (u) => `${w}/api/contributions/${enc(u)}`,
      parse: (j) => {
        const days = normalizeDays(j.contributions);
        if (!days.length) throw new ApiError('No contribution data.', 'bad_data', 'gridscape-api');
        return { days, totals: { ...totalsFromDays(days), ...(j.totals || {}) }, complete: true };
      },
    });
  }

  profile.push(
    { name: 'GitHub API', url: (u) => `${GH}/users/${enc(u)}`, parse: (j) => normalizeProfile(j, 'GitHub API') },
    { name: 'ungh.cc', url: (u) => `${UNGH}/users/${enc(u)}`, parse: (j) => normalizeProfile(j && j.user ? { ...j.user, login: j.user.username } : null, 'ungh.cc') },
  );
  repos.push(
    { name: 'GitHub API', url: (u) => `${GH}/users/${enc(u)}/repos?per_page=100&sort=pushed&type=owner`, parse: (j) => normalizeRepos(j, 'GitHub API') },
    { name: 'ungh.cc', url: (u) => `${UNGH}/users/${enc(u)}/repos`, parse: (j) => normalizeRepos(j && j.repos, 'ungh.cc') },
  );
  contributions.push(
    {
      name: 'github-contributions-api',
      url: (u) => `${JOGRUBER}/${enc(u)}?y=all`,
      parse: (j) => {
        const days = normalizeDays(j && j.contributions);
        if (!days.length) throw new ApiError('No contribution data.', 'bad_data', 'github-contributions-api');
        const totals = {};
        for (const [k, v] of Object.entries((j && j.total) || {})) if (/^\d{4}$/.test(k)) totals[k] = Number(v) || 0;
        return { days, totals: { ...totalsFromDays(days), ...totals }, complete: true };
      },
    },
    {
      name: 'deno-github-contributions-api',
      // Without from/to this API returns GitHub's default "last year" view.
      url: (u) => `${KAWARIMIDOLL}/${enc(u)}.json?flat=true`,
      parse: (j) => {
        const days = normalizeDays(j && j.contributions && j.contributions.flat ? j.contributions.flat(2) : []);
        if (!days.length) throw new ApiError('No contribution data.', 'bad_data', 'deno-github-contributions-api');
        return { days, totals: totalsFromDays(days), complete: false };
      },
      rangeUrl: (u, from, to) => `${KAWARIMIDOLL}/${enc(u)}.json?flat=true&from=${from}&to=${to}`,
    },
  );
  return { profile, repos, contributions };
}

/* ---------------------------------------------------------------- runner */

const DEFAULT_TIMEOUT = 9000;
const BREAKER_MS = 5 * 60 * 1000;

function anySignal(signals) {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) { ctrl.abort(s.reason); break; }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

export function createClient({ fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = DEFAULT_TIMEOUT, now = () => Date.now() } = {}) {
  const broken = new Map(); // source name -> until timestamp

  async function request(url, source, signal) {
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(() => timeoutCtrl.abort(new ApiError('Request timed out.', 'timeout', source)), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { signal: anySignal([signal, timeoutCtrl.signal]), headers: { Accept: 'application/json' } });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      if (timeoutCtrl.signal.aborted) throw new ApiError('Request timed out.', 'timeout', source);
      throw new ApiError('Network error.', 'network', source);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) throw new ApiError('That GitHub user does not exist.', 'not_found', source);
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const err = new ApiError('Rate limit reached.', 'rate_limit', source);
      err.resetAt = reset ? reset * 1000 : null;
      throw err;
    }
    if (!res.ok) throw new ApiError(`Request failed (${res.status}).`, 'http', source);
    try {
      return await res.json();
    } catch {
      throw new ApiError('Invalid response.', 'bad_data', source);
    }
  }

  /**
   * Tries each source in order. `notFoundIsFinal`: a 404 from any source ends the chain
   * (true for profiles: GitHub itself says the user does not exist).
   */
  async function run(sources, user, { signal, notFoundIsFinal = false } = {}) {
    const errors = [];
    const t = now();
    const available = sources.filter((s) => !(broken.get(s.name) > t));
    // If every source is in cooldown, try them all anyway.
    const list = available.length ? available : sources;
    for (const source of list) {
      try {
        const json = await request(source.url(user), source.name, signal);
        const value = source.parse(json);
        broken.delete(source.name);
        return { value, source };
      } catch (err) {
        if (signal && signal.aborted) throw err;
        const e = err instanceof ApiError ? err : new ApiError(String(err && err.message || err), 'bad_data', source.name);
        e.source = source.name;
        errors.push(e);
        if (e.code === 'not_found' && notFoundIsFinal) throw e;
        if (e.code !== 'not_found') {
          broken.set(source.name, e.code === 'rate_limit' && e.resetAt ? e.resetAt : now() + BREAKER_MS);
        }
      }
    }
    const notFound = errors.find((e) => e.code === 'not_found');
    if (notFound && errors.every((e) => e.code === 'not_found')) throw notFound;
    const limited = errors.find((e) => e.code === 'rate_limit');
    const err = new ApiError(
      limited
        ? 'All data sources are busy or rate limited right now. Please try again in a few minutes.'
        : 'Could not reach any data source. Check your connection and try again.',
      'all_failed'
    );
    err.errors = errors;
    throw err;
  }

  return {
    run,
    request,
    /** For sources with complete:false — loads one date range. */
    async fetchRange(source, user, from, to, signal) {
      const json = await request(source.rangeUrl(user, from, to), source.name, signal);
      return source.parse(json);
    },
    isBroken: (name) => broken.get(name) > now(),
  };
}
