// node server/check.ts — the tree walk on the slide's five examples, and Truth Social HTML cleanup.
import assert from 'node:assert/strict'
import { leafOf } from './jev.ts'
import { htmlToText } from './sources.ts'

assert.equal(leafOf({ political: 0.01, falsifiable: 0.96, settled: 0.04, verified: 0.11 }), 'nonpolitical') // Today is my birthday!
assert.equal(leafOf({ political: 0.97, falsifiable: 0.08, settled: 0.07, verified: 0.05 }), 'opinion') // Voting is a waste of time!
assert.equal(leafOf({ political: 0.98, falsifiable: 0.97, settled: 0.3, verified: 0.07 }), 'rumor') // Reagan talked to Iran in 1980!
assert.equal(leafOf({ political: 0.99, falsifiable: 0.98, settled: 0.96, verified: 0.02 }), 'misinformation') // Trump won the 2020 election!
assert.equal(leafOf({ political: 0.99, falsifiable: 0.97, settled: 0.71, verified: 0.73 }), 'fact') // Trump won the 2024 election!

assert.equal(htmlToText('<p>A &amp; B&#39;s</p><p>C<br/>D</p>'), "A & B's\nC\nD")
assert.equal(htmlToText('<p><span class="quote-inline"><br/>RT: https://truthsocial.com/users/x/statuses/1</span></p>'), '')
console.log('ok')
