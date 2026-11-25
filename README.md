# MissinformationGPT

Pulls posts from Truth Social and X accounts and runs each one through a misinformation decision tree, animated live:

```
Statement → Is it political? ── no → Non-political statement
              └ yes → Is it falsifiable? ── no → Political opinion
                        └ yes → Externally verified or falsified? ── no → Political rumor
                                  └ yes → Externally verified? ── no → Political misinformation
                                                               └ yes → Political fact
```

- **Posts:** [ScrapeBadger](https://scrapebadger.com). X via its search API (~21 credits per 20 tweets). Truth Social via its web scraper hitting Truth Social's Mastodon API (2 credits per 20 posts). Reposts, replies and image/link-only posts are skipped.
- **Classifier:** Jev (`typesafe/jev-1.13`) through OpenRouter's Decisions API. One call per post answers all four questions as probabilities; a node says yes at p ≥ 0.5.
- **UI:** add accounts, set posts per account and a timeframe, then watch posts drop into the inbox and travel the tree. Click a leaf to filter the results.

Jev answers from its own knowledge with no live fact-check, so very recent claims tend to land in *rumor*.

## Run

```sh
cp .env.example .env   # OPENROUTER_API_KEY, SCRAPEBADGER_API_KEY
npm install
npm run dev            # API on :8787, app on Vite's port (proxies /api)
npm start              # production build + API, served on :4173
npm run check          # tree walk + HTML cleanup asserts
```

To share it: `cloudflared tunnel --url http://localhost:4173`. Anyone with the link can spend your API credits.

## Layout

- `server/index.ts` — `GET /api/run?src=truth:realDonaldTrump&src=x:handle&limit=50&since=YYYY-MM-DD&until=YYYY-MM-DD`, streamed as server-sent events (`post`, `progress`, `verdict`, `fail`, `end`).
- `server/sources.ts` — Truth Social and X fetchers.
- `server/jev.ts` — the four questions and the tree walk.
- `src/Tree.tsx` — the figure as SVG, with posts animated along their path.
- `src/App.tsx` — controls, inbox, results.
