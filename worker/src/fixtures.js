// Deterministic fake data for local testing: `wrangler dev --var FIXTURES:1`
// Lets you check every route without network access or a token.
function rand(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export function FIXTURES(user) {
  if (user.toLowerCase() === 'ghost') {
    const nf = async () => { const { NotFound } = await import('./github.js'); throw new NotFound(user); };
    return { profile: nf, repos: nf, contributions: nf };
  }
  const r = rand([...user].reduce((a, c) => a + c.charCodeAt(0), 7));
  const days = [];
  const end = new Date();
  for (let t = Date.UTC(2023, 0, 1); t <= end.getTime(); t += 86400000) {
    const c = r() < 0.3 ? 0 : Math.floor(-Math.log(1 - r()) * 6) + 1;
    days.push({ date: new Date(t).toISOString().slice(0, 10), count: c, level: c === 0 ? 0 : c < 3 ? 1 : c < 7 ? 2 : c < 12 ? 3 : 4 });
  }
  return {
    profile: async () => ({ source: 'fixture', profile: { login: user, name: `Test ${user}`, avatar: '', bio: 'Fixture profile', url: `https://github.com/${user}`, followers: 42, following: 1, publicRepos: 7, location: 'Berlin', createdAt: '2019-05-01T00:00:00Z', type: 'User' } }),
    repos: async () => ({ source: 'fixture', repos: [{ name: 'demo', url: `https://github.com/${user}/demo`, description: 'Demo repo', stars: 12, forks: 3, language: 'JavaScript' }] }),
    contributions: async () => ({ source: 'fixture', contributions: days, totals: {} }),
  };
}
