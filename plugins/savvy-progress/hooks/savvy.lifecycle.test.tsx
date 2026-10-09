import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' }
const STEP = { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: USAGE }

// ponytail: tests reach the engine through untyped shapes (`as never`); the assertions are what matter
const world = (on: any) => {
  mock.clock(on, { now: 1000 })
  on('session.usage', (async () => ({ value: { cost: { usd: 0 }, context: { window: 1_000_000 } } })) as never)
  on('ui.open', (async () => ({ value: {} })) as never)
  on('turn.step', async function* () {
    return STEP
  } as never)
  on('turn.complete', (async () => ({ text: '' })) as never)
  on('ui.toast', (async () => ({ value: undefined })) as never)
}

const step = async ($: any, agentId: string) => {
  const s = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId })
  for await (const _ of s) void _
  return s.result
}

const complete = ($: any, agentId: string) =>
  $.turn.complete({ turnId: 't1', agentId, reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as never)

/** Which sections the pane draws: the "Running · n" heading and the "Finished" toggle. */
const sections = async ($: any) => {
  const pane = await $.ui.mount({ plugin: 'savvy-progress', surface: 'desktop', component: 'Pane', requestId: 'savvy-agents', props: {} } as never)
  const running = !!(await pane.find({ type: 'Text', text: /Running · 1/ } as never))
  const finished = !!(await pane.find({ key: 'finished' } as never))
  await pane.unmount()
  return { running, finished }
}

test('an agent stays under Running until its turn completes, and comes back when resumed', async ($, on) => {
  world(on)
  on('agent.spawn', (async () => ({ agentId: 'a1', model: 'claude-haiku-5-5' })) as never)
  await $.agent.spawn({ prompt: 'x', description: 'Scan repo', subagentType: 'Explore' } as never)

  expect({ at: 'waiting', ...(await sections($)) }).toEqual({ at: 'waiting', running: true, finished: false })
  await step($, 'a1')
  expect({ at: 'running', ...(await sections($)) }).toEqual({ at: 'running', running: true, finished: false })
  await complete($, 'a1')
  expect({ at: 'done', ...(await sections($)) }).toEqual({ at: 'done', running: false, finished: true })
  await step($, 'a1') // resumed later (e.g. SendMessage)
  expect({ at: 'resumed', ...(await sections($)) }).toEqual({ at: 'resumed', running: true, finished: false })
})

test('an agent that finishes before its row exists is not stuck under Running', async ($, on) => {
  world(on)
  on('agent.spawn', (async () => {
    await complete($, 'a2')
    return { agentId: 'a2', model: 'claude-haiku-5-5' }
  }) as never)
  await $.agent.spawn({ prompt: 'x', description: 'Fast one', subagentType: 'Explore' } as never)

  expect(await sections($)).toEqual({ running: false, finished: true })
})
