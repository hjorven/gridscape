# Gridscape

Turn any GitHub profile into an interactive **3D contribution skyline** — and share it.

**Live:** https://hjorven.github.io/gridscape/

## Features

- Enter a username, `@handle` or any `github.com/...` link
- 3D skyline (Three.js): drag to rotate, pinch/scroll to zoom, hover/tap a day for details
- Year switcher (last 12 months + every year with data), 7 color themes, 2D fallback
- Stats: total, longest/current streak, best day, active days, favorite weekday, weekly rhythm
- Top languages and most-starred repos
- Sharing: deep links (`?user=...&year=...&theme=...`), 1200x630 share card PNG, 3D screenshot,
  native share sheet on phones, X / Bluesky / LinkedIn / Reddit, README badge
- Responsive (phone, tablet, desktop), light/dark mode, reduced-motion support, PWA manifest
- SEO: meta + Open Graph + Twitter cards, JSON-LD, sitemap, robots.txt, custom 404
- Security: Content-Security-Policy, all user data rendered as text (no `innerHTML`)
- No backend, no build step, no cookies, no tracking

## Data sources

| Data | Source | Limit |
|---|---|---|
| Contribution calendar | [github-contributions-api](https://github.com/grubersjoe/github-contributions-api) | cached ~1 h |
| Profile, repos | GitHub REST API (unauthenticated) | 60 requests/hour per IP |

Results are cached in `sessionStorage` for 10 minutes.

## Run locally

ES modules need a web server (opening `index.html` directly will not work):

```bash
cd gridscape
python3 -m http.server 8000
```

Then open http://localhost:8000

## Deploy to GitHub Pages

```bash
cd gridscape
git init
git add .
git commit -m "Initial commit: Gridscape"
git branch -M main
gh repo create gridscape --public --source=. --remote=origin --push
gh api -X POST repos/hjorven/gridscape/pages -f "source[branch]=main" -f "source[path]=/"
```

Without the GitHub CLI: create a public repo `gridscape` on github.com, then

```bash
git remote add origin https://github.com/hjorven/gridscape.git
git push -u origin main
```

and enable **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**.

### Different repo name or custom domain?

The URL `https://hjorven.github.io/gridscape/` is hard-coded in `index.html` (canonical, Open Graph,
JSON-LD), `robots.txt`, `sitemap.xml` and `404.html`. Search and replace it if you change it.

### Editing the import map

`index.html` contains a CSP hash for the inline `<script type="importmap">`. If you change the import map
(e.g. a new Three.js version), recompute the hash and replace the old `sha256-...` value:

```bash
python3 -c "import re,hashlib,base64;s=open('index.html').read();m=re.search(r'<script type=\"importmap\">(.*?)</script>',s,re.S);print('sha256-'+base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode())"
```

## Project structure

```
index.html            page, SEO tags, CSP, import map
css/style.css         all styles (tokens, light/dark, responsive)
js/app.js             UI controller, URL state, rendering
js/api.js             data fetching, input parsing, caching
js/stats.js           date ranges, grid layout, statistics
js/scene.js           Three.js skyline (InstancedMesh, OrbitControls)
js/share.js           share card, downloads, Web Share API, social links
js/palettes.js        color themes
assets/               favicon, app icons, og-image
manifest.webmanifest  PWA manifest
404.html, robots.txt, sitemap.xml, .nojekyll
```

## License

MIT
