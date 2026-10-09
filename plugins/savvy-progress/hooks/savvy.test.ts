import { expect, test } from 'claude-code/testing'

import { bar, costUsd, newTokens, pixels, rasterCells, SKINS, tally } from './register'

test('progress tally and bar', () => {
  const t = tally([
    { subject: 'a', status: 'completed' },
    { subject: 'b', status: 'in_progress' },
    { subject: 'c', status: 'pending' },
  ])
  expect(t).toEqual({ done: 1, total: 3, active: 'b' })
  expect(bar(1, 4, 8)).toBe('██░░░░░░')
  expect(bar(0, 0, 4)).toBe('░░░░')
})

test('cost uses the answering model price, tokens skip cache re-reads', () => {
  const u = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 }
  // haiku 5.5: 0.1*1000 + 0.5*1000 + 0.01*1e6, per million
  expect(Math.abs(costUsd(u, 'claude-haiku-5-5') - (100 + 500 + 10_000) / 1e6) < 1e-9).toBe(true)
  expect(Math.abs(costUsd(u, 'claude-opus-5-5') - (4000 + 20_000 + 200_000) / 1e6) < 1e-9).toBe(true)
  expect(newTokens(u)).toBe(2000)
})

test('crab raster is 10x4 cells', () => {
  const b64 = rasterCells(pixels(SKINS.developer))
  // 40 cells * 3 u32 * 4 bytes = 480 bytes -> 640 base64 chars
  expect(b64.length).toBe(640)
})
