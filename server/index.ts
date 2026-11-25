import { createServer } from 'node:http'
import type { Post, Verdict } from '../src/types.ts'
import { judge, leafOf } from './jev.ts'
import { truth, x } from './sources.ts'

const PORT = Number(process.env.PORT ?? 8787)
const SOURCE = /^(truth|x):[A-Za-z0-9_]{1,30}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86_400_000
const MAX_PAGES = 250 // ponytail: stops an image-only account paging back forever; raise if real runs hit it

// ponytail: in-memory verdict cache, lost on restart; persist to disk if reruns get expensive.
const verdicts = new Map<string, Promise<Verdict>>()

function classify(post: Post, signal: AbortSignal): Promise<Verdict> {
  let v = verdicts.get(post.id)
  if (!v) {
    v = judge(post, signal).then((answers) => ({ id: post.id, answers, leaf: leafOf(answers) }))
    verdicts.set(post.id, v)
    v.catch(() => verdicts.delete(post.id))
  }
  return v.catch((e: Error) => ({ id: post.id, error: e.message }))
}

type Send = (event: string, data: unknown) => void
type Run = { sources: string[]; limit: number; since?: number; until?: number }

async function run({ sources, limit, since, until }: Run, send: Send, signal: AbortSignal) {
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
            judging.push(classify(post, signal).then((v) => send('verdict', v)))
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

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/api/run') return res.writeHead(404).end()
  const params = parse(url.searchParams)
  if (!params) return res.writeHead(400, { 'content-type': 'text/plain' }).end('bad sources, limit or dates')

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const ac = new AbortController()
  res.on('close', () => ac.abort()) // client closed the EventSource: stop scraping and judging
  const send: Send = (event, data) => {
    if (!ac.signal.aborted) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  try {
    if (!process.env.SCRAPEBADGER_API_KEY || !process.env.OPENROUTER_API_KEY)
      send('fail', { source: '', message: 'Set SCRAPEBADGER_API_KEY and OPENROUTER_API_KEY in .env' })
    else await run(params, send, ac.signal)
  } finally {
    send('end', {})
    res.end()
  }
}).listen(PORT, () => console.log(`api on :${PORT}`))
