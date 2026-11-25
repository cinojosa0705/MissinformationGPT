// Shared between the server (server/*.ts) and the React app. Types only.
export type Post = { id: string; source: string; text: string; createdAt: string; url: string }
export type Answers = Record<string, number> // question key → Jev's p(yes)
export type Verdict = { id: string; answers?: Answers; path?: string[]; leaf?: string; error?: string } // path: root question … leaf
export type Progress = { source: string; n: number; pages: number; credits: number; done?: boolean }

// The editable decision tree. Keys are shared by questions and leaves; `yes`/`no` hold the key of the next box.
export type Question = {
  id: string
  label: string // text in the box, "\n" breaks lines
  instructions: string // Jev prompt
  whenTrue: string
  whenFalse: string
  threshold: number // yes when p(yes) ≥ threshold
  yes: string
  no: string
  yesLabel: string
  noLabel: string
}
export type Outcome = { id: string; label: string; example: string }
export type TreeConfig = { root: string; questions: Question[]; leaves: Outcome[] }
export type Problem = { at?: string; message: string }
export type RunFile = { name: string; at: string; size: number; posts: number; sources: string[]; more: number }
