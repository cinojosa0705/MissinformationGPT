import { useEffect, useMemo, useRef, useState } from 'react'
import { Source } from './App'
import Tree from './Tree'
import { DEFAULT_TREE, flat, validate } from './decision'
import type { Answers, Outcome, Problem, Question, RunFile, TreeConfig } from './types'

const STORE = 'missinformationgpt-admin'
const KEY = /^[a-z][a-z0-9_]{0,31}$/
const NEW_Q = '+question'
const NEW_L = '+outcome'
const fmt = (p: number) => p.toFixed(2).replace(/^0/, '')
const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`)
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const stored = {
  get: () => {
    try {
      return sessionStorage.getItem(STORE) ?? ''
    } catch {
      return ''
    }
  },
  set: (v: string) => {
    try {
      if (v) sessionStorage.setItem(STORE, v)
      else sessionStorage.removeItem(STORE)
    } catch {
      /* private mode: stay unlocked for this page only */
    }
  },
}

type Reply<T> = { status: number; data: T & { error?: string; problems?: Problem[] } }
async function api<T>(path: string, token: string, init?: RequestInit): Promise<Reply<T>> {
  try {
    const r = await fetch(path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
    return { status: r.status, data: await r.json().catch(() => ({ error: `Server error ${r.status}` })) }
  } catch {
    return { status: 0, data: { error: "Can't reach the server" } as Reply<T>['data'] }
  }
}

// Hands out unused keys like question_3, remembering the ones it already gave.
const namer = (t: TreeConfig) => {
  const ids = new Set([...t.questions, ...t.leaves].map((n) => n.id))
  return (base: string) => {
    let i = 1
    while (ids.has(`${base}_${i}`)) i++
    ids.add(`${base}_${i}`)
    return `${base}_${i}`
  }
}
const parentOf = (t: TreeConfig, id: string) => {
  for (const q of t.questions) for (const b of ['yes', 'no'] as const) if (q[b] === id) return { q, b }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="fld">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

// Edited locally, applied on blur or Enter, so references only move once the new key is complete and free.
function KeyField({ id, hint, onRename }: { id: string; hint: string; onRename: (next: string) => string | undefined }) {
  const [v, setV] = useState(id)
  const [err, setErr] = useState<string>()
  const commit = () => setErr(v === id ? undefined : onRename(v.trim()))
  return (
    <label className="fld">
      <span className="label">Key</span>
      <input
        className="mono"
        value={v}
        spellCheck={false}
        aria-invalid={!!err}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setV(id)
            setErr(undefined)
          }
        }}
      />
      <span className={err ? 'hint err' : 'hint'}>{err ?? hint}</span>
    </label>
  )
}

export default function Admin() {
  const [token, setToken] = useState(stored.get)
  const [gate, setGate] = useState<'checking' | 'locked' | 'off' | 'open'>('checking')
  const [gateMsg, setGateMsg] = useState<string>()
  const [password, setPassword] = useState('')
  const [saved, setSaved] = useState<TreeConfig>()
  const [draft, setDraft] = useState<TreeConfig>()
  const [sel, setSel] = useState<string>()
  const [runs, setRuns] = useState<RunFile[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ n: number; text: string }>()
  const [statement, setStatement] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ n: number; path: string[]; answers: Answers; error?: string }>()
  const [tokens, setTokens] = useState<{ id: string; path: string[] }[]>([])
  const toastTimer = useRef(0)

  const flash = (text: string) => {
    clearTimeout(toastTimer.current)
    setToast({ n: Date.now(), text })
    toastTimer.current = window.setTimeout(() => setToast(undefined), 2800)
  }

  async function unlock(t: string) {
    const { status, data } = await api<RunFile[]>('/api/admin/runs', t)
    if (status === 200) {
      stored.set(t)
      setToken(t)
      setRuns(data)
      setGate('open')
      return
    }
    stored.set('')
    setGate(status === 503 ? 'off' : 'locked')
    setGateMsg(status === 401 && !t ? undefined : data.error)
  }

  function lock(message?: string) {
    stored.set('')
    setToken('')
    setPassword('')
    setGate('locked')
    setGateMsg(message)
  }

  useEffect(() => {
    document.title = 'Admin · MissinformationGPT'
    unlock(stored.get())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- check the stored password once

  useEffect(() => {
    if (gate !== 'open') return
    fetch('/api/config')
      .then((r) => r.json())
      .then((t: TreeConfig) => {
        setSaved(t)
        setDraft(t)
        setSel(t.root)
      })
  }, [gate])

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [dirty])

  const problems = useMemo(() => (draft ? validate(draft) : []), [draft])
  const names = useMemo(() => new Map([...(draft?.questions ?? []), ...(draft?.leaves ?? [])].map((n) => [n.id, flat(n.label) || n.id])), [draft])
  const inbound = useMemo(() => {
    const m = new Map<string, number>()
    for (const q of draft?.questions ?? []) for (const b of [q.yes, q.no]) m.set(b, (m.get(b) ?? 0) + 1)
    return m
  }, [draft])

  if ((gate === 'checking' && !password) || (gate === 'open' && !draft)) {
    return (
      <div className="gate">
        <p className="muted pulse">Loading the admin…</p>
      </div>
    )
  }
  if (gate !== 'open' || !draft) {
    return (
      <div className="gate">
        <form
          className="gate-card"
          onSubmit={(e) => {
            e.preventDefault()
            setGate('checking')
            unlock(password)
          }}
        >
          <span className="label">MissinformationGPT · Admin</span>
          <h2>{gate === 'off' ? 'The admin is off' : 'Unlock the editor'}</h2>
          {gate === 'off' ? (
            <p className="muted">
              Add <code>ADMIN_PASSWORD=…</code> to <code>.env</code> (or your host's environment variables) and restart the server.
            </p>
          ) : (
            <>
              <p className="muted">Edit the decision tree and the prompts Jev answers.</p>
              <input type="text" name="username" value="admin" autoComplete="username" readOnly hidden />
              <input
                type="password"
                aria-label="Admin password"
                placeholder="Admin password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="primary" disabled={gate === 'checking' || !password}>
                {gate === 'checking' ? 'Checking…' : 'Unlock'}
              </button>
              {gateMsg && <p className="err">{gateMsg}</p>}
            </>
          )}
          <a className="nav" href="/">
            ← Back to the app
          </a>
        </form>
      </div>
    )
  }

  // Every edit goes through here: copy, change, and drop a test result that no longer matches the draft.
  const update = (fn: (t: TreeConfig) => void) => {
    setDraft((d) => {
      const t = structuredClone(d!)
      fn(t)
      return t
    })
    setResult(undefined)
  }
  const setQ = (id: string, patch: Partial<Question>) => update((t) => Object.assign(t.questions.find((q) => q.id === id)!, patch))
  const setL = (id: string, patch: Partial<Outcome>) => update((t) => Object.assign(t.leaves.find((l) => l.id === id)!, patch))

  function rename(old: string, next: string) {
    if (!KEY.test(next)) return 'Lowercase letters, digits and _, starting with a letter (up to 32).'
    if (names.has(next)) return `“${next}” is already used by another box.`
    update((t) => {
      for (const n of [...t.questions, ...t.leaves]) if (n.id === old) n.id = next
      for (const q of t.questions) for (const b of ['yes', 'no'] as const) if (q[b] === old) q[b] = next
      if (t.root === old) t.root = next
    })
    setSel(next)
  }

  // New question on a branch (or above the root): yes continues to what was there, no ends in a new outcome.
  function insert(into: { q: string; b: 'yes' | 'no' } | 'root', below: string) {
    const next = namer(draft!)
    const qid = next('question')
    const lids = [next('outcome'), below ? '' : next('outcome')]
    update((t) => {
      if (into === 'root') t.root = qid
      else t.questions.find((x) => x.id === into.q)![into.b] = qid
      t.questions.push({ id: qid, label: 'New question?', instructions: '', whenTrue: '', whenFalse: '', threshold: 0.5, yes: below || lids[1], no: lids[0], yesLabel: 'Yes', noLabel: 'No' })
      for (const id of lids.filter(Boolean)) t.leaves.push({ id, label: 'New outcome', example: '' })
    })
    setSel(qid)
  }
  const insertAbove = (id: string) => {
    const p = parentOf(draft!, id)
    if (p) insert({ q: p.q.id, b: p.b }, id)
    else if (draft!.root === id) insert('root', id)
  }

  function point(qid: string, branch: 'yes' | 'no', target: string) {
    const q = draft!.questions.find((x) => x.id === qid)!
    if (target === NEW_Q) return insert({ q: qid, b: branch }, names.has(q[branch]) ? q[branch] : '')
    if (target === NEW_L) {
      const lid = namer(draft!)('outcome')
      update((t) => {
        t.leaves.push({ id: lid, label: 'New outcome', example: '' })
        t.questions.find((x) => x.id === qid)![branch] = lid
      })
      return setSel(lid)
    }
    setQ(qid, { [branch]: target })
  }

  // Deleting a question keeps one branch (the one that goes on to more questions) and drops the other.
  function remove(id: string) {
    const t = draft!
    const q = t.questions.find((x) => x.id === id)
    const p = parentOf(t, id)
    if (!q) {
      update((t) => {
        t.leaves = t.leaves.filter((l) => l.id !== id)
        for (const x of t.questions) for (const b of ['yes', 'no'] as const) if (x[b] === id) x[b] = ''
      })
      return setSel(p?.q.id ?? t.root)
    }
    const isQ = (k: string) => t.questions.some((x) => x.id === k)
    const keep = isQ(q.yes) || !isQ(q.no) ? q.yes : q.no
    const gone = new Set([id])
    for (const stack = [keep === q.yes ? q.no : q.yes]; stack.length; ) {
      const k = stack.pop()!
      if (gone.has(k) || k === keep) continue
      gone.add(k)
      const x = t.questions.find((y) => y.id === k)
      if (x) stack.push(x.yes, x.no)
    }
    update((t) => {
      if (p) t.questions.find((x) => x.id === p.q.id)![p.b] = keep
      if (t.root === id) t.root = keep
      t.questions = t.questions.filter((x) => !gone.has(x.id))
      t.leaves = t.leaves.filter((x) => !gone.has(x.id))
    })
    setSel(p?.q.id ?? keep)
  }

  async function save() {
    setSaving(true)
    const { status, data } = await api<TreeConfig>('/api/admin/tree', token, { method: 'PUT', body: JSON.stringify(draft) })
    setSaving(false)
    if (status === 401) return lock('Your session ended. Unlock again to save.')
    if (status !== 200) return flash(data.error ?? 'Save failed')
    setSaved(data)
    setDraft(data)
    flash('Saved. New runs use this tree.')
  }

  async function test(e: React.FormEvent) {
    e.preventDefault()
    setTesting(true)
    const { status, data } = await api<{ answers: Answers; path: string[] }>('/api/admin/test', token, {
      method: 'POST',
      body: JSON.stringify({ tree: draft, statement }),
    })
    setTesting(false)
    if (status === 401) return lock('Your session ended. Unlock again.')
    const n = Date.now()
    if (status !== 200) return setResult({ n, path: [], answers: {}, error: data.error ?? 'Test failed' })
    setResult({ n, path: data.path, answers: data.answers })
    setTokens((t) => [...t, { id: `test-${n}`, path: data.path }])
  }

  async function refreshRuns() {
    const { status, data } = await api<RunFile[]>('/api/admin/runs', token)
    if (status === 401) return lock()
    if (status === 200) setRuns(data)
  }

  const q = draft.questions.find((x) => x.id === sel)
  const leaf = draft.leaves.find((x) => x.id === sel)
  const mine = problems.filter((p) => p.at === sel)
  const attached = (id: string) => !!parentOf(draft, id) || draft.root === id
  const options = (skip: string[]) => {
    const pick = (ids: { id: string; label: string }[]) =>
      ids
        .filter((n) => !skip.includes(n.id) && n.id !== draft.root)
        .map((n) => (
          <option key={n.id} value={n.id}>
            {flat(n.label) || n.id}
            {inbound.get(n.id) ? '' : ' · not connected'}
          </option>
        ))
    return (
      <>
        <optgroup label="Questions">{pick(draft.questions)}</optgroup>
        <optgroup label="Outcomes">{pick(draft.leaves)}</optgroup>
        <optgroup label="Create">
          <option value={NEW_Q}>+ Insert a new question here</option>
          <option value={NEW_L}>+ New outcome</option>
        </optgroup>
      </>
    )
  }

  return (
    <>
      <header className="top">
        <div>
          <h1>
            MissinformationGPT <span className="badge">Admin</span>
          </h1>
          <p className="sub">Edit the decision tree and the prompts Jev answers. Saved changes apply to the next run.</p>
        </div>
        <nav className="navs">
          <a className="nav" href="/">
            ← Back to the app
          </a>
          <button type="button" className="link" onClick={() => lock()}>
            Lock
          </button>
        </nav>
      </header>

      <div className="toolbar">
        <span className="label">Decision tree</span>
        <span className={dirty ? 'status dirty' : 'status'}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <span className="spacer" />
        <button type="button" onClick={() => (update((t) => Object.assign(t, structuredClone(DEFAULT_TREE))), setSel(DEFAULT_TREE.root))}>
          Reset to Figure 1
        </button>
        <button type="button" disabled={!dirty} onClick={() => (setDraft(saved), setResult(undefined))}>
          Discard
        </button>
        <button type="button" className="primary" disabled={!dirty || problems.length > 0 || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="editor">
        <div className="canvas-col">
          <div className="canvas">
            <Tree
              tree={draft}
              pick="all"
              selected={sel}
              onSelect={setSel}
              current={result && !result.error ? result : undefined}
              flying={tokens}
              onArrive={(id) => setTokens((t) => t.filter((x) => x.id !== id))}
            />
          </div>
          <p className="muted hint-line">Click a box to edit it. Numbers beside questions are their thresholds; mono text is each box's key.</p>

          {problems.length > 0 ? (
            <ul className="problems" aria-label="Problems">
              {problems.map((p, i) => (
                <li key={i}>
                  {p.at && names.has(p.at) ? (
                    <button type="button" className="link" onClick={() => setSel(p.at)}>
                      {p.message}
                    </button>
                  ) : (
                    p.message
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ok">✓ The tree is valid: every box is connected and every question has a prompt.</p>
          )}

          <section className="try" aria-label="Try a statement">
            <div className="section-head">
              <span className="label">Try a statement</span>
              <span className="muted">Runs this draft, saved or not, on one statement. About $0.00002 each.</span>
            </div>
            <div className="chips">
              {draft.leaves
                .filter((l) => l.example)
                .map((l) => (
                  <button type="button" key={l.id} className="chip ghost" onClick={() => setStatement(l.example)}>
                    {l.example}
                  </button>
                ))}
            </div>
            <form className="try-form" onSubmit={test}>
              <textarea rows={3} placeholder="Paste a post or write a statement…" value={statement} onChange={(e) => setStatement(e.target.value)} />
              <button className="primary" disabled={testing || !statement.trim() || problems.length > 0}>
                {testing ? 'Asking Jev…' : 'Test'}
              </button>
            </form>
            {result?.error && <p className="err">{result.error}</p>}
            {result && !result.error && (
              <div className="result" key={result.n}>
                <ol className="steps">
                  {result.path.slice(0, -1).map((id) => {
                    const x = draft.questions.find((y) => y.id === id)
                    const p = result.answers[id]
                    return (
                      x && (
                        <li key={id}>
                          <span>{flat(x.label)}</span>
                          <b className="mono">
                            {p >= x.threshold ? 'yes' : 'no'} {fmt(p)}
                          </b>
                        </li>
                      )
                    )
                  })}
                </ol>
                <div className="verdict">→ {names.get(result.path.at(-1)!)}</div>
              </div>
            )}
          </section>
        </div>

        <aside className="inspector" aria-label="Edit the selected box">
          {q ? (
            <>
              <div className="insp-head">
                <span className="label">Question</span>
                <span className="mono muted">CSV column p_{q.id}</span>
              </div>
              {mine.length > 0 && (
                <ul className="problems small">
                  {mine.map((p, i) => (
                    <li key={i}>{p.message}</li>
                  ))}
                </ul>
              )}
              <Field label="Text in the tree" hint="Enter starts a new line in the box.">
                <textarea rows={2} value={q.label} onChange={(e) => setQ(q.id, { label: e.target.value })} />
              </Field>
              <KeyField key={q.id} id={q.id} hint="Jev sees this as the question's name." onRename={(k) => rename(q.id, k)} />

              <h3 className="group">Jev prompt</h3>
              <Field label="Question for Jev">
                <textarea rows={3} value={q.instructions} placeholder="e.g. Is this statement political?" onChange={(e) => setQ(q.id, { instructions: e.target.value })} />
              </Field>
              <Field label="Yes when…">
                <textarea rows={3} value={q.whenTrue} placeholder="What makes the answer yes" onChange={(e) => setQ(q.id, { whenTrue: e.target.value })} />
              </Field>
              <Field label="No when…">
                <textarea rows={3} value={q.whenFalse} placeholder="What makes the answer no" onChange={(e) => setQ(q.id, { whenFalse: e.target.value })} />
              </Field>
              <Field label={`Threshold · yes when p ≥ ${fmt(q.threshold)}`} hint="Raise it to make yes harder to reach.">
                <input type="range" min={0.05} max={0.95} step={0.05} value={q.threshold} onChange={(e) => setQ(q.id, { threshold: Number(e.target.value) })} />
              </Field>

              <h3 className="group">Branches</h3>
              {(['yes', 'no'] as const).map((b) => (
                <div className="branch" key={b}>
                  <span className={`pill ${b}`}>{b === 'yes' ? 'Yes' : 'No'}</span>
                  <span aria-hidden>→</span>
                  <select aria-label={`Where “${b}” leads`} value={q[b]} onChange={(e) => point(q.id, b, e.target.value)}>
                    {!names.has(q[b]) && (
                      <option value={q[b]} disabled>
                        Choose…
                      </option>
                    )}
                    {names.has(q[b]) && <option value={q[b]}>{names.get(q[b])}</option>}
                    {options([q.id, q[b]])}
                  </select>
                  <input
                    aria-label={`Label on the ${b} arrow`}
                    placeholder={b === 'yes' ? 'Yes' : 'No'}
                    value={b === 'yes' ? q.yesLabel : q.noLabel}
                    onChange={(e) => setQ(q.id, b === 'yes' ? { yesLabel: e.target.value } : { noLabel: e.target.value })}
                  />
                </div>
              ))}
              <div className="insp-actions">
                <button type="button" disabled={!attached(q.id)} onClick={() => insertAbove(q.id)}>
                  Insert question above
                </button>
                <button type="button" className="danger" disabled={draft.questions.length < 2} onClick={() => remove(q.id)}>
                  Delete question
                </button>
              </div>
            </>
          ) : leaf ? (
            <>
              <div className="insp-head">
                <span className="label">Outcome</span>
                <span className="mono muted">a leaf of the tree</span>
              </div>
              {mine.length > 0 && (
                <ul className="problems small">
                  {mine.map((p, i) => (
                    <li key={i}>{p.message}</li>
                  ))}
                </ul>
              )}
              <Field label="Text in the tree" hint="Enter starts a new line in the box.">
                <textarea rows={2} value={leaf.label} onChange={(e) => setL(leaf.id, { label: e.target.value })} />
              </Field>
              <KeyField key={leaf.id} id={leaf.id} hint="Identifies this outcome; the CSV shows the text above." onRename={(k) => rename(leaf.id, k)} />
              <Field label="Example statement" hint="Shown on hover, and offered under Try a statement.">
                <input value={leaf.example} onChange={(e) => setL(leaf.id, { example: e.target.value })} />
              </Field>
              <div className="insp-actions">
                <button type="button" disabled={!attached(leaf.id)} onClick={() => insertAbove(leaf.id)}>
                  Insert question above
                </button>
                <button type="button" className="danger" onClick={() => remove(leaf.id)}>
                  Delete outcome
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Click a box in the tree to edit it.</p>
          )}
        </aside>
      </div>

      <section className="runs" aria-label="Saved runs">
        <div className="section-head">
          <span className="label">Runs</span>
          <span className="muted mono">
            {runs.length} CSV {runs.length === 1 ? 'file' : 'files'} in data/runs
          </span>
          <button type="button" onClick={refreshRuns}>
            Refresh
          </button>
        </div>
        {runs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Accounts</th>
                  <th>Posts</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.name}>
                    <td className="mono nowrap">{when(r.at)}</td>
                    <td>
                      <div className="chips">
                        {r.sources.map((s) => (
                          <Source key={s} s={s} />
                        ))}
                        {r.more > 0 && <span className="muted">+{r.more} more</span>}
                      </div>
                    </td>
                    <td className="mono">{r.posts}</td>
                    <td className="mono nowrap">{bytes(r.size)}</td>
                    <td>
                      <a className="button" href={`/api/runs/${encodeURIComponent(r.name)}`} download>
                        Download CSV
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No runs yet. Every run on the main page saves its results here as a CSV.</p>
        )}
      </section>

      {toast && (
        <div className="toast" key={toast.n} role="status">
          {toast.text}
        </div>
      )}
    </>
  )
}
