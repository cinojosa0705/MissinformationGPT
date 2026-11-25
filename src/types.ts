// Shared between the server (server/*.ts) and the React app. Types only.
export type Post = { id: string; source: string; text: string; createdAt: string; url: string }
export type Answers = { political: number; falsifiable: number; settled: number; verified: number }
export type Leaf = 'nonpolitical' | 'opinion' | 'rumor' | 'misinformation' | 'fact'
export type Verdict = { id: string; answers?: Answers; leaf?: Leaf; error?: string }
export type Progress = { source: string; n: number; pages: number; credits: number; done?: boolean }
