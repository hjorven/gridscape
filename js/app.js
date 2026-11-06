// App controller: wires the UI, data, 3D scene, exports and sharing together.
import { parseUsername, fetchProfile, fetchContributions, fetchRepos, ApiError } from './api.js';
import {
  availableYears, buildRange, layoutGrid, computeStats, topLanguages, topRepos,
  formatDate, formatDateShort, formatNumber, weekdayName, WEEKDAYS, todayISO,
} from './stats.js';
import { DEFAULT_PALETTE, getPalette, getComparePalette } from './palettes.js';
import { computeAchievements } from './achievements.js';
import { WORKER_URL } from './config.js';
import {
  buildShareCard, canvasToBlob, downloadBlob, canShareFiles, nativeShare, copyText, socialLinks, readmeEmbeds,
} from './share.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
};
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = {
  user: null,
  profile: null,
  data: null,
  repos: null,
  rangeKey: 'last',
  paletteKey: DEFAULT_PALETTE,
  view: '3d',
  days: [],
  grid: null,
  stats: null,
  achievements: [],
  compare: null,      // { user, profile, data }
  cmp: null,          // { days, grid, stats } for the compare user in the current range
  scene: null,
  sceneFailed: false,
  controller: null,
  compareController: null,
  exporting: false,
};

/* ---------- Site light/dark toggle ---------- */
function initSiteTheme() {
  let saved = null;
  try { saved = localStorage.getItem('gs:site-theme'); } catch { /* ignore */ }
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  $('#theme-toggle').addEventListener('click', () => {
    const next = effectiveMode() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('gs:site-theme', next); } catch { /* ignore */ }
    syncPalette();
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncPalette);
}

/** The skyline uses GitHub's own dark or light contribution colors, matching the site mode. */
function effectiveMode() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

const sceneTheme = (pal) => ({ bg: pal.bg, plinth: pal.plinth, textColor: pal.textColor });

function syncPalette() {
  const key = effectiveMode();
  if (key === state.paletteKey) return;
  state.paletteKey = key;
  renderLegend(getPalette(key));
  if (state.stats) {
    renderStats();
    renderCompareTable();
    renderEmbeds();
    if (state.view === '2d' || state.sceneFailed) render2D();
    if (state.scene) updateScene();
  }
}

/* ---------- Status + toast ---------- */
function setStatus(msg, isError = false, target = '#form-status') {
  const s = $(target);
  s.textContent = msg || '';
  s.classList.toggle('error', isError);
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

/* ---------- URL state ---------- */
function readParams() {
  const p = new URLSearchParams(location.search);
  const year = p.get('year');
  return {
    user: parseUsername(p.get('user') || p.get('u') || ''),
    year: year && /^(last|\d{4})$/.test(year) ? year : 'last',
    vs: parseUsername(p.get('vs') || ''),
  };
}

/** URL of this page with the current view. */
function pageURL() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('user', state.user);
  if (state.rangeKey !== 'last') url.searchParams.set('year', state.rangeKey);
  if (state.compare) url.searchParams.set('vs', state.compare.user);
  return url.toString();
}

/** Link for sharing: goes through the worker when configured, so previews show this profile. */
function shareURL() {
  if (!WORKER_URL) return pageURL();
  const url = new URL(`${WORKER_URL.replace(/\/+$/, '')}/u/${encodeURIComponent(state.user)}`);
  if (state.rangeKey !== 'last') url.searchParams.set('year', state.rangeKey);
  if (state.compare) url.searchParams.set('vs', state.compare.user);
  return url.toString();
}

function syncURL(push = false) {
  const url = pageURL();
  if (url === location.href) return;
  history[push ? 'pushState' : 'replaceState']({}, '', url);
}

const siteLabel = () => `${location.host}${location.pathname.replace(/index\.html$/, '')}`.replace(/\/$/, '');

/* ---------- Palette ---------- */
function renderLegend(pal) {
  $('#legend').replaceChildren(...pal.levels.map((c) => {
    const i = el('i');
    i.style.background = c;
    return i;
  }));
  $('#stage').style.setProperty('--stage-bg', pal.bg);
}

/* ---------- Scene (lazy loaded) ---------- */
async function ensureScene() {
  if (state.scene || state.sceneFailed) return state.scene;
  try {
    const mod = await import('./scene.js');
    if (!mod.webglAvailable()) throw new Error('WebGL not available');
    state.scene = mod.createSkyline($('#stage-canvas'), { onHover: showTooltip });
  } catch (err) {
    console.warn('3D unavailable, using 2D fallback:', err);
    state.sceneFailed = true;
    setView('2d');
    ['#view2d-btn', '#rotate-btn', '#night-btn', '#dl-video', '#dl-gif', '#dl-stl'].forEach((s) => {
      $(s).disabled = true;
      $(s).title = '3D is not available on this device';
    });
  }
  return state.scene;
}

function showTooltip(hit, x, y) {
  const tip = $('#tooltip');
  if (!hit) { tip.hidden = true; return; }
  const { cell, city } = hit;
  const n = cell.count;
  const who = state.compare ? `@${city === 0 ? state.profile.login : state.compare.profile.login}: ` : '';
  tip.textContent = `${who}${n === 0 ? 'No' : formatNumber(n)} contribution${n === 1 ? '' : 's'} · ${formatDate(cell.date)}`;
  const stage = $('#stage').getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(x, 110), stage.width - 110)}px`;
  tip.style.top = `${Math.max(y, 44)}px`;
  tip.hidden = false;
}

function setView(view) {
  state.view = view;
  const is2D = view === '2d';
  $('#grid2d').hidden = !is2D;
  $('#stage-canvas').hidden = is2D;
  const btn = $('#view2d-btn');
  btn.setAttribute('aria-pressed', String(is2D));
  btn.querySelector('span').textContent = is2D ? '3D' : '2D';
  $('#rotate-btn').disabled = is2D || state.sceneFailed;
  $('#night-btn').disabled = is2D || state.sceneFailed;
  $('#reset-btn').disabled = is2D;
  $('#tooltip').hidden = true;
  if (is2D) render2D();
  else state.scene?.resize();
}

function updateScene() {
  if (!state.scene || !state.grid) return;
  const pal = getPalette(state.paletteKey);
  const cities = [{ cells: state.grid.cells, weeks: state.grid.weeks, palette: pal }];
  let max = state.stats.max;
  let left = `@${state.profile.login}`;
  if (state.compare && state.cmp) {
    cities.push({ cells: state.cmp.grid.cells, weeks: state.cmp.grid.weeks, palette: getComparePalette(state.paletteKey) });
    max = Math.max(max, state.cmp.stats.max);
    left = `@${state.profile.login} vs @${state.compare.profile.login}`;
  }
  state.scene.setData({
    cities,
    max,
    text: { left, right: state.rangeKey === 'last' ? 'last year' : state.rangeKey },
  }, sceneTheme(pal));
}

/* ---------- 2D grid (fallback + toggle) ---------- */
function gridSVG(grid, stats, pal, label) {
  const { cells, weeks } = grid;
  const size = 11;
  const gap = 3;
  const left = 28;
  const top = label ? 30 : 18;
  const w = left + weeks * (size + gap);
  const h = top + 7 * (size + gap);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w * 2));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label ? `${label}: ` : ''}${formatNumber(stats.total)} contributions`);
  const text = (x, y, str, opts = {}) => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('fill', getPalette(state.paletteKey).text);
    t.setAttribute('opacity', opts.opacity || '0.6');
    t.setAttribute('font-size', opts.size || '8');
    t.setAttribute('font-family', '-apple-system, Segoe UI, Helvetica, Arial, sans-serif');
    if (opts.weight) t.setAttribute('font-weight', opts.weight);
    t.textContent = str;
    svg.append(t);
  };
  if (label) text(left, 9, label, { opacity: '0.9', size: '9', weight: '600' });
  [1, 3, 5].forEach((d) => text(0, top + d * (size + gap) + 8, WEEKDAYS[d]));
  let lastMonth = '';
  for (const c of cells) {
    if (c.dow === 0 || c === cells[0]) {
      const m = c.date.slice(5, 7);
      if (m !== lastMonth && Number(c.date.slice(8, 10)) <= 7) {
        text(left + c.week * (size + gap), top - 6, formatDateShort(c.date).split(' ')[0]);
        lastMonth = m;
      }
    }
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', left + c.week * (size + gap));
    r.setAttribute('y', top + c.dow * (size + gap));
    r.setAttribute('width', size);
    r.setAttribute('height', size);
    r.setAttribute('rx', 2);
    r.setAttribute('fill', pal.levels[c.level] || pal.levels[0]);
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${c.count} contribution${c.count === 1 ? '' : 's'} on ${formatDate(c.date)}`;
    r.append(title);
    svg.append(r);
  }
  return svg;
}

function render2D() {
  const box = $('#grid2d');
  if (!state.grid) { box.replaceChildren(); return; }
  const pal = getPalette(state.paletteKey);
  const items = [gridSVG(state.grid, state.stats, pal, state.compare ? `@${state.profile.login}` : null)];
  if (state.compare && state.cmp) items.push(gridSVG(state.cmp.grid, state.cmp.stats, getComparePalette(state.paletteKey), `@${state.compare.profile.login}`));
  box.replaceChildren(el('div', { class: 'grid2d-inner' }, items));
}

/** Flat grid drawn on a canvas — used for exports when WebGL is unavailable. */
function gridCanvas() {
  const pal = getPalette(state.paletteKey);
  const { cells, weeks } = state.grid;
  const s = 14;
  const g = 4;
  const pad = 40;
  const c = document.createElement('canvas');
  c.width = weeks * (s + g) + pad * 2;
  c.height = 7 * (s + g) + pad * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, c.width, c.height);
  for (const cell of cells) {
    ctx.fillStyle = pal.levels[cell.level] || pal.levels[0];
    ctx.fillRect(pad + cell.week * (s + g), pad + cell.dow * (s + g), s, s);
  }
  return c;
}

function copyCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/* ---------- Rendering ---------- */
const rangeLabel = (key = state.rangeKey) => (key === 'last' ? 'last year' : String(key));

function renderYears() {
  const years = availableYears(state.data);
  const box = $('#years');
  const keys = ['last', ...years.map(String)];
  if (!keys.includes(state.rangeKey)) keys.splice(1, 0, state.rangeKey); // year still loading
  box.replaceChildren(...keys.map((k) => {
    const b = el('button', { type: 'button', class: 'chip', role: 'tab', text: k === 'last' ? 'Last year' : k });
    b.setAttribute('aria-selected', String(k === state.rangeKey));
    b.addEventListener('click', () => {
      state.rangeKey = k;
      box.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-selected', String(c === b)));
      renderRange();
      syncURL();
    });
    return b;
  }));
}

function renderProfile() {
  const p = state.profile;
  const avatar = $('#p-avatar');
  avatar.src = p.avatar ? `${p.avatar}${p.avatar.includes('?') ? '&' : '?'}s=176` : 'assets/icon-192.png';
  avatar.alt = `Avatar of ${p.login}`;
  $('#p-name').textContent = p.name;
  const login = $('#p-login');
  login.textContent = `@${p.login}`;
  login.href = p.url;
  $('#p-bio').textContent = p.bio;
  $('#p-bio').hidden = !p.bio;
  const meta = [
    p.followers !== null ? [formatNumber(p.followers), ' followers'] : null,
    p.publicRepos !== null ? [formatNumber(p.publicRepos), ' public repos'] : null,
    p.location ? ['', p.location] : null,
    p.createdAt ? ['', `Joined ${formatDate(p.createdAt.slice(0, 10))}`] : null,
  ].filter(Boolean);
  $('#p-meta').replaceChildren(...meta.map(([strong, rest]) => {
    const li = el('li');
    if (strong) li.append(el('strong', { text: strong }));
    li.append(rest);
    return li;
  }));
  document.title = `@${p.login}'s GitHub in 3D — Gridscape`;
}

function renderStats() {
  const s = state.stats;
  const set = (id, value, sub = '') => {
    $(`#${id}`).textContent = value;
    $(`#${id}-sub`).textContent = sub;
  };
  set('s-total', formatNumber(s.total), rangeLabel());
  set('s-longest', `${s.longest} ${s.longest === 1 ? 'day' : 'days'}`,
    s.longest ? `${formatDateShort(s.longestStart)} – ${formatDateShort(s.longestEnd)}` : '');
  set('s-current', `${s.current} ${s.current === 1 ? 'day' : 'days'}`,
    s.current ? `since ${formatDateShort(s.currentStart)}` : (state.rangeKey === 'last' ? 'start one today' : 'at the end of the year'));
  set('s-best', s.best ? formatNumber(s.best.count) : '–', s.best ? formatDate(s.best.date) : '');
  set('s-active', `${s.activePct}%`, `${s.active} of ${s.days} days`);
  set('s-weekday', s.favoriteWeekday === null ? '–' : weekdayName(s.favoriteWeekday),
    s.total ? `avg ${s.avgPerActive.toFixed(1)} per active day` : '');

  const max = Math.max(...s.weekday, 1);
  const accent = getPalette(state.paletteKey).accent;
  $('#weekday-bars').replaceChildren(...s.weekday.map((v, i) => {
    const fill = el('div', { class: 'bar-fill' });
    fill.style.height = `${Math.max(2, (v / max) * 100)}%`;
    fill.style.background = accent;
    return el('div', { class: 'bar', title: `${weekdayName(i)}: ${formatNumber(v)}` }, [
      el('span', { class: 'bar-value', text: v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v) }),
      fill,
      el('span', { text: WEEKDAYS[i] }),
    ]);
  }));
}

function renderCompareTable() {
  const sec = $('#compare-section');
  if (!state.compare || !state.cmp) { sec.hidden = true; return; }
  sec.hidden = false;
  const a = state.stats;
  const b = state.cmp.stats;
  $('#cmp-a').textContent = `@${state.profile.login}`;
  $('#cmp-b').textContent = `@${state.compare.profile.login}`;
  $('#cmp-a').style.setProperty('--dot', getPalette(state.paletteKey).levels[4]);
  $('#cmp-b').style.setProperty('--dot', getComparePalette(state.paletteKey).levels[3]);
  const rows = [
    ['Contributions', a.total, b.total, formatNumber],
    ['Longest streak', a.longest, b.longest, (v) => `${v} d`],
    ['Current streak', a.current, b.current, (v) => `${v} d`],
    ['Best day', a.max, b.max, formatNumber],
    ['Active days', a.active, b.active, (v) => `${v}`],
    ['Per active day', a.avgPerActive, b.avgPerActive, (v) => v.toFixed(1)],
  ];
  $('#cmp-body').replaceChildren(...rows.map(([label, x, y, f]) => {
    const tie = f(x) === f(y);
    return el('tr', {}, [
      el('th', { scope: 'row', text: label }),
      el('td', { class: !tie && x > y ? 'win' : '', text: f(x) }),
      el('td', { class: !tie && y > x ? 'win' : '', text: f(y) }),
    ]);
  }));
}

function renderRepos() {
  const repos = state.repos;
  const langBar = $('#lang-bar');
  const langList = $('#lang-list');
  const note = $('#lang-note');
  const list = $('#repos');
  if (!repos) {
    langBar.replaceChildren();
    langList.replaceChildren();
    note.textContent = 'Loading…';
    list.replaceChildren();
    return;
  }
  if (repos.error) {
    langBar.replaceChildren();
    langList.replaceChildren();
    note.textContent = repos.error;
    list.replaceChildren(el('li', { class: 'muted', text: repos.error }));
    return;
  }
  const langs = topLanguages(repos.list);
  note.textContent = langs.length
    ? `Based on ${repos.list.length} public repositories (excluding forks).`
    : repos.partial ? 'Languages are unavailable from the backup source right now.' : 'No languages detected yet.';
  langBar.replaceChildren(...langs.map((l) => {
    const s = el('span', { title: `${l.name} ${l.pct.toFixed(1)}%` });
    s.style.width = `${l.pct}%`;
    s.style.background = l.color;
    return s;
  }));
  langList.replaceChildren(...langs.map((l) => {
    const dot = el('i');
    dot.style.background = l.color;
    return el('li', {}, [dot, el('span', { text: l.name }), el('span', { class: 'pct', text: `${l.pct.toFixed(0)}%` })]);
  }));

  const top = topRepos(repos.list);
  if (!top.length) {
    list.replaceChildren(el('li', { class: 'muted', text: 'No public repositories yet.' }));
    return;
  }
  list.replaceChildren(...top.map((r) => el('li', {}, el('a', { href: r.url, target: '_blank', rel: 'noopener' }, [
    el('div', { class: 'repo-name', text: r.name }),
    r.description ? el('p', { class: 'repo-desc', text: r.description }) : null,
    el('div', { class: 'repo-meta' }, [
      el('span', { text: `★ ${formatNumber(r.stars)}` }),
      el('span', { text: `⑂ ${formatNumber(r.forks)}` }),
      r.language ? el('span', { text: r.language }) : null,
    ]),
  ]))));
}

function renderAchievements() {
  const today = todayISO();
  state.achievements = computeAchievements({
    days: state.data.contributions.filter((d) => d.date <= today),
    profile: state.profile,
    repos: state.repos && state.repos.list && !state.repos.partial ? state.repos.list : null,
    today,
  });
  const earned = state.achievements.filter((a) => a.earned).length;
  $('#ach-count').textContent = `${earned} / ${state.achievements.length}`;
  $('#achievements').replaceChildren(...state.achievements.map((a) => {
    const bar = el('span', { class: 'ach-bar' }, el('i'));
    bar.firstChild.style.width = `${Math.round(a.progress * 100)}%`;
    return el('li', { class: `ach${a.earned ? ' earned' : ''}`, title: a.desc }, [
      el('span', { class: 'ach-icon', text: a.icon, 'aria-hidden': 'true' }),
      el('span', { class: 'ach-text' }, [
        el('strong', { text: a.title }),
        el('span', { class: 'ach-desc', text: a.desc }),
        el('span', { class: 'ach-detail', text: a.earned ? `Unlocked · ${a.detail}` : a.detail }),
        a.earned ? null : bar,
      ]),
    ]);
  }));
}

function renderSources() {
  const parts = [];
  if (state.profile?._source) parts.push(`profile via ${state.profile._source}`);
  if (state.data?.source) parts.push(`contributions via ${state.data.source}`);
  if (state.repos?.source) parts.push(`repositories via ${state.repos.source}`);
  $('#data-source').textContent = parts.length ? `Data: ${parts.join(' · ')}.` : '';
}

function computeRange(data, key) {
  const today = todayISO();
  const days = buildRange(data, key, today);
  const grid = layoutGrid(days);
  const endsToday = days.length && days[days.length - 1].date === today;
  return { days, grid, stats: computeStats(days, { endsToday }) };
}

async function renderRange() {
  const main = computeRange(state.data, state.rangeKey);
  state.days = main.days;
  state.grid = main.grid;
  state.stats = main.stats;
  state.cmp = state.compare ? computeRange(state.compare.data, state.rangeKey) : null;
  renderStats();
  renderCompareTable();
  updateShare();
  const title = state.rangeKey === 'last' ? 'the last year' : state.rangeKey;
  $('#viewer-title').textContent = state.compare && state.cmp
    ? `@${state.profile.login} ${formatNumber(state.stats.total)} vs @${state.compare.profile.login} ${formatNumber(state.cmp.stats.total)} in ${title}`
    : `${formatNumber(state.stats.total)} contributions in ${title}`;

  if (state.view === '2d' || state.sceneFailed) render2D();
  const scene = await ensureScene();
  if (scene) updateScene();
}

/* ---------- Share ---------- */
function renderEmbeds() {
  if (!state.user) return;
  const pageUrl = new URL(pageURL());
  pageUrl.searchParams.delete('year');
  pageUrl.searchParams.delete('vs');
  const embeds = readmeEmbeds({ pageUrl: pageUrl.toString(), user: state.user, workerUrl: WORKER_URL, theme: state.paletteKey });
  $('#embeds').replaceChildren(...embeds.map((e) => {
    const code = el('code', { text: e.md });
    const btn = el('button', { class: 'btn', type: 'button', text: 'Copy Markdown' });
    btn.addEventListener('click', async () => toast((await copyText(e.md)) ? 'Markdown copied' : 'Copy failed'));
    const img = el('img', { src: e.img, alt: `${e.label} preview`, loading: 'lazy' });
    return el('div', { class: 'embed' }, [el('h4', { text: e.label }), el('p', { class: 'embed-preview' }, img), el('pre', {}, code), btn]);
  }));
  if (!WORKER_URL) {
    $('#embeds').append(el('p', { class: 'muted small', text: 'A live badge and a skyline card become available once the Gridscape API is set up (see README).' }));
  }
}

function updateShare() {
  if (!state.user || !state.stats) return;
  const url = shareURL();
  $('#share-url').value = url;
  const text = state.compare && state.cmp
    ? `@${state.profile.login} vs @${state.compare.profile.login} on GitHub: ${formatNumber(state.stats.total)} vs ${formatNumber(state.cmp.stats.total)} contributions (${rangeLabel()}).`
    : `My GitHub year in 3D: ${formatNumber(state.stats.total)} contributions (${rangeLabel()}), longest streak ${state.stats.longest} days.`;
  const links = socialLinks({ url, text });
  $('#share-x').href = links.x;
  $('#share-bsky').href = links.bsky;
  $('#share-li').href = links.li;
  $('#share-reddit').href = links.reddit;
  renderEmbeds();
}

async function makeCardBlob() {
  const pal = getPalette(state.paletteKey);
  let source = null;
  if (state.scene && state.view === '3d') source = state.scene.snapshot();
  else if (state.grid) source = gridCanvas();
  const card = await buildShareCard({
    profile: state.profile,
    stats: state.stats,
    rangeLabel: rangeLabel(),
    palette: pal,
    sceneCanvas: source,
    siteLabel: siteLabel(),
    achievements: state.achievements,
    compare: state.compare && state.cmp ? { profile: state.compare.profile, stats: state.cmp.stats, palette: getComparePalette(state.paletteKey) } : null,
  });
  return canvasToBlob(card);
}

function fileBase() {
  return `gridscape-${state.user}${state.compare ? `-vs-${state.compare.user}` : ''}-${state.rangeKey}`;
}

function exportInfo() {
  const total = state.compare && state.cmp
    ? `${formatNumber(state.stats.total)} vs ${formatNumber(state.cmp.stats.total)}`
    : formatNumber(state.stats.total);
  return {
    login: state.compare ? `${state.profile.login} vs @${state.compare.profile.login}` : state.profile.login,
    total,
    subtitle: `contributions · ${rangeLabel()}`,
    site: siteLabel(),
  };
}

function setProgress(p, label) {
  const box = $('#export-progress');
  if (p === null) { box.hidden = true; return; }
  box.hidden = false;
  box.querySelector('i').style.width = `${Math.round(p * 100)}%`;
  box.querySelector('span').textContent = label;
}

async function busy(btn, fn) {
  if (state.exporting) return;
  state.exporting = true;
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    if (err?.name !== 'AbortError') { console.error(err); toast(err?.message ? `Export failed: ${err.message}` : 'Something went wrong'); }
  } finally {
    btn.disabled = false;
    state.exporting = false;
    setProgress(null);
  }
}

function initShare() {
  $('#copy-link').addEventListener('click', async () => {
    toast((await copyText($('#share-url').value)) ? 'Link copied' : 'Copy failed — select the link manually');
  });

  $('#dl-card').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    downloadBlob(await makeCardBlob(), `${fileBase()}-card.png`);
  }));

  $('#dl-3d').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const source = state.scene && state.view === '3d' ? state.scene.snapshot() : gridCanvas();
    downloadBlob(await canvasToBlob(source), `${fileBase()}.png`);
  }));

  $('#dl-video').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const { recordVideo, canRecordVideo } = await import('./export.js');
    if (!canRecordVideo()) throw new Error('your browser cannot record video — try the GIF');
    const scene = await ensureScene();
    if (!scene) throw new Error('3D is not available');
    if (state.view === '2d') setView('3d');
    const loading = $('#stage-loading');
    $('#stage-loading-text').textContent = 'Recording…';
    loading.hidden = false;
    try {
      const { blob, ext } = await recordVideo(scene, {
        format: $('#video-format').value,
        info: exportInfo(),
        palette: getPalette(state.paletteKey),
        onProgress: (p) => setProgress(p, `Recording video… ${Math.round(p * 100)}%`),
      });
      downloadBlob(blob, `${fileBase()}-${$('#video-format').value}.${ext}`);
    } finally {
      loading.hidden = true;
      $('#stage-loading-text').textContent = 'Raising buildings…';
    }
  }));

  $('#dl-gif').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const { recordGIF } = await import('./export.js');
    const scene = await ensureScene();
    if (!scene) throw new Error('3D is not available');
    if (state.view === '2d') setView('3d');
    const blob = await recordGIF(scene, {
      info: exportInfo(),
      palette: getPalette(state.paletteKey),
      onProgress: (p) => setProgress(p, `Rendering GIF… ${Math.round(p * 100)}%`),
    });
    downloadBlob(blob, `${fileBase()}.gif`);
  }));

  $('#dl-stl').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const { exportSTL } = await import('./export.js');
    const scene = await ensureScene();
    if (!scene) throw new Error('3D is not available');
    setProgress(0.3, 'Building 3D model…');
    await scene.fontReady();
    const blob = await exportSTL(scene);
    downloadBlob(blob, `${fileBase()}.stl`);
  }));

  if (navigator.share) {
    const btn = $('#native-share');
    btn.hidden = false;
    btn.addEventListener('click', () => busy(btn, async () => {
      const blob = canShareFiles() ? await makeCardBlob() : null;
      await nativeShare({
        blob,
        filename: `${fileBase()}-card.png`,
        title: `@${state.user} on Gridscape`,
        text: `My GitHub year in 3D — ${formatNumber(state.stats.total)} contributions`,
        url: shareURL(),
      });
    }));
  }

  $('#wrapped-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { openWrapped } = await import('./wrapped.js');
      let skyline = null;
      if (state.scene && !state.compare) {
        state.scene.beginCapture(1080, 1100);
        skyline = copyCanvas(state.scene.captureFrame(0));
        state.scene.endCapture();
      } else if (state.grid) {
        skyline = gridCanvas();
      }
      await openWrapped({
        profile: state.profile,
        rangeKey: state.rangeKey,
        rangeTitle: rangeLabel(),
        days: state.days,
        stats: state.stats,
        repos: state.repos && state.repos.list ? state.repos.list : null,
        achievements: state.achievements,
        skyline,
        site: siteLabel(),
        avatarUrl: state.profile.avatar ? `${state.profile.avatar}${state.profile.avatar.includes('?') ? '&' : '?'}s=300` : null,
      }, {
        onSave: async (canvas, i) => downloadBlob(await canvasToBlob(canvas), `${fileBase()}-review-${i + 1}.png`),
        onShare: async (canvas, i) => {
          try {
            await nativeShare({ blob: await canvasToBlob(canvas), filename: `${fileBase()}-review-${i + 1}.png`, title: 'My year on GitHub', text: 'My year on GitHub', url: shareURL() });
          } catch (err) { if (err?.name !== 'AbortError') toast('Sharing failed'); }
        },
      });
    } catch (err) {
      console.error(err);
      toast('Could not open the year in review');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- Viewer controls ---------- */
function initViewer() {
  $('#rotate-btn').addEventListener('click', (e) => {
    if (!state.scene) return;
    const on = !state.scene.autoRotate;
    state.scene.setAutoRotate(on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });
  $('#night-btn').addEventListener('click', (e) => {
    if (!state.scene) return;
    const on = !state.scene.night;
    state.scene.setNight(on);
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });
  $('#reset-btn').addEventListener('click', () => state.scene?.resetCamera());
  $('#view2d-btn').addEventListener('click', () => setView(state.view === '2d' ? '3d' : '2d'));

  const fsBtn = $('#fullscreen-btn');
  const stage = $('#stage');
  if (!document.fullscreenEnabled || !stage.requestFullscreen) fsBtn.hidden = true;
  fsBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch { /* ignore */ }
  });
  document.addEventListener('fullscreenchange', () => setTimeout(() => state.scene?.resize(), 50));

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('#rotate-btn').setAttribute('aria-pressed', 'false');
  }
}

/* ---------- Loading ---------- */
function errorMessage(err) {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (err.code === 'not_found') return 'That GitHub user does not exist.';
  return err.message;
}

async function load(user, { push = true, year = 'last', vs = null } = {}) {
  state.controller?.abort();
  state.compareController?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const opts = { signal: controller.signal };

  const btn = $('#search-btn');
  btn.disabled = true;
  setStatus(`Fetching @${user}…`);
  $('#user-input').value = user;

  try {
    // Profile and calendar load in parallel; a missing profile (404) stops the calendar requests.
    const contribCtrl = new AbortController();
    controller.signal.addEventListener('abort', () => contribCtrl.abort(), { once: true });
    const contribPromise = fetchContributions(user, { signal: contribCtrl.signal });
    contribPromise.catch(() => {});
    let profile;
    try {
      profile = await fetchProfile(user, opts);
    } catch (err) {
      contribCtrl.abort();
      throw err;
    }
    const data = await contribPromise;
    if (controller.signal.aborted) return;
    state.user = profile.login;
    state.profile = profile;
    state.data = data;
    state.repos = null;
    state.compare = null;
    state.rangeKey = year || 'last';
    $('#compare-input').value = '';
    $('#compare-clear').hidden = true;
    setStatus('', false, '#compare-status');

    $('#result').hidden = false;
    renderProfile();
    renderYears();
    renderRepos();
    renderAchievements();
    renderSources();
    $('#stage-loading').hidden = false;
    await renderRange();
    $('#stage-loading').hidden = true;
    setStatus('');
    syncURL(push);
    if (push) $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });

    fetchRepos(profile.login, opts).then((repos) => {
      if (controller.signal.aborted) return;
      state.repos = repos;
      renderRepos();
      renderAchievements();
      renderSources();
    }).catch(() => {});

    if (!data.complete) {
      setStatus('Loading older years from a backup source…');
      data.loadRest(() => {
        if (controller.signal.aborted) return;
        renderYears();
        renderAchievements();
      }, profile.createdAt).then(() => {
        if (controller.signal.aborted) return;
        setStatus('');
        renderYears();
        renderAchievements();
        if (state.rangeKey !== 'last') renderRange();
      }).catch(() => setStatus(''));
    }

    if (vs) loadCompare(vs, { sync: false });
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (!(err instanceof ApiError)) console.error(err);
    $('#stage-loading').hidden = true;
    setStatus(errorMessage(err), true);
  } finally {
    if (state.controller === controller) btn.disabled = false;
  }
}

async function loadCompare(user, { sync = true } = {}) {
  if (!state.profile) return;
  if (user.toLowerCase() === state.profile.login.toLowerCase()) {
    setStatus('Pick a different user to compare with.', true, '#compare-status');
    return;
  }
  state.compareController?.abort();
  const controller = new AbortController();
  state.compareController = controller;
  const btn = $('#compare-btn');
  btn.disabled = true;
  setStatus(`Fetching @${user}…`, false, '#compare-status');
  try {
    const contribPromise = fetchContributions(user, { signal: controller.signal });
    contribPromise.catch(() => {});
    const profile = await fetchProfile(user, { signal: controller.signal });
    const data = await contribPromise;
    if (controller.signal.aborted) return;
    if (!data.complete) await data.loadRest(null, profile.createdAt);
    state.compare = { user: profile.login, profile, data };
    $('#compare-input').value = profile.login;
    $('#compare-clear').hidden = false;
    setStatus('', false, '#compare-status');
    await renderRange();
    if (sync) syncURL();
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus(errorMessage(err), true, '#compare-status');
  } finally {
    if (state.compareController === controller) btn.disabled = false;
  }
}

function clearCompare() {
  state.compareController?.abort();
  state.compare = null;
  state.cmp = null;
  $('#compare-input').value = '';
  $('#compare-clear').hidden = true;
  setStatus('', false, '#compare-status');
  renderRange();
  syncURL();
}

function initForm() {
  const form = $('#search-form');
  const input = $('#user-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = parseUsername(input.value);
    if (!user) {
      setStatus('Please enter a valid GitHub username or profile link.', true);
      input.focus();
      return;
    }
    load(user);
  });
  document.querySelectorAll('[data-example]').forEach((b) => {
    b.addEventListener('click', () => {
      input.value = b.dataset.example;
      form.requestSubmit();
    });
  });

  $('#compare-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = parseUsername($('#compare-input').value);
    if (!user) {
      setStatus('Please enter a valid GitHub username.', true, '#compare-status');
      return;
    }
    loadCompare(user);
  });
  $('#compare-clear').addEventListener('click', clearCompare);
}

function bootFromURL(push = false) {
  const { user, year, vs } = readParams();
  state.paletteKey = effectiveMode();
  renderLegend(getPalette(state.paletteKey));
  if (user) load(user, { push, year, vs });
}

/* ---------- Service worker (offline + faster repeat visits) ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

initSiteTheme();
initForm();
initViewer();
initShare();
bootFromURL(false);
registerSW();
window.addEventListener('popstate', () => bootFromURL(false));
