// Achievements computed from public data. Pure functions, no DOM.

const DAY = 86400000;
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** All runs of consecutive active days over the full history. Missing dates count as zero. */
export function activeRuns(days) {
  const runs = [];
  let cur = null;
  let prevT = null;
  for (const d of days) {
    const t = toUTC(d.date);
    const contiguous = prevT !== null && t - prevT === DAY;
    if (d.count > 0) {
      if (cur && contiguous) {
        cur.end = d.date;
        cur.length++;
      } else {
        cur = { start: d.date, end: d.date, length: 1 };
        runs.push(cur);
      }
    } else {
      cur = null;
    }
    prevT = t;
  }
  return runs;
}

function longestComeback(runs) {
  // Longest run that starts after a pause of 30+ days.
  let best = 0;
  for (let i = 1; i < runs.length; i++) {
    const gap = (toUTC(runs[i].start) - toUTC(runs[i - 1].end)) / DAY - 1;
    if (gap >= 30) best = Math.max(best, runs[i].length);
  }
  return best;
}

const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

/**
 * @param {object} input
 * @param {Array} input.days      full contribution history [{date,count}]
 * @param {object} input.profile  normalized profile (createdAt)
 * @param {Array|null} input.repos normalized repositories or null if unknown
 * @param {string} input.today    YYYY-MM-DD
 */
export function computeAchievements({ days, profile = null, repos = null, today }) {
  const runs = activeRuns(days);
  const longest = runs.reduce((m, r) => Math.max(m, r.length), 0);
  const total = days.reduce((a, d) => a + d.count, 0);
  const maxDay = days.reduce((m, d) => Math.max(m, d.count), 0);

  const perYear = new Map();
  const monthsPerYear = new Map();
  let weekend = 0;
  for (const d of days) {
    const y = d.date.slice(0, 4);
    perYear.set(y, (perYear.get(y) || 0) + d.count);
    if (d.count > 0) {
      if (!monthsPerYear.has(y)) monthsPerYear.set(y, new Set());
      monthsPerYear.get(y).add(d.date.slice(5, 7));
      const dow = new Date(toUTC(d.date)).getUTCDay();
      if (dow === 0 || dow === 6) weekend += d.count;
    }
  }
  const bestYear = Math.max(0, ...perYear.values());
  const bestMonths = Math.max(0, ...[...monthsPerYear.values()].map((s) => s.size));
  const weekendShare = total ? weekend / total : 0;
  const comeback = longestComeback(runs);

  const end = toUTC(today);
  const lastYear = days.filter((d) => { const t = toUTC(d.date); return t > end - 365 * DAY && t <= end; });
  const activeLastYear = lastYear.filter((d) => d.count > 0).length;
  const activeShare = activeLastYear / 365;

  const years = profile && profile.createdAt ? (end - Date.parse(profile.createdAt)) / (365.25 * DAY) : null;
  const maxStars = repos ? repos.reduce((m, r) => Math.max(m, r.stars || 0), 0) : null;
  const langs = repos ? new Set(repos.map((r) => r.language).filter(Boolean)).size : null;

  const list = [
    { id: 'centurion', icon: '100', title: 'Centurion', desc: '100-day contribution streak', value: longest, target: 100, unit: 'days' },
    { id: 'club-1k', icon: '1k', title: '1k Club', desc: '1,000 contributions in one calendar year', value: bestYear, target: 1000, unit: 'in best year' },
    { id: 'unstoppable', icon: '30', title: 'Unstoppable', desc: '30-day contribution streak', value: longest, target: 30, unit: 'days' },
    { id: 'star-maker', icon: '★', title: 'Star Maker', desc: 'A repository with 100+ stars', value: maxStars, target: 100, unit: 'stars on top repo' },
    { id: 'year-round', icon: '12', title: 'Year-Round', desc: 'Active in all 12 months of a year', value: bestMonths, target: 12, unit: 'months' },
    { id: 'comeback', icon: '↺', title: 'Comeback', desc: '7-day streak after a 30-day break', value: comeback, target: 7, unit: 'days' },
    { id: 'big-day', icon: '50', title: 'Big Day', desc: '50+ contributions in a single day', value: maxDay, target: 50, unit: 'on best day' },
    { id: 'veteran', icon: '5y', title: 'Veteran', desc: 'GitHub account older than 5 years', value: years === null ? null : Math.floor(years * 10) / 10, target: 5, unit: 'years' },
    { id: 'polyglot', icon: '{}', title: 'Polyglot', desc: '5+ languages across your repositories', value: langs, target: 5, unit: 'languages' },
    { id: 'consistent', icon: '%', title: 'Consistent', desc: 'Active on half the days of the last year', value: Math.round(activeShare * 100), target: 50, unit: '% of days' },
    { id: 'weekend', icon: 'SS', title: 'Weekend Warrior', desc: '20%+ of contributions on weekends', value: total >= 100 ? Math.round(weekendShare * 100) : 0, target: 20, unit: '% on weekends' },
    { id: 'on-a-roll', icon: '7', title: 'On a Roll', desc: '7-day contribution streak', value: longest, target: 7, unit: 'days' },
  ];

  return list.map((a) => {
    const known = a.value !== null && a.value !== undefined;
    const progress = known ? Math.min(1, a.value / a.target) : 0;
    return {
      id: a.id,
      icon: a.icon,
      title: a.title,
      desc: a.desc,
      known,
      earned: known && a.value >= a.target,
      progress,
      detail: known ? `${fmt(a.value)}${a.unit.startsWith('%') ? '' : ' '}${a.unit}` : 'Needs repository data',
    };
  });
}
