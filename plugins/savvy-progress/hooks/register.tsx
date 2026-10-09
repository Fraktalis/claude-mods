import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, StateDollar } from 'claude-code'

import type { AgentRow, AgentStatus, Batch, Report, Task, TaskStatus } from '../types'

const PANE = 'savvy-agents'
const PROGRESS_TOOL = 'mcp__savvy-progress__progress'

const tasks = atom({ plugin: 'savvy-progress', key: 'tasks' } as const, {})
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, {})
const skins = atom({ plugin: 'savvy-progress', key: 'skins' } as const, {})
const batch = atom({ plugin: 'savvy-progress', key: 'batch' } as const, null)
const mainReport = atom({ plugin: 'savvy-progress', key: 'mainReport' } as const, null)
const finishedCollapsed = atom({ plugin: 'savvy-progress', key: 'finishedCollapsed' } as const, false)
const lastPrompt = atom({ plugin: 'savvy-progress', key: 'lastPrompt' } as const, '')

// ---------- pure helpers (tested in savvy.test.ts) ----------

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** $ per million tokens: input, output, cache read. Cache writes bill at 1.25x input. */
export type Price = { input: number; output: number; cacheRead: number }

// ponytail: first-party list prices (claude-api skill table, 2026-10-06); edit here when prices change
const PRICES: [RegExp, Price][] = [
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet/, { input: 3, output: 15, cacheRead: 0.3 }],
  [/haiku-5/, { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  [/haiku/, { input: 1, output: 5, cacheRead: 0.1 }],
]

export const priceOf = (model: string): Price => PRICES.find(([re]) => re.test(model))?.[1] ?? PRICES[1]![1]

/** What one request cost, in dollars, at the answering model's list price. */
export const costUsd = (u: Usage, model: string) => {
  const p = priceOf(model)
  return (
    (u.input_tokens * p.input +
      u.cache_creation_input_tokens * p.input * 1.25 +
      u.cache_read_input_tokens * p.cacheRead +
      u.output_tokens * p.output) /
    1_000_000
  )
}

/** Tokens the request added: new input, cache writes and output; cache re-reads are not new. */
export const newTokens = (u: Usage) => u.input_tokens + u.cache_creation_input_tokens + u.output_tokens

export const promptTokens = (u: Usage) => u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

export const tally = (list: Task[]) => ({
  done: list.filter(t => t.status === 'completed').length,
  total: list.length,
  active: list.find(t => t.status === 'in_progress')?.subject,
})

export const bar = (done: number, total: number, width = 20) => {
  const n = total ? Math.round((done / total) * width) : 0
  return '█'.repeat(n) + '░'.repeat(width - n)
}

export const shortModel = (m: string) =>
  (m || '?')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/^(\w+)-(\d+)-(\d+)$/, (_, n: string, a: string, b: string) => `${n[0]!.toUpperCase()}${n.slice(1)} ${a}.${b}`)

export const money = (usd: number) => (usd < 0.01 ? '≈<$0.01' : `≈$${usd.toFixed(2)}`)
export const kTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Where an agent stands, 0..1, or null when nothing measurable was reported. */
export const fraction = (a: Pick<AgentRow, 'status' | 'report'>, own?: { done: number; total: number }) => {
  if (a.status === 'done' || a.status === 'failed') return 1
  if (a.report && a.report.total > 0) return Math.min(1, a.report.done / a.report.total)
  if (own && own.total > 0) return own.done / own.total
  return null
}

export const titleOf = (prompt: string) => {
  const first = prompt.replace(/^\/\S+\s*/, '').split(/[.:\n!?]/)[0]?.trim() ?? ''
  if (!first) return 'Agents'
  return first.length > 28 ? `${first.slice(0, 27)}…` : first
}

// ---------- pixel crabs ----------
// 10x8 grid: two hat rows + six body rows. b body, e eye, h hat.

export type Skin = { body: number; eye: number; hat?: number; hatRows?: [string, string]; role: string; color: string }

export const SKINS = {
  crab: { body: 0xd97757, eye: 0x1a1a1a, role: 'crab', color: '#d97757' },
  developer: { body: 0xd97757, eye: 0x1a1a1a, hat: 0x3fb950, hatRows: ['...hhhh...', '..hhhhhhhh'], role: 'builder', color: '#3fb950' },
  designer: { body: 0xd97757, eye: 0x1a1a1a, hat: 0xf2f2f2, hatRows: ['..hhhhhh..', '...hhhh...'], role: 'designer', color: '#4c9aff' },
  researcher: { body: 0xd97757, eye: 0x1a1a1a, hat: 0xb07d48, hatRows: ['...hhhh...', '.hhhhhhhh.'], role: 'scout', color: '#e3a33b' },
  architect: { body: 0xd97757, eye: 0x1a1a1a, hat: 0xf2c94c, hatRows: ['..hhhhhh..', '.hhhhhhhh.'], role: 'planner', color: '#f2c94c' },
  ghost: { body: 0x8b949e, eye: 0x30363d, role: 'failed', color: '#f85149' },
} satisfies Record<string, Skin>

const skinOf = (name: string): Skin => (SKINS as Record<string, Skin>)[name] ?? SKINS.crab

// ponytail: default skin per built-in agent type; /savvy-skin overrides
const TYPE_SKIN: Record<string, string> = { Explore: 'researcher', Plan: 'architect', 'general-purpose': 'developer' }

const BODY = ['.bbbbbbbb.', '.bebbbbeb.', 'bbbbbbbbbb', '.bbbbbbbb.', '.bbbbbbbb.', '.b.b..b.b.']

export const pixels = (skin: Skin): (number | null)[][] =>
  [...(skin.hatRows ?? ['..........', '..........']), ...BODY].map(r =>
    [...r].map(c => (c === 'b' ? skin.body : c === 'e' ? skin.eye : c === 'h' ? skin.hat ?? null : null)),
  )

const DEFAULT = 0x01000000

export const rasterCells = (px: (number | null)[][]) => {
  const words: number[] = []
  for (let y = 0; y < px.length; y += 2) {
    const row = px[y] ?? []
    for (let x = 0; x < row.length; x++) {
      const top = row[x] ?? null
      const bottom = px[y + 1]?.[x] ?? null
      if (top === null && bottom === null) words.push(0x20, DEFAULT, DEFAULT)
      else if (top === null) words.push(0x2584, bottom ?? DEFAULT, DEFAULT)
      else words.push(0x2580, top, bottom ?? DEFAULT)
    }
  }
  // toBase64 is in the mod runtime, not in the es2023 lib typings
  return (new Uint8Array(Uint32Array.from(words).buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

export const svgCrab = (px: (number | null)[][], opts: { scale?: number; bob?: boolean; dim?: boolean } = {}) => {
  const s = opts.scale ?? 3
  const rects = px
    .flatMap((row, y) =>
      row.map((c, x) => (c === null ? '' : `<rect x="${x * s}" y="${y * s + s}" width="${s}" height="${s}" fill="${hex(c)}"/>`)),
    )
    .join('')
  const bob = opts.bob
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -${s};0 0" dur="0.7s" repeatCount="indefinite"/>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${10 * s}" height="${9 * s}" viewBox="0 0 ${10 * s} ${9 * s}" shape-rendering="crispEdges">` +
    `<g opacity="${opts.dim ? 0.45 : 1}">${rects}${bob}</g></svg>`
  )
}

// ---------- status glyphs (fallback where a surface has no Client) ----------

export const STATUS = {
  waiting: { glyph: '◌', color: 'subtle' },
  running: { glyph: '●', color: '#e8743b' },
  done: { glyph: '✓', color: 'success' },
  failed: { glyph: '✗', color: 'error' },
} satisfies Record<AgentStatus, { glyph: string; color: string }>

const BAR_COLOR: Record<AgentStatus, string | null> = { waiting: null, running: null, done: '#3fb950', failed: '#f85149' }

// ---------- state helpers ----------

function setTasks($: StateDollar, owner: string, fn: (t: Record<string, Task>) => Record<string, Task>) {
  return update($, tasks, all => ({ ...all, [owner]: fn(all[owner] ?? {}) }))
}

function patchAgent($: StateDollar, id: string, fn: (a: AgentRow) => Partial<AgentRow>) {
  return update($, agents, all => (all[id] ? { ...all, [id]: { ...all[id], ...fn(all[id]) } } : all))
}

const isLive = (a: AgentRow) => a.status === 'running' || a.status === 'waiting'

const NOTE =
  `\n\n[Progress reporting] If the tool ${PROGRESS_TOOL} is available, call it once at the start with ` +
  `total = the number of steps you plan and done = 0, then after each step with the new done count and ` +
  `a 2-4 word step label. One call per step, no more.`

/** Marks the batch ended (and toasts once) when none of its agents is live. */
async function closeBatchIfDone($: EngineInterface, now: number) {
  const all = await read($, agents)
  const b = await read($, batch)
  if (!b || b.endedAt !== undefined || !b.ids.every(id => !all[id] || !isLive(all[id]!))) return
  await update($, batch, cur => (cur ? { ...cur, endedAt: now } : cur))
  if (!b.hidden) $.ui.toast(`🦀 ${b.title}: ${b.ids.length} agent${b.ids.length > 1 ? 's' : ''} finished`)
}

// ---------- hooks ----------

export const register: Register = on => {
  // a subagent can finish before agent.spawn has written its row: keep the outcome until the row lands
  const early = new Map<string, { status: AgentStatus; endedAt: number }>()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'savvy', description: 'Open the Savvy Progress agents pane' })
    await $.command.register({
      name: 'savvy-skin',
      description: 'Set a crab skin for an agent type: /savvy-skin <type|*> <skin>',
      argumentHint: `<type|*> <${Object.keys(SKINS).join('|')}>`,
    })
    await $.tool.register({
      name: 'progress',
      description:
        'Report progress on your current multi-step job so the person sees a live progress bar. ' +
        'Call with total steps and done = 0 at the start, then after each step. Optional title names the whole job (main loop only).',
      inputSchema: {
        type: 'object',
        properties: {
          done: { type: 'integer', minimum: 0 },
          total: { type: 'integer', minimum: 1 },
          step: { type: 'string', description: '2-4 word label of the current step' },
          title: { type: 'string', description: 'Short name of the whole job' },
        },
        required: ['done', 'total'],
      },
      isDeferred: false,
    })
    const saved = (await $.store.get('skins')) as Record<string, string> | undefined
    if (saved) await update($, skins, () => saved)
    return next(e)
  })

  on('command.run', { command: 'savvy' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agents' })
    return { text: 'Savvy Progress pane opened.' }
  })

  on('command.run', { command: 'savvy-skin' }, async ($, e) => {
    const [type, skin] = e.args.trim().split(/\s+/)
    if (!type || !skin || !(SKINS as Record<string, Skin>)[skin]) {
      return { text: `Usage: /savvy-skin <type|*> <skin>. Skins: ${Object.keys(SKINS).join(', ')}` }
    }
    const map = { ...(await read($, skins)), [type]: skin }
    await update($, skins, () => map)
    await $.store.set('skins', map)
    return { text: `Agents of type ${type} now wear the ${skin} skin.` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.text.trim()) await update($, lastPrompt, () => e.text)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const owner = e.agentId ?? 'main'

    if ((e.tool as string) === PROGRESS_TOOL) {
      const input = e as unknown as { done?: number; total?: number; step?: string; title?: string }
      const report: Report = { done: Math.max(0, input.done ?? 0), total: Math.max(1, input.total ?? 1), step: input.step }
      if (e.agentId) {
        await patchAgent($, e.agentId, a => ({ report, tools: a.tools + 1 }))
      } else {
        await update($, mainReport, () => report)
        if (input.title) await update($, batch, b => (b ? { ...b, title: input.title! } : b))
      }
      return { result: 'Progress noted.' }
    }

    if (e.agentId) void patchAgent($, e.agentId, a => ({ tools: a.tools + 1 }))

    if (e.tool === 'TodoWrite') {
      await setTasks($, owner, () =>
        Object.fromEntries(e.todos.map((t, i) => [`todo${i}`, { subject: t.activeForm || t.content, status: t.status }])),
      )
      return next(e)
    }
    if (e.tool === 'TaskUpdate' && e.status) {
      const status = e.status
      await setTasks($, owner, list => {
        const { [e.taskId]: old, ...rest } = list
        if (status === 'deleted') return rest
        if (!old) return list
        return { ...list, [e.taskId]: { subject: e.activeForm ?? e.subject ?? old.subject, status: status as TaskStatus } }
      })
      return next(e)
    }
    if (e.tool === 'TaskCreate') {
      const subject = e.activeForm ?? e.subject
      const ran = await next(e)
      const id = (ran as { result?: { task?: { id?: string } } }).result?.task?.id
      if (id) await setTasks($, owner, list => ({ ...list, [id]: { subject, status: 'pending' } }))
      return ran
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e.workflow ? e : { ...e, prompt: e.prompt + NOTE })
    if (!ran.agentId) return ran
    const now = await $.clock.now()
    const row: AgentRow = {
      id: ran.agentId,
      description: e.description,
      type: e.subagentType,
      model: ran.model,
      status: 'waiting',
      steps: 0,
      tools: 0,
      usd: 0,
      tokens: 0,
      ctx: 0,
      startedAt: now,
    }
    const prompt = await read($, lastPrompt)
    // one atomic update: parallel spawns all land in the same batch (update retries on a version miss)
    let isFresh = false
    let nextBatch: Batch = { id: now, title: titleOf(prompt), startedAt: now, ids: [row.id], hidden: false }
    await update($, batch, cur => {
      isFresh = !cur || cur.endedAt !== undefined
      nextBatch = isFresh
        ? { id: now, title: titleOf(prompt), startedAt: now, ids: [row.id], hidden: false }
        : { id: cur!.id, title: cur!.title, startedAt: cur!.startedAt, ids: [...cur!.ids, row.id], hidden: false }
      return nextBatch
    })
    if (isFresh) await update($, mainReport, () => null)
    await update($, agents, list => {
      // ponytail: keep this batch's agents + the 6 most recent older finished ones
      const older = Object.values(list)
        .filter(a => !nextBatch.ids.includes(a.id) && !isLive(a))
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(6)
        .map(a => a.id)
      const kept = Object.fromEntries(Object.entries(list).filter(([id]) => !older.includes(id)))
      return { ...kept, [row.id]: row }
    })
    const done = early.get(row.id)
    if (done) {
      early.delete(row.id)
      await patchAgent($, row.id, () => done)
      await closeBatchIfDone($, done.endedAt)
    }
    void $.ui.open({ id: PANE, title: 'Agents' })
    return ran
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const effort = e.effort === undefined ? undefined : String(e.effort)
      const id = e.agentId
      // a step after an early finish means the agent was resumed: forget the stored outcome
      early.delete(id)
      let resumed = false
      // a step means the agent is working: waiting -> running, and a finished agent that is resumed goes back to Running
      await update($, agents, all => {
        const a = all[id]
        if (!a) return all
        if (a.status === 'running') return effort && effort !== a.effort ? { ...all, [id]: { ...a, effort } } : all
        resumed = a.status === 'done' || a.status === 'failed'
        const { endedAt: _ended, ...rest } = a
        const back: AgentRow = { ...rest, status: 'running', effort: effort ?? a.effort }
        return { ...all, [id]: back }
      })
      if (resumed) {
        await update($, batch, cur => {
          if (!cur || !cur.ids.includes(id) || cur.endedAt === undefined) return cur
          const { endedAt: _e, ...open } = cur
          return open
        })
      }
    }
    const r = yield* next(e)
    if (r.usage) {
      if (e.agentId) {
        const model = r.usage.model || e.model
        const usd = costUsd(r.usage, model)
        const t = newTokens(r.usage)
        const ctx = promptTokens(r.usage)
        await patchAgent($, e.agentId, a => ({ steps: a.steps + 1, usd: (a.usd ?? 0) + usd, tokens: a.tokens + t, ctx, model: model || a.model }))
      }
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const now = await $.clock.now()
      const status: AgentStatus = e.reason === 'answer' ? 'done' : 'failed'
      if (!(await read($, agents))[e.agentId]) early.set(e.agentId, { status, endedAt: now })
      await patchAgent($, e.agentId, a => ({
        status,
        endedAt: now,
        report: a.report && e.reason === 'answer' ? { ...a.report, done: a.report.total } : a.report,
      }))
      // the row may have landed meanwhile and taken the outcome above: then nothing waits in `early`
      if ((await read($, agents))[e.agentId]) early.delete(e.agentId)
      await closeBatchIfDone($, now)
    }
    return next(e)
  })

  // ---------- band above the prompt ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, batch)
    if (e.props.hasSurvey || !b || b.hidden) return next(e)
    const all = await read($, agents)
    const list = b.ids.map(id => all[id]).filter((a): a is AgentRow => !!a)
    const live = list.filter(isLive)
    // ponytail: the band stays up after a batch ends until dismissed, so the result is seen
    const ownTasks = await read($, tasks)
    const skinMap = await read($, skins)
    const mr = await read($, mainReport)

    const segs = list.map(a => {
      const own = tally(Object.values(ownTasks[a.id] ?? {}))
      const skin = skinOf(skinMap[a.type] ?? skinMap['*'] ?? TYPE_SKIN[a.type] ?? 'crab')
      return { frac: fraction(a, own), color: BAR_COLOR[a.status] ?? skin.color, running: a.status === 'running' }
    })
    const finished = list.length - live.length
    const known = segs.map(s => s.frac ?? 0)
    const frac = mr ? mr.done / mr.total : known.reduce((s, f) => s + f, 0) / Math.max(1, list.length)
    const activeStep = live.map(a => a.report?.step).find(Boolean)
    const label = mr ? `${mr.step ?? 'Step'} ${mr.done}/${mr.total}` : `${activeStep ?? (live.length ? 'Working' : 'Done')} ${finished}/${list.length}`
    const pct = `${Math.round(frac * 100)}%`
    const overall: AgentStatus = live.length ? (live.some(a => a.status === 'running') ? 'running' : 'waiting') : list.some(a => a.status === 'failed') ? 'failed' : 'done'
    const hide = () => update($, batch, cur => (cur ? { ...cur, hidden: true } : cur))
    const openPane = () => void $.ui.open({ id: PANE, title: 'Agents' })

    // ponytail: animation lives in Clients (surface-side, kept across redraws), so redraws never restart it
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Box, Text, Button, Client } = $.ui.resolve(e)
      const barW = Math.max(16, Math.min(44, (e.props.bodyColumns ?? 80) - b.title.length - 26))
      return (
        <Box flexDirection="row" gap={1} alignItems="center">
          <Client key="band-dot" module="./dot.tsx" props={{ status: overall }} />
          <Button key="agents" plain label={b.title} onPress={openPane} />
          <Client
            key="band-bar"
            module="./globalbar.tsx"
            props={{ frac, label: `${label} · ${pct}`, live: live.length > 0, failed: overall === 'failed', width: barW }}
            width={barW}
          />
          <Text color="#d97757">🦀</Text>
          <Text>×{list.length}</Text>
          <Button key="hide" plain label="✕" role="dismiss" onPress={hide} />
        </Box>
      )
    }
    const { Text } = $.ui.resolve(e)
    return (
      <Text>
        {STATUS[overall].glyph} {b.title} · {label} · {pct}
      </Text>
    )
  })

  // ---------- agents pane ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, agents)
    const list = Object.values(all)
    if (list.length === 0) return <Text dimColor>No subagents yet this session.</Text>

    const b = await read($, batch)
    const allTasks = await read($, tasks)
    const skinMap = await read($, skins)
    const collapsed = await read($, finishedCollapsed)
    const usage = await $.session.usage()
    const window = usage.context?.window || 200_000
    const now = await $.clock.now()
    const cols = e.props.bodyColumns ?? 40
    const costOf = (a: AgentRow) => a.usd ?? 0

    const inBatch = b ? list.filter(a => b.ids.includes(a.id)) : list
    const statCost = inBatch.reduce((s, a) => s + costOf(a), 0)
    const statTokens = inBatch.reduce((s, a) => s + a.tokens, 0)
    const statTime = b ? (b.endedAt ?? now) - b.startedAt : 0

    const live = list.filter(isLive).sort((x, y) => x.startedAt - y.startedAt)
    const finished = list.filter(a => !isLive(a)).sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))


    const mascot = (a: AgentRow, skin: Skin) => {
      const px = pixels(a.status === 'failed' ? SKINS.ghost : skin)
      if (e.surface === 'terminal') {
        const { Raster } = $.ui.resolve(e)
        return <Raster key={`crab-${a.id}`} columns={10} rows={4} cells={rasterCells(px)} />
      }
      const { Svg } = $.ui.resolve(e)
      // static image: no sandboxed frame, nothing to restart on redraw
      return <Svg source={svgCrab(px, { dim: a.status === 'waiting' })} alt={`${skin.role} crab`} width={30} height={27} />
    }

    const statusMark = (a: AgentRow) => {
      if (e.surface === 'terminal' || e.surface === 'desktop') {
        const { Client } = $.ui.resolve(e)
        return <Client key={`dot-${a.id}`} module="./dot.tsx" props={{ status: a.status }} />
      }
      return <Text color={STATUS[a.status].color}>{STATUS[a.status].glyph}</Text>
    }

    const timer = (key: string, elapsed: number, running: boolean, bold?: boolean) => {
      if (e.surface === 'terminal' || e.surface === 'desktop') {
        const { Client } = $.ui.resolve(e)
        return <Client key={key} module="./timer.tsx" props={{ elapsed, running, bold: !!bold, dim: !bold }} />
      }
      return (
        <Text bold={bold} dimColor={!bold}>
          {clock(elapsed)}
        </Text>
      )
    }

    const progressBar = (a: AgentRow, frac: number | null, color: string) => {
      if (e.surface === 'terminal' || e.surface === 'desktop') {
        const { Client } = $.ui.resolve(e)
        // ponytail: pane width minus the crab (10) and gaps; a fixed width keeps the Client's size stable
        const width = Math.max(8, Math.min(60, cols - 13))
        return <Client key={`bar-${a.id}`} module="./agentbar.tsx" props={{ frac, color, status: a.status, width }} width={width} />
      }
      const w = Math.max(8, Math.min(28, cols - 14))
      return <Text color={color}>{frac === null ? '━'.repeat(w) : bar(Math.round(frac * w), w, w)}</Text>
    }

    const row = (a: AgentRow) => {
      const skin = skinOf(skinMap[a.type] ?? skinMap['*'] ?? TYPE_SKIN[a.type] ?? 'crab')
      const own = tally(Object.values(allTasks[a.id] ?? {}))
      const frac = fraction(a, own)
      const color = BAR_COLOR[a.status] ?? skin.color
      const count = a.report ? `${Math.min(a.report.done, a.report.total)}/${a.report.total}` : own.total ? `${own.done}/${own.total}` : `${a.steps} steps`
      const step = a.report?.step ?? own.active ?? (a.status === 'waiting' ? 'Waiting' : a.status === 'running' ? `${a.tools} tools` : '')
      const ctxPct = a.ctx ? `ctx ${Math.max(1, Math.round((a.ctx / window) * 100))}% · ` : ''
      return (
        <Box key={a.id} flexDirection="row" gap={1} marginBottom={1}>
          {mascot(a, skin)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Text bold dimColor={a.status === 'waiting'} wrap="truncate-end">
                {a.description}
              </Text>
              {statusMark(a)}
            </Box>
            <Text wrap="truncate-end">
              <Text color={skin.color}>{skin.role}</Text>
              <Text dimColor>
                {' '}
                {shortModel(a.model)}
                {a.effort ? ` · ${a.effort}` : ''}
              </Text>
            </Text>
            <Box flexDirection={cols < 56 ? 'column' : 'row'} justifyContent="space-between" columnGap={1}>
              <Text wrap="truncate-end">
                {count}
                {step ? <Text dimColor> · {step}</Text> : null}
              </Text>
              <Box flexDirection="row" gap={1}>
                <Text dimColor wrap="truncate-end">
                  {ctxPct}
                  {kTokens(a.tokens)} {money(costOf(a))}
                </Text>
                {timer(`t-${a.id}`, (a.endedAt ?? now) - a.startedAt, isLive(a))}
              </Box>
            </Box>
            {progressBar(a, frac, color)}
          </Box>
        </Box>
      )
    }

    const stat = (label: string, value: string | ReturnType<typeof timer>) => (
      <Box key={label} flexDirection="column" flexGrow={1} borderStyle="round" borderColor="subtle" paddingX={1}>
        <Text dimColor>{label}</Text>
        {typeof value === 'string' ? <Text bold>{value}</Text> : value}
      </Box>
    )

    const toggle = () => update($, finishedCollapsed, v => !v)

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{b?.title ?? 'Agents'}</Text>
        <Box flexDirection="row" gap={1}>
          {stat('Cost', money(statCost))}
          {stat('Tokens', kTokens(statTokens))}
          {stat('Time', timer('stat-time', statTime, live.length > 0, true))}
        </Box>
        {live.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>Running · {live.length}</Text>
            {live.map(row)}
          </Box>
        )}
        {finished.length > 0 && (
          <Box flexDirection="column">
            <Button key="finished" plain label={`${collapsed ? '▸' : '▾'} Finished · ${finished.length}`} onPress={toggle} />
            {!collapsed && finished.map(row)}
          </Box>
        )}
      </Box>
    )
  })
}
