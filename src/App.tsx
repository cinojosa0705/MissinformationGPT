import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Tree from './Tree'
import { flat } from './decision'
import { layout } from './layout'
import type { Post, Progress, TreeConfig, Verdict } from './types'

const PLATFORMS = { truth: 'Truth Social', x: 'X' } as const
type Platform = keyof typeof PLATFORMS
const TAG: Record<string, string> = { truth: 'TS', x: 'X' }
const SPEEDS = [[1, '1×'], [3, '3×'], [10, '10×'], [0, 'Skip']] as const // 0 = no animation
const PRESETS = [[1, '24h'], [7, '7d'], [30, '30d'], [0, 'All']] as const
const DAY = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmt = (p: number) => p.toFixed(2).replace(/^0/, '')

export function Source({ s, onRemove }: { s: string; onRemove?: () => void }) {
  const [platform, handle] = s.split(':')
  return (
    <span className="chip">
      <span className="tag">{TAG[platform]}</span>@{handle}
      {onRemove && (
        <button type="button" aria-label={`Remove @${handle}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  )
}

export default function App() {
  const [sources, setSources] = useState(['truth:realDonaldTrump'])
  const [platform, setPlatform] = useState<Platform>('truth')
  const [handle, setHandle] = useState('')
  const [limit, setLimit] = useState(50)
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [speed, setSpeed] = useState<number>(1)
  const [tree, setTree] = useState<TreeConfig>()
  const [csv, setCsv] = useState<string>()

  const [target, setTarget] = useState(0)
  const [posts, setPosts] = useState<Record<string, Post>>({})
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({})
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [fails, setFails] = useState<{ source: string; message: string }[]>([])
  const [running, setRunning] = useState(false)
  const [flying, setFlying] = useState<string[]>([])
  const [arrived, setArrived] = useState<string[]>([])
  const [current, setCurrent] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const queue = useRef<string[]>([]) // classified, waiting to be launched into the tree
  const es = useRef<EventSource | null>(null)
  const speedRef = useRef(speed)

  useEffect(() => {
    speedRef.current = speed
    if (!speed) return
    const t = setInterval(() => {
      const id = queue.current.shift()
      if (!id) return
      setFlying((f) => [...f, id])
      setCurrent(id)
    }, 650 / speed)
    return () => clearInterval(t)
  }, [speed])

  useEffect(() => () => es.current?.close(), [])
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setTree, () => setFails([{ source: '', message: "Couldn't load the decision tree from the server" }]))
  }, [])

  const arrive = useCallback((id: string) => {
    setFlying((f) => f.filter((x) => x !== id))
    setArrived((a) => [...a, id])
  }, [])

  function stop() {
    es.current?.close()
    es.current = null
    setRunning(false)
  }

  function start() {
    stop()
    setPosts({})
    setVerdicts({})
    setProgress({})
    setFails([])
    setFlying([])
    setArrived([])
    setCurrent(undefined)
    setSelected(undefined)
    setCsv(undefined)
    queue.current = []
    setTarget(sources.length * limit)

    const q = new URLSearchParams({ limit: String(limit) })
    sources.forEach((s) => q.append('src', s))
    if (since) q.set('since', since)
    if (until) q.set('until', until)
    const source = new EventSource('/api/run?' + q)
    es.current = source
    setRunning(true)
    const on = <T,>(name: string, fn: (d: T) => void) => source.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)))
    on<TreeConfig>('config', setTree) // the tree this run uses, even if the admin saves a new one mid-run
    on<Post>('post', (p) => setPosts((m) => ({ ...m, [p.id]: p })))
    on<Progress>('progress', (p) => setProgress((m) => ({ ...m, [p.source]: p })))
    on<{ source: string; message: string }>('fail', (f) => setFails((l) => [...l, f]))
    on<Verdict>('verdict', (v) => {
      setVerdicts((m) => ({ ...m, [v.id]: v }))
      if (!v.leaf) return
      if (speedRef.current) queue.current.push(v.id)
      else setArrived((a) => [...a, v.id])
    })
    on<{ csv?: string }>('end', (d) => {
      setCsv(d.csv)
      stop()
    })
    source.onerror = () => {
      if (es.current !== source) return
      setFails((l) => [...l, { source: '', message: 'Lost the connection to the server' }])
      stop()
    }
  }

  function changeSpeed(s: number) {
    setSpeed(s)
    if (s) return
    const rest = [...flying, ...queue.current]
    queue.current = []
    setFlying([])
    setArrived((a) => [...a, ...rest])
  }

  function add(e: React.FormEvent) {
    e.preventDefault()
    const s = `${platform}:${handle.trim().replace(/^@/, '')}`
    if (!sources.includes(s)) setSources([...sources, s])
    setHandle('')
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = Object.fromEntries((tree?.leaves ?? []).map((l) => [l.id, 0]))
    for (const id of arrived) c[verdicts[id].leaf!] = (c[verdicts[id].leaf!] ?? 0) + 1
    return c
  }, [arrived, verdicts, tree])
  const names = useMemo(() => new Map([...(tree?.questions ?? []), ...(tree?.leaves ?? [])].map((n) => [n.id, flat(n.label)])), [tree])
  const corner = useMemo(() => !tree || layout(tree).corner, [tree])
  const leafName = (id: string) => names.get(id) ?? id

  const rows = useMemo(() => {
    const failed = Object.values(verdicts).filter((v) => v.error).map((v) => v.id)
    return [...arrived, ...(selected ? [] : failed)]
      .filter((id) => !selected || verdicts[id].leaf === selected)
      .map((id) => ({ post: posts[id], v: verdicts[id] }))
      .sort((a, b) => b.post.createdAt.localeCompare(a.post.createdAt))
  }, [arrived, verdicts, posts, selected])

  const all = Object.values(posts)
  const loaded = all.length
  const judged = Object.keys(verdicts).length
  const fetching = running && Object.values(progress).filter((p) => p.done).length < target / limit
  const credits = Object.values(progress).reduce((a, p) => a + p.credits, 0)
  const cv = current ? verdicts[current] : undefined
  const now = cv?.leaf ? { id: cv.id, leaf: cv.leaf, path: cv.path!, answers: cv.answers! } : undefined
  const nowPost = now && posts[now.id]

  return (
    <>
      <header className="top">
        <div>
          <h1>MissinformationGPT</h1>
          <p className="sub">
            Each post walks a decision tree and Jev answers every question. The default tree is <i>Figure 1</i>, “Decision tree for conceptual scheme”.
          </p>
        </div>
        <a className="nav" href="/admin">
          Admin <span aria-hidden>→</span>
        </a>
      </header>

      <section className="controls" aria-label="Run settings">
        <div className="field">
          <span className="label">Accounts</span>
          <div className="chips">
            {sources.map((s) => (
              <Source key={s} s={s} onRemove={sources.length > 1 ? () => setSources(sources.filter((x) => x !== s)) : undefined} />
            ))}
          </div>
          <form className="add" onSubmit={add}>
            <select aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {Object.entries(PLATFORMS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              aria-label="Handle"
              placeholder="@handle"
              required
              pattern="@?[A-Za-z0-9_]{1,30}"
              title="Letters, numbers and underscores"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
            <button type="submit" disabled={sources.length >= 10}>
              Add
            </button>
          </form>
        </div>

        <label className="field">
          <span className="label">Posts per account</span>
          <input type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
        </label>

        <div className="field">
          <span className="label">Timeframe (UTC)</span>
          <div className="row">
            <input type="date" aria-label="From" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} />
            <span>→</span>
            <input type="date" aria-label="To" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} />
          </div>
          <div className="seg">
            {PRESETS.map(([d, label]) => (
              <button
                key={label}
                type="button"
                className={(d ? since === isoDay(Date.now() - d * DAY) : !since) && !until ? 'on' : ''}
                onClick={() => {
                  setSince(d ? isoDay(Date.now() - d * DAY) : '')
                  setUntil('')
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button className="primary" onClick={running ? stop : start}>
          {running ? 'Stop' : 'Run'}
        </button>
      </section>

      <main className="stage">
        <aside className="inbox" aria-label="Loading posts">
          <span className="label">Inbox</span>
          <div className="big">{loaded}</div>
          <div className="muted">
            {target ? `of up to ${target} posts loaded · ${judged} judged` : 'Press Run to pull posts'}
          </div>
          <div className={fetching ? 'bar busy' : 'bar'}>
            <i style={{ width: `${target ? (loaded / target) * 100 : 0}%` }} />
          </div>
          <ul className="progress">
            {Object.values(progress).map((p) => (
              <li key={p.source}>
                <Source s={p.source} />
                <span className="mono">
                  {p.n} · {p.pages} pg {p.done ? '✓' : '…'}
                </span>
              </li>
            ))}
            {fails.map((f, i) => (
              <li key={i} className="fail">
                ⚠ {f.source && `@${f.source.split(':')[1]}: `}
                {f.message}
              </li>
            ))}
          </ul>
          {credits > 0 && <div className="muted mono">{credits} ScrapeBadger credits</div>}
          <div className="deck" aria-hidden>
            {all
              .slice(-5)
              .reverse()
              .map((p, i) => (
                <div key={p.id} style={{ transform: `translateY(${i * 16}px) scale(${1 - i * 0.05})`, zIndex: 10 - i, opacity: 1 - i * 0.17 }}>
                  <div className="card">
                    <div className="meta">
                      <span>
                        {TAG[p.source.split(':')[0]]} @{p.source.split(':')[1]}
                      </span>
                      <span>{when(p.createdAt)}</span>
                    </div>
                    <p>{p.text}</p>
                  </div>
                </div>
              ))}
          </div>
        </aside>

        <section className="board" aria-label="Decision tree">
          <div className="board-head">
            <span className="label">Decision tree · live</span>
            <span className="muted mono">
              {queue.current.length} waiting · {flying.length} in the tree · {arrived.length} sorted
            </span>
            <div className="seg" role="group" aria-label="Animation speed">
              {SPEEDS.map(([s, label]) => (
                <button key={label} type="button" className={speed === s ? 'on' : ''} onClick={() => changeSpeed(s)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="tree-wrap">
            {tree ? (
              <Tree
                tree={tree}
                flying={flying.map((id) => ({ id, path: verdicts[id].path! }))}
                current={now}
                counts={counts}
                speed={speed || 1}
                selected={selected}
                onSelect={(l) => setSelected((s) => (s === l ? undefined : l))}
                onArrive={arrive}
              />
            ) : (
              <div className="tree-loading muted">Loading the tree…</div>
            )}
            {now && nowPost && (
              <div className={corner ? 'now' : 'now inline'} key={now.id}>
                <div className="meta">
                  <span className="label">Now evaluating</span>
                  <span className="mono">
                    @{nowPost.source.split(':')[1]} · {when(nowPost.createdAt)}
                  </span>
                </div>
                <p>{nowPost.text}</p>
                <div className="answers">
                  {tree?.questions.map((q) => (
                    <span key={q.id} className={now.path.includes(q.id) ? '' : 'skip'}>
                      {flat(q.label)} <b>{fmt(now.answers[q.id] ?? 0)}</b>
                    </span>
                  ))}
                </div>
                <div className="verdict">→ {leafName(now.leaf)}</div>
              </div>
            )}
          </div>
          <p className="muted note">
            Jev (<span className="mono">typesafe/jev-1.13</span> on OpenRouter) answers all {tree?.questions.length ?? ''} questions in one call per post, from
            its own knowledge with no live fact-check, so very recent claims tend to land in <i>rumor</i>. A question says yes when p reaches its threshold
            (.50 unless changed in the admin). Click a leaf to filter.
          </p>
        </section>
      </main>

      <section className="results" aria-label="Results">
        <div className="results-head">
          <span className="label">Results</span>
          {selected && (
            <button type="button" className="chip" onClick={() => setSelected(undefined)}>
              {leafName(selected)} ×
            </button>
          )}
          <span className="muted mono">{rows.length} posts</span>
          {csv && (
            <a className="button" href={`/api/runs/${encodeURIComponent(csv)}`} download>
              Download CSV
            </a>
          )}
          {running && <span className="muted">The CSV is saved when the run ends.</span>}
        </div>
        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Verdict</th>
                  <th>Posted</th>
                  <th>Account</th>
                  <th>Post</th>
                  <th title={`p(yes): ${tree?.questions.map((q) => q.id).join(', ')}`}>{tree?.questions.map((q) => q.id[0].toUpperCase()).join(' · ')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ post, v }) => (
                  <tr key={post.id}>
                    <td className="v">{v.leaf ? leafName(v.leaf) : <span title={v.error}>unclassified</span>}</td>
                    <td className="mono nowrap">{when(post.createdAt)}</td>
                    <td className="nowrap">
                      <Source s={post.source} />
                    </td>
                    <td className="text">{post.text}</td>
                    <td className="mono nowrap">{v.answers ? tree?.questions.map((q) => fmt(v.answers![q.id] ?? 0)).join(' ') : '—'}</td>
                    <td>
                      <a href={post.url} target="_blank" rel="noreferrer" aria-label="Open original post">
                        ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
