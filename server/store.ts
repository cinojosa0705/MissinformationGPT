// Everything kept on disk: the edited tree (data/tree.json) and one CSV per run (data/runs/).
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DEFAULT_TREE, clean, flat, validate } from '../src/decision.ts'
import type { Post, RunFile, TreeConfig, Verdict } from '../src/types.ts'

export const DATA = resolve(process.env.DATA_DIR ?? join(import.meta.dirname, '../data'))
const TREE = join(DATA, 'tree.json')
const RUNS = join(DATA, 'runs')
export const RUN_FILE = /^[\w.+-]+\.csv$/ // no slashes, so a name can't leave data/runs

export async function loadTree(): Promise<TreeConfig> {
  try {
    const tree = clean(JSON.parse(await readFile(TREE, 'utf8')))
    const problems = validate(tree)
    if (!problems.length) return tree
    console.warn(`Ignoring ${TREE}: ${problems[0].message}`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Ignoring ${TREE}: ${(e as Error).message}`)
  }
  return DEFAULT_TREE
}

export async function saveTree(tree: TreeConfig) {
  await mkdir(DATA, { recursive: true })
  await writeFile(TREE + '.tmp', JSON.stringify(tree, null, 2) + '\n')
  await rename(TREE + '.tmp', TREE) // atomic: a crash mid-write never leaves half a tree
}

// Post text is untrusted: a leading = + - @ would run as a formula in Excel or Sheets, so it gets a ' prefix.
const cell = (v: string) => {
  const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export function toCsv(tree: TreeConfig, rows: { post: Post; v: Verdict }[]) {
  const leaf = new Map(tree.leaves.map((l) => [l.id, flat(l.label)]))
  const head = ['posted_at', 'platform', 'handle', 'verdict', ...tree.questions.map((q) => `p_${q.id}`), 'text', 'url', 'error']
  const body = [...rows]
    .sort((a, b) => b.post.createdAt.localeCompare(a.post.createdAt))
    .map(({ post, v }) => {
      const [platform, handle] = post.source.split(':')
      const ps = tree.questions.map((q) => v.answers?.[q.id]?.toFixed(3) ?? '')
      return [post.createdAt, platform, handle, (v.leaf && leaf.get(v.leaf)) ?? '', ...ps, post.text, post.url, v.error ?? '']
    })
  return '﻿' + [head, ...body].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n' // BOM so Excel reads UTF-8
}

// File name: <time>_<posts>_<platform.handle>+….csv, so the run list needs no index file.
export async function saveRun(sources: string[], csv: string, posts: number) {
  await mkdir(RUNS, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const who = sources.slice(0, 3).map((s) => s.replace(':', '.')).join('+') + (sources.length > 3 ? `+${sources.length - 3}more` : '')
  const name = `${stamp}_${posts}_${who}.csv`
  await writeFile(join(RUNS, name), csv)
  return name
}

export const readRun = (name: string) => readFile(join(RUNS, name))

export async function listRuns(): Promise<RunFile[]> {
  const names = (await readdir(RUNS).catch(() => [] as string[])).filter((n) => RUN_FILE.test(n))
  const runs = await Promise.all(
    names.map(async (name) => {
      const [, posts = '0', who = ''] = name.match(/^[^_]+_(\d+)_(.+)\.csv$/) ?? []
      const parts = who.split('+')
      const { size, mtime } = await stat(join(RUNS, name))
      return {
        name, size, at: mtime.toISOString(), posts: Number(posts),
        sources: parts.filter((p) => p.includes('.')).map((p) => p.replace('.', ':')),
        more: parseInt(parts.find((p) => p.endsWith('more')) ?? '0'),
      }
    }),
  )
  return runs.sort((a, b) => b.at.localeCompare(a.at))
}
