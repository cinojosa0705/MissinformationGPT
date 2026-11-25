import { setTimeout as sleep } from 'node:timers/promises'
import type { Answers, Leaf, Post } from '../src/types.ts'

const MODEL = process.env.JEV_MODEL ?? 'typesafe/jev-1.13'

// One Decisions call answers every node of Figure 1 at once; leafOf walks the tree with the answers.
const QUESTIONS = {
  political: {
    type: 'noul',
    instructions: 'Is this statement political?',
    criteria: {
      true: 'It is about government, elections, politicians, political parties, public policy, laws, courts, the military, or relations between countries.',
      false: 'It is personal, commercial, or about sports, entertainment, religion or culture, with no political subject.',
    },
  },
  falsifiable: {
    type: 'noul',
    instructions: 'Does the statement make a factual claim that evidence could prove true or false?',
    criteria: {
      true: 'It asserts something checkable: that an event happened, a number or statistic, a quote, a record, a result, or who did what.',
      false: 'It only expresses an opinion, value judgment, insult, praise, hope, prediction, promise, intention, or question.',
    },
  },
  settled: {
    type: 'noul',
    instructions:
      "Has the statement's main factual claim been externally verified or falsified, i.e. settled by reliable sources such as official records, courts, credible reporting, fact-checkers or scientific consensus?",
    criteria: {
      true: 'Reliable public evidence settles the claim, either confirming it or refuting it.',
      false: 'Nothing authoritative settles it: the claim is unconfirmed, still disputed, a long-running allegation that investigations neither proved nor disproved, or too new or obscure to have been checked.',
    },
  },
  verified: {
    type: 'noul',
    instructions: "Do reliable external sources confirm the statement's main factual claim?",
    criteria: { true: 'Reliable sources confirm it is true.', false: 'Reliable sources show it is false or misleading.' },
  },
}

// ponytail: fixed 0.5 cut at every node; calibrate per node against hand-labelled posts if verdicts look skewed.
export const leafOf = (a: Answers): Leaf =>
  a.political < 0.5 ? 'nonpolitical'
  : a.falsifiable < 0.5 ? 'opinion'
  : a.settled < 0.5 ? 'rumor'
  : a.verified < 0.5 ? 'misinformation'
  : 'fact'

// At most MAX Jev calls in flight across all runs; a finished call hands its slot straight to the next waiter.
const MAX = 16
let active = 0
const waiting: (() => void)[] = []
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active < MAX) active++
  else await new Promise<void>((r) => waiting.push(r))
  try {
    return await fn()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

export const judge = (post: Post, signal: AbortSignal) =>
  withSlot(async (): Promise<Answers> => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch('https://openrouter.ai/api/alpha/decisions', {
          method: 'POST',
          headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            questions: QUESTIONS,
            state: { statement: post.text, author: '@' + post.source.split(':')[1], posted_at: post.createdAt },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        })
        const body: any = await r.json()
        const a = Object.fromEntries(Object.keys(QUESTIONS).map((k) => [k, body?.answers?.[k]?.noul]))
        if (!r.ok || Object.values(a).some((v) => typeof v !== 'number'))
          throw new Error(`Jev ${r.status}: ${JSON.stringify(body).slice(0, 160)}`)
        return a as Answers
      } catch (e) {
        if (attempt === 2 || signal.aborted) throw e
        await sleep(1000 * 2 ** attempt)
      }
    }
  })
