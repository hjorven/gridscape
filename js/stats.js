// Pure helpers: date ranges, grid layout and statistics. No DOM access here.

const DAY = 86400000;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const toISO = (t) => new Date(t).toISOString().slice(0, 10);

export function todayISO(now = new Date()) {
  // Local calendar date of the visitor (not UTC), formatted YYYY-MM-DD.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dateFmtShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const formatDate = (iso) => dateFmt.format(new Date(toUTC(iso)));
export const formatDateShort = (iso) => dateFmtShort.format(new Date(toUTC(iso)));
export const formatNumber = (n) => new Intl.NumberFormat('en-US').format(n);
export const weekdayName = (i) => WEEKDAYS_LONG[i];

/** Years that have data, newest first. */
export function availableYears(data, today = todayISO()) {
  const thisYear = Number(today.slice(0, 4));
  const years = new Set(Object.keys(data.totals).map(Number));
  for (const c of data.contributions) years.add(Number(c.date.slice(0, 4)));
  return [...years].filter((y) => y >= 2008 && y <= thisYear).sort((a, b) => b - a);
}

/**
 * Returns a continuous list of days for a range key:
 * "last" = the last 365 days up to today, or a year like "2025".
 */
export function buildRange(data, key, today = todayISO()) {
  const byDate = new Map(data.contributions.map((c) => [c.date, c]));
  let start;
  let end;
  if (key === 'last') {
    end = toUTC(today);
    start = end - 364 * DAY;
  } else {
    const y = Number(key);
    start = Date.UTC(y, 0, 1);
    end = Math.min(Date.UTC(y, 11, 31), toUTC(today));
  }
  const days = [];
  for (let t = start; t <= end; t += DAY) {
    const iso = toISO(t);
    const c = byDate.get(iso);
    days.push({ date: iso, count: c ? c.count : 0, level: c ? c.level : 0 });
  }
  return days;
}

/** Adds week/weekday positions (GitHub layout: columns are weeks, rows Sun..Sat). */
export function layoutGrid(days) {
  if (!days.length) return { cells: [], weeks: 0 };
  const offset = new Date(toUTC(days[0].date)).getUTCDay();
  const cells = days.map((d, i) => ({ ...d, week: Math.floor((i + offset) / 7), dow: (i + offset) % 7 }));
  const weeks = cells[cells.length - 1].week + 1;
  return { cells, weeks };
}

export function computeStats(days, { endsToday = false } = {}) {
  let total = 0;
  let max = 0;
  let best = null;
  let active = 0;
  let longest = 0;
  let longestStart = null;
  let longestEnd = null;
  let run = 0;
  let runStart = null;
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const months = new Map();

  for (const d of days) {
    total += d.count;
    const dow = new Date(toUTC(d.date)).getUTCDay();
    weekday[dow] += d.count;
    const mk = d.date.slice(0, 7);
    months.set(mk, (months.get(mk) || 0) + d.count);
    if (d.count > max) {
      max = d.count;
      best = d;
    }
    if (d.count > 0) {
      active++;
      if (run === 0) runStart = d.date;
      run++;
      if (run > longest) {
        longest = run;
        longestStart = runStart;
        longestEnd = d.date;
      }
    } else {
      run = 0;
    }
  }

  // Current streak: count back from the last day. If the range ends today and
  // today has no contributions yet, the streak is still alive from yesterday.
  let current = 0;
  let i = days.length - 1;
  if (endsToday && i >= 0 && days[i].count === 0) i--;
  let currentStart = null;
  for (; i >= 0 && days[i].count > 0; i--) {
    current++;
    currentStart = days[i].date;
  }

  const favIdx = weekday.indexOf(Math.max(...weekday));
  let bestMonth = null;
  for (const [k, v] of months) if (!bestMonth || v > bestMonth.count) bestMonth = { month: k, count: v };

  return {
    total,
    max,
    best,
    active,
    days: days.length,
    activePct: days.length ? Math.round((active / days.length) * 100) : 0,
    avgPerActive: active ? total / active : 0,
    longest,
    longestStart,
    longestEnd,
    current,
    currentStart,
    weekday,
    favoriteWeekday: total > 0 ? favIdx : null,
    bestMonth,
  };
}

// A compact subset of GitHub linguist colors.
const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219', 'C++': '#f34b7d',
  C: '#555555', 'C#': '#178600', Go: '#00ADD8', Rust: '#dea584', Ruby: '#701516', PHP: '#4F5D95',
  Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB', HTML: '#e34c26', CSS: '#563d7c', SCSS: '#c6538c',
  Shell: '#89e051', Vue: '#41b883', Svelte: '#ff3e00', Lua: '#000080', 'Jupyter Notebook': '#DA5B0B',
  Haskell: '#5e5086', Elixir: '#6e4a7e', Scala: '#c22d40', R: '#198CE7', 'Objective-C': '#438eff',
  Zig: '#ec915c', Nix: '#7e7eff', Dockerfile: '#384d54', 'Vim Script': '#199f4b', Perl: '#0298c3',
  GDScript: '#355570', Astro: '#ff5a03', MDX: '#fcb32c', Makefile: '#427819', Clojure: '#db5855',
  Julia: '#a270ba', OCaml: '#ef7a08', 'Emacs Lisp': '#c065db', Assembly: '#6E4C13', PowerShell: '#012456',
};
export const langColor = (name) => LANG_COLORS[name] || '#8b98a9';

/** Top languages by number of own (non-fork) repositories. */
export function topLanguages(repos, limit = 6) {
  const counts = new Map();
  for (const r of repos) if (r.language) counts.set(r.language, (counts.get(r.language) || 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, limit).map(([name, n]) => ({ name, count: n, pct: (n / total) * 100, color: langColor(name) }));
  const rest = sorted.slice(limit).reduce((a, [, n]) => a + n, 0);
  if (rest) top.push({ name: 'Other', count: rest, pct: (rest / total) * 100, color: '#6e7681' });
  return top;
}

export function topRepos(repos, limit = 6) {
  return [...repos].sort((a, b) => b.stars - a.stars || b.forks - a.forks).slice(0, limit);
}
