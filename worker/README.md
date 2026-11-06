# Gridscape API (Cloudflare Worker)

Optional backend for Gridscape. The site works without it (it then uses public APIs only),
but with it you get:

- **No rate limits for visitors:** data comes from the official GitHub GraphQL/REST API with your token, cached for 1 hour
- **Preview images per profile:** shared links show the person's skyline on WhatsApp, Discord, X, LinkedIn …
- **Live README badge and skyline card**
- **More backups:** if GitHub fails, the worker tries the public contribution APIs, and as a last resort serves a stale copy (up to 7 days old)

Runs on the free Cloudflare Workers plan (100,000 requests/day).

## Routes

| Route | What it returns |
|---|---|
| `/api/user/:user` | profile (JSON) |
| `/api/repos/:user` | repositories (JSON) |
| `/api/contributions/:user` | full contribution calendar (JSON) |
| `/u/:user?year=&vs=` | share page with Open Graph tags, redirects to the site |
| `/og/:user.png?year=&vs=` | 1200x630 preview image |
| `/badge/:user.svg?theme=light` | live badge |
| `/card/:user.svg?theme=light&year=` | README card with a mini skyline |
| `/health` | status |

## Fallback order

| Data | 1. | 2. | 3. | 4. | last resort |
|---|---|---|---|---|---|
| Profile | edge cache | GitHub REST (token) | GitHub REST (no token) | ungh.cc | stale cache |
| Repositories | edge cache | GitHub REST (token) | GitHub REST (no token) | ungh.cc | stale cache |
| Contributions | edge cache | GitHub GraphQL (token) | github-contributions-api | deno-github-contributions-api | stale cache |

The site itself has a second chain on top of this: worker → public APIs directly.

## Setup (one time, about 10 minutes)

### 1. GitHub token

Create a fine-grained token at https://github.com/settings/personal-access-tokens/new:

- Repository access: **Public repositories (read-only)**
- Permissions: none needed

### 2. Cloudflare account and API token

1. Sign up for free at https://dash.cloudflare.com/sign-up
2. Your **Account ID** is shown on the right of the Workers & Pages overview page
3. Create an API token at https://dash.cloudflare.com/profile/api-tokens with the template **"Edit Cloudflare Workers"**

### 3. Store the three secrets in the GitHub repo

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo hjorven/gridscape
gh secret set CLOUDFLARE_ACCOUNT_ID --repo hjorven/gridscape
gh secret set GH_API_TOKEN --repo hjorven/gridscape
```

Each command asks you to paste the value.

### 4. Deploy

```bash
gh workflow run deploy-worker.yml --repo hjorven/gridscape
gh run watch --repo hjorven/gridscape
```

The log shows the URL, e.g. `https://gridscape-api.<your-subdomain>.workers.dev`.
Check it:

```bash
curl https://gridscape-api.<your-subdomain>.workers.dev/health
```

`{"ok":true,"token":true}` means everything works.

### 5. Connect the site

Put the URL into `js/config.js`:

```js
export const WORKER_URL = 'https://gridscape-api.<your-subdomain>.workers.dev';
```

Commit and push; GitHub Pages updates in about a minute. From then on, every change in `worker/`
is deployed automatically.

## Local development

```bash
cd worker
npm install
npx wrangler dev --var FIXTURES:1
```

`FIXTURES:1` uses built-in fake data, so you need neither network nor token.
Then open http://localhost:8787/og/octo.png or http://localhost:8787/card/octo.svg.

## Custom domain

If you put the worker on your own domain instead of `*.workers.dev`, add that domain to
`connect-src` and `img-src` in the Content-Security-Policy in `index.html`.
