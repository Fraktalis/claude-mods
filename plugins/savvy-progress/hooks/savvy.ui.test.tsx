import { expect, mock, test } from 'claude-code/testing'

const SPAWN = { prompt: 'x', description: 'Scan repo', subagentType: 'Explore' }

test('band and pane draw a spawned agent on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('session.usage', (async () => ({ value: { cost: { usd: 0.42 } } })) as never)
  on('ui.open', (async () => ({ value: {} })) as never)
  on('agent.spawn', async () => ({ agentId: 'a1', model: 'claude-haiku-5-5' }))
  await $.agent.spawn(SPAWN as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: {} } as never)
    expect(await band.find({ key: 'agents' } as never)).toBeTruthy()
    await band.unmount()

    const pane = await $.ui.mount({
      plugin: 'savvy-progress',
      surface,
      component: 'Pane',
      requestId: 'savvy-agents',
      props: {},
    } as never)
    expect(await pane.find({ type: 'Text', text: /Scan repo/ } as never)).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Haiku 5.5/ui } as never)).toBeTruthy()
    expect(await pane.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' } as never)).toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /no such agent/ } as never)).toBeFalsy()
    await pane.unmount()
  }
})
