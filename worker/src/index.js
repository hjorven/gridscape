// Gridscape API — Cloudflare Worker
//
//   GET /api/user/:user            profile (JSON)
//   GET /api/repos/:user           repositories (JSON)
//   GET /api/contributions/:user   full contribution calendar (JSON)
//   GET /u/:user?year=&vs=         share page with per-profile Open Graph tags, redirects to the site
//   GET /og/:user.png?year=&vs=    1200x630 preview image
//   GET /badge/:user.svg?theme=    live README badge
//   GET /card/:user.svg?theme=&year=  README card with a mini skyline
//   GET /health                    status
import { getProfile, getRepos, getContributions, NotFound } from './github.js';
import { badgeSVG, cardSVG, ogSVG, sharePageHTML, rangeData, rangeLabel } from './render.js';
import { renderPNG } from './og.js';
import { formatNumber } from '../../js/stats.js';
import { FIXTURES } from './fixtures.js';

const USER_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const YEAR_RE = /^(last|\d{4})$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200, maxAge = 600) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` },
});

const svg = (body, maxAge = 3600) => new Response(body, {
  headers: { ...CORS, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}` },
});

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function data(env, ctx, user) {
  if (env.FIXTURES === '1') return FIXTURES(user);
  return {
    profile: () => getProfile(env, ctx, user),
    repos: () => getRepos(env, ctx, user),
    contributions: (createdAt) => getContributions(env, ctx, user, createdAt),
  };
}

async function loadBundle(env, ctx, user) {
  const d = data(env, ctx, user);
  const p = await d.profile();
  const c = await d.contributions(p.profile.createdAt);
  return { profile: p.profile, data: { contributions: c.contributions, totals: c.totals || {} } };
}

async function avatarDataURI(url) {
  if (!url) return null;
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}s=184`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    if (!/^image\/(png|jpe?g|gif|webp)/.test(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);

  const parts = url.pathname.split('/').filter(Boolean);
  const site = (env.SITE_URL || 'https://hjorven.github.io/gridscape/').replace(/\/?$/, '/');
  const year = YEAR_RE.test(url.searchParams.get('year') || '') ? url.searchParams.get('year') : 'last';
  const theme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark';

  if (parts.length === 0) return Response.redirect(site, 302);
  if (parts[0] === 'health') return json({ ok: true, token: Boolean(env.GITHUB_TOKEN) }, 200, 0);

  const route = parts[0];
  const rawUser = (parts[1] || '').replace(/\.(png|svg)$/i, '');
  if (!USER_RE.test(rawUser)) return json({ error: 'Invalid username' }, 400);
  const user = rawUser;
  const d = data(env, ctx, user);

  try {
    switch (route) {
      case 'api': {
        // /api/:kind/:user
        const kind = parts[1];
        const u = parts[2];
        if (!u || !USER_RE.test(u)) return json({ error: 'Invalid username' }, 400);
        const dd = data(env, ctx, u);
        if (kind === 'user') {
          const p = await dd.profile();
          return json({ ...toGitHubShape(p.profile), _source: p.source });
        }
        if (kind === 'repos') {
          const r = await dd.repos();
          return json(r.repos.map((x) => ({ ...x, html_url: x.url, stargazers_count: x.stars, forks_count: x.forks })));
        }
        if (kind === 'contributions') {
          let createdAt = null;
          try { createdAt = (await dd.profile()).profile.createdAt; } catch (err) { if (err instanceof NotFound) throw err; }
          const c = await dd.contributions(createdAt);
          return json({ contributions: c.contributions, totals: c.totals, _source: c.source });
        }
        return json({ error: 'Not found' }, 404);
      }

      case 'badge': {
        const { profile, data: cd } = await loadBundle(env, ctx, user);
        const { stats } = rangeData(cd, 'last', todayUTC());
        const value = `${formatNumber(stats.total)} contributions · ${stats.longest}d streak`;
        return svg(badgeSVG({ label: `${profile.login} in 3D`, value, theme }));
      }

      case 'card': {
        const { profile, data: cd } = await loadBundle(env, ctx, user);
        return svg(cardSVG({ profile, data: cd, rangeKey: year, theme, today: todayUTC() }));
      }

      case 'og': {
        const users = [user];
        const vs = url.searchParams.get('vs');
        if (vs && USER_RE.test(vs) && vs.toLowerCase() !== user.toLowerCase()) users.push(vs);
        const bundles = await Promise.all(users.map((u) => loadBundle(env, ctx, u)));
        const avatars = users.length === 1 ? [await avatarDataURI(bundles[0].profile.avatar)] : [];
        const svgText = ogSVG({ profiles: bundles.map((b) => b.profile), datas: bundles.map((b) => b.data), rangeKey: year, avatars, today: todayUTC() });
        const png = await renderPNG(svgText);
        return new Response(png, {
          headers: { ...CORS, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=21600, s-maxage=21600' },
        });
      }

      case 'u': {
        const vs = url.searchParams.get('vs');
        const target = new URL(site);
        target.searchParams.set('user', user);
        if (year !== 'last') target.searchParams.set('year', year);
        if (vs && USER_RE.test(vs)) target.searchParams.set('vs', vs);
        const og = new URL(`/og/${user}.png`, url.origin);
        if (year !== 'last') og.searchParams.set('year', year);
        if (vs && USER_RE.test(vs)) og.searchParams.set('vs', vs);
        let title = `@${user}'s GitHub in 3D — Gridscape`;
        let description = 'An interactive 3D skyline of GitHub contributions.';
        try {
          const { profile, data: cd } = await loadBundle(env, ctx, user);
          const { stats } = rangeData(cd, year, todayUTC());
          title = vs ? `@${profile.login} vs @${vs} — Gridscape` : `@${profile.login}'s GitHub in 3D — Gridscape`;
          description = `${formatNumber(stats.total)} contributions in ${rangeLabel(year)} · longest streak ${stats.longest} days · best day ${stats.best ? stats.best.count : 0}.`;
        } catch (err) {
          if (err instanceof NotFound) return Response.redirect(site, 302);
        }
        return new Response(sharePageHTML({ title, description, image: og.toString(), target: target.toString(), canonical: url.toString() }), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
        });
      }

      default:
        return json({ error: 'Not found' }, 404);
    }
  } catch (err) {
    if (err instanceof NotFound) return json({ error: 'User not found' }, 404, 300);
    console.error(err);
    return json({ error: 'Upstream unavailable' }, 502, 0);
  }
}

/** Matches the GitHub REST field names so the site's parsers work unchanged. */
function toGitHubShape(p) {
  return {
    login: p.login, name: p.name, avatar_url: p.avatar, bio: p.bio, html_url: p.url,
    followers: p.followers, following: p.following, public_repos: p.publicRepos,
    location: p.location, created_at: p.createdAt, type: p.type,
  };
}

export default {
  async fetch(request, env, ctx) {
    // Edge cache for the rendered responses (images, pages, API)
    const cache = caches.default;
    const cacheable = request.method === 'GET' && env.FIXTURES !== '1';
    if (cacheable) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    const res = await handle(request, env, ctx);
    if (cacheable && res.status === 200 && /max-age=[1-9]/.test(res.headers.get('Cache-Control') || '')) {
      ctx.waitUntil(cache.put(request, res.clone()));
    }
    return res;
  },
};
