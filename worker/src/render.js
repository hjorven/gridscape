// Pure SVG/HTML builders used by the worker (and unit tests). No network access here.
import { buildRange, layoutGrid, computeStats, formatNumber } from '../../js/stats.js';
import { PALETTES } from '../../js/palettes.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, 'DejaVu Sans', sans-serif";

export function rangeData(data, rangeKey, today) {
  const days = buildRange(data, rangeKey, today);
  const grid = layoutGrid(days);
  const stats = computeStats(days, { endsToday: rangeKey === 'last' });
  return { days, grid, stats };
}

export const rangeLabel = (key) => (key === 'last' ? 'the last year' : String(key));

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Isometric skyline as SVG polygons. Weeks run to the lower right, weekdays to the lower left.
 * Returns { svg, width, height } in local coordinates (top-left = 0,0).
 */
export function isoSkyline(grid, max, palette, { tile = 12, maxH = 150, base = true } = {}) {
  const s = tile;
  const weeks = Math.max(1, grid.weeks);
  const ox = 7 * s + s; // room on the left for the weekday axis
  const oy = maxH + s;
  const pos = (w, d) => [ox + (w - d) * s, oy + (w + d) * (s / 2)];
  const out = [];

  if (base) {
    // Plinth under the whole grid
    const pad = 0.6;
    const [ax, ay] = pos(-pad, -pad);
    const [bx, by] = pos(weeks - 1 + pad + 1, -pad);
    const [cx, cy] = pos(weeks - 1 + pad + 1, 7 + pad);
    const [dx, dy] = pos(-pad, 7 + pad);
    const h = s * 0.9;
    const top = palette.base;
    out.push(`<polygon points="${dx},${dy} ${cx},${cy} ${cx},${cy + h} ${dx},${dy + h}" fill="${shade(top, 0.7)}"/>`);
    out.push(`<polygon points="${cx},${cy} ${bx},${by} ${bx},${by + h} ${cx},${cy + h}" fill="${shade(top, 0.85)}"/>`);
    out.push(`<polygon points="${ax},${ay} ${bx},${by} ${cx},${cy} ${dx},${dy}" fill="${top}"/>`);
  }

  const cells = [...grid.cells].sort((a, b) => (a.week + a.dow) - (b.week + b.dow) || a.week - b.week);
  const inner = s * 0.86;
  for (const c of cells) {
    const [x0, y0] = pos(c.week, c.dow);
    const x = x0;
    const y = y0 + (s - inner) / 2;
    const h = c.count && max ? 2 + Math.pow(c.count / max, 0.55) * maxH : 1.5;
    const color = palette.levels[c.level] || palette.levels[0];
    const p = (px, py) => `${px.toFixed(1)},${py.toFixed(1)}`;
    const top = [p(x, y - h), p(x + inner, y - h - inner / 2), p(x + 2 * inner, y - h), p(x + inner, y - h + inner / 2)];
    const left = [p(x, y - h), p(x + inner, y - h + inner / 2), p(x + inner, y + inner / 2), p(x, y)];
    const right = [p(x + inner, y - h + inner / 2), p(x + 2 * inner, y - h), p(x + 2 * inner, y), p(x + inner, y + inner / 2)];
    out.push(`<polygon points="${left.join(' ')}" fill="${shade(color, 0.62)}"/>`);
    out.push(`<polygon points="${right.join(' ')}" fill="${shade(color, 0.8)}"/>`);
    out.push(`<polygon points="${top.join(' ')}" fill="${color}"/>`);
  }
  const width = ox + weeks * s + s * 2;
  const height = oy + (weeks + 7) * (s / 2) + s * 2;
  return { svg: out.join(''), width, height };
}

/* ------------------------------------------------------------------ badge */

function textWidth(str, size) {
  // Rough average glyph width for system sans fonts; textLength fixes the final width.
  let w = 0;
  for (const ch of str) w += /[ilj.,'|·:]/.test(ch) ? 0.3 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.64 : 0.55;
  return Math.ceil(w * size);
}

export function badgeSVG({ label = 'GitHub in 3D', value, theme = 'dark' }) {
  const pal = PALETTES[theme] || PALETTES.dark;
  const size = 11;
  const lw = textWidth(label, size) + 30; // icon + padding
  const vw = textWidth(value, size) + 16;
  const W = lw + vw;
  const H = 20;
  const labelBg = theme === 'light' ? '#f6f8fa' : '#21262d';
  const labelFg = theme === 'light' ? '#1f2328' : '#e6edf3';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<clipPath id="r"><rect width="${W}" height="${H}" rx="4"/></clipPath>
<g clip-path="url(#r)">
<rect width="${lw}" height="${H}" fill="${labelBg}"/>
<rect x="${lw}" width="${vw}" height="${H}" fill="${pal.levels[3]}"/>
</g>
<g transform="translate(6 4)">
<rect x="0" y="6" width="4" height="6" rx="1" fill="${pal.levels[2]}"/>
<rect x="4.5" y="1" width="4" height="11" rx="1" fill="${pal.levels[4]}"/>
<rect x="9" y="4" width="4" height="8" rx="1" fill="${pal.levels[3]}"/>
</g>
<g font-family="${FONT}" font-size="${size}" font-weight="600">
<text x="24" y="14" fill="${labelFg}" textLength="${lw - 30}">${esc(label)}</text>
<text x="${lw + 8}" y="14" fill="#ffffff" textLength="${vw - 16}">${esc(value)}</text>
</g>
</svg>`;
}

/* ------------------------------------------------------------------ README card */

export function cardSVG({ profile, data, rangeKey = 'last', theme = 'dark', today }) {
  const pal = PALETTES[theme] || PALETTES.dark;
  const { grid, stats } = rangeData(data, rangeKey, today);
  const sky = isoSkyline(grid, stats.max, pal, { tile: 9, maxH: 90 });
  const W = 840;
  const H = 330;
  const scale = Math.min((W - 300) / sky.width, (H - 30) / sky.height);
  const border = theme === 'light' ? '#d0d7de' : '#30363d';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(profile.login)}: ${stats.total} contributions">
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${pal.bg}" stroke="${border}"/>
<g font-family="${FONT}">
<text x="28" y="56" font-size="22" font-weight="600" fill="${pal.text}">${esc(profile.name || profile.login)}</text>
<text x="28" y="82" font-size="15" fill="${pal.muted}">@${esc(profile.login)}</text>
<text x="28" y="160" font-size="48" font-weight="700" fill="${pal.text}">${formatNumber(stats.total)}</text>
<text x="28" y="186" font-size="14" fill="${pal.muted}">contributions in ${esc(rangeLabel(rangeKey))}</text>
<text x="28" y="232" font-size="14" fill="${pal.muted}"><tspan font-weight="600" fill="${pal.text}">${stats.longest}</tspan> day longest streak</text>
<text x="28" y="256" font-size="14" fill="${pal.muted}"><tspan font-weight="600" fill="${pal.text}">${stats.best ? formatNumber(stats.best.count) : 0}</tspan> on the best day</text>
<text x="28" y="302" font-size="12" fill="${pal.muted}">Gridscape</text>
</g>
<g transform="translate(${W - sky.width * scale - 16} ${(H - sky.height * scale) / 2}) scale(${scale.toFixed(4)})">${sky.svg}</g>
</svg>`;
}

/* ------------------------------------------------------------------ Open Graph image (SVG, rendered to PNG) */

export function ogSVG({ profiles, datas, rangeKey = 'last', avatars = [], today }) {
  const pal = PALETTES.dark;
  const W = 1200;
  const H = 630;
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="${pal.bg}"/>`);
  const font = "'DejaVu Sans'";

  if (profiles.length === 1) {
    const [profile] = profiles;
    const { grid, stats } = rangeData(datas[0], rangeKey, today);
    const sky = isoSkyline(grid, stats.max, pal, { tile: 13, maxH: 170 });
    const scale = Math.min(720 / sky.width, 560 / sky.height);
    parts.push(`<g transform="translate(${W - sky.width * scale - 20} ${(H - sky.height * scale) / 2 + 10}) scale(${scale.toFixed(4)})">${sky.svg}</g>`);
    if (avatars[0]) {
      parts.push(`<clipPath id="av"><circle cx="108" cy="110" r="46"/></clipPath>`);
      parts.push(`<image href="${avatars[0]}" x="62" y="64" width="92" height="92" clip-path="url(#av)"/>`);
      parts.push(`<circle cx="108" cy="110" r="47" fill="none" stroke="#30363d" stroke-width="2"/>`);
    } else {
      parts.push(`<circle cx="108" cy="110" r="46" fill="${pal.levels[2]}"/>`);
      parts.push(`<text x="108" y="126" text-anchor="middle" font-family="${font}" font-weight="bold" font-size="44" fill="#ffffff">${esc(String(profile.login).slice(0, 1).toUpperCase())}</text>`);
    }
    const name = String(profile.name || profile.login);
    const nameSize = name.length > 16 ? 26 : 34;
    parts.push(`<text x="176" y="104" font-family="${font}" font-weight="bold" font-size="${nameSize}" fill="${pal.text}">${esc(name.slice(0, 28))}</text>`);
    parts.push(`<text x="176" y="138" font-family="${font}" font-size="22" fill="${pal.muted}">@${esc(profile.login)}</text>`);
    const total = formatNumber(stats.total);
    const bigSize = total.length > 6 ? 84 : 104;
    parts.push(`<text x="58" y="310" font-family="${font}" font-weight="bold" font-size="${bigSize}" fill="${pal.text}">${total}</text>`);
    parts.push(`<text x="62" y="352" font-family="${font}" font-size="26" fill="${pal.muted}">contributions in ${esc(rangeLabel(rangeKey))}</text>`);
    const items = [[`${stats.longest}`, 'day streak'], [stats.best ? formatNumber(stats.best.count) : '0', 'best day'], [`${stats.activePct}%`, 'active days']];
    items.forEach(([v, l], i) => {
      const x = 60 + i * 140;
      parts.push(`<rect x="${x}" y="400" width="128" height="92" rx="10" fill="${pal.base}"/>`);
      parts.push(`<text x="${x + 14}" y="446" font-family="${font}" font-weight="bold" font-size="30" fill="${pal.text}">${esc(v)}</text>`);
      parts.push(`<text x="${x + 14}" y="474" font-family="${font}" font-size="15" fill="${pal.muted}">${esc(l)}</text>`);
    });
  } else {
    // Compare: two skylines stacked, names and totals on the left
    const colors = [pal, COMPARE_PALETTE];
    profiles.forEach((profile, i) => {
      const { grid, stats } = rangeData(datas[i], rangeKey, today);
      const sky = isoSkyline(grid, stats.max, colors[i], { tile: 9, maxH: 90 });
      const scale = Math.min(700 / sky.width, 290 / sky.height);
      const y0 = i * 300 + 20;
      parts.push(`<g transform="translate(${W - sky.width * scale - 20} ${y0}) scale(${scale.toFixed(4)})">${sky.svg}</g>`);
      parts.push(`<rect x="60" y="${y0 + 90}" width="10" height="110" rx="5" fill="${colors[i].levels[4]}"/>`);
      parts.push(`<text x="92" y="${y0 + 126}" font-family="${font}" font-weight="bold" font-size="32" fill="${pal.text}">@${esc(profile.login)}</text>`);
      parts.push(`<text x="92" y="${y0 + 190}" font-family="${font}" font-weight="bold" font-size="56" fill="${pal.text}">${formatNumber(stats.total)}</text>`);
    });
    parts.push(`<text x="92" y="330" font-family="${font}" font-size="24" fill="${pal.muted}">vs</text>`);
  }
  parts.push(`<text x="60" y="${H - 40}" font-family="${font}" font-size="18" fill="${pal.muted}">Gridscape · GitHub contributions in 3D</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

export const COMPARE_PALETTE = {
  levels: ['#161b22', '#0c2d6b', '#1158c7', '#388bfd', '#79c0ff'],
  bg: '#0d1117', base: '#21262d', text: '#e6edf3', muted: '#7d8590', accent: '#58a6ff',
};

/* ------------------------------------------------------------------ share page */

export function sharePageHTML({ title, description, image, target, canonical }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Gridscape">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<style>body{background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#4493f8}</style>
</head>
<body>
<p>Opening <a href="${esc(target)}">${esc(title)}</a>…</p>
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>
</body>
</html>`;
}
