import { setTimeout as sleep } from 'node:timers/promises'
import type { Post } from '../src/types.ts'

export type Page = { posts: Post[]; credits: number }
export type Window = { since?: number; until?: number; signal: AbortSignal }

async function scrapebadger(path: string, init: RequestInit, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://scrapebadger.com/v1' + path, {
      ...init,
      headers: { 'x-api-key': process.env.SCRAPEBADGER_API_KEY!, 'content-type': 'application/json' },
      signal,
    })
    if (r.status === 402) throw new Error('ScrapeBadger is out of credits')
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      await sleep((Number(r.headers.get('retry-after')) || 2 ** attempt) * 1000, undefined, { signal })
      continue
    }
    const body: any = await r.json().catch(() => ({}))
    if (!r.ok) {
      const why = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body).slice(0, 200)
      throw new Error(`ScrapeBadger ${r.status}: ${why}`)
    }
    return { body, credits: Number(r.headers.get('x-credits-used')) || 0 }
  }
}

export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>|<\/p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(lt|gt|quot|nbsp|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', nbsp: ' ', amp: '&' })[e]!)
    .split('\n')
    .filter((line) => !/^RT: \S+$/.test(line.trim())) // quote posts carry the quoted link as an "RT:" line
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Media-only and link-only posts make no statement to classify.
const hasWords = (p: Post) => p.text.replace(/https?:\/\/\S+/g, '').trim().length >= 3

// ScrapeBadger has no Truth Social endpoint, so its web scraper fetches Truth Social's
// Mastodon API (2 credits a call, 20 statuses a page).
async function truthApi(path: string, signal: AbortSignal) {
  const url = 'https://truthsocial.com/api/v1' + path
  const { body, credits } = await scrapebadger('/web/scrape', { method: 'POST', body: JSON.stringify({ url, format: 'text' }) }, signal)
  if (!body.success) throw new Error('Truth Social blocked the scraper, try again')
  if (body.status_code === 404) throw new Error('Truth Social account not found')
  if (body.status_code !== 200) throw new Error(`Truth Social answered ${body.status_code}`)
  return { data: JSON.parse(body.content), credits: body.credits_used ?? credits }
}

type Status = { id: string; created_at: string; content: string; url: string; reblog: unknown }

export async function* truth(handle: string, { since, until, signal }: Window): AsyncGenerator<Page> {
  const acct = await truthApi(`/accounts/lookup?acct=${handle}`, signal)
  yield { posts: [], credits: acct.credits }
  // Status ids are Mastodon snowflakes (ms << 16), so `until` jumps straight to that time instead of paging back to it.
  let maxId = until ? String(BigInt(until) << 16n) : ''
  for (;;) {
    const { data, credits } = await truthApi(
      `/accounts/${acct.data.id}/statuses?exclude_replies=true&limit=20${maxId ? `&max_id=${maxId}` : ''}`,
      signal,
    )
    const page = data as Status[]
    if (!page.length) return
    maxId = page.at(-1)!.id
    const posts = page
      .filter((s) => !s.reblog && !(since && Date.parse(s.created_at) < since))
      .map((s) => ({ id: `truth:${s.id}`, source: `truth:${handle}`, text: htmlToText(s.content), createdAt: s.created_at, url: s.url }))
      .filter(hasWords)
    yield { posts, credits }
    if (since && Date.parse(page.at(-1)!.created_at) < since) return
  }
}

type Tweet = { id: string; created_at: string; full_text?: string; text?: string }

export async function* x(handle: string, { since, until, signal }: Window): AsyncGenerator<Page> {
  const seen = new Set<string>()
  let upper = until ? Math.floor(until / 1000) : 0
  // A cursor chain can end early or die deep (503), so re-anchor until_time at the oldest tweet
  // seen and search again, until a pass adds nothing new.
  for (;;) {
    const query = [`from:${handle}`, '-filter:replies', since && `since_time:${Math.floor(since / 1000)}`, upper && `until_time:${upper}`]
      .filter(Boolean)
      .join(' ')
    let cursor = ''
    let fresh = 0
    let oldest = Infinity
    for (;;) {
      let res
      try {
        const qs = new URLSearchParams({ query, query_type: 'Latest', ...(cursor ? { cursor } : {}) })
        res = await scrapebadger(`/twitter/tweets/advanced_search?${qs}`, {}, signal)
      } catch (e) {
        if (!cursor || signal.aborted) throw e
        break
      }
      const tweets: Tweet[] = res.body.data ?? []
      const posts: Post[] = []
      for (const t of tweets) {
        oldest = Math.min(oldest, Date.parse(t.created_at))
        if (seen.has(t.id)) continue
        seen.add(t.id)
        fresh++
        posts.push({
          id: `x:${t.id}`,
          source: `x:${handle}`,
          text: t.full_text || t.text || '',
          createdAt: new Date(t.created_at).toISOString(),
          url: `https://x.com/${handle}/status/${t.id}`,
        })
      }
      yield { posts: posts.filter(hasWords), credits: res.credits }
      cursor = res.body.next_cursor
      if (!cursor || !tweets.length) break
    }
    if (!fresh) return
    upper = Math.floor(oldest / 1000) + 1
  }
}
