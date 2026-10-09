import { expect, mock, test } from 'claude-code/testing'

import { estimate, nextContext, span, statusText } from './register'

test('cold costs a cache write (2x input for 1h, 1.25x for 5m), warm a cache read', () => {
  const e1h = estimate(1_000_000, 'claude-opus-5-5', '1h')
  expect(Math.abs(e1h.cold - 8) < 1e-9).toBe(true) // $4/M input x 2
  expect(Math.abs(e1h.warm - 0.2) < 1e-9).toBe(true) // $0.20/M cache read
  expect(Math.abs(estimate(1_000_000, 'claude-opus-5-5', '5m').cold - 5) < 1e-9).toBe(true)
  expect(nextContext({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100 })).toBe(1115)
})

test('status line text', () => {
  const l = { at: 0, ctx: 300_000, model: 'claude-opus-5-5' }
  expect(statusText(null, 0, '1h', 20_000, false)).toBe(undefined)
  expect(statusText(l, 18 * 60_000, '1h', 20_000, false)).toBe('🔥 cache 42m')
  expect(statusText(l, 2 * 3_600_000, '1h', 20_000, true)).toBe('🧊 cache cold · next msg ≈ $2.40 · keepwarm')
  expect(statusText({ ...l, ctx: 5000 }, 2 * 3_600_000, '1h', 20_000, false)).toBe('🧊 cache cold')
  expect(span(75 * 60_000)).toBe('1h15')
})

const USAGE = { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 290_000, cache_creation_input_tokens: 7000, model: 'claude-opus-5-5' }

// ponytail: tests reach the engine through untyped shapes (`as never`)
/** `sent` collects every prompt that reaches the bottom of prompt.submit (the keep-warm ping included). */
const world = (on: any, sent: string[] = []) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('command.register', (async () => ({ value: {} })) as never)
  on('ui.status', (async () => ({ value: undefined })) as never)
  on('prompt.fill', (async () => ({ value: { text: '', cursor: 0 } })) as never)
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  } as never)
  on('prompt.submit', (async (_: unknown, e: { text: string }) => (sent.push(e.text), { text: e.text })) as never)
  return clock
}

const request = async ($: any) => {
  const s = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of s) void _
}

const type = ($: any, text: string) => $.prompt.submit({ text, cursor: text.length, origin: { kind: 'composer' } })

test('a cold cache stops the first Enter with the cost, the second Enter sends', async ($, on) => {
  const clock = world(on)
  await request($)

  expect((await type($, 'warm question')).drop).toBe(undefined) // warm: passes

  await clock.advance(2 * 3_600_000) // 2h idle, 1h TTL
  const first = await type($, 'cold question')
  expect(typeof first.drop).toBe('string')
  expect(first.drop).toContain('~300k tokens')
  expect(first.drop).toContain('≈ $2.40') // 300k x $8/M
  expect(first.drop).toContain('≈ $0.06') // 300k x $0.20/M

  const second = await type($, 'cold question')
  expect(second.drop).toBe(undefined)
  expect(second.text).toBe('cold question')
})

test('plugin prompts are never stopped', async ($, on) => {
  const clock = world(on)
  await request($)
  await clock.advance(2 * 3_600_000)
  const r = await $.prompt.submit({ text: 'from a plugin', cursor: 0, origin: { kind: 'plugin', name: 'x' } } as never)
  expect((r as { drop?: string }).drop).toBe(undefined)
})

const keepwarmWorld = (on: any, draft: string) => {
  const sent: string[] = []
  const clock = world(on, sent)
  on('prompt.read', (async () => ({ value: { text: draft, cursor: draft.length } })) as never)
  on('turn.complete', (async () => ({ text: '' })) as never)
  return { clock, sent }
}

const answer = ($: any) => $.turn.complete({ turnId: 't', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })

test('keepwarm pings just before the TTL', async ($, on) => {
  const { clock, sent } = keepwarmWorld(on, '')
  await ($ as any).command.run({ command: 'keepwarm', args: 'on' })
  await request($)
  await answer($)

  await clock.advance(3_600_000 - 90_000 - 1)
  expect(sent.length).toBe(0) // not yet
  await clock.advance(2)
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('Keep-warm ping')
})

test('keepwarm never pings over a draft being typed', async ($, on) => {
  const { clock, sent } = keepwarmWorld(on, 'half a sente')
  await ($ as any).command.run({ command: 'keepwarm', args: 'on' })
  await request($)
  await answer($)
  await clock.advance(3_600_000)
  expect(sent.length).toBe(0)
})
