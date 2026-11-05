// App controller: wires the UI, data, 3D scene and sharing together.
import { parseUsername, fetchProfile, fetchContributions, fetchRepos, ApiError } from './api.js';
import {
  availableYears, buildRange, layoutGrid, computeStats, topLanguages, topRepos,
  formatDate, formatDateShort, formatNumber, weekdayName, WEEKDAYS, todayISO,
} from './stats.js';
import { DEFAULT_PALETTE, getPalette } from './palettes.js';
import {
  buildShareCard, canvasToBlob, downloadBlob, canShareFiles, nativeShare, copyText, socialLinks, badgeMarkdown,
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
  for (const c of [].concat(children)) if (c) node.append(c);
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
  scene: null,
  sceneFailed: false,
  controller: null,
};

/* ---------- Site light/dark toggle ---------- */
function initSiteTheme() {
  let saved = null;
  try { saved = localStorage.getItem('gs:site-theme'); } catch { /* ignore */ }
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  $('#theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'light' ? 'dark' : 'light';
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

function syncPalette() {
  const key = effectiveMode();
  if (key === state.paletteKey) return;
  state.paletteKey = key;
  applyPalette();
  if (state.stats) renderStats();
  updateShare();
}

/* ---------- Status + toast ---------- */
function setStatus(msg, isError = false) {
  const s = $('#form-status');
  s.textContent = msg || '';
  s.classList.toggle('error', isError);
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2200);
}

/* ---------- URL state ---------- */
function readParams() {
  const p = new URLSearchParams(location.search);
  return {
    user: parseUsername(p.get('user') || p.get('u') || ''),
    year: p.get('year'),
  };
}

function shareURL() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('user', state.user);
  if (state.rangeKey !== 'last') url.searchParams.set('year', state.rangeKey);
  return url.toString();
}

function syncURL(push = false) {
  const url = shareURL();
  if (url === location.href) return;
  history[push ? 'pushState' : 'replaceState']({}, '', url);
}

const siteLabel = () => `${location.host}${location.pathname.replace(/index\.html$/, '')}`.replace(/\/$/, '');

/* ---------- Palette ---------- */
function renderLegend(pal) {
  const legend = $('#legend');
  legend.replaceChildren(...pal.levels.map((c) => {
    const i = el('i');
    i.style.background = c;
    return i;
  }));
}

function applyPalette() {
  const pal = getPalette(state.paletteKey);
  renderLegend(pal);
  $('#stage').style.setProperty('--stage-bg', pal.bg);
  if (state.scene) state.scene.setPalette(pal);
  if (state.view === '2d' || !state.scene) render2D();
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
    $('#view2d-btn').disabled = true;
    $('#rotate-btn').disabled = true;
  }
  return state.scene;
}

function showTooltip(cell, x, y) {
  const tip = $('#tooltip');
  if (!cell) { tip.hidden = true; return; }
  const n = cell.count;
  tip.textContent = `${n === 0 ? 'No' : formatNumber(n)} contribution${n === 1 ? '' : 's'} · ${formatDate(cell.date)}`;
  const stage = $('#stage').getBoundingClientRect();
  tip.style.left = `${Math.min(Math.max(x, 90), stage.width - 90)}px`;
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
  $('#reset-btn').disabled = is2D;
  $('#tooltip').hidden = true;
  if (is2D) render2D();
  else state.scene?.resize();
}

/* ---------- 2D grid (fallback + toggle) ---------- */
function render2D() {
  const box = $('#grid2d');
  if (!state.grid) { box.replaceChildren(); return; }
  const pal = getPalette(state.paletteKey);
  const { cells, weeks } = state.grid;
  const size = 11;
  const gap = 3;
  const left = 28;
  const top = 18;
  const w = left + weeks * (size + gap);
  const h = top + 7 * (size + gap);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w * 2));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${formatNumber(state.stats.total)} contributions`);

  const text = (x, y, str) => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.setAttribute('fill', pal.text);
    t.setAttribute('opacity', '0.6');
    t.setAttribute('font-size', '8');
    t.setAttribute('font-family', 'JetBrains Mono, monospace');
    t.textContent = str;
    svg.append(t);
  };
  [1, 3, 5].forEach((d) => text(0, top + d * (size + gap) + 8, WEEKDAYS[d]));
  let lastMonth = '';
  for (const c of cells) {
    if (c.dow === 0 || c === cells[0]) {
      const m = c.date.slice(5, 7);
      if (m !== lastMonth && Number(c.date.slice(8, 10)) <= 7) {
        text(left + c.week * (size + gap), 10, formatDateShort(c.date).split(' ')[0]);
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
  box.replaceChildren(svg);
}

/** Flat grid drawn on a canvas — used for the share card when WebGL is unavailable. */
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

/* ---------- Rendering ---------- */
function rangeLabel(key = state.rangeKey) {
  return key === 'last' ? 'last year' : String(key);
}

function renderYears() {
  const years = availableYears(state.data);
  const box = $('#years');
  const keys = ['last', ...years.map(String)];
  if (!keys.includes(state.rangeKey)) state.rangeKey = 'last';
  box.replaceChildren(...keys.map((k) => {
    const b = el('button', {
      type: 'button',
      class: 'chip',
      role: 'tab',
      text: k === 'last' ? 'Last year' : k,
    });
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
  avatar.src = p.avatar ? `${p.avatar}${p.avatar.includes('?') ? '&' : '?'}s=176` : '';
  avatar.alt = `Avatar of ${p.login}`;
  $('#p-name').textContent = p.name;
  const login = $('#p-login');
  login.textContent = `@${p.login}`;
  login.href = p.url;
  $('#p-bio').textContent = p.bio;
  $('#p-bio').hidden = !p.bio;
  const meta = [
    [formatNumber(p.followers), ' followers'],
    [formatNumber(p.publicRepos), ' public repos'],
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
    s.current ? `since ${formatDateShort(s.currentStart)}` : 'start one today');
  set('s-best', s.best ? formatNumber(s.best.count) : '–', s.best ? formatDate(s.best.date) : '');
  set('s-active', `${s.activePct}%`, `${s.active} of ${s.days} days`);
  set('s-weekday', s.favoriteWeekday === null ? '–' : weekdayName(s.favoriteWeekday),
    s.total ? `avg ${s.avgPerActive.toFixed(1)} per active day` : '');

  const max = Math.max(...s.weekday, 1);
  $('#weekday-bars').replaceChildren(...s.weekday.map((v, i) => {
    const fill = el('div', { class: 'bar-fill' });
    fill.style.height = `${Math.max(2, (v / max) * 100)}%`;
    fill.style.background = getPalette(state.paletteKey).accent;
    return el('div', { class: 'bar', title: `${weekdayName(i)}: ${formatNumber(v)}` }, [
      el('span', { class: 'bar-value', text: v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v) }),
      fill,
      el('span', { text: WEEKDAYS[i] }),
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
  const langs = topLanguages(repos);
  note.textContent = langs.length ? `Based on ${repos.length} public repositories (excluding forks).` : 'No languages detected yet.';
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

  const top = topRepos(repos);
  if (!top.length) {
    list.replaceChildren(el('li', { class: 'muted', text: 'No public repositories yet.' }));
    return;
  }
  list.replaceChildren(...top.map((r) => {
    const meta = el('div', { class: 'repo-meta' }, [
      el('span', { text: `★ ${formatNumber(r.stars)}` }),
      el('span', { text: `⑂ ${formatNumber(r.forks)}` }),
      r.language ? el('span', { text: r.language }) : null,
    ]);
    const a = el('a', { href: r.url, target: '_blank', rel: 'noopener' }, [
      el('div', { class: 'repo-name', text: r.name }),
      r.description ? el('p', { class: 'repo-desc', text: r.description }) : null,
      meta,
    ]);
    return el('li', {}, a);
  }));
}

async function renderRange() {
  const today = todayISO();
  state.days = buildRange(state.data, state.rangeKey, today);
  state.grid = layoutGrid(state.days);
  const endsToday = state.days.length && state.days[state.days.length - 1].date === today;
  state.stats = computeStats(state.days, { endsToday });
  renderStats();
  updateShare();
  $('#viewer-title').textContent = `${formatNumber(state.stats.total)} contributions in ${state.rangeKey === 'last' ? 'the last year' : state.rangeKey}`;

  const pal = getPalette(state.paletteKey);
  if (state.view === '2d' || state.sceneFailed) render2D();
  const scene = await ensureScene();
  if (scene) {
    scene.setData({
      cells: state.grid.cells,
      weeks: state.grid.weeks,
      max: state.stats.max,
      labelText: {
        left: `@${state.profile.login} · ${rangeLabel()}`,
        right: `${formatNumber(state.stats.total)} contributions`,
      },
    }, pal);
  }
}

/* ---------- Share ---------- */
function updateShare() {
  if (!state.user || !state.stats) return;
  const url = shareURL();
  $('#share-url').value = url;
  const text = `My GitHub year in 3D: ${formatNumber(state.stats.total)} contributions (${rangeLabel()}), longest streak ${state.stats.longest} days.`;
  const links = socialLinks({ url, text });
  $('#share-x').href = links.x;
  $('#share-bsky').href = links.bsky;
  $('#share-li').href = links.li;
  $('#share-reddit').href = links.reddit;
  const badgeUrl = new URL(url);
  badgeUrl.searchParams.delete('year');
  const badge = badgeMarkdown(badgeUrl.toString(), '#39d353');
  $('#badge-md').textContent = badge.md;
  $('#badge-img').src = badge.img;
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
  });
  return canvasToBlob(card);
}

function fileBase() {
  return `gridscape-${state.user}-${state.rangeKey}`;
}

function initShare() {
  $('#copy-link').addEventListener('click', async () => {
    toast((await copyText($('#share-url').value)) ? 'Link copied' : 'Copy failed — select the link manually');
  });
  $('#copy-badge').addEventListener('click', async () => {
    toast((await copyText($('#badge-md').textContent)) ? 'Markdown copied' : 'Copy failed');
  });

  const busy = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); } catch (err) {
      if (err?.name !== 'AbortError') { console.error(err); toast('Something went wrong'); }
    } finally { btn.disabled = false; }
  };

  $('#dl-card').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    downloadBlob(await makeCardBlob(), `${fileBase()}-card.png`);
  }));

  $('#dl-3d').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const source = state.scene && state.view === '3d' ? state.scene.snapshot() : gridCanvas();
    downloadBlob(await canvasToBlob(source), `${fileBase()}.png`);
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
}

/* ---------- Viewer controls ---------- */
function initViewer() {
  $('#rotate-btn').addEventListener('click', (e) => {
    if (!state.scene) return;
    const on = !state.scene.autoRotate;
    state.scene.setAutoRotate(on);
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
async function load(user, { push = true, year = null } = {}) {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const opts = { signal: controller.signal };

  const btn = $('#search-btn');
  btn.disabled = true;
  setStatus(`Fetching @${user}…`);
  $('#user-input').value = user;

  try {
    const [profile, data] = await Promise.all([fetchProfile(user, opts), fetchContributions(user, opts)]);
    if (controller.signal.aborted) return;
    state.user = profile.login;
    state.profile = profile;
    state.data = data;
    state.repos = null;
    if (year) state.rangeKey = year;
    else if (push) state.rangeKey = 'last';

    $('#result').hidden = false;
    renderProfile();
    renderYears();
    renderRepos();
    $('#stage-loading').hidden = false;
    await renderRange();
    $('#stage-loading').hidden = true;
    setStatus('');
    syncURL(push);

    fetchRepos(profile.login, opts).then((repos) => {
      if (controller.signal.aborted) return;
      state.repos = repos;
      renderRepos();
    }).catch(() => {});

    if (push) $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (!(err instanceof ApiError)) console.error(err);
    $('#stage-loading').hidden = true;
    setStatus(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.', true);
  } finally {
    if (state.controller === controller) btn.disabled = false;
  }
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
}

function bootFromURL(push = false) {
  const { user, year } = readParams();
  state.paletteKey = effectiveMode();
  renderLegend(getPalette(state.paletteKey));
  if (user) load(user, { push, year: year && /^(last|\d{4})$/.test(year) ? year : 'last' });
}

initSiteTheme();
initForm();
initViewer();
initShare();
bootFromURL(false);
window.addEventListener('popstate', () => bootFromURL(false));
