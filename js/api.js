// Data layer: GitHub REST API (profile, repos) + public contributions API.
// Everything is public data, fetched directly from the browser — no backend needed.

const GH = 'https://api.github.com';
const CONTRIB = 'https://github-contributions-api.jogruber.de/v4';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

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
  } catch {
    /* storage full or blocked — ignore */
  }
}

async function getJSON(url, { signal } = {}) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Network error — check your connection and try again.', 'network');
  }
  if (res.status === 404) throw new ApiError('That GitHub user does not exist.', 'not_found');
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
    throw new ApiError(
      `GitHub API rate limit reached${mins ? ` — try again in about ${mins} min` : ''}.`,
      'rate_limit'
    );
  }
  if (!res.ok) throw new ApiError(`Request failed (${res.status}).`, 'http');
  return res.json();
}

export async function fetchProfile(user, opts) {
  const key = `gs:profile:${user.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const p = await getJSON(`${GH}/users/${encodeURIComponent(user)}`, opts);
  const profile = {
    login: p.login,
    name: p.name || p.login,
    avatar: p.avatar_url,
    bio: p.bio || '',
    url: p.html_url,
    followers: p.followers,
    following: p.following,
    publicRepos: p.public_repos,
    location: p.location || '',
    blog: p.blog || '',
    createdAt: p.created_at,
    type: p.type,
  };
  cacheSet(key, profile);
  return profile;
}

export async function fetchContributions(user, opts) {
  const key = `gs:contrib:${user.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await getJSON(`${CONTRIB}/${encodeURIComponent(user)}?y=all`, opts);
  if (!data || !Array.isArray(data.contributions)) {
    throw new ApiError('No contribution data found for this user.', 'empty');
  }
  const contributions = data.contributions
    .filter((c) => c && typeof c.date === 'string')
    .map((c) => ({ date: c.date, count: Number(c.count) || 0, level: Number(c.level) || 0 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const totals = {};
  for (const [k, v] of Object.entries(data.total || {})) {
    if (/^\d{4}$/.test(k)) totals[k] = Number(v) || 0;
  }
  const result = { contributions, totals };
  cacheSet(key, result);
  return result;
}

/** Repos are optional: if the API is rate limited we just return null. */
export async function fetchRepos(user, opts) {
  const key = `gs:repos:${user.toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const list = await getJSON(
      `${GH}/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&type=owner`,
      opts
    );
    const repos = (Array.isArray(list) ? list : [])
      .filter((r) => !r.fork)
      .map((r) => ({
        name: r.name,
        url: r.html_url,
        description: r.description || '',
        stars: r.stargazers_count || 0,
        forks: r.forks_count || 0,
        language: r.language || null,
        size: r.size || 0,
      }));
    cacheSet(key, repos);
    return repos;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return { error: err.message };
  }
}
