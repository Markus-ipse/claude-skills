import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionMessage } from 'claude-code'

const HOME = '/home/u'
const ROOT = `${HOME}/.claude/handoffs`
const BRIEF = `${ROOT}/code/feat.md`
const MIN = 60_000
const SUMMARY: SessionMessage = { role: 'user', text: 'summary', toolUses: [] }

// A fake world beneath the plugin: files with mtimes, and just enough git.
function world(on: On, opts: { sid?: string; store?: Record<string, unknown>; upstream?: boolean } = {}) {
  const files = new Map<string, { mtime: number; text: string }>()
  const committed = new Map<string, number>()
  const commits: string[] = []
  const pushes: string[] = []
  const submits: string[] = []
  const statuses: (string | undefined)[] = []
  let headSec = 0
  let codeChanges: string[] = []
  const compacts: string[] = []

  mock.env(on, { HOME })
  mock.store(on, opts.store)
  const clock = mock.clock(on)
  const session = mock.session(on)

  on('session.id', () => ({ value: opts.sid ?? 's1' }))
  on('session.cwd', () => ({ value: '/code' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', () => ({ turnId: 't' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.compact', ($, e) => {
    compacts.push(e.instructions ?? '')
    return { messages: [SUMMARY] }
  })
  on('tool.call', () => ({ result: {} as never, text: 'ok' }))
  on('ui.status', ($, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => (submits.push(e.text), { text: e.text }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', ($, e) => ({ value: files.get(e.path)?.text ?? '' }))
  on('fs.stat', ($, e) => {
    const f = files.get(e.path)
    const isDir = e.path === ROOT || e.path === '/code'
    if (!f && !isDir) return { deny: `ENOENT ${e.path}` }
    return { value: { kind: isDir ? 'dir' : 'file', size: 0, mtimeMs: f?.mtime ?? 0, isLink: false, ...(e.resolve ? { realPath: e.path } : {}) } as const }
  })
  on('process.run', ($, e) => {
    const a = e.argv.slice(1).join(' ')
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const path = e.argv[e.argv.length - 1] ?? ''
    if (a.startsWith('status --porcelain -- ')) return ok(files.get(path)?.mtime !== committed.get(path) ? ` M ${path}` : '')
    if (a.startsWith('commit ')) { committed.set(path, files.get(path)?.mtime ?? 0); commits.push(path); return ok() }
    if (a === 'push') { pushes.push(e.init?.cwd ?? ''); return ok() }
    if (a === 'rev-parse --absolute-git-dir') return ok('/git')
    if (a === 'rev-list --count @{u}..HEAD') return opts.upstream === false ? { value: { ...ok().value, exitCode: 128 } } : ok('1')
    if (a === 'log -1 --format=%ct') return ok(String(headSec))
    if (a === 'rev-parse --show-toplevel') return ok('/code')
    if (a === 'status --porcelain -z -uall') return ok(codeChanges.join('\0'))
    return ok()
  })

  return {
    clock, session, compacts, files, commits, pushes, submits, statuses,
    write: (path: string, ageMin = 0) => files.set(path, { mtime: Date.now() - ageMin * MIN, text: `# ${path}` }),
    commitInCode: () => { headSec = Math.floor(Date.now() / 1000) + 1 },
    changeInCode: (rel: string) => { files.set(`/code/${rel}`, { mtime: Date.now() + 1000, text: '' }); codeChanges = [` M ${rel}`] },
  }
}

const start = ($: Engine) =>
  $.session.start({ cwd: '/code', surface: 'terminal', isInteractive: true })
const turnDone = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

describe('bind', () => {
  test('writing a brief commits it locally and pushes after a minute', async ($, on) => {
    const w = world(on)
    await start($)
    w.write(BRIEF)
    const ran = await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    expect(ran.context).toBeUndefined()
    expect(w.commits).toEqual([BRIEF])
    expect(w.pushes).toEqual([])
    await w.clock.advance(MIN)
    expect(w.pushes).toEqual([`${ROOT}/code`])
    expect(w.statuses.at(-1)).toMatch(/handoff: feat/)
  })

  test('another session holding the sync lock defers the push', async ($, on) => {
    const w = world(on, { store: { 'sync-lock': { sid: 'other', at: Date.now() } } })
    await start($)
    w.write(BRIEF)
    await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    await w.clock.advance(MIN)
    expect(w.commits).toEqual([BRIEF])
    expect(w.pushes).toEqual([])
  })

  test('a handoffs repo with no upstream is committed but never pushed', async ($, on) => {
    const w = world(on, { upstream: false })
    await start($)
    w.write(BRIEF)
    await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    await w.clock.advance(MIN)
    expect(w.commits).toEqual([BRIEF])
    expect(w.pushes).toEqual([])
  })

  test('files that are not briefs are left alone', async ($, on) => {
    const w = world(on)
    await start($)
    w.write(`${ROOT}/README.md`)
    w.write('/code/notes.md')
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/README.md`, content: 'x' })
    await $.tool.call({ tool: 'Edit', file_path: '/code/notes.md', old_string: 'a', new_string: 'b' })
    expect(w.commits).toEqual([])
  })

  test('a second live session on the same brief is warned once', async ($, on) => {
    const w = world(on, { store: { 'session:other': { brief: BRIEF, at: Date.now() - MIN } } })
    await start($)
    w.write(BRIEF)
    const first = await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    expect(first.context?.join('')).toMatch(/another session on this machine \(other\)/)
    w.write(BRIEF)
    const second = await $.tool.call({ tool: 'Edit', file_path: BRIEF, old_string: 'a', new_string: 'b' })
    expect(second.context).toBeUndefined()
  })
})

describe('reminders', () => {
  test('a git commit reminds only once the session is live', async ($, on) => {
    const w = world(on)
    await start($)
    const before = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
    expect(before.context).toBeUndefined()
    w.write(BRIEF)
    await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    const after = await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m x' })
    expect(after.context?.join('')).toMatch(/you just committed/)
    for (const command of ['git status', 'git log --grep commit', `git -C ${ROOT} commit -m brief`]) {
      const other = await $.tool.call({ tool: 'Bash', command })
      expect(other.context).toBeUndefined()
    }
  })

  test('a stale brief is nudged once per stale stretch, and only if the repo moved', async ($, on) => {
    const w = world(on)
    await start($)
    w.write(BRIEF)
    await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    w.write(BRIEF, 30)
    await $.turn.complete(turnDone)
    expect(w.submits).toEqual([])
    w.changeInCode('src/a.ts')
    await $.turn.complete(turnDone)
    await $.turn.complete(turnDone)
    expect(w.submits.length).toBe(1)
    expect(w.submits[0]).toMatch(/was last updated 30 min ago/)
  })

  test('idle before the cache expires asks once; a new turn cancels it', async ($, on) => {
    const w = world(on)
    await start($)
    w.write(BRIEF, 5)
    await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    w.files.set(BRIEF, { mtime: Date.now() - 5 * MIN, text: '' })
    w.commitInCode()
    await $.turn.complete(turnDone)
    await w.clock.advance(30 * MIN)
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await w.clock.advance(30 * MIN)
    expect(w.submits).toEqual([])
    await $.turn.complete(turnDone)
    await w.clock.advance(50 * MIN)
    expect(w.submits.length).toBe(1)
    expect(w.submits[0]).toMatch(/idle 50 min/)
    // The model answered without editing the brief: no second ask until it changes.
    await $.turn.complete(turnDone)
    await w.clock.advance(50 * MIN)
    expect(w.submits.length).toBe(1)
  })

  test('context fill asks at the threshold and every 15 points after', async ($, on) => {
    const w = world(on)
    await start($)
    w.write(BRIEF, 10)
    await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    w.files.set(BRIEF, { mtime: Date.now() - 10 * MIN, text: '' })
    const measure = (percent: number) =>
      $.session.measure({ context: { window: 1000, tokens: percent * 10, percent }, rateLimits: [], changed: ['context'] })
    await measure(50)
    await measure(62)
    await measure(70)
    await measure(78)
    expect(w.submits.map(s => s.match(/(\d+)% full/)?.[1])).toEqual(['62', '78'])
  })
})

describe('compaction', () => {
  test('tells the summarizer and hands the brief back', async ($, on) => {
    const w = world(on)
    await start($)
    w.write(BRIEF)
    await $.tool.call({ tool: 'Write', file_path: BRIEF, content: 'x' })
    const done = await $.session.compact({ trigger: 'auto', messages: [SUMMARY] })
    expect(w.compacts.at(-1)).toMatch(/live handoff brief at/)
    expect(done.messages?.length).toBe(2)
    expect(done.messages?.at(-1)?.text).toContain(`# ${BRIEF}`)
  })
})
