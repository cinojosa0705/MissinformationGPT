# MissinformationGPT

Pull posts from Truth Social and X accounts and watch each one walk a misinformation decision tree:

```
Statement → Is it political? ── no → Non-political statement
              └ yes → Is it falsifiable? ── no → Political opinion
                        └ yes → Externally verified or falsified? ── no → Political rumor
                                  └ yes → Externally verified? ── no → Political misinformation
                                                               └ yes → Political fact
```

Posts come from [ScrapeBadger](https://scrapebadger.com). Each post is classified by **Jev** (`typesafe/jev-1.13`) through [OpenRouter](https://openrouter.ai): one call answers all four questions, and a question counts as "yes" when Jev's probability is 0.5 or more.

---

## 1. What you need

- **Node.js 22.18 or newer** (24 recommended). Check with `node -v`; get it from [nodejs.org](https://nodejs.org).
- **git**
- A **ScrapeBadger** account and an **OpenRouter** account (step 3).

## 2. Clone and install

```sh
git clone https://github.com/cinojosa0705/MissinformationGPT.git
cd MissinformationGPT
npm install
```

## 3. Get the API keys

**ScrapeBadger** (fetches the posts)

1. Sign up at [scrapebadger.com](https://scrapebadger.com/auth/signup).
2. Copy your API key from the dashboard. It starts with `sb_` ([auth docs](https://docs.scrapebadger.com/authentication.md)).
3. Make sure the account has credits. 100 Truth Social posts cost about 10–20 credits; 100 tweets about 105.

**OpenRouter** (runs Jev)

1. Sign up at [openrouter.ai](https://openrouter.ai).
2. Add a few dollars of credit. Jev costs about $0.00002 per post, so $1 covers ~50,000 posts.
3. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys). It starts with `sk-or-`.

## 4. Add the keys

```sh
cp .env.example .env
```

Open `.env` and paste the keys in:

```
OPENROUTER_API_KEY=sk-or-v1-...
SCRAPEBADGER_API_KEY=sb_live_...
```

`.env` is gitignored. Never commit it.

## 5. Run it locally

```sh
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). The API runs on port 8787 and Vite forwards `/api` to it.

Using it:

1. **Accounts**: `@realDonaldTrump` on Truth Social is preset. Pick *Truth Social* or *X*, type a handle, press **Add** (up to 10).
2. **Posts per account**: how many posts to pull from each (1–1000).
3. **Timeframe**: pick dates, or a preset (24h / 7d / 30d / All). Empty means "latest posts".
4. Press **Run**. Posts land in the inbox on the left, then travel the tree one by one.
5. Change the animation **speed** (1× / 3× / 10× / Skip), and click any leaf to filter the results table.

## 6. Run the production build

```sh
npm run build
npm start
```

Open http://localhost:8787. One Node process serves the app and the API. Set `PORT` to change the port.

## 7. Share it from your machine

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared` on macOS), then, with `npm start` running:

```sh
cloudflared tunnel --url http://localhost:8787
```

It prints a public `https://….trycloudflare.com` link that works as long as the command runs.

## 8. Deploy it

Any host that runs a long-lived Node server works (Render, Railway, Fly.io, a VPS). Serverless hosts like Vercel or Netlify Functions don't, because a run streams results for minutes.

On [Render](https://render.com):

1. Push the repo (or your fork) to GitHub.
2. In Render: **New → Web Service**, and connect the repo.
3. Settings:
   - **Runtime**: Node
   - **Build command**: `npm install && npm run build`
   - **Start command**: `npm start`
4. Under **Environment**, add `OPENROUTER_API_KEY` and `SCRAPEBADGER_API_KEY`.
5. **Deploy**. Your app is live at `https://<service-name>.onrender.com`.

Render supplies `PORT` and picks the Node version from `engines` in `package.json`. Free instances sleep when idle, so the first visit after a while takes a moment.

> **Heads-up:** there is no login. Anyone with the link can start runs that spend your ScrapeBadger and OpenRouter credits. Share the URL carefully.

---

## Troubleshooting

| Message | Fix |
| - | - |
| `Set SCRAPEBADGER_API_KEY and OPENROUTER_API_KEY in .env` | Step 4, then restart. On a host, add them as environment variables. |
| `ScrapeBadger is out of credits` | Top up your ScrapeBadger account. |
| `Truth Social blocked the scraper, try again` | Truth Social's bot protection won that round. Run again. |
| `Truth Social account not found` | Check the handle (no `@` needed). |
| `No build found: run npm run build first` | Run `npm run build` before `npm start`. |
| Port 8787 already in use | `PORT=9000 npm start` (production), or stop the other process (dev expects 8787). |
| Almost everything lands in *rumor* | Jev answers from its own knowledge with no live fact-checking, so claims newer than its training can't be verified or falsified. |

## How it's built

- `server/index.ts`: serves the app and `GET /api/run?src=truth:realDonaldTrump&src=x:handle&limit=50&since=YYYY-MM-DD&until=YYYY-MM-DD`, streamed as server-sent events (`post`, `progress`, `verdict`, `fail`, `end`).
- `server/sources.ts`: Truth Social (ScrapeBadger's web scraper on Truth Social's Mastodon API) and X (ScrapeBadger search). Reposts, replies and image- or link-only posts are skipped.
- `server/jev.ts`: the four questions and the tree walk.
- `src/Tree.tsx`: the tree as SVG, with posts animated along their path.
- `src/App.tsx`: controls, inbox, results.
- `npm run check`: self-checks for the tree walk and HTML cleanup.
