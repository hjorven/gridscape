# Gridscape

Turn any GitHub profile into an interactive **3D contribution skyline** — and share it.

**Live:** https://hjorven.github.io/gridscape/

## Features

- **3D skyline** in the style of GitHub Skyline: dark bevelled plinth, username and year raised on the front, month labels, original GitHub colors (follows light/dark mode)
- **Night mode** with glowing buildings, auto-rotate, fullscreen, 2D fallback
- **Compare mode:** two profiles side by side (`?vs=friend`), head-to-head table
- **Year in review:** tap-through story (biggest month, longest streak, favorite day, top language, achievements), every slide saveable as 1080x1920
- **12 achievements** (Centurion, 1k Club, Year-Round, Comeback, Star Maker …) with progress, shown on the share card
- **Exports:** share card PNG, 3D view PNG, video (MP4/WebM, story/square/wide), animated GIF, **STL for 3D printing**
- **Sharing:** links with a live preview image per profile, native share sheet, X / Bluesky / LinkedIn / Reddit, live README badge and skyline card
- **Reliable data:** several sources per data type with automatic fallback (see below)
- Responsive, PWA with service worker (installable, fast repeat visits), accessible, no cookies, no tracking

## Data sources and fallbacks

The site tries each source in order and skips sources that failed in the last 5 minutes.

| Data | 1. | 2. | 3. |
|---|---|---|---|
| Profile | Gridscape API (worker) | GitHub REST API | ungh.cc |
| Repositories | Gridscape API (worker) | GitHub REST API | ungh.cc |
| Contributions | Gridscape API (worker) | github-contributions-api | deno-github-contributions-api |

The worker itself has its own chain (GitHub GraphQL with token → public APIs → stale cache).
The footer of the site shows which source was used. Without the worker the site still works.

## Setup

### GitHub Pages

Already set up: `main` branch, root folder.

### Optional: Gridscape API

Gives per-profile preview images, the live README badge/card and removes rate limits.
Step-by-step guide: [`worker/README.md`](worker/README.md).

## Development

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 (ES modules need a web server).

Tests:

```bash
npm install
npx playwright install chromium
npm test        # unit tests (stats, fallbacks, achievements, worker rendering)
npm run e2e     # browser tests with mocked APIs, including all fallback scenarios
```

Both run automatically on every push and pull request (GitHub Actions).

### Editing the import map

`index.html` contains a CSP hash for the inline `<script type="importmap">`. After changing it,
recompute the hash and replace the old `sha256-...` value:

```bash
python3 -c "import re,hashlib,base64;s=open('index.html').read();m=re.search(r'<script type=\"importmap\">(.*?)</script>',s,re.S);print('sha256-'+base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode())"
```

## Project structure

```
index.html              page, SEO tags, CSP, import map
sw.js                   service worker
css/style.css           styles (GitHub Primer colors, light/dark, responsive)
js/app.js               UI controller
js/config.js            worker URL
js/sources.js           data sources, normalizers, fallback client
js/api.js               caching, input parsing, background loading
js/stats.js             date ranges, grid layout, statistics
js/achievements.js      achievements
js/scene.js             Three.js skyline (plinth, 3D text, night mode, compare, capture, STL)
js/export.js            STL, video, GIF
js/wrapped.js           year in review
js/share.js             share card, README embeds, Web Share API
assets/fonts/           DejaVu Sans Bold subset for the 3D text
worker/                 Cloudflare Worker (API, preview images, badge)
tests/unit/             node:test unit tests
tests/e2e/              Playwright browser tests
.github/workflows/      CI and worker deploy
```

## License

MIT. The 3D text and preview images use DejaVu fonts ([license](https://dejavu-fonts.github.io/License.html)).
