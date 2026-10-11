// handoff live mode: keeps the /handoff brief current while the session works.
//
// Inert until this session writes a brief (~/.claude/handoffs/<repo>/<slug>.md)
// with Write or Edit; from then on it
//   - commits each edit to the handoffs repo locally, and pushes a minute after
//     the last one, so the handoffs working tree stays clean for every session;
//   - reminds after a `git commit` in the code repo;
//   - asks for an update when a turn ends with the brief stale and the repo moved,
//     when the context passes a threshold, and when the session sits idle long
//     enough that the prompt cache is about to expire;
//   - tells the summarizer about the brief and hands the brief back after compaction;
//   - warns when another session on this machine is live on the same brief.
// Per-session state lives in $.store, which every session on the machine shares.
import type { Register } from 'claude-code'

// The host calls the helpers need. `$` may only be spelled at a call site, so
// session.start builds these closures over its own `$` (which, like the timers
// started from it, lives as long as the session) and the helpers take them.
type Io = {
  run: (argv: string[], cwd: string, timeoutMs?: number) => Promise<{ exitCode: number; stdout: string }>
  stat: (path: string, resolve?: boolean) => Promise<{ mtimeMs: number; realPath?: string } | undefined>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  home: () => Promise<string | undefined>
  rootOverride: () => Promise<string | undefined>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  del: (key: string) => Promise<void>
  keys: () => Promise<string[]>
  sid: () => Promise<string>
  cwd: () => Promise<string>
  sleep: (ms: number) => Promise<void>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  status: (text: string | undefined) => void
  toast: (text: string) => void
  ask: (text: string) => void
}
type Live = { brief: string; at: number; nudgedMtime?: number; idledMtime?: number; ctxFired?: number; warned?: string[] }

const KEY = 'session:'
const CONCURRENT_MS = 6 * 3600_000 // another session's binding counts as live this long after its last turn
const EXPIRE_MS = 7 * 86400_000 // bindings of sessions that never ended cleanly
const SYNC_DELAY_MS = 60_000
const SYNC_LOCK = 'sync-lock' // one sync at a time across this machine's sessions
const SYNC_LOCK_MS = 3 * 60_000
const CTX_STEP = 15
const BRIEF_MAX_LINES = 150

export const register: Register = (on, options) => {
  const staleMs = Number(options.staleMinutes ?? 20) * 60_000
  const ctxAt = Number(options.contextPercent ?? 60)
  const idleMs = Number(options.idleMinutes ?? 50) * 60_000

  let io: Io | undefined
  let idleTimer: { cancel: () => void } | undefined
  let syncTimer: { cancel: () => void } | undefined
  let rootCache: string | undefined

  // The handoffs root, symlinks resolved.
  const root = async (io: Io) => {
    if (rootCache) return rootCache
    const path = ((await io.rootOverride()) ?? `${await io.home()}/.claude/handoffs`).replace(/\/$/, '')
    const real = (await io.stat(path, true))?.realPath
    if (real) rootCache = real
    return real ?? path
  }
  const git = (io: Io, cwd: string, args: string[], timeoutMs = 15_000) =>
    io.run(['git', ...args], cwd, timeoutMs).catch(() => ({ exitCode: 1, stdout: '' }))
  const dir = (p: string) => p.slice(0, p.lastIndexOf('/'))
  const mtime = async (io: Io, p: string) => (await io.stat(p))?.mtimeMs

  const load = async (io: Io, sid?: string): Promise<Live | undefined> =>
    (await io.get(KEY + (sid ?? (await io.sid())))) as Live | undefined
  const save = async (io: Io, live: Live) => io.set(KEY + (await io.sid()), live)
  // Read-modify-write, so hooks that interleave don't drop each other's fields.
  const patch = async (io: Io, fields: Partial<Live>) => {
    const live = await load(io)
    if (live) await save(io, { ...live, ...fields })
  }

  // The brief this session is live on, if it still exists.
  const current = async (io: Io) => {
    const live = await load(io)
    const m = live && (await mtime(io, live.brief))
    return live && m !== undefined ? { live, mtime: m } : undefined
  }

  // Only <root>/<repo>/<slug>.md counts as a brief.
  const briefPath = async (io: Io, path: string) => {
    const real = (await io.stat(path, true))?.realPath
    const r = await root(io)
    if (!real || !real.startsWith(r + '/') || !real.endsWith('.md')) return undefined
    return real.slice(r.length + 1).split('/').length === 2 ? real : undefined
  }

  const commitBrief = async (io: Io, brief: string, why: string, attempts = 3) => {
    const cwd = dir(brief)
    if (!(await git(io, cwd, ['status', '--porcelain', '--', brief])).stdout.trim()) return true
    const name = brief.slice((await root(io)).length + 1).replace(/\.md$/, '')
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await git(io, cwd, ['add', '--', brief])
      if ((await git(io, cwd, ['commit', '-q', '-m', `handoff: ${name} (${why})`, '--', brief])).exitCode === 0) return true
      if (attempt < attempts) await io.sleep(300 * attempt) // another session may hold index.lock
    }
    return false
  }

  // Pull and push the handoffs repo, pushing every unpushed brief commit. Never
  // stashes, so a conflict aborts cleanly; one sync at a time on this machine.
  const sync = async (io: Io, brief: string) => {
    const cwd = dir(brief)
    const sid = await io.sid()
    const lock = (await io.get(SYNC_LOCK)) as { sid: string; at: number } | undefined
    if (lock && lock.sid !== sid && Date.now() - lock.at < SYNC_LOCK_MS) return
    await io.set(SYNC_LOCK, { sid, at: Date.now() })
    try {
      const gitDir = (await git(io, cwd, ['rev-parse', '--absolute-git-dir'])).stdout.trim()
      const isRebasing = async () =>
        (await io.exists(`${gitDir}/rebase-merge`)) || (await io.exists(`${gitDir}/rebase-apply`))
      if (!gitDir) return
      if (await isRebasing()) return io.toast(`handoff: ${cwd} is mid-rebase; briefs are committed locally, not pushed`)
      if ((await git(io, cwd, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim())
        return io.toast(`handoff: ${cwd} has uncommitted changes; briefs are committed locally, not pushed`)
      const ahead = await git(io, cwd, ['rev-list', '--count', '@{u}..HEAD'])
      if (ahead.exitCode !== 0 || ahead.stdout.trim() === '0') return // no upstream, or nothing to push
      if ((await git(io, cwd, ['pull', '--rebase', '--no-autostash'], 60_000)).exitCode !== 0) {
        if (await isRebasing()) await git(io, cwd, ['rebase', '--abort']) // ours: we hold the lock
        return io.toast(`handoff: pull failed in ${cwd}; the brief is committed locally, push it by hand`)
      }
      if ((await git(io, cwd, ['push'], 60_000)).exitCode !== 0)
        io.toast(`handoff: push failed in ${cwd}; the brief is committed locally, push it by hand`)
    } finally {
      if (((await io.get(SYNC_LOCK)) as { sid?: string } | undefined)?.sid === sid) await io.del(SYNC_LOCK)
    }
  }

  const showStatus = async (io: Io) => {
    const cur = await current(io)
    if (!cur) return io.status(undefined)
    const slug = cur.live.brief.split('/').pop()!.replace(/\.md$/, '')
    io.status(`handoff: ${slug} · ${Math.round((Date.now() - cur.mtime) / 60_000)}m old`)
  }

  // Has the code repo moved (a commit, or a changed file) since `since`?
  const repoMoved = async (io: Io, since: number) => {
    const cwd = await io.cwd()
    const head = (await git(io, cwd, ['log', '-1', '--format=%ct'])).stdout.trim()
    if (head && Number(head) * 1000 > since) return true
    const top = (await git(io, cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
    if (!top) return false
    const out = (await git(io, cwd, ['status', '--porcelain', '-z', '-uall'])).stdout.split('\0')
    for (let i = 0, seen = 0; i < out.length && seen < 200; i++, seen++) {
      const entry = out[i] ?? ''
      if (entry.length < 4) continue
      if ('RC'.includes(entry[0] ?? '')) i++ // skip the rename source
      if (((await mtime(io, `${top}/${entry.slice(3)}`)) ?? 0) > since) return true
    }
    return false
  }

  
  const ask = (text: string) => io?.ask(`Live handoff: ${text}`)

  on('session.start', async ($, e, next) => {
    io = {
      run: async (argv, cwd, timeoutMs) => $.process.run(argv, { cwd, timeoutMs }),
      stat: async (path, resolve) => $.fs.stat(path, resolve ? { resolve: true } : undefined).catch(() => undefined),
      exists: async path => $.fs.exists(path),
      read: async path => $.fs.read(path),
      home: async () => $.env.get('HOME'),
      rootOverride: async () => $.env.get('HANDOFF_ROOT'),
      get: async key => $.store.get(key),
      set: async (key, value) => $.store.set(key, value),
      del: async key => $.store.delete(key),
      keys: async () => $.store.keys(),
      sid: async () => $.session.id(),
      cwd: async () => $.session.cwd(),
      sleep: async ms => $.clock.sleep(ms),
      after: (ms, fn) => $.clock.after(ms, fn),
      status: text => $.ui.status(text),
      toast: text => $.ui.toast(text),
      ask: text => void $.prompt.submit({ text }).catch(() => undefined),
    }
    await showStatus(io)
    return next(e)
  })

  // Bind: this session wrote a brief.
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (!io || ran.deny !== undefined || ran.isError || e.agentId) return ran
    const brief = 'file_path' in e ? await briefPath(io, e.file_path) : undefined
    if (!brief) return ran

    const sid = await io.sid()
    const prev = await load(io, sid)
    const live: Live = prev?.brief === brief ? { ...prev, at: Date.now() } : { brief, at: Date.now() }
    const notes: string[] = []

    const others: string[] = []
    for (const key of await io.keys()) {
      if (!key.startsWith(KEY) || key === KEY + sid) continue
      const other = (await io.get(key)) as Live | undefined
      const age = Date.now() - (other?.at ?? 0)
      if (age > EXPIRE_MS) await io.del(key)
      else if (other?.brief === brief && age < CONCURRENT_MS && !live.warned?.includes(key)) others.push(key)
    }
    if (others.length) {
      live.warned = [...(live.warned ?? []), ...others]
      notes.push(`another session on this machine (${others.map(k => k.slice(KEY.length)).join(', ')}) was live on ${brief} ` +
        `in the last 6 hours, possibly one that has since crashed. Two live sessions on one brief overwrite each other. ` +
        `Ask the user; if both are running, continue in \`<slug>-2.md\`, created with Write.`)
    }
    await save(io, live)

    if (!(await commitBrief(io, brief, 'live'))) notes.push(`could not commit ${brief} in the handoffs repo; check \`git status\` there.`)
    syncTimer?.cancel()
    const sio = io
    syncTimer = sio.after(SYNC_DELAY_MS, () => void sync(sio, brief))
    await showStatus(io)
    return notes.length ? { ...ran, context: [...(ran.context ?? []), ...notes.map(n => `Live handoff: ${n}`)] } : ran
  }).catch(($, e, next) => next(e))

  // Reminder after a commit in the code repo.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!io || ran.deny !== undefined || ran.isError || e.agentId) return ran
    if (!/(^|[;&|(]\s*)git\s+(-C\s+\S+\s+)?commit(\s|$)/.test(e.command) || e.command.includes(await root(io))) return ran
    const cur = await current(io)
    if (!cur) return ran
    const note = `Live handoff: you just committed. If this changes State, Verification or Next steps in ${cur.live.brief}, ` +
      `update those lines now with a small Edit (and the Updated line).`
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    idleTimer?.cancel()
    return next(e)
  })

  // Stale nudge, and the idle timer for the next quiet stretch.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!io || e.agentId) return done
    const cur = await current(io)
    if (!cur) return done
    await patch(io, { at: Date.now() })
    await showStatus(io)

    const isStale = Date.now() - cur.mtime > staleMs && cur.live.nudgedMtime !== cur.mtime
    if (e.reason === 'answer' && isStale && (await repoMoved(io, cur.mtime))) {
      await patch(io, { nudgedMtime: cur.mtime })
      ask(`${cur.live.brief} was last updated ${Math.round((Date.now() - cur.mtime) / 60_000)} min ago and the repo has ` +
        `moved since. Bring State, Dead ends, Verification and Next steps up to date with small Edits, then stop. ` +
        `If nothing in it is out of date, say so in one line and stop.`)
    }

    if (idleMs > 0) {
      idleTimer?.cancel()
      const lastTurn = Date.now()
      const tio = io
      idleTimer = tio.after(idleMs, async () => {
        const now = await current(tio)
        // Once per stale stretch, like the nudge: wait for the brief to change before asking again.
        if (!now || now.mtime > lastTurn || now.live.idledMtime === now.mtime || !(await repoMoved(tio, now.mtime))) return
        await patch(tio, { idledMtime: now.mtime })
        ask(`the session has been idle ${Math.round(idleMs / 60_000)} min and its prompt cache expires soon. ` +
          `Bring ${now.live.brief} fully up to date now, while that is still cheap: State, Dead ends, Verification, ` +
          `Next steps. Then stop.`)
      })
    }
    return done
  })

  // Context threshold, then every CTX_STEP points; re-armed once compaction drops the fill.
  on('session.measure', async ($, e, next) => {
    const done = await next(e)
    const pct = e.context.percent
    if (!io || pct === undefined || !e.changed.includes('context')) return done
    const cur = await current(io)
    if (!cur) return done
    const fired = cur.live.ctxFired ?? 0
    if (pct < fired - CTX_STEP) await patch(io, { ctxFired: 0 })
    else if (pct >= ctxAt && pct >= fired + CTX_STEP && Date.now() - cur.mtime > 5 * 60_000) {
      await patch(io, { ctxFired: pct })
      ask(`the context window is ${pct}% full. Bring ${cur.live.brief} up to date now, while the context is cached: ` +
        `State, Dead ends, Verification, Next steps. Then carry on with the work.`)
    }
    return done
  })

  // Through compaction: tell the summarizer, then hand the brief back.
  on('session.compact', async ($, e, next) => {
    const cur = io && !e.agentId ? await current(io) : undefined
    if (!io || !cur) return next(e)
    const stress = `A live handoff brief at ${cur.live.brief} records this session's goal, state, decisions, dead ends ` +
      `and next steps, and is handed back after compaction. Keep what it does not yet say, above all approaches tried and abandoned.`
    const done = await next({ ...e, instructions: e.instructions ? `${e.instructions}\n\n${stress}` : stress })
    if (done.skip !== undefined || e.trigger === 'precompute') return done
    const lines = (await io.read(cur.live.brief)).split('\n')
    const body = lines.slice(0, BRIEF_MAX_LINES).join('\n') + (lines.length > BRIEF_MAX_LINES ? '\n[…truncated]' : '')
    const text = `Live handoff is on for this session. The brief at ${cur.live.brief} is below; where it and the compaction ` +
      `summary disagree, trust the brief, and keep it updated as you work.\n\n${body}`
    // Into what the transcript becomes, so it survives the compaction it follows.
    return { ...done, messages: [...done.messages, { role: 'user', text, toolUses: [] }] }
  }).catch(($, e, next) => next(e))

  // The end budget (about 1.5 s) fits a local commit, not a pull and push: unpushed
  // commits go out with the next sync from any session, or with /handoff.
  on('session.end', async ($, e, next) => {
    idleTimer?.cancel()
    syncTimer?.cancel()
    if (!io) return next(e)
    const live = await load(io, e.sessionId)
    await io.del(KEY + e.sessionId)
    if (live) await commitBrief(io, live.brief, 'session end', 1)
    return next(e)
  })
}
