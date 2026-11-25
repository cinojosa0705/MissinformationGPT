import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import { clean, validate, walk } from '../src/decision.ts'
import type { Post, TreeConfig, Verdict } from '../src/types.ts'
import { judge } from './jev.ts'
import { truth, x } from './sources.ts'
import { DATA, RUN_FILE, listRuns, loadTree, readRun, saveRun, saveTree, toCsv } from './store.ts'

const PORT = Number(process.env.PORT ?? 8787)
const SOURCE = /^(truth|x):[A-Za-z0-9_]{1,30}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000
const MAX_PAGES = 250 // ponytail: stops an image-only account paging back forever; raise if real runs hit it

let tree = await loadTree()
let version = 0 // bumped on every save, so cached verdicts from an older tree are never reused

// ponytail: in-memory verdict cache, lost on restart; persist to disk if reruns get expensive.
const verdicts = new Map<string, Promise<Verdict>>()

function classify(post: Post, cfg: TreeConfig, ver: number, signal: AbortSignal): Promise<Verdict> {
  const key = `${ver}:${post.id}`
  let v = verdicts.get(key)
  if (!v) {
    const state = { statement: post.text, author: '@' + post.source.split(':')[1], posted_at: post.createdAt }
    v = judge(cfg.questions, state, signal).then((answers) => {
      const path = walk(cfg, answers)
      return { id: post.id, answers, path, leaf: path.at(-1) }
    })
    verdicts.set(key, v)
    v.catch(() => verdicts.delete(key))
  }
  return v.catch((e: Error) => ({ id: post.id, error: signal.aborted ? 'Run stopped before Jev answered' : e.message }))
}

type Send = (event: string, data: unknown) => void
type Run = { sources: string[]; limit: number; since?: number; until?: number }
type Row = { post: Post; v: Verdict }

async function run({ sources, limit, since, until }: Run, cfg: TreeConfig, ver: number, send: Send, signal: AbortSignal) {
  const rows: Row[] = []
  const judging: Promise<void>[] = []
  await Promise.all(
    sources.map(async (source) => {
      const [platform, handle] = source.split(':')
      const p = { source, n: 0, pages: 0, credits: 0 }
      try {
        for await (const page of (platform === 'x' ? x : truth)(handle, { since, until, signal })) {
          p.pages++
          p.credits += page.credits
          for (const post of page.posts.slice(0, limit - p.n)) {
            p.n++
            send('post', post)
            judging.push(classify(post, cfg, ver, signal).then((v) => (rows.push({ post, v }), send('verdict', v))))
          }
          send('progress', p)
          if (p.n >= limit || p.pages >= MAX_PAGES) break
        }
      } catch (e) {
        if (!signal.aborted) send('fail', { source, message: (e as Error).message })
      }
      send('progress', { ...p, done: true })
    }),
  )
  await Promise.all(judging)
  return rows
}

function parse(q: URLSearchParams): Run | undefined {
  const sources = [...new Set(q.getAll('src'))]
  const limit = Number(q.get('limit') ?? 50)
  const [since, until] = ['since', 'until'].map((k) => q.get(k) || undefined)
  if (!sources.length || sources.length > 10 || !sources.every((s) => SOURCE.test(s))) return
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return
  if ((since && !DATE.test(since)) || (until && !DATE.test(until))) return
  // Dates are whole UTC days; `until` includes its day.
  return { sources, limit, since: since ? Date.parse(since) : undefined, until: until ? Date.parse(until) + DAY : undefined }
}

async function stream(params: Run, res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const ac = new AbortController()
  res.on('close', () => ac.abort()) // client closed the EventSource: stop scraping and judging
  const send: Send = (event, data) => {
    if (!ac.signal.aborted) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const cfg = tree // a save mid-run doesn't change this run's tree
  let rows: Row[] = []
  try {
    send('config', cfg)
    if (!process.env.SCRAPEBADGER_API_KEY || !process.env.OPENROUTER_API_KEY)
      send('fail', { source: '', message: 'Set SCRAPEBADGER_API_KEY and OPENROUTER_API_KEY in .env' })
    else rows = await run(params, cfg, version, send, ac.signal)
  } finally {
    // Every run with posts is kept as a CSV, stopped runs included.
    const csv = rows.length ? await saveRun(params.sources, toCsv(cfg, rows), rows.length).catch((e) => void console.error('CSV not saved:', e)) : undefined
    if (csv) console.log(`Run saved: ${join(DATA, 'runs', csv)}`)
    send('end', { csv })
    res.end()
  }
}

const json = (res: ServerResponse, status: number, data: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(data))

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = ''
  for await (const chunk of req) if ((raw += chunk).length > 200_000) return
  try {
    return JSON.parse(raw)
  } catch {
    return
  }
}

// Admin endpoints need `Authorization: Bearer <ADMIN_PASSWORD>`. Without the variable the admin is off.
// ponytail: no attempt limit; README asks for a long random password, add a lockout if it's ever a short one.
const digest = (s: string) => createHash('sha256').update(s).digest()
async function admin(route: string, req: IncomingMessage, res: ServerResponse) {
  const password = process.env.ADMIN_PASSWORD
  if (!password) return json(res, 503, { error: 'The admin is off. Set ADMIN_PASSWORD in .env and restart the server.' })
  const given = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
  if (!timingSafeEqual(digest(given), digest(password))) return json(res, 401, { error: 'Wrong password' })

  if (route === 'runs' && req.method === 'GET') return json(res, 200, await listRuns())

  if (route === 'tree' && req.method === 'PUT') {
    const next = clean(await readJson(req))
    const problems = validate(next)
    if (problems.length) return json(res, 400, { error: problems[0].message, problems })
    await saveTree(next)
    tree = next
    version++
    verdicts.clear()
    console.log('Decision tree saved')
    return json(res, 200, tree)
  }

  if (route === 'test' && req.method === 'POST') {
    const body = await readJson(req)
    const draft = clean(body?.tree)
    const statement = typeof body?.statement === 'string' ? body.statement.trim() : ''
    const problems = validate(draft)
    if (problems.length) return json(res, 400, { error: problems[0].message, problems })
    if (!statement || statement.length > 5000) return json(res, 400, { error: 'Write a statement to test (up to 5,000 characters).' })
    if (!process.env.OPENROUTER_API_KEY) return json(res, 503, { error: 'Set OPENROUTER_API_KEY in .env' })
    try {
      const answers = await judge(draft.questions, { statement }, AbortSignal.timeout(45_000))
      return json(res, 200, { answers, path: walk(draft, answers) })
    } catch (e) {
      return json(res, 502, { error: (e as Error).message })
    }
  }
  json(res, 404, { error: 'Not found' })
}

// The built app (`npm run build` → dist/). One page, so anything that isn't a file gets index.html.
const DIST = join(import.meta.dirname, '../dist')
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' }
async function serveApp(pathname: string, res: ServerResponse) {
  const file = join(DIST, pathname) // URL parsing already resolved any "..", so this stays inside dist/
  const body = await readFile(file).catch(() => undefined)
  if (body && TYPES[extname(file)]) return res.writeHead(200, { 'content-type': TYPES[extname(file)] }).end(body)
  const index = await readFile(join(DIST, 'index.html')).catch(() => undefined)
  if (!index) return res.writeHead(404, { 'content-type': 'text/plain' }).end('No build found: run `npm run build` first')
  res.writeHead(200, { 'content-type': TYPES['.html'] }).end(index)
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  try {
    if (path === '/api/run') {
      const params = parse(url.searchParams)
      return params ? await stream(params, res) : res.writeHead(400, { 'content-type': 'text/plain' }).end('bad sources, limit or dates')
    }
    if (path === '/api/config') return json(res, 200, tree)
    if (path.startsWith('/api/runs/')) {
      const name = path.slice('/api/runs/'.length)
      const csv = RUN_FILE.test(name) ? await readRun(name).catch(() => undefined) : undefined
      if (!csv) return json(res, 404, { error: 'No such run' })
      return res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` }).end(csv)
    }
    if (path.startsWith('/api/admin/')) return await admin(path.slice('/api/admin/'.length), req, res)
    if (path.startsWith('/api/')) return json(res, 404, { error: 'Not found' })
    await serveApp(path, res)
  } catch (e) {
    console.error(e)
    if (!res.headersSent) json(res, 500, { error: 'Server error' })
  }
}).listen(PORT, () => console.log(`MissinformationGPT on http://localhost:${PORT}`))
