// "Wrapped": a tap-through year-in-review story. Every slide is drawn on a 1080x1920 canvas,
// so what you see is exactly what you can save or share.
import { PALETTES } from './palettes.js';
import { formatNumber, formatDate, weekdayName } from './stats.js';
import { topLanguages } from './stats.js';

const W = 1080;
const H = 1920;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SLIDE_MS = 5500;
const pal = PALETTES.dark;

const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function background(ctx, hue = 0) {
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  // Soft green glow, position varies per slide
  const g = ctx.createRadialGradient(W * (0.2 + 0.6 * ((hue * 0.37) % 1)), H * 0.15, 40, W * 0.5, H * 0.2, W * 1.1);
  g.addColorStop(0, 'rgba(57, 211, 83, 0.20)');
  g.addColorStop(1, 'rgba(57, 211, 83, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Faint contribution grid at the bottom
  ctx.globalAlpha = 0.28;
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 7; y++) {
      const lvl = (x * 7 + y * 3 + hue * 5) % 5;
      ctx.fillStyle = pal.levels[lvl];
      ctx.fillRect(40 + x * 51, H - 520 + y * 51, 42, 42);
    }
  }
  ctx.globalAlpha = 1;
  const fade = ctx.createLinearGradient(0, H - 460, 0, H);
  fade.addColorStop(0, pal.bg);
  fade.addColorStop(1, pal.bg + '00');
  ctx.fillStyle = fade;
  ctx.fillRect(0, H - 460, W, 460);
}

function text(ctx, str, x, y, { size = 48, weight = 600, color = pal.text, align = 'left', alpha = 1, maxWidth } = {}) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  if (maxWidth) {
    while (ctx.measureText(str).width > maxWidth && s > 20) {
      s -= 4;
      ctx.font = `${weight} ${s}px ${FONT}`;
    }
  }
  ctx.fillText(str, x, y);
  ctx.globalAlpha = 1;
}

function footer(ctx, d) {
  text(ctx, `@${d.profile.login} · ${d.rangeTitle}`, 80, H - 96, { size: 34, weight: 500, color: pal.muted });
  text(ctx, d.site, W - 80, H - 96, { size: 30, weight: 600, color: pal.muted, align: 'right' });
}

function bars(ctx, values, labels, x, y, w, h, t, highlight) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const gap = 14;
  const bw = (w - gap * (n - 1)) / n;
  values.forEach((v, i) => {
    const bh = Math.max(6, (v / max) * h * ease(t * 1.4 - i * 0.04));
    ctx.fillStyle = i === highlight ? pal.accent : pal.levels[2];
    ctx.beginPath();
    ctx.roundRect(x + i * (bw + gap), y + h - bh, bw, bh, 8);
    ctx.fill();
    text(ctx, labels[i], x + i * (bw + gap) + bw / 2, y + h + 50, { size: 28, weight: 500, color: pal.muted, align: 'center' });
  });
}

/* ------------------------------------------------------------------ slides */

function buildSlides(d) {
  const slides = [];
  const s = d.stats;

  slides.push({
    draw(ctx, t) {
      background(ctx, 0);
      if (d.avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(W / 2, 560, 150, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = ease(t * 2);
        ctx.drawImage(d.avatar, W / 2 - 150, 410, 300, 300);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      text(ctx, `@${d.profile.login}`, W / 2, 840, { size: 56, weight: 600, color: pal.muted, align: 'center', alpha: ease(t * 2) });
      text(ctx, d.rangeKey === 'last' ? 'Your last year' : `Your ${d.rangeKey}`, W / 2, 1000, { size: 104, weight: 700, align: 'center', alpha: ease(t * 2 - 0.3) });
      text(ctx, 'on GitHub', W / 2, 1120, { size: 104, weight: 700, color: pal.accent, align: 'center', alpha: ease(t * 2 - 0.5) });
      text(ctx, 'Tap to continue', W / 2, 1320, { size: 34, weight: 500, color: pal.muted, align: 'center', alpha: ease(t * 2 - 1) });
    },
  });

  slides.push({
    draw(ctx, t) {
      background(ctx, 1);
      text(ctx, 'You made', 80, 640, { size: 64, weight: 600, color: pal.muted });
      text(ctx, formatNumber(Math.round(s.total * ease(t * 1.2))), 70, 860, { size: 230, weight: 800, maxWidth: W - 140 });
      text(ctx, 'contributions', 80, 960, { size: 72, weight: 700, color: pal.accent });
      if (s.active) {
        text(ctx, `on ${s.active} different days —`, 80, 1120, { size: 48, weight: 500, color: pal.muted, alpha: ease(t * 2 - 1) });
        text(ctx, `${s.avgPerActive.toFixed(1)} per active day.`, 80, 1186, { size: 48, weight: 500, color: pal.muted, alpha: ease(t * 2 - 1) });
      }
      footer(ctx, d);
    },
  });

  const monthly = new Array(12).fill(0);
  for (const day of d.days) monthly[Number(day.date.slice(5, 7)) - 1] += day.count;
  const bestMonth = monthly.indexOf(Math.max(...monthly));
  if (s.total > 0) {
    slides.push({
      draw(ctx, t) {
        background(ctx, 2);
        text(ctx, 'Your biggest month', 80, 420, { size: 60, weight: 600, color: pal.muted });
        text(ctx, MONTHS[bestMonth], 80, 560, { size: 130, weight: 800, color: pal.accent });
        text(ctx, `${formatNumber(monthly[bestMonth])} contributions`, 80, 640, { size: 48, weight: 500, color: pal.muted });
        bars(ctx, monthly, MONTHS.map((m) => m[0]), 80, 820, W - 160, 520, t, bestMonth);
        footer(ctx, d);
      },
    });
  }

  if (s.longest > 0) {
    slides.push({
      draw(ctx, t) {
        background(ctx, 3);
        text(ctx, 'Longest streak', 80, 520, { size: 60, weight: 600, color: pal.muted });
        text(ctx, `${Math.round(s.longest * ease(t * 1.3))}`, 70, 790, { size: 260, weight: 800 });
        text(ctx, s.longest === 1 ? 'day in a row' : 'days in a row', 80, 890, { size: 72, weight: 700, color: pal.accent });
        text(ctx, `${formatDate(s.longestStart)} – ${formatDate(s.longestEnd)}`, 80, 980, { size: 40, weight: 500, color: pal.muted });
        const n = Math.min(s.longest, 49);
        const shown = Math.floor(n * ease(t * 1.5));
        for (let i = 0; i < shown; i++) {
          ctx.fillStyle = pal.levels[2 + (i % 3)];
          ctx.beginPath();
          ctx.roundRect(80 + (i % 7) * 132, 1080 + Math.floor(i / 7) * 56, 120, 44, 8);
          ctx.fill();
        }
        footer(ctx, d);
      },
    });
  }

  if (s.favoriteWeekday !== null) {
    slides.push({
      draw(ctx, t) {
        background(ctx, 4);
        text(ctx, 'Your favorite day', 80, 420, { size: 60, weight: 600, color: pal.muted });
        text(ctx, `${weekdayName(s.favoriteWeekday)}s`, 80, 560, { size: 130, weight: 800, color: pal.accent });
        bars(ctx, s.weekday, ['S', 'M', 'T', 'W', 'T', 'F', 'S'], 80, 760, W - 160, 560, t, s.favoriteWeekday);
        footer(ctx, d);
      },
    });
  }

  if (s.best) {
    slides.push({
      draw(ctx, t) {
        background(ctx, 5);
        text(ctx, 'Your biggest day', 80, 640, { size: 60, weight: 600, color: pal.muted });
        text(ctx, formatDate(s.best.date), 80, 780, { size: 100, weight: 800, maxWidth: W - 160 });
        text(ctx, `${formatNumber(Math.round(s.best.count * ease(t * 1.3)))}`, 70, 1040, { size: 230, weight: 800, color: pal.accent });
        text(ctx, 'contributions in one day', 80, 1130, { size: 52, weight: 600, color: pal.muted });
        footer(ctx, d);
      },
    });
  }

  const langs = d.repos ? topLanguages(d.repos, 5).filter((l) => l.name !== 'Other') : [];
  if (langs.length) {
    slides.push({
      draw(ctx, t) {
        background(ctx, 6);
        text(ctx, 'Top language', 80, 420, { size: 60, weight: 600, color: pal.muted });
        text(ctx, langs[0].name, 80, 560, { size: 130, weight: 800, color: langs[0].color === '#000080' ? pal.accent : langs[0].color, maxWidth: W - 160 });
        langs.forEach((l, i) => {
          const y = 760 + i * 150;
          const a = ease(t * 2 - i * 0.15);
          text(ctx, l.name, 80, y, { size: 48, weight: 600, alpha: a });
          text(ctx, `${l.pct.toFixed(0)}%`, W - 80, y, { size: 44, weight: 500, color: pal.muted, align: 'right', alpha: a });
          ctx.fillStyle = pal.base;
          ctx.beginPath();
          ctx.roundRect(80, y + 30, W - 160, 22, 11);
          ctx.fill();
          ctx.fillStyle = l.color;
          ctx.beginPath();
          ctx.roundRect(80, y + 30, Math.max(22, (W - 160) * (l.pct / 100) * a), 22, 11);
          ctx.fill();
        });
        footer(ctx, d);
      },
    });
  }

  const earned = (d.achievements || []).filter((a) => a.earned).slice(0, 6);
  if (earned.length) {
    slides.push({
      draw(ctx, t) {
        background(ctx, 7);
        text(ctx, 'Achievements', 80, 420, { size: 60, weight: 600, color: pal.muted });
        text(ctx, `${earned.length} unlocked`, 80, 540, { size: 110, weight: 800, color: pal.accent });
        earned.forEach((a, i) => {
          const y = 680 + i * 170;
          const al = ease(t * 2.2 - i * 0.2);
          ctx.globalAlpha = al;
          ctx.fillStyle = pal.base;
          ctx.beginPath();
          ctx.roundRect(80, y, W - 160, 140, 24);
          ctx.fill();
          ctx.fillStyle = pal.levels[3];
          ctx.beginPath();
          ctx.arc(160, y + 70, 46, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          text(ctx, a.icon, 160, y + 86, { size: 38, weight: 800, color: '#ffffff', align: 'center', alpha: al });
          text(ctx, a.title, 240, y + 64, { size: 46, weight: 700, alpha: al });
          text(ctx, a.desc, 240, y + 112, { size: 32, weight: 500, color: pal.muted, alpha: al, maxWidth: W - 360 });
        });
        footer(ctx, d);
      },
    });
  }

  slides.push({
    draw(ctx, t) {
      background(ctx, 8);
      text(ctx, 'Your year,', 80, 300, { size: 84, weight: 800 });
      text(ctx, 'as a skyline.', 80, 400, { size: 84, weight: 800, color: pal.accent });
      if (d.skyline) {
        const img = d.skyline;
        const iw = W;
        const ih = Math.min(1100, iw * (img.height / img.width));
        const sw = img.width;
        const sh = sw * (ih / iw);
        ctx.globalAlpha = ease(t * 1.5);
        ctx.drawImage(img, 0, (img.height - sh) / 2, sw, sh, 0, 480, iw, ih);
        ctx.globalAlpha = 1;
      }
      text(ctx, `${formatNumber(s.total)} contributions · ${d.rangeTitle}`, W / 2, 1660, { size: 42, weight: 600, align: 'center' });
      text(ctx, `Make yours at ${d.site}`, W / 2, 1730, { size: 34, weight: 500, color: pal.muted, align: 'center' });
    },
  });

  return slides;
}

/* ------------------------------------------------------------------ player */

export async function openWrapped(input, { onSave, onShare } = {}) {
  const avatar = input.avatarUrl ? await loadImage(input.avatarUrl) : null;
  const d = { ...input, avatar };
  const slides = buildSlides(d);

  const root = document.createElement('div');
  root.className = 'wrapped';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Year in review');
  root.innerHTML = `
    <div class="wrapped-frame">
      <div class="wrapped-progress"></div>
      <canvas width="${W}" height="${H}" aria-live="polite"></canvas>
      <div class="wrapped-actions">
        <button type="button" class="btn" data-act="save">Save image</button>
        <button type="button" class="btn" data-act="share" hidden>Share</button>
        <button type="button" class="btn btn-primary" data-act="close">Close</button>
      </div>
    </div>`;
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const progress = root.querySelector('.wrapped-progress');
  progress.append(...slides.map(() => {
    const seg = document.createElement('span');
    seg.append(document.createElement('i'));
    return seg;
  }));

  let index = 0;
  let slideStart = performance.now();
  let paused = false;
  let pausedAt = 0;
  let raf = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render(now) {
    const elapsed = now - slideStart;
    const t = reduced ? 1 : elapsed / 1000;
    slides[index].draw(ctx, t);
    [...progress.children].forEach((seg, i) => {
      seg.firstChild.style.width = i < index ? '100%' : i > index ? '0%' : `${Math.min(100, (elapsed / SLIDE_MS) * 100)}%`;
    });
    if (!paused && elapsed >= SLIDE_MS) {
      if (index < slides.length - 1) go(index + 1);
      else { paused = true; pausedAt = now; } // stay on the last slide
    }
    raf = requestAnimationFrame((n) => render(paused ? pausedAt : n));
  }

  function go(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    slideStart = performance.now();
    paused = false;
    canvas.setAttribute('aria-label', `Slide ${index + 1} of ${slides.length}`);
  }

  function close() {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    root.remove();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(index + 1); }
    else if (e.key === 'ArrowLeft') go(index - 1);
  }
  document.addEventListener('keydown', onKey);

  let pressTimer = 0;
  let held = false;
  canvas.addEventListener('pointerdown', () => {
    held = false;
    pressTimer = setTimeout(() => { held = true; paused = true; pausedAt = performance.now(); }, 220);
  });
  canvas.addEventListener('pointerup', (e) => {
    clearTimeout(pressTimer);
    if (held) {
      // Resume where we paused
      slideStart += performance.now() - pausedAt;
      paused = false;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width * 0.3) go(index - 1);
    else go(index + 1);
  });

  const finalFrame = () => {
    // Save the fully animated state of the current slide
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    slides[index].draw(c.getContext('2d'), 10);
    return c;
  };

  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    if (act === 'save') onSave?.(finalFrame(), index);
    if (act === 'share') onShare?.(finalFrame(), index);
  });
  if (onShare && navigator.share) root.querySelector('[data-act="share"]').hidden = false;
  root.querySelector('[data-act="close"]').focus();

  go(0);
  raf = requestAnimationFrame(render);
  return { close, slides: slides.length };
}
