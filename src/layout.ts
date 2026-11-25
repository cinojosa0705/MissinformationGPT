// Geometry for any decision tree, styled after Figure 1: leaves in one row at the bottom, each question one row
// lower than its parent, a "no"/"yes" that ends in a leaf drops straight down onto it. Pure, so check.ts can test it.
import { flat } from './decision.ts'
import type { TreeConfig } from './types.ts'

export type Pt = [number, number]
export type Box = { id: string; kind: 'start' | 'q' | 'leaf'; x: number; y: number; w: number; h: number; lines: string[]; title: string }
export type Edge = { to: string; pts: Pt[]; label: string; at: Pt; anchor: 'start' | 'end' }
export type Layout = { boxes: Map<string, Box>; edges: Map<string, Edge>; W: number; H: number; corner: boolean }

export const START = '#start' // can't clash: keys are [a-z0-9_]
const TOP = 40
const GAP = 28
const PAD = 24
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif'

// Real text widths from a canvas in the browser; an average glyph width in Node (check.ts). Typed by hand so the
// server's type-check, which has no DOM types, accepts this file.
type Pen = { font: string; measureText(s: string): { width: number } }
const doc = (globalThis as { document?: { createElement(tag: 'canvas'): { getContext(kind: '2d'): Pen | null } } }).document
let ctx: Pen | null | undefined
const textW = (s: string, font: string, px: number) => {
  if (ctx === undefined) ctx = doc ? doc.createElement('canvas').getContext('2d') : null
  if (!ctx) return s.length * px * 0.56
  ctx.font = font
  return ctx.measureText(s).width
}
const split = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
const widest = (lines: string[], font: string) => Math.max(0, ...lines.map((l) => textW(l, font, 17)))

export function layout(tree: TreeConfig): Layout {
  const qs = new Map(tree.questions.map((q) => [q.id, q]))
  const ls = new Map(tree.leaves.map((l) => [l.id, l]))
  const boxes = new Map<string, Box>()
  const parent = new Map<string, { id: string; branch: 'yes' | 'no' }>()
  const col = new Map<string, number>() // x in leaf columns, scaled to pixels once the spacing is known
  let columns = 0
  let deepest = 1

  // Depth-first, "no" before "yes", so leaves read left to right like the figure. Only the first way into a box
  // is drawn; a draft with two ways in, or a loop, still renders and validate() explains what's wrong.
  const place = (id: string, depth: number, from?: { id: string; branch: 'yes' | 'no' }): number | undefined => {
    const q = qs.get(id)
    const l = ls.get(id)
    if (boxes.has(id) || (!q && !l)) return
    if (from) parent.set(id, from)
    if (l) {
      const lines = split(l.label)
      const w = Math.max(150, widest(lines, `italic 17px ${SANS}`) + 32)
      boxes.set(id, { id, kind: 'leaf', x: 0, y: 0, w, h: lines.length > 2 ? 20 + 20 * lines.length : 60, lines, title: l.example ? `e.g. “${l.example}”` : flat(l.label) })
      col.set(id, columns++)
      return col.get(id)
    }
    const lines = split(q!.label)
    const w = Math.max(140, widest(lines, `700 17px ${SANS}`) + 40)
    boxes.set(id, { id, kind: 'q', x: 0, y: depth, w, h: lines.length > 1 ? 20 + 21 * lines.length : 44, lines, title: flat(q!.label) })
    deepest = Math.max(deepest, depth)
    const kids = (['no', 'yes'] as const)
      .map((b) => ({ id: q![b], c: place(q![b], depth + 1, { id, branch: b }) }))
      .filter((k): k is { id: string; c: number } => k.c !== undefined)
    const leafKids = kids.filter((k) => ls.has(k.id))
    const c = !kids.length ? columns++ : kids.length === 2 && leafKids.length === 1 ? leafKids[0].c : (kids[0].c + kids[kids.length - 1].c) / 2
    col.set(id, c)
    return c
  }
  place(tree.root, 1)

  // Column spacing: the smallest that keeps leaves apart, boxes in one row apart, and straight drops clear of boxes.
  const all = [...boxes.values()]
  const qb = all.filter((b) => b.kind === 'q')
  let s = Math.max(0, ...all.filter((b) => b.kind === 'leaf').map((b) => b.w)) + GAP
  for (const a of qb)
    for (const b of qb) {
      const dc = col.get(b.id)! - col.get(a.id)!
      if (a.y === b.y && dc > 0) s = Math.max(s, ((a.w + b.w) / 2 + GAP) / dc)
    }
  for (const [id, p] of parent) {
    const c = boxes.get(id)!
    const dc = Math.abs(col.get(id)! - col.get(p.id)!)
    // Room for a question-to-question diagonal like the figure's; past 300 per column it bends into an elbow instead.
    if (c.kind === 'q' && dc > 0) s = Math.max(s, Math.min(300, ((boxes.get(p.id)!.w + c.w) / 2 + 20) / dc))
    if (c.kind !== 'leaf' || dc !== 0) continue
    for (const b of qb) {
      const dc = Math.abs(col.get(b.id)! - col.get(id)!)
      if (b.y > boxes.get(p.id)!.y && dc > 0) s = Math.max(s, (b.w / 2 + 16) / dc)
    }
  }

  const row = Math.max(98, ...qb.map((b) => b.h + 36))
  const leafY = TOP + deepest * row + 165
  for (const b of all) {
    b.x = col.get(b.id)! * s
    b.y = b.kind === 'leaf' ? leafY : TOP + b.y * row
  }

  const edges = new Map<string, Edge>()
  const bottom = (b: Box) => b.y + b.h / 2
  const top = (b: Box) => b.y - b.h / 2
  const root = boxes.get(tree.root)
  if (root) {
    const start: Box = { id: START, kind: 'start', x: root.x, y: TOP, w: 140, h: 44, lines: ['Statement'], title: 'Statement' }
    boxes.set(START, start)
    const a = bottom(start)
    const b = top(root)
    edges.set(root.id, { to: root.id, pts: [[root.x, a], [root.x, b]], label: 'evaluate', at: [root.x + 10, (a + b) / 2 + 5], anchor: 'start' })
  }
  for (const [id, { id: pid, branch }] of parent) {
    const p = boxes.get(pid)!
    const c = boxes.get(id)!
    const q = qs.get(pid)!
    const label = (branch === 'yes' ? q.yesLabel : q.noLabel).trim() || (branch === 'yes' ? 'Yes' : 'No')
    const d = Math.sign(c.x - p.x)
    const pb = bottom(p)
    const ct = top(c)
    if (d === 0) {
      // Straight drop; the label sits on the side away from the other branch.
      const other = boxes.get(branch === 'yes' ? q.no : q.yes)
      const side = other && other.x < p.x ? 1 : -1
      edges.set(id, { to: id, pts: [[p.x, pb], [p.x, ct]], label, at: [p.x + side * 12, (pb + ct) / 2 + 7], anchor: side > 0 ? 'start' : 'end' })
      continue
    }
    const sx = p.x + d * (p.w / 2 - 15)
    const ex = c.x - d * (c.w / 2 - 25)
    const anchor = d > 0 ? 'start' : 'end'
    if (c.kind === 'q' && d * (ex - sx) >= 20) {
      edges.set(id, { to: id, pts: [[sx, pb], [ex, ct]], label, at: [(sx + ex) / 2 + d * 10, (pb + ct) / 2 - 7], anchor })
    } else {
      const ox = p.x + d * Math.min(50, p.w / 4)
      const my = (pb + ct) / 2
      edges.set(id, { to: id, pts: [[ox, pb], [ox, my], [c.x, my], [c.x, ct]], label, at: [ox + d * 9, Math.min(pb + 34, my - 4)], anchor })
    }
  }

  // Fit the drawing: boxes, the notes right of questions ("yes .99", key), and edge labels.
  let minX = Infinity
  let maxX = -Infinity
  for (const b of boxes.values()) {
    minX = Math.min(minX, b.x - b.w / 2)
    maxX = Math.max(maxX, b.x + b.w / 2 + (b.kind === 'q' ? 96 : 0))
  }
  for (const e of edges.values()) {
    const w = textW(e.label, `15px ${SANS}`, 15)
    minX = Math.min(minX, e.anchor === 'end' ? e.at[0] - w : e.at[0])
    maxX = Math.max(maxX, e.anchor === 'start' ? e.at[0] + w : e.at[0])
  }
  if (!boxes.size) return { boxes, edges, W: 600, H: 200, corner: false }
  const dx = PAD - minX
  for (const b of boxes.values()) b.x += dx
  for (const e of edges.values()) {
    e.pts = e.pts.map(([x, y]) => [x + dx, y])
    e.at = [e.at[0] + dx, e.at[1]]
  }
  const W = Math.ceil(maxX - minX + PAD * 2)
  const H = leafY + 100
  // Is the top-right corner empty? Then the app can float its "Now evaluating" card there, as in the figure.
  const corner = ![...boxes.values()].some((b) => b.x + b.w / 2 + (b.kind === 'q' ? 96 : 0) > W * 0.52 && top(b) < H * 0.42)
  return { boxes, edges, W, H, corner }
}

// The points a token travels for a verdict path: Statement, then each edge into the next box.
export function route(L: Layout, path: string[]): Pt[] {
  const s = L.boxes.get(START)
  const pts: Pt[] = s ? [[s.x, s.y]] : []
  for (const id of path) {
    const e = L.edges.get(id)
    const b = L.boxes.get(id)
    if (!e || !b) break
    pts.push(...e.pts, [b.x, b.y])
  }
  return pts
}
