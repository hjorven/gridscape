// Share helpers: 1200x630 card rendering, downloads, Web Share API, social links.
import { formatNumber } from './stats.js';

const W = 1200;
const H = 630;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

function loadImage(src, timeout = 5000) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), timeout);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

function drawCover(ctx, source, dx, dy, dw, dh) {
  const sw = source.width;
  const sh = source.height;
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const w = dw / scale;
  const h = dh / scale;
  ctx.drawImage(source, (sw - w) / 2, (sh - h) / 2, w, h, dx, dy, dw, dh);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, font, startSize, minSize = 18) {
  let size = startSize;
  ctx.font = font(size);
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = font(size);
  }
  return size;
}

export async function buildShareCard({ profile, stats, rangeLabel, palette, sceneCanvas, siteLabel, achievements = [], compare = null }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const light = palette.bg.toLowerCase() === '#ffffff';

  // Background
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);

  // 3D render on the right, fading into the background
  if (sceneCanvas) {
    drawCover(ctx, sceneCanvas, 380, 0, W - 380, H);
    const fade = ctx.createLinearGradient(380, 0, 640, 0);
    fade.addColorStop(0, palette.bg);
    fade.addColorStop(1, palette.bg + '00');
    ctx.fillStyle = fade;
    ctx.fillRect(380, 0, 260, H);
  }

  if (compare) {
    drawCompare(ctx, { profile, stats, palette, compare, rangeLabel });
    ctx.fillStyle = palette.muted;
    ctx.font = `600 18px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(siteLabel, 60, H - 48);
    return canvas;
  }

  // Avatar
  const avatarSrc = profile.avatar ? `${profile.avatar}${profile.avatar.includes('?') ? '&' : '?'}s=192` : null;
  const avatar = await loadImage(avatarSrc);
  const ax = 64;
  const ay = 64;
  const ar = 44;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, ax, ay, ar * 2, ar * 2);
  } else {
    ctx.fillStyle = palette.levels[2];
    ctx.fillRect(ax, ay, ar * 2, ar * 2);
    ctx.fillStyle = palette.text;
    ctx.font = `700 40px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(profile.login.slice(0, 1).toUpperCase(), ax + ar, ay + ar + 2);
  }
  ctx.restore();
  ctx.strokeStyle = light ? '#d0d7de' : '#30363d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ax + ar, ay + ar, ar + 2, 0, Math.PI * 2);
  ctx.stroke();

  // Name + handle
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = palette.text;
  fitText(ctx, profile.name, 300, (s) => `700 ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`, 34);
  ctx.fillText(profile.name, ax + ar * 2 + 20, ay + 40);
  ctx.fillStyle = palette.muted;
  ctx.font = '400 20px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
  ctx.fillText(`@${profile.login}`, ax + ar * 2 + 20, ay + 72);

  // Big number
  const totalText = formatNumber(stats.total);
  ctx.fillStyle = palette.text;
  fitText(ctx, totalText, 420, (s) => `700 ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`, 112, 48);
  ctx.fillText(totalText, 60, 300);
  ctx.fillStyle = palette.muted;
  ctx.font = '500 26px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
  ctx.fillText(`contributions · ${rangeLabel}`, 62, 342);

  // Mini stats
  const items = [
    ['Longest streak', `${stats.longest} ${stats.longest === 1 ? 'day' : 'days'}`],
    ['Best day', stats.best ? `${stats.best.count}` : '–'],
    ['Active days', `${stats.activePct}%`],
  ];
  items.forEach(([labelText, value], i) => {
    const x = 60 + i * 140;
    const y = 400;
    ctx.fillStyle = palette.base;
    roundRect(ctx, x, y, 128, 92, 14);
    ctx.fill();
    ctx.fillStyle = palette.text;
    fitText(ctx, value, 108, (s) => `700 ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`, 30, 16);
    ctx.fillText(value, x + 14, y + 46);
    ctx.fillStyle = palette.muted;
    ctx.font = '500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
    ctx.fillText(labelText, x + 14, y + 74);
  });

  // Achievements (up to three)
  const earned = achievements.filter((a) => a.earned).slice(0, 3);
  let ax2 = 60;
  for (const a of earned) {
    ctx.font = `600 15px ${FONT}`;
    const w = ctx.measureText(a.title).width + 52;
    if (ax2 + w > 470) break;
    ctx.fillStyle = palette.base;
    roundRect(ctx, ax2, 512, w, 34, 17);
    ctx.fill();
    ctx.fillStyle = palette.levels[3];
    ctx.beginPath();
    ctx.arc(ax2 + 17, 529, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `800 ${a.icon.length > 2 ? 9 : 11}px ${FONT}`;
    ctx.fillText(a.icon, ax2 + 17, 533);
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.text;
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText(a.title, ax2 + 36, 534);
    ax2 += w + 8;
  }

  // Footer
  ctx.fillStyle = palette.muted;
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(siteLabel, 60, H - 40);

  return canvas;
}

function drawCompare(ctx, { profile, stats, palette, compare, rangeLabel }) {
  const rows = [
    { p: profile, s: stats, pal: palette },
    { p: compare.profile, s: compare.stats, pal: compare.palette },
  ];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  rows.forEach((r, i) => {
    const y = 90 + i * 230;
    ctx.fillStyle = r.pal.levels[4];
    roundRect(ctx, 60, y, 8, 150, 4);
    ctx.fill();
    ctx.fillStyle = palette.muted;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(`@${r.p.login}`, 90, y + 30);
    ctx.fillStyle = palette.text;
    fitText(ctx, formatNumber(r.s.total), 320, (sz) => `700 ${sz}px ${FONT}`, 76, 36);
    ctx.fillText(formatNumber(r.s.total), 86, y + 104);
    ctx.fillStyle = palette.muted;
    ctx.font = `500 17px ${FONT}`;
    ctx.fillText(`${r.s.longest}d streak · best day ${r.s.best ? r.s.best.count : 0}`, 90, y + 140);
  });
  ctx.fillStyle = palette.muted;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(`vs · ${rangeLabel}`, 90, 300);
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function canShareFiles() {
  try {
    const f = new File([''], 'x.png', { type: 'image/png' });
    return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [f] }));
  } catch {
    return false;
  }
}

export async function nativeShare({ blob, filename, title, text, url }) {
  const data = { title, text, url };
  if (blob) {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) data.files = [file];
  }
  await navigator.share(data);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers / insecure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function socialLinks({ url, text }) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return {
    x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
    bsky: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`)}`,
    li: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    reddit: `https://www.reddit.com/submit?url=${u}&title=${t}`,
  };
}

/**
 * README snippets. With the worker: a live badge and a card with a mini skyline that update
 * automatically. Without it: a static shields.io badge.
 */
export function readmeEmbeds({ pageUrl, user, workerUrl, theme = 'dark' }) {
  const w = (workerUrl || '').replace(/\/+$/, '');
  if (!w) {
    const img = 'https://img.shields.io/badge/my_GitHub-in_3D-39d353?style=for-the-badge&logo=github&logoColor=white&labelColor=0d1117';
    return [{ id: 'badge', label: 'Badge', img, md: `[![My GitHub in 3D](${img})](${pageUrl})` }];
  }
  const t = theme === 'light' ? '?theme=light' : '';
  const badge = `${w}/badge/${user}.svg${t}`;
  const card = `${w}/card/${user}.svg${t}`;
  return [
    { id: 'badge', label: 'Live badge', img: badge, md: `[![${user}'s GitHub in 3D](${badge})](${pageUrl})` },
    { id: 'card', label: 'Skyline card', img: card, md: `[![${user}'s GitHub skyline](${card})](${pageUrl})` },
  ];
}

