import { useLayoutEffect, useRef } from 'react'
import type { Answers, Leaf } from './types'

type Pt = [number, number]

// Layout of the slide's Figure 1, in viewBox units.
const NODES = {
  S: { x: 130, y: 40, w: 140, h: 44, lines: ['Statement'] },
  P: { x: 130, y: 145, w: 220, h: 62, lines: ['Is the statement', 'political?'] },
  F: { x: 405, y: 240, w: 200, h: 44, lines: ['Is it falsifiable?'] },
  E: { x: 660, y: 335, w: 250, h: 62, lines: ['Is it externally', 'verified or falsified?'] },
  V: { x: 935, y: 435, w: 210, h: 62, lines: ['Is it externally', 'verified?'] },
}
const LEAF = { y: 600, w: 160, h: 60 }

export const QUESTIONS = [
  ['P', 'political', 'Political?'],
  ['F', 'falsifiable', 'Falsifiable?'],
  ['E', 'settled', 'Verified or falsified?'],
  ['V', 'verified', 'Verified?'],
] as const

// How many questions the walk asks before it exits the tree: it stops at the first "no".
export const asked = (a: Answers) => {
  const i = QUESTIONS.findIndex(([, k]) => a[k] < 0.5)
  return i === -1 ? 4 : i + 1
}

export const LEAVES: Record<Leaf, { x: number; lines: string[]; example: string; path: string[] }> = {
  nonpolitical: { x: 130, lines: ['Non-political', 'statement'], example: 'Today is my birthday!', path: ['SP', 'Pn'] },
  opinion: { x: 405, lines: ['Political', 'opinion'], example: 'Voting is a waste of time!', path: ['SP', 'PF', 'Fo'] },
  rumor: { x: 660, lines: ['Political', 'rumor'], example: 'Reagan talked to Iran in 1980!', path: ['SP', 'PF', 'FE', 'Er'] },
  misinformation: { x: 850, lines: ['Political', 'misinformation'], example: 'Trump won the 2020 election!', path: ['SP', 'PF', 'FE', 'EV', 'Vm'] },
  fact: { x: 1030, lines: ['Political', 'fact'], example: 'Trump won the 2024 election!', path: ['SP', 'PF', 'FE', 'EV', 'Vf'] },
}
export const leafName = (l: Leaf) => LEAVES[l].lines.join(' ')

const c = (n: { x: number; y: number }): Pt => [n.x, n.y]
const leafC = (l: Leaf): Pt => [LEAVES[l].x, LEAF.y]
const LEAF_TOP = LEAF.y - LEAF.h / 2

const EDGES: Record<string, { pts: Pt[]; to: Pt; label: string; at: Pt; end?: boolean }> = {
  SP: { pts: [[130, 62], [130, 114]], to: c(NODES.P), label: 'evaluate', at: [140, 93] },
  PF: { pts: [[225, 176], [330, 218]], to: c(NODES.F), label: 'Yes', at: [288, 190] },
  Pn: { pts: [[130, 176], [130, LEAF_TOP]], to: leafC('nonpolitical'), label: 'No', at: [118, 380], end: true },
  FE: { pts: [[490, 262], [565, 304]], to: c(NODES.E), label: 'Yes', at: [534, 276] },
  Fo: { pts: [[405, 262], [405, LEAF_TOP]], to: leafC('opinion'), label: 'No', at: [393, 420], end: true },
  EV: { pts: [[770, 366], [860, 404]], to: c(NODES.V), label: 'Yes', at: [822, 377] },
  Er: { pts: [[660, 366], [660, LEAF_TOP]], to: leafC('rumor'), label: 'No', at: [648, 470], end: true },
  Vm: { pts: [[885, 466], [885, 518], [850, 518], [850, LEAF_TOP]], to: leafC('misinformation'), label: 'No (Falsified)', at: [877, 500], end: true },
  Vf: { pts: [[985, 466], [985, 518], [1030, 518], [1030, LEAF_TOP]], to: leafC('fact'), label: 'Yes', at: [995, 500] },
}

const route = (l: Leaf): Pt[] => [c(NODES.S), ...LEAVES[l].path.flatMap((e) => [...EDGES[e].pts, EDGES[e].to])]
const fmt = (p: number) => p.toFixed(2).replace(/^0/, '')

function Token({ id, leaf, speed, lead, onArrive }: { id: string; leaf: Leaf; speed: number; lead: boolean; onArrive: (id: string) => void }) {
  const ref = useRef<SVGGElement>(null)
  useLayoutEffect(() => {
    const pts = route(leaf)
    const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]))
    const total = seg.reduce((a, b) => a + b, 0)
    let run = 0
    // Offsets by distance so the token moves at an even pace along every segment.
    const frames = pts.map((p, i) => ({ transform: `translate(${p[0]}px, ${p[1]}px)`, offset: (run += i ? seg[i - 1] : 0) / total }))
    const anim = ref.current!.animate(frames, { duration: total / 0.42 / speed, easing: 'ease-in-out', fill: 'forwards' })
    anim.onfinish = () => onArrive(id)
    return () => anim.cancel()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- route and pace are fixed at launch
  return (
    <g ref={ref} className="token">
      <circle r={lead ? 9 : 6} />
    </g>
  )
}

type Props = {
  flying: { id: string; leaf: Leaf }[]
  current?: { id: string; leaf: Leaf; answers: Answers }
  counts: Record<Leaf, number>
  speed: number
  selected?: Leaf
  onSelect: (l?: Leaf) => void
  onArrive: (id: string) => void
}

export default function Tree({ flying, current, counts, speed, selected, onSelect, onArrive }: Props) {
  const path = new Set(current ? LEAVES[current.leaf].path : [])
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const n = current ? asked(current.answers) : 0
  return (
    <svg className="tree" viewBox="0 0 1130 700" role="img" aria-label="Decision tree: political, falsifiable, externally settled, verified">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>

      {Object.entries(EDGES).map(([k, e]) => (
        <g key={k}>
          <polyline className={path.has(k) ? 'edge on' : 'edge'} points={e.pts.join(' ')} markerEnd="url(#arrow)" />
          <text className="edge-label" x={e.at[0]} y={e.at[1]} textAnchor={e.end ? 'end' : 'start'}>
            {e.label}
          </text>
        </g>
      ))}

      {Object.entries(NODES).map(([k, b]) => {
        const qi = QUESTIONS.findIndex(([node]) => node === k)
        const shown = current && qi !== -1 && qi < n
        const p = shown ? current.answers[QUESTIONS[qi][1]] : 0
        return (
          <g key={k} className={current && (k === 'S' || shown) ? 'node on' : 'node'}>
            <rect x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx={4} />
            {b.lines.map((l, i) => (
              <text key={i} x={b.x} y={b.y + 6 + (i - (b.lines.length - 1) / 2) * 21} textAnchor="middle">
                {l}
              </text>
            ))}
            {shown && (
              <text className="prob" x={b.x + b.w / 2 + 6} y={b.y - b.h / 2 + 12}>
                {p >= 0.5 ? 'yes' : 'no'} {fmt(p)}
              </text>
            )}
          </g>
        )
      })}

      {(Object.keys(LEAVES) as Leaf[]).map((l) => {
        const { x, lines, example } = LEAVES[l]
        const cls = ['leaf', current?.leaf === l && 'on', selected === l && 'sel'].filter(Boolean).join(' ')
        return (
          <g
            key={l}
            className={cls}
            role="button"
            tabIndex={0}
            aria-pressed={selected === l}
            aria-label={`${leafName(l)}: ${counts[l]} posts`}
            onClick={() => onSelect(selected === l ? undefined : l)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(selected === l ? undefined : l))}
          >
            <title>{`e.g. “${example}”`}</title>
            {counts[l] > 0 && <rect key={counts[l]} className="ripple" x={x - LEAF.w / 2} y={LEAF_TOP} width={LEAF.w} height={LEAF.h} rx={4} />}
            <rect className="box" x={x - LEAF.w / 2} y={LEAF_TOP} width={LEAF.w} height={LEAF.h} rx={4} />
            {lines.map((t, i) => (
              <text key={i} className="name" x={x} y={LEAF.y - 4 + i * 20} textAnchor="middle">
                {t}
              </text>
            ))}
            <text className="count" x={x} y={LEAF.y + 66} textAnchor="middle">
              {counts[l]}
            </text>
            <text className="pct" x={x} y={LEAF.y + 86} textAnchor="middle">
              {total ? Math.round((counts[l] / total) * 100) : 0}%
            </text>
          </g>
        )
      })}

      {flying.map((t) => (
        <Token key={t.id} {...t} speed={speed} lead={t.id === current?.id} onArrive={onArrive} />
      ))}
    </svg>
  )
}
