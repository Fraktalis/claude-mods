import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LastRequest } from '../types'

const last = atom({ plugin: 'cache-tax', key: 'last' } as const, null)
const confirm = atom({ plugin: 'cache-tax', key: 'confirm' } as const, null)
const keepwarm = atom({ plugin: 'cache-tax', key: 'keepwarm' } as const, false)
const pings = atom({ plugin: 'cache-tax', key: 'pings' } as const, 0)
const isBusy = atom({ plugin: 'cache-tax', key: 'isBusy' } as const, false)

// ---------- pure helpers (tested in cache.test.ts) ----------

export type Ttl = '1h' | '5m'
export const ttlMs = (ttl: Ttl) => (ttl === '5m' ? 5 * 60_000 : 60 * 60_000)

/** $ per million tokens: input, cache read. */
type Price = { input: number; cacheRead: number }

// ponytail: first-party list prices (claude-api skill table, 2026-10-06), same table as savvy-progress; edit both when prices change
const PRICES: [RegExp, Price][] = [
  [/fable|mythos/, { input: 10, cacheRead: 0.25 }],
  [/opus-5-5/, { input: 4, cacheRead: 0.2 }],
  [/opus/, { input: 5, cacheRead: 0.5 }],
  [/sonnet-5/, { input: 2, cacheRead: 0.2 }],
  [/sonnet/, { input: 3, cacheRead: 0.3 }],
  [/haiku-5/, { input: 0.1, cacheRead: 0.01 }],
  [/haiku/, { input: 1, cacheRead: 0.1 }],
]
const priceOf = (model: string): Price => PRICES.find(([re]) => re.test(model))?.[1] ?? PRICES[1]![1]

/** What re-sending `ctx` tokens costs: cold re-writes the cache (1.25x input for 5m, 2x for 1h), warm reads it. */
export const estimate = (ctx: number, model: string, ttl: Ttl) => {
  const p = priceOf(model)
  return {
    cold: (ctx * p.input * (ttl === '1h' ? 2 : 1.25)) / 1_000_000,
    warm: (ctx * p.cacheRead) / 1_000_000,
  }
}

export const money = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)
export const kTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
export const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`
}

/** Tokens the next request re-sends: everything the last one carried, plus its answer. */
export const nextContext = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }) =>
  u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens

/** The status line text for a moment `now`. */
export const statusText = (l: LastRequest | null, now: number, ttl: Ttl, minTokens: number, isKeepwarm: boolean) => {
  if (!l || l.ctx === 0) return undefined
  const left = l.at + ttlMs(ttl) - now
  const tail = isKeepwarm ? ' · keepwarm' : ''
  if (left > 0) return `🔥 cache ${span(left)}${tail}`
  if (l.ctx < minTokens) return `🧊 cache cold${tail}`
  return `🧊 cache cold · next msg ≈ ${money(estimate(l.ctx, l.model, ttl).cold)}${tail}`
}

const CONFIRM_MS = 120_000
const PING_LEAD_MS = 90_000
const PING_TEXT = 'Keep-warm ping from the cache-tax plugin, to keep the prompt cache warm while the user is away. Reply with just "ok".'

// ---------- options ----------

type Options = { ttl: Ttl; minTokens: number; maxPings: number }
const readOptions = (raw: unknown): Options => {
  const o = (raw ?? {}) as Partial<Record<keyof Options, unknown>>
  return {
    ttl: o.ttl === '5m' ? '5m' : '1h',
    minTokens: typeof o.minTokens === 'number' ? o.minTokens : 20_000,
    maxPings: typeof o.maxPings === 'number' ? o.maxPings : 3,
  }
}

// ---------- shared steps ----------

async function refreshStatus($: EngineInterface, opts: Options) {
  const l = await read($, last)
  const isOn = await read($, keepwarm)
  $.ui.status(statusText(l, await $.clock.now(), opts.ttl, opts.minTokens, isOn))
}

// ---------- hooks ----------

export const register: Register = (on, options) => {
  const opts = readOptions(options)
  let pingTimer: { cancel: () => void } | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'keepwarm', description: 'Keep the prompt cache warm while you are away: /keepwarm on|off', argumentHint: 'on|off' })
    await $.command.register({ name: 'cache', description: 'Show the prompt cache state and what the next message would cost' })
    $.clock.every(60_000, () => void refreshStatus($, opts))
    await refreshStatus($, opts)
    return next(e)
  })

  // the main loop's requests: when the cache was last refreshed, and what the next one re-sends
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) await update($, isBusy, () => true)
    const r = yield* next(e)
    if (!e.agentId && r.usage) {
      const model = r.usage.model || e.model
      const l: LastRequest = { at: await $.clock.now(), ctx: nextContext(r.usage), model }
      await update($, last, () => l)
      await refreshStatus($, opts)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    await update($, isBusy, () => false)
    pingTimer?.cancel()
    pingTimer = null
    if (await read($, keepwarm)) {
      const done = await read($, pings)
      const l = await read($, last)
      if (l && done < opts.maxPings) {
        const scheduledFor = l.at
        pingTimer = $.clock.after(Math.max(10_000, ttlMs(opts.ttl) - PING_LEAD_MS), () => {
          void (async () => {
            // only when nothing happened since, Claude is idle, and the person is not typing
            const cur = await read($, last)
            const box = await $.prompt.read().catch(() => null)
            if (!cur || cur.at !== scheduledFor || (await read($, isBusy)) || (box && box.text.trim() !== '')) return
            await update($, pings, n => n + 1)
            await $.prompt.submit({ text: PING_TEXT, cursor: PING_TEXT.length } as never)
          })()
        })
      }
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    // plugin and SDK prompts (the keep-warm ping included) are never stopped
    if (kind !== undefined && kind !== 'composer' && kind !== 'bridge') return next(e)
    await update($, pings, () => 0)

    const l = await read($, last)
    const now = await $.clock.now()
    const isCold = !!l && now - l.at > ttlMs(opts.ttl)
    if (!l || !isCold || l.ctx < opts.minTokens) return next(e)

    const c = await read($, confirm)
    if (c && c.until > now) {
      await update($, confirm, () => null)
      return next(e)
    }

    await update($, confirm, () => ({ until: now + CONFIRM_MS }))
    const cost = estimate(l.ctx, l.model, opts.ttl)
    // put the text back in the box once the drop has cleared it, so Enter sends it as is
    const text = e.text
    $.clock.after(150, () => void $.prompt.fill({ text, mode: 'replace' } as never))
    return {
      drop:
        `🧊 Prompt cache is cold (idle ${span(now - l.at)}). This message re-reads ~${kTokens(l.ctx)} tokens ` +
        `≈ ${money(cost.cold)} (warm it would be ≈ ${money(cost.warm)}). Press Enter again within 2 min to send it, ` +
        `or /compact first to shrink the context.`,
    }
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, keepwarm))
    await update($, keepwarm, () => isOn)
    await update($, pings, () => 0)
    if (!isOn) {
      pingTimer?.cancel()
      pingTimer = null
    }
    await refreshStatus($, opts)
    return {
      text: isOn
        ? `Keep-warm on: up to ${opts.maxPings} ping(s) while you are away, each ~${span(PING_LEAD_MS)} before the ${opts.ttl} cache expires. Each costs a cache read plus a one-word reply. Starts after Claude's next answer.`
        : 'Keep-warm off.',
    }
  })

  on('command.run', { command: 'cache' }, async $ => {
    const l = await read($, last)
    if (!l) return { text: 'No request yet in this session: nothing cached.' }
    const now = await $.clock.now()
    const left = l.at + ttlMs(opts.ttl) - now
    const cost = estimate(l.ctx, l.model, opts.ttl)
    return {
      text:
        `${left > 0 ? `🔥 warm, ${span(left)} left` : `🧊 cold for ${span(-left)}`} (TTL ${opts.ttl}). ` +
        `Next message re-sends ~${kTokens(l.ctx)} tokens on ${l.model}: ≈ ${money(cost.warm)} warm, ≈ ${money(cost.cold)} cold. ` +
        `Keep-warm: ${(await read($, keepwarm)) ? 'on' : 'off'}.`,
    }
  })
}
