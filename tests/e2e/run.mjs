// End-to-end tests in a real (headless) browser with all external APIs mocked.
//   node tests/e2e/run.mjs
// Env: SCREENSHOTS=1 saves screenshots to tests/e2e/out/
//      LOCAL_CDN=/path/to/node_modules  serves three.js and gifenc locally (offline runs)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tests/e2e/out');
const SHOTS = process.env.SCREENSHOTS === '1';
const LOCAL_CDN = process.env.LOCAL_CDN || '';
const WORKER = 'https://gridscape-api.test.workers.dev';
if (SHOTS) fs.mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ static server */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, p.endsWith('/') ? `${p}index.html` : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* ------------------------------------------------------------------ mock data */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function calendar(user) {
  const r = rng([...user].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const days = [];
  const today = new Date();
  const end = Date.UTC(today.getFullYear(), 11, 31);
  for (let t = Date.UTC(2023, 0, 1); t <= end; t += 86400000) {
    const future = t > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    let c = future || r() < 0.3 ? 0 : Math.floor(-Math.log(1 - r()) * 6) + 1;
    if (!future && t % (86400000 * 97) < 86400000) c = 64; // a few big days
    days.push({ date: new Date(t).toISOString().slice(0, 10), count: c, level: c === 0 ? 0 : c < 3 ? 1 : c < 7 ? 2 : c < 12 ? 3 : 4 });
  }
  return days;
}
const profileJSON = (user) => ({
  login: user, name: user === 'octo-dev' ? 'Octo <b>Dev</b>' : `Test ${user}`, id: 1,
  avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4', bio: 'Builds <script>alert(1)</script> things',
  html_url: `https://github.com/${user}`, followers: 1234, following: 5, public_repos: 42, location: 'Berlin',
  created_at: '2019-03-04T10:00:00Z', type: 'User',
});
const LANGS = ['TypeScript', 'Python', 'Rust', 'Go', 'JavaScript', 'Swift', 'C++', 'Shell'];
const reposJSON = (user) => Array.from({ length: 30 }, (_, i) => ({
  name: `repo-${i}`, html_url: `https://github.com/${user}/repo-${i}`, description: `Description ${i} <img src=x onerror=alert(1)>`,
  stargazers_count: (i * 137) % 900, forks_count: i * 3, language: LANGS[i % LANGS.length], fork: i % 9 === 0,
}));
const ICON = fs.readFileSync(path.join(ROOT, 'assets/icon-192.png'));
const CORS = { 'access-control-allow-origin': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, body: JSON.stringify(body), headers: { ...CORS, 'content-type': 'application/json' } });

/**
 * mode.github:  'ok' | 'ratelimit'      (api.github.com)
 * mode.jogruber:'ok' | 'down'
 * mode.worker:  'none' | 'ok' | 'down'
 */
function router(mode, log) {
  return async (route) => {
    const url = route.request().url();
    const u = new URL(url);
    if (url.startsWith('https://cdn.jsdelivr.net/npm/')) {
      if (!LOCAL_CDN) return route.continue(); // real CDN (CI has network access)
      const m = url.match(/npm\/(three|gifenc)@[^/]+\/(.*)$/);
      const file = m && path.join(LOCAL_CDN, m[1], m[2].split('?')[0]);
      if (file && fs.existsSync(file)) return route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { ...CORS, 'content-type': 'text/javascript' } });
      return route.fulfill({ status: 404, headers: CORS });
    }
    if (u.pathname.endsWith('/js/config.js') && u.origin + '/' === BASE.replace(/\/$/, '') + '/' && mode.worker !== 'none') {
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/javascript' }, body: `export const WORKER_URL = '${WORKER}';\nexport const SITE_URL = '${BASE}';\n` });
    }
    if (url.startsWith(WORKER)) {
      log.push(`worker ${u.pathname}`);
      if (mode.worker === 'down') return json(route, { error: 'Upstream unavailable' }, 502);
      const [, , kind, user] = u.pathname.split('/');
      if (u.pathname.startsWith('/badge/') || u.pathname.startsWith('/card/')) {
        return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="20"><rect width="200" height="20" fill="#26a641"/></svg>' });
      }
      if (user === 'ghost') return json(route, { error: 'User not found' }, 404);
      if (kind === 'user') return json(route, profileJSON(user));
      if (kind === 'repos') return json(route, reposJSON(user).filter((r) => !r.fork));
      if (kind === 'contributions') return json(route, { contributions: calendar(user), totals: {} });
      return json(route, { error: 'nf' }, 404);
    }
    if (u.host === 'api.github.com') {
      log.push(`github ${u.pathname}`);
      if (mode.github === 'ratelimit') return route.fulfill({ status: 403, body: '{"message":"rate limit"}', headers: { ...CORS, 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } });
      const [, , user, sub] = u.pathname.split('/');
      if (user === 'ghost') return json(route, { message: 'Not Found' }, 404);
      return json(route, sub === 'repos' ? reposJSON(user) : profileJSON(user));
    }
    if (u.host === 'ungh.cc') {
      log.push(`ungh ${u.pathname}`);
      const [, , user, sub] = u.pathname.split('/');
      if (user === 'ghost') return json(route, { error: 'nf' }, 404);
      if (sub === 'repos') return json(route, { repos: reposJSON(user).map((r) => ({ name: r.name, repo: `${user}/${r.name}`, description: r.description, stars: r.stargazers_count, forks: r.forks_count })) });
      return json(route, { user: { id: 1, name: `Ungh ${user}`, username: user, twitter: null } });
    }
    if (u.host === 'github-contributions-api.jogruber.de') {
      log.push(`jogruber ${u.pathname}`);
      if (mode.jogruber === 'down') return route.fulfill({ status: 500, headers: CORS, body: 'oops' });
      const user = u.pathname.split('/')[2];
      if (user === 'ghost') return json(route, { error: 'nf' }, 404);
      const days = calendar(user);
      const total = {};
      for (const d of days) total[d.date.slice(0, 4)] = (total[d.date.slice(0, 4)] || 0) + d.count;
      return json(route, { total, contributions: days });
    }
    if (u.host === 'github-contributions-api.kawarimidoll.deno.net') {
      log.push(`deno ${u.pathname}${u.search}`);
      const user = u.pathname.slice(1).replace(/\.json$/, '');
      const all = calendar(user);
      const from = u.searchParams.get('from');
      const to = u.searchParams.get('to');
      const today = new Date().toISOString().slice(0, 10);
      const lastStart = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const sel = all.filter((d) => (from ? d.date >= from && d.date <= to : d.date >= lastStart && d.date <= today));
      const LV = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
      return json(route, { contributions: sel.map((d) => ({ date: d.date, contributionCount: d.count, contributionLevel: LV[d.level], color: '#000' })), totalContributions: 0 });
    }
    if (u.host === 'avatars.githubusercontent.com') return route.fulfill({ status: 200, body: ICON, headers: { ...CORS, 'content-type': 'image/png' } });
    if (u.host === 'img.shields.io') return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20"><rect width="120" height="20" fill="#39d353"/></svg>' });
    if (u.origin + '/' === BASE) return route.continue();
    return route.abort();
  };
}

/* ------------------------------------------------------------------ harness */
const failures = [];
let passed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ok   ${name}`); } else { failures.push(`${name} ${extra}`); console.log(`  FAIL ${name} ${extra}`); }
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function newPage(mode, viewport = { width: 1366, height: 900 }, extra = {}) {
  const log = [];
  const errors = [];
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, ...extra });
  await ctx.route('**/*', router(mode, log));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Mocked 4xx/5xx responses are expected in fallback tests
    if (/Failed to load resource/.test(t)) return;
    errors.push(t);
  });
  return { ctx, page, log, errors };
}
const shot = async (page, name, opts = {}) => { if (SHOTS) await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts }); };
const ready = (page) => page.waitForFunction(() => document.querySelector('#stage-canvas canvas') && document.querySelector('#stage-loading').hidden, null, { timeout: 20000 });

async function download(page, selector, timeout = 30000) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), page.click(selector)]);
  const file = path.join(OUT, dl.suggestedFilename());
  fs.mkdirSync(OUT, { recursive: true });
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(file) };
}

/* ------------------------------------------------------------------ scenarios */
try {
  console.log('Scenario 1: public APIs, primary sources');
  {
    const { ctx, page, log, errors } = await newPage({ github: 'ok', jogruber: 'ok', worker: 'none' });
    page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(BASE);
    await shot(page, '01-home');
    await page.fill('#user-input', 'not valid!!');
    await page.click('#search-btn');
    check('invalid input message', (await page.textContent('#form-status')).includes('valid GitHub username'));
    await page.fill('#user-input', 'ghost');
    await page.click('#search-btn');
    await page.waitForSelector('#form-status.error >> text=does not exist', { timeout: 10000 });
    check('unknown user message', true);

    await page.fill('#user-input', 'https://github.com/octo-dev/some-repo?tab=x');
    await page.click('#search-btn');
    await ready(page);
    await page.waitForSelector('#repos li a', { timeout: 10000 });
    await page.waitForTimeout(1500);
    check('url updated', page.url().includes('user=octo-dev'));
    check('name rendered as text', (await page.textContent('#p-name')) === 'Octo <b>Dev</b>');
    check('no injected elements', (await page.evaluate(() => document.querySelectorAll('#p-bio script, #repos img').length)) === 0);
    check('data sources shown', /contributions via github-contributions-api/.test(await page.textContent('#data-source')), await page.textContent('#data-source'));
    check('years listed', (await page.$$eval('#years .chip', (els) => els.map((e) => e.textContent))).includes('2023'));
    check('achievements rendered', (await page.$$('#achievements li')).length === 12);
    check('some achievements earned', (await page.$$('#achievements li.earned')).length >= 3);
    check('3D text font loaded', await page.evaluate(() => fetch('assets/fonts/dejavu-sans-bold.typeface.json').then((r) => r.ok)));
    await page.waitForTimeout(800);
    await shot(page, '02-result-desktop', { fullPage: true });
    if (SHOTS) await page.locator('.viewer').screenshot({ path: path.join(OUT, '03-viewer.png') });

    // Night mode
    await page.click('#rotate-btn');
    await page.click('#night-btn');
    await page.waitForTimeout(400);
    if (SHOTS) await page.locator('.viewer').screenshot({ path: path.join(OUT, '04-night.png') });
    await page.click('#night-btn');

    // Compare
    await page.fill('#compare-input', 'hubber');
    await page.click('#compare-btn');
    await page.waitForSelector('#compare-section:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1500);
    check('compare url', page.url().includes('vs=hubber'));
    check('compare title', (await page.textContent('#viewer-title')).includes('vs @hubber'));
    check('compare table rows', (await page.$$('#cmp-body tr')).length === 6);
    if (SHOTS) await page.locator('.viewer-layout').screenshot({ path: path.join(OUT, '05-compare.png') });
    await page.click('#view2d-btn');
    check('2D shows both grids', (await page.$$('#grid2d svg')).length === 2);
    await page.click('#view2d-btn');
    const card = await download(page, '#dl-card');
    check('compare card png', card.buf.slice(1, 4).toString() === 'PNG' && card.buf.length > 20000, card.name);
    await page.click('#compare-clear');
    await page.waitForTimeout(800);
    check('compare removed', !page.url().includes('vs='));

    // Exports
    const card2 = await download(page, '#dl-card');
    check('share card png', card2.buf.slice(1, 4).toString() === 'PNG' && card2.buf.length > 20000);
    const stl = await download(page, '#dl-stl');
    const tris = stl.buf.readUInt32LE(80);
    check('stl binary', stl.buf.length === 84 + tris * 50 && tris > 3000, `${tris} triangles`);
    const gif = await download(page, '#dl-gif', 90000);
    check('gif', gif.buf.slice(0, 6).toString() === 'GIF89a' && gif.buf.length > 50000, `${gif.buf.length} bytes`);
    await page.selectOption('#video-format', 'square');
    const vid = await download(page, '#dl-video', 60000);
    check('video', vid.buf.length > 20000 && /\.(webm|mp4)$/.test(vid.name), `${vid.name} ${vid.buf.length}`);

    // Year in review
    await page.click('#wrapped-btn');
    await page.waitForSelector('.wrapped canvas', { timeout: 10000 });
    await page.waitForTimeout(1200);
    await shot(page, '06-wrapped-1');
    for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1300); }
    await shot(page, '07-wrapped-3');
    const slide = await download(page, '.wrapped [data-act="save"]');
    check('wrapped slide png 1080x1920', slide.buf.readUInt32BE(16) === 1080 && slide.buf.readUInt32BE(20) === 1920);
    await page.keyboard.press('Escape');
    check('wrapped closed', (await page.$('.wrapped')) === null);

    const backups = log.filter((l) => /^(ungh|deno)/.test(l) && !l.includes('ghost'));
    check('only primary sources used', backups.length === 0, backups.join(','));
    check('no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log('Scenario 2: GitHub API rate limited and contributions API down -> backups');
  {
    const { ctx, page, log, errors } = await newPage({ github: 'ratelimit', jogruber: 'down', worker: 'none' });
    await page.goto(`${BASE}?user=octo-dev&year=2023`);
    await ready(page);
    await page.waitForFunction(() => /repositories via/.test(document.querySelector('#data-source').textContent), null, { timeout: 15000 });
    const src = await page.textContent('#data-source');
    check('profile via ungh', src.includes('profile via ungh.cc'), src);
    check('contributions via deno api', src.includes('contributions via deno-github-contributions-api'), src);
    check('repos via ungh', src.includes('repositories via ungh.cc'), src);
    await page.waitForFunction(() => document.querySelector('#form-status').textContent === '', null, { timeout: 20000 });
    check('older years loaded', log.some((l) => l.includes('from=2023-01-01')));
    check('2023 selected and filled', (await page.textContent('#viewer-title')).includes('in 2023') && !(await page.textContent('#s-total')).startsWith('0'), await page.textContent('#s-total'));
    check('no console errors', errors.length === 0, errors.join(' | '));
    await shot(page, '08-fallback', { fullPage: false });
    await ctx.close();
  }

  console.log('Scenario 3: own worker API');
  {
    const { ctx, page, log, errors } = await newPage({ github: 'ok', jogruber: 'ok', worker: 'ok' });
    await page.goto(`${BASE}?user=octo-dev`);
    await ready(page);
    await page.waitForSelector('#repos li a');
    const src = await page.textContent('#data-source');
    check('everything via worker', (src.match(/gridscape-api/g) || []).length === 3, src);
    check('no public API calls', !log.some((l) => /^(github|jogruber|ungh|deno)/.test(l)));
    check('share link uses worker', (await page.inputValue('#share-url')).startsWith(`${WORKER}/u/octo-dev`));
    check('live badge + card embeds', (await page.$$('#embeds .embed')).length === 2);
    check('no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log('Scenario 4: worker down -> public APIs');
  {
    const { ctx, page, errors } = await newPage({ github: 'ok', jogruber: 'ok', worker: 'down' });
    await page.goto(`${BASE}?user=octo-dev`);
    await ready(page);
    const src = await page.textContent('#data-source');
    check('fell back to GitHub API', src.includes('profile via GitHub API'), src);
    check('fell back to contributions API', src.includes('contributions via github-contributions-api'), src);
    check('no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  console.log('Scenario 5: mobile, light mode, deep link with compare');
  {
    const { ctx, page, errors } = await newPage({ github: 'ok', jogruber: 'ok', worker: 'none' }, { width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'light' });
    await page.goto(`${BASE}?user=octo-dev&year=2024&vs=hubber`);
    await ready(page);
    await page.waitForSelector('#compare-section:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1500);
    check('year from link', (await page.$eval('#years [aria-selected=true]', (e) => e.textContent)) === '2024');
    check('no horizontal overflow', (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    if (SHOTS) await page.locator('.viewer-layout').screenshot({ path: path.join(OUT, '09-mobile-viewer.png') });
    if (SHOTS) await page.locator('#compare-section').screenshot({ path: path.join(OUT, '10-mobile-compare.png') });
    check('no console errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} catch (err) {
  failures.push(`crash: ${err.stack || err}`);
  console.error(err);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}
