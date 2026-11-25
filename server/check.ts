// node server/check.ts — tree walk, tree validation, CSV escaping, Truth Social HTML cleanup.
import assert from 'node:assert/strict'
import { DEFAULT_TREE, clean, validate, walk } from '../src/decision.ts'
import { layout } from '../src/layout.ts'
import { htmlToText } from './sources.ts'
import { toCsv } from './store.ts'

const leaf = (political: number, falsifiable: number, settled: number, verified: number) =>
  walk(DEFAULT_TREE, { political, falsifiable, settled, verified }).at(-1)
assert.equal(leaf(0.01, 0.96, 0.04, 0.11), 'nonpolitical') // Today is my birthday!
assert.equal(leaf(0.97, 0.08, 0.07, 0.05), 'opinion') // Voting is a waste of time!
assert.equal(leaf(0.98, 0.97, 0.3, 0.07), 'rumor') // Reagan talked to Iran in 1980!
assert.equal(leaf(0.99, 0.98, 0.96, 0.02), 'misinformation') // Trump won the 2020 election!
assert.equal(leaf(0.99, 0.97, 0.71, 0.73), 'fact') // Trump won the 2024 election!
assert.deepEqual(walk(DEFAULT_TREE, { political: 0.9, falsifiable: 0.2 }), ['political', 'falsifiable', 'opinion'])

// Validation: the default is clean, and broken shapes are caught.
assert.deepEqual(validate(DEFAULT_TREE), [])
assert.deepEqual(validate(clean(JSON.parse(JSON.stringify(DEFAULT_TREE)))), [])
const edit = (fn: (t: typeof DEFAULT_TREE) => void) => {
  const t = structuredClone(DEFAULT_TREE)
  fn(t)
  return validate(t).map((p) => p.message).join(' | ')
}
assert.match(edit((t) => (t.questions[1].no = 'rumor')), /reached by 2 branches/) // two ways into one box
assert.match(edit((t) => (t.questions[1].no = 'rumor')), /“Political opinion” isn't connected/)
assert.match(edit((t) => (t.questions[3].yes = 'political')), /starts the tree/) // loop back to the root
assert.match(edit((t) => (t.questions[0].threshold = 1)), /threshold/)
assert.match(edit((t) => (t.leaves[0].id = 'Bad Key')), /key must be/)
assert.match(edit((t) => (t.root = 'rumor')), /start with a question/)

// Layout: Figure 1 gets every box and edge, nothing overlaps within a row, and the top-right corner stays free.
const L = layout(DEFAULT_TREE)
assert.equal(L.boxes.size, 10) // 4 questions, 5 outcomes, Statement
assert.equal(L.edges.size, 9)
for (const a of L.boxes.values())
  for (const b of L.boxes.values()) if (a !== b && a.y === b.y) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2, `${a.id} overlaps ${b.id}`)
assert.ok(L.corner)

// CSV: quotes, newlines and formula-looking post text.
const post = { id: 'truth:1', source: 'truth:someone', text: '=HYPERLINK("x")\nsecond, line', createdAt: '2026-01-02T03:04:05.000Z', url: 'https://example.com/1' }
const csv = toCsv(DEFAULT_TREE, [{ post, v: { id: post.id, answers: { political: 0.99, falsifiable: 0.2, settled: 0, verified: 0 }, leaf: 'opinion' } }])
assert.ok(csv.startsWith('﻿posted_at,platform,handle,verdict,p_political,p_falsifiable,p_settled,p_verified,text,url,error\r\n'))
assert.ok(csv.includes(`2026-01-02T03:04:05.000Z,truth,someone,Political opinion,0.990,0.200,0.000,0.000,"'=HYPERLINK(""x"")\nsecond, line",https://example.com/1,\r\n`))

assert.equal(htmlToText('<p>A &amp; B&#39;s</p><p>C<br/>D</p>'), "A & B's\nC\nD")
assert.equal(htmlToText('<p><span class="quote-inline"><br/>RT: https://truthsocial.com/users/x/statuses/1</span></p>'), '')
console.log('ok')
