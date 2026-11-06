import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeSVG, cardSVG, ogSVG, sharePageHTML, isoSkyline, esc } from '../../worker/src/render.js';
import { layoutGrid, buildRange } from '../../js/stats.js';

const data = { contributions: [{ date: '2025-06-01', count: 12, level: 4 }, { date: '2025-06-02', count: 3, level: 2 }], totals: {} };
const profile = { login: 'octo', name: 'Octo <script>' };

test('esc escapes HTML', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('badge contains the value and is valid-looking SVG', () => {
  const svg = badgeSVG({ label: 'octo in 3D', value: '1,234 contributions · 5d streak' });
  assert.match(svg, /^<svg[^>]+width="\d+"/);
  assert.ok(svg.includes('1,234 contributions'));
});

test('card escapes user content', () => {
  const svg = cardSVG({ profile, data, rangeKey: '2025', today: '2026-01-01' });
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('Octo &lt;script&gt;'));
  assert.ok(svg.includes('>15<'), 'total for 2025');
});

test('skyline draws three faces per day', () => {
  const grid = layoutGrid(buildRange(data, '2025', '2026-01-01'));
  const { svg } = isoSkyline(grid, 12, { levels: ['#000000', '#111111', '#222222', '#333333', '#444444'], base: '#555555' });
  assert.equal((svg.match(/<polygon/g) || []).length, 365 * 3 + 3);
});

test('og image svg for one and two profiles', () => {
  assert.ok(ogSVG({ profiles: [profile], datas: [data], rangeKey: '2025', today: '2026-01-01' }).includes('width="1200"'));
  const two = ogSVG({ profiles: [profile, { login: 'hub' }], datas: [data, data], rangeKey: '2025', today: '2026-01-01' });
  assert.ok(two.includes('@hub') && two.includes('vs'));
});

test('share page has OG tags and a safe redirect', () => {
  const html = sharePageHTML({ title: 'T "x"', description: 'D', image: 'https://i/og.png', target: 'https://site/?user=a</script>', canonical: 'https://w/u/a' });
  assert.ok(html.includes('<meta property="og:image" content="https://i/og.png">'));
  assert.ok(html.includes('T &quot;x&quot;'));
  assert.ok(!html.includes('a</script>'), 'target is escaped inside the script');
});
