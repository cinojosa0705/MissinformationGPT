import { useLayoutEffect, useMemo, useRef } from 'react'
import { START, layout, route, type Pt } from './layout'
import type { Answers, TreeConfig } from './types'

const fmt = (p: number) => p.toFixed(2).replace(/^0/, '')

function Token({ id, pts, speed, lead, onArrive }: { id: string; pts: Pt[]; speed: number; lead: boolean; onArrive?: (id: string) => void }) {
  const ref = useRef<SVGGElement>(null)
  useLayoutEffect(() => {
    if (pts.length < 2) return void onArrive?.(id)
    const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
    const total = seg.reduce((a, b) => a + b, 0)
    let run = 0
    // Offsets by distance so the token moves at an even pace along every segment.
    const frames = pts.map((p, i) => ({ transform: `translate(${p[0]}px, ${p[1]}px)`, offset: (run += i ? seg[i - 1] : 0) / total }))
    const anim = ref.current!.animate(frames, { duration: total / 0.42 / speed, easing: 'ease-in-out', fill: 'forwards' })
    anim.onfinish = () => onArrive?.(id)
    return () => anim.cancel()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- route and pace are fixed at launch
  return (
    <g ref={ref} className="token">
      <circle r={lead ? 9 : 6} />
    </g>
  )
}

type Props = {
  tree: TreeConfig
  flying?: { id: string; path: string[] }[]
  current?: { path: string[]; answers: Answers } // highlighted, with Jev's answer beside each question asked
  counts?: Record<string, number> // leaf totals; without them leaves show their key (admin preview)
  speed?: number
  selected?: string
  pick?: 'leaves' | 'all' // which boxes respond to clicks
  onSelect?: (id: string) => void
  onArrive?: (id: string) => void
}

export default function Tree({ tree, flying = [], current, counts, speed = 1, selected, pick = 'leaves', onSelect, onArrive }: Props) {
  const L = useMemo(() => layout(tree), [tree])
  const qs = useMemo(() => new Map(tree.questions.map((q) => [q.id, q])), [tree])
  const on = new Set(current?.path)
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
  const boxes = [...L.boxes.values()]

  return (
    <svg className="tree" viewBox={`0 0 ${L.W} ${L.H}`} role="img" aria-label={`Decision tree with ${tree.questions.length} questions`}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>

      {[...L.edges.values()].map((e) => (
        <g key={e.to}>
          <polyline className={on.has(e.to) ? 'edge on' : 'edge'} points={e.pts.join(' ')} markerEnd="url(#arrow)" />
          <text className="edge-label" x={e.at[0]} y={e.at[1]} textAnchor={e.anchor}>
            {e.label}
          </text>
        </g>
      ))}

      {boxes.map((b) => {
        const isLeaf = b.kind === 'leaf'
        const clickable = b.kind !== 'start' && (pick === 'all' || isLeaf) && !!onSelect
        const lit = b.kind === 'start' ? !!current : on.has(b.id)
        const cls = [isLeaf ? 'leaf' : 'node', lit && 'on', selected === b.id && 'sel', clickable && 'pickable'].filter(Boolean).join(' ')
        const left = b.x - b.w / 2
        const topY = b.y - b.h / 2
        const q = qs.get(b.id)
        const asked = q && current && on.has(b.id) && current.answers[b.id] !== undefined
        const p = asked ? current.answers[b.id] : 0
        const n = counts?.[b.id] ?? 0
        return (
          <g
            key={b.id}
            className={cls}
            {...(clickable ? {
              role: 'button',
              tabIndex: 0,
              'aria-pressed': selected === b.id,
              'aria-label': counts && isLeaf ? `${b.title}: ${n} posts` : `Edit ${b.title}`,
              onClick: () => onSelect!(b.id),
              onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect!(b.id)),
            } : {})}
          >
            <title>{b.title}</title>
            {isLeaf && n > 0 && <rect key={n} className="ripple" x={left} y={topY} width={b.w} height={b.h} rx={4} />}
            <rect className="box" x={left} y={topY} width={b.w} height={b.h} rx={4} />
            {b.lines.map((t, i) => (
              <text key={i} className="name" x={b.x} y={b.y + 6 + (i - (b.lines.length - 1) / 2) * (isLeaf ? 20 : 21)} textAnchor="middle">
                {t}
              </text>
            ))}
            {q && (asked || !counts) && (
              <text className="prob" x={b.x + b.w / 2 + 6} y={topY + 12}>
                {asked ? `${p >= q.threshold ? 'yes' : 'no'} ${fmt(p)}` : `≥ ${fmt(q.threshold)}`}
              </text>
            )}
            {isLeaf && counts && (
              <>
                <text className="count" x={b.x} y={b.y + b.h / 2 + 36} textAnchor="middle">
                  {n}
                </text>
                <text className="pct" x={b.x} y={b.y + b.h / 2 + 56} textAnchor="middle">
                  {total ? Math.round((n / total) * 100) : 0}%
                </text>
              </>
            )}
            {b.kind !== 'start' && !counts && (
              <text className="key" x={isLeaf ? b.x : b.x + b.w / 2 + 6} y={isLeaf ? b.y + b.h / 2 + 22 : topY + 30} textAnchor={isLeaf ? 'middle' : 'start'}>
                {b.id}
              </text>
            )}
          </g>
        )
      })}

      {flying.map((t) => (
        <Token key={t.id} id={t.id} pts={route(L, t.path)} speed={speed} lead={t.path === current?.path} onArrive={onArrive} />
      ))}
      {!L.boxes.has(START) && (
        <text className="empty" x={L.W / 2} y={L.H / 2} textAnchor="middle">
          Pick a question to start the tree
        </text>
      )}
    </svg>
  )
}

