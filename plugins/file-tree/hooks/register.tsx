import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileState, Touch } from '../types'

const PANE = 'file-tree'
const root = atom({ plugin: 'file-tree', key: 'root' } as const, '')
const touched = atom({ plugin: 'file-tree', key: 'touched' } as const, {})
const expanded = atom({ plugin: 'file-tree', key: 'expanded' } as const, {})
const touchedOnly = atom({ plugin: 'file-tree', key: 'touchedOnly' } as const, false)

// ---------- pure helpers (tested in tree.test.ts) ----------

/** Absolute, '/'-separated, `.`/`..` resolved; a relative path is taken from `base`. */
export const norm = (p: string, base: string) => {
  let s = p.replace(/\\/g, '/')
  if (!/^([A-Za-z]:\/|\/)/.test(s)) s = `${base.replace(/\\/g, '/').replace(/\/$/, '')}/${s}`
  const parts: string[] = []
  for (const seg of s.split('/')) {
    if (seg === '.' || (seg === '' && parts.length > 0)) continue
    if (seg === '..') {
      if (parts.length > 1) parts.pop()
      continue
    }
    parts.push(seg)
  }
  const out = parts.join('/')
  return /^[a-z]:/.test(out) ? out[0]!.toUpperCase() + out.slice(1) : out
}

/** The record key: Windows paths compare without case. */
export const keyOf = (absPath: string) => (/^[A-Za-z]:/.test(absPath) ? absPath.toLowerCase() : absPath)

export type Op = 'read' | 'edit' | 'create'

/** A file's state after an operation: reads never downgrade, edits to a new file keep it new. */
export const nextState = (prev: FileState | undefined, op: Op): FileState => {
  if (op === 'read') return prev ?? 'read'
  if (op === 'create') return 'created'
  return prev === 'created' ? 'created' : 'modified'
}

/** Keys of the paths `git status --porcelain -z` reports dirty, resolved from the repo top. */
export const parsePorcelain = (stdout: string, top: string) => {
  const dirty = new Set<string>()
  const parts = stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    dirty.add(keyOf(norm(entry.slice(3), top)))
    if (xy.includes('R') || xy.includes('C')) i++ // a rename's source path follows
  }
  return dirty
}

/** The folder holding a normalized path. */
export const parentOf = (absPath: string) => {
  const cut = absPath.lastIndexOf('/')
  return cut <= 0 ? '/' : /^[A-Za-z]:$/.test(absPath.slice(0, cut)) ? `${absPath.slice(0, cut)}/` : absPath.slice(0, cut)
}

export const isCommitCommand = (cmd: string) => /(^|[;&|]\s*|\s)git(\s+-\S+(\s+\S+)?)*\s+commit\b/.test(cmd)

// ---------- look ----------

const LOOK: Record<FileState, { glyph: string; color: string; label: string }> = {
  read: { glyph: '◦', color: '#6cb6ff', label: 'read' },
  modified: { glyph: '●', color: '#e8743b', label: 'modified' },
  created: { glyph: '+', color: '#d2a8ff', label: 'new' },
  committed: { glyph: '✓', color: '#3fb950', label: 'committed' },
}

// heavy folders are listed dimmed; like every folder they only open by themselves when they lead to a touched file
const HEAVY = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target', '.cache', '.turbo'])
const PER_DIR = 80
const MAX_ROWS = 400
const RECENT_MS = 1800
const INDENT = '  '

// ---------- project root ----------

/** The session's working directory, looked up once and kept (session.start may not have run, e.g. after a reload). */
async function rootOf($: EngineInterface): Promise<string> {
  const known = await read($, root)
  if (known) return known
  const cwd = norm(await $.session.cwd(), '/')
  await update($, root, () => cwd)
  return cwd
}

// ---------- git ----------

/**
 * Turns modified/new files that git no longer reports dirty into committed, in
 * every repository that holds one (the session's project and anything "elsewhere").
 */
async function refreshCommitted($: EngineInterface) {
  const all = await read($, touched)
  const pending = Object.entries(all).filter(([, t]) => t.state === 'modified' || t.state === 'created')
  if (pending.length === 0) return

  // the repository of each folder holding a pending file, looked up once per folder
  const topOfDir = new Map<string, string | null>()
  for (const [, t] of pending) {
    const dir = parentOf(t.path)
    if (topOfDir.has(dir)) continue
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir, timeoutMs: 5000 }).catch(() => null)
    topOfDir.set(dir, top && top.exitCode === 0 ? norm(top.stdout.trim(), dir) : null)
  }

  // one git status per repository
  const clean = new Set<string>()
  for (const top of new Set([...topOfDir.values()].filter((t): t is string => !!t))) {
    const status = await $.process
      .run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: top, timeoutMs: 10_000 })
      .catch(() => null)
    if (!status || status.exitCode !== 0) continue
    const dirty = parsePorcelain(status.stdout, top)
    const topKey = keyOf(top)
    for (const [k] of pending) if (k.startsWith(`${topKey}/`) && !dirty.has(k)) clean.add(k)
  }
  if (clean.size === 0) return

  await update($, touched, cur => {
    const next = { ...cur }
    for (const k of clean) {
      const t = next[k]
      // only still-pending files: one touched again meanwhile keeps its new state
      if (t && (t.state === 'modified' || t.state === 'created')) next[k] = { ...t, state: 'committed' }
    }
    return next
  })
}

/** Records an operation on a file. */
async function mark($: EngineInterface, path: string, op: Op) {
  const cwd = await rootOf($)
  const abs = norm(path, cwd)
  const key = keyOf(abs)
  const now = await $.clock.now()
  await update($, touched, all => {
    const prev = all[key]
    return { ...all, [key]: { state: nextState(prev?.state, op), at: now, ops: (prev?.ops ?? 0) + 1, path: abs } }
  })
}

// ---------- hooks ----------

export const register: Register = on => {
  let hasOpened = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tree', description: 'Open the File Tree pane' })
    await $.command.register({ name: 'tree-clear', description: 'Forget which files Claude touched this session' })
    await rootOf($)
    return next(e)
  })

  on('command.run', { command: 'tree' }, async $ => {
    hasOpened = true
    await refreshCommitted($)
    await $.ui.open({ id: PANE, title: 'Files' })
    return { text: 'File Tree opened.' }
  })

  on('command.run', { command: 'tree-clear' }, async $ => {
    await update($, touched, () => ({}))
    return { text: 'File Tree cleared.' }
  })

  // commits made outside Claude (a terminal) show up on the next prompt
  on('prompt.submit', async ($, e, next) => {
    void refreshCommitted($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as { file_path?: string; notebook_path?: string; command?: string }
    const path = input.file_path ?? input.notebook_path
    const tool = e.tool as string
    const cwd = await rootOf($)
    // a Write to a path that did not exist creates the file
    const existed = tool === 'Write' && path ? await $.fs.exists(norm(path, cwd)).catch(() => true) : true

    const ran = await next(e)
    if (('deny' in ran && !!ran.deny) || (ran as { isError?: boolean }).isError) return ran

    let op: Op | null = null
    if (path && tool === 'Read') op = 'read'
    else if (path && tool === 'Write') op = existed ? 'edit' : 'create'
    else if (path && (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit')) op = 'edit'
    if (path && op) await mark($, path, op)
    if (op && op !== 'read' && !hasOpened) {
      hasOpened = true
      void $.ui.open({ id: PANE, title: 'Files' })
    }
    if (tool === 'Bash' && input.command && isCommitCommand(input.command)) await refreshCommitted($)
    return ran
  })

  // ---------- pane ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // drawing is pure: read the root, never store it from here
    const cwd = (await read($, root)) || norm(await $.session.cwd(), '/')
    const all = await read($, touched)
    const open = await read($, expanded)
    const onlyTouched = await read($, touchedOnly)
    const now = await $.clock.now()
    const hasClient = e.surface === 'terminal' || e.surface === 'desktop'

    const keys = Object.keys(all)
    const leadsToTouched = (dirKey: string) => keys.some(k => k.startsWith(`${dirKey}/`))
    const isOpen = (dirKey: string) => open[dirKey] ?? leadsToTouched(dirKey)
    const toggle = (dirKey: string, now: boolean) => () => update($, expanded, m => ({ ...m, [dirKey]: !now }))

    const name = (label: string, key: string, t: Touch | undefined) => {
      if (!t) return <Text dimColor>{label}</Text>
      const color = LOOK[t.state].color
      if (hasClient && now - t.at < RECENT_MS && (e.surface === 'terminal' || e.surface === 'desktop')) {
        const { Client } = $.ui.resolve(e)
        return <Client key={`s:${key}`} module="./shimmer.tsx" props={{ text: label, color, pulse: t.ops, age: Math.max(0, now - t.at) }} />
      }
      return <Text color={color}>{label}</Text>
    }

    const rows: unknown[] = []
    let isCut = false

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 12) return
      const entries = await $.fs.list(dir).catch(() => [])
      const items = entries
        .filter(en => en.kind !== 'other' || en.isLink)
        .map(en => {
          const abs = `${dir}/${en.name}`
          return { name: en.name, abs, key: keyOf(abs), isDir: en.kind === 'dir' }
        })
        .filter(it => {
          const hot = it.isDir ? leadsToTouched(it.key) : !!all[it.key]
          return onlyTouched ? hot : true
        })
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))

      const shown = items.filter((it, i) => i < PER_DIR || (it.isDir ? leadsToTouched(it.key) : !!all[it.key]))
      const pad = INDENT.repeat(depth)
      for (const it of shown) {
        if (rows.length >= MAX_ROWS) {
          isCut = true
          return
        }
        if (it.isDir) {
          const isDirOpen = isOpen(it.key)
          const count = keys.filter(k => k.startsWith(`${it.key}/`)).length
          rows.push(
            <Box key={`d:${it.key}`} flexDirection="row">
              <Text>{pad}</Text>
              <Button
                key={`b:${it.key}`}
                plain
                dimColor={HEAVY.has(it.name)}
                label={`${isDirOpen ? '▾' : '▸'} ${it.name}`}
                onPress={toggle(it.key, isDirOpen)}
              />
              {count > 0 && <Text color="#e8743b"> {count}</Text>}
            </Box>,
          )
          if (isDirOpen) await walk(it.abs, depth + 1)
        } else {
          const t = all[it.key]
          rows.push(
            <Box key={`f:${it.key}`} flexDirection="row">
              <Text>{pad}</Text>
              <Text color={t ? LOOK[t.state].color : 'subtle'}>{t ? LOOK[t.state].glyph : ' '} </Text>
              {name(it.name, it.key, t)}
            </Box>,
          )
        }
      }
      const hidden = items.length - shown.length
      if (hidden > 0) rows.push(<Text key={`m:${dir}`} dimColor>{`${pad}… ${hidden} more`}</Text>)
    }

    if (cwd) await walk(cwd, 0)

    const rootKey = keyOf(cwd)
    const elsewhere = Object.entries(all).filter(([k]) => !k.startsWith(`${rootKey}/`))
    const counts = (['modified', 'created', 'committed', 'read'] as const).map(s => [s, Object.values(all).filter(t => t.state === s).length] as const)
    const summary = counts.filter(([, n]) => n > 0).map(([s, n]) => `${n} ${LOOK[s].label}`).join(' · ')
    const projectName = cwd.split('/').pop() || cwd

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold wrap="truncate-end">
            {projectName}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="only" plain label={onlyTouched ? 'All files' : 'Touched only'} onPress={() => update($, touchedOnly, v => !v)} />
            <Button key="clear" plain label="Clear" onPress={() => update($, touched, () => ({}))} />
          </Box>
        </Box>
        <Text dimColor wrap="truncate-end">
          {summary || 'Nothing touched yet'}
        </Text>
        <Box flexDirection="row" gap={1} marginBottom={1}>
          {(Object.keys(LOOK) as FileState[]).map(s => (
            <Text key={`l:${s}`} color={LOOK[s].color}>
              {LOOK[s].glyph} {LOOK[s].label}
            </Text>
          ))}
        </Box>
        {rows as never}
        {isCut && <Text dimColor>… tree cut at {MAX_ROWS} rows; use Touched only</Text>}
        {elsewhere.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Elsewhere · {elsewhere.length}</Text>
            {elsewhere
              .sort(([, a], [, b]) => b.at - a.at)
              .map(([k, t]) => (
                <Box key={`e:${k}`} flexDirection="row">
                  <Text color={LOOK[t.state].color}>{LOOK[t.state].glyph} </Text>
                  {name(t.path, k, t)}
                </Box>
              ))}
          </Box>
        )}
      </Box>
    )
  })
}
