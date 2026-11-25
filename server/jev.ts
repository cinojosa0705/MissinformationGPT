import { setTimeout as sleep } from 'node:timers/promises'
import type { Answers, Question } from '../src/types.ts'

const MODEL = process.env.JEV_MODEL ?? 'typesafe/jev-1.13'

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

// One Decisions call answers every question of the tree at once; walk() in src/decision.ts then follows the answers.
// ponytail: one threshold per question; calibrate against hand-labelled posts if verdicts look skewed.
export const judge = (questions: Question[], state: Record<string, string>, signal: AbortSignal) =>
  withSlot(async (): Promise<Answers> => {
    const asked = Object.fromEntries(
      questions.map((q) => [q.id, { type: 'noul', instructions: q.instructions, criteria: { true: q.whenTrue, false: q.whenFalse } }]),
    )
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch('https://openrouter.ai/api/alpha/decisions', {
          method: 'POST',
          headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: MODEL, questions: asked, state }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        })
        const body: any = await r.json()
        const a = Object.fromEntries(questions.map((q) => [q.id, body?.answers?.[q.id]?.noul]))
        if (!r.ok || Object.values(a).some((v) => typeof v !== 'number'))
          throw new Error(`Jev ${r.status}: ${JSON.stringify(body).slice(0, 160)}`)
        return a as Answers
      } catch (e) {
        if (attempt === 2 || signal.aborted) throw e
        await sleep(1000 * 2 ** attempt)
      }
    }
  })
