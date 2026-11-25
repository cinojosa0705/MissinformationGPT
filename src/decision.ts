// The decision tree's data and rules, shared by the server and the React app (no DOM, no Node APIs).
import type { Answers, Problem, Question, TreeConfig } from './types.ts'

export const MAX_QUESTIONS = 12
const KEY = /^[a-z][a-z0-9_]{0,31}$/

const q = (id: string, label: string, instructions: string, whenTrue: string, whenFalse: string, yes: string, no: string, noLabel = 'No'): Question => ({
  id, label, instructions, whenTrue, whenFalse, threshold: 0.5, yes, no, yesLabel: 'Yes', noLabel,
})

// Figure 1, "Decision tree for conceptual scheme".
export const DEFAULT_TREE: TreeConfig = {
  root: 'political',
  questions: [
    q(
      'political',
      'Is the statement\npolitical?',
      'Is this statement political?',
      'It is about government, elections, politicians, political parties, public policy, laws, courts, the military, or relations between countries.',
      'It is personal, commercial, or about sports, entertainment, religion or culture, with no political subject.',
      'falsifiable',
      'nonpolitical',
    ),
    q(
      'falsifiable',
      'Is it falsifiable?',
      'Does the statement make a factual claim that evidence could prove true or false?',
      'It asserts something checkable: that an event happened, a number or statistic, a quote, a record, a result, or who did what.',
      'It only expresses an opinion, value judgment, insult, praise, hope, prediction, promise, intention, or question.',
      'settled',
      'opinion',
    ),
    q(
      'settled',
      'Is it externally\nverified or falsified?',
      "Has the statement's main factual claim been externally verified or falsified, i.e. settled by reliable sources such as official records, courts, credible reporting, fact-checkers or scientific consensus?",
      'Reliable public evidence settles the claim, either confirming it or refuting it.',
      'Nothing authoritative settles it: the claim is unconfirmed, still disputed, a long-running allegation that investigations neither proved nor disproved, or too new or obscure to have been checked.',
      'verified',
      'rumor',
    ),
    q(
      'verified',
      'Is it externally\nverified?',
      "Do reliable external sources confirm the statement's main factual claim?",
      'Reliable sources confirm it is true.',
      'Reliable sources show it is false or misleading.',
      'fact',
      'misinformation',
      'No (Falsified)',
    ),
  ],
  leaves: [
    { id: 'nonpolitical', label: 'Non-political\nstatement', example: 'Today is my birthday!' },
    { id: 'opinion', label: 'Political\nopinion', example: 'Voting is a waste of time!' },
    { id: 'rumor', label: 'Political\nrumor', example: 'Reagan talked to Iran in 1980!' },
    { id: 'misinformation', label: 'Political\nmisinformation', example: 'Trump won the 2020 election!' },
    { id: 'fact', label: 'Political\nfact', example: 'Trump won the 2024 election!' },
  ],
}

export const flat = (label: string) => label.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')

// Walk from the root with Jev's answers. Returns the keys visited, ending at a leaf.
export function walk(tree: TreeConfig, answers: Answers): string[] {
  const qs = new Map(tree.questions.map((x) => [x.id, x]))
  const path = [tree.root]
  for (let n = qs.get(tree.root); n && path.length <= qs.size; n = qs.get(path.at(-1)!)) path.push(answers[n.id] >= n.threshold ? n.yes : n.no)
  return path
}

// Keep only known fields with the right types, so stored JSON never carries junk from a request body.
export function clean(x: any): TreeConfig {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : [])
  return {
    root: s(x?.root),
    questions: list(x?.questions).map((q) => ({
      id: s(q?.id), label: s(q?.label), instructions: s(q?.instructions), whenTrue: s(q?.whenTrue), whenFalse: s(q?.whenFalse),
      threshold: Number(q?.threshold), yes: s(q?.yes), no: s(q?.no), yesLabel: s(q?.yesLabel), noLabel: s(q?.noLabel),
    })),
    leaves: list(x?.leaves).map((l) => ({ id: s(l?.id), label: s(l?.label), example: s(l?.example) })),
  }
}

// Everything that would stop the tree from being a single tree Jev can walk. Empty list = valid.
export function validate(tree: TreeConfig): Problem[] {
  const out: Problem[] = []
  const nodes = [...tree.questions, ...tree.leaves]
  const qs = new Map(tree.questions.map((x) => [x.id, x]))
  const ids = new Set(nodes.map((n) => n.id))
  const name = (id: string) => `“${flat(nodes.find((n) => n.id === id)?.label ?? '') || id}”`
  const say = (at: string | undefined, message: string) => out.push({ at, message })

  if (!tree.questions.length) say(undefined, 'The tree needs at least one question.')
  if (tree.questions.length > MAX_QUESTIONS) say(undefined, `The tree can have at most ${MAX_QUESTIONS} questions.`)
  const seen = new Set<string>()
  for (const n of nodes) {
    if (!KEY.test(n.id)) say(n.id, `${name(n.id)}: the key must be lowercase letters, digits or _, starting with a letter.`)
    else if (seen.has(n.id)) say(n.id, `Two boxes use the key “${n.id}”.`)
    seen.add(n.id)
    if (!flat(n.label)) say(n.id, `The box “${n.id}” needs a label.`)
    if (n.label.length > 80) say(n.id, `${name(n.id)}: keep the label under 80 characters.`)
  }
  for (const x of tree.questions) {
    if (!x.instructions.trim()) say(x.id, `${name(x.id)} needs an instruction for Jev.`)
    if (!x.whenTrue.trim() || !x.whenFalse.trim()) say(x.id, `${name(x.id)} needs both “yes when” and “no when” criteria.`)
    if ([x.instructions, x.whenTrue, x.whenFalse].some((t) => t.length > 2000)) say(x.id, `${name(x.id)}: keep each prompt under 2,000 characters.`)
    if (!(x.threshold > 0 && x.threshold < 1)) say(x.id, `${name(x.id)}: the threshold must be between 0 and 1.`)
    if (x.yesLabel.length > 30 || x.noLabel.length > 30) say(x.id, `${name(x.id)}: keep branch labels under 30 characters.`)
    for (const b of ['yes', 'no'] as const) if (!ids.has(x[b])) say(x.id, `${name(x.id)}: choose where “${b}” leads.`)
  }

  const parents = new Map<string, number>()
  for (const x of tree.questions) for (const b of [x.yes, x.no]) parents.set(b, (parents.get(b) ?? 0) + 1)
  if (!qs.has(tree.root)) say(undefined, 'The tree must start with a question.')
  else if (parents.has(tree.root)) say(tree.root, `${name(tree.root)} starts the tree, so no branch can lead back to it.`)
  for (const [id, n] of parents) if (n > 1 && ids.has(id)) say(id, `${name(id)} is reached by ${n} branches. Each box needs exactly one way in.`)

  const reached = new Set<string>()
  for (const stack = [tree.root]; stack.length; ) {
    const id = stack.pop()!
    if (reached.has(id) || !ids.has(id)) continue
    reached.add(id)
    const x = qs.get(id)
    if (x) stack.push(x.yes, x.no)
  }
  for (const n of nodes) if (ids.has(n.id) && !reached.has(n.id)) say(n.id, `${name(n.id)} isn't connected to the tree.`)
  return out
}
