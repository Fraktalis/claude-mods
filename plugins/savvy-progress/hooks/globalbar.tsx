import type { ClientModule } from 'claude-code'

import { ease, mix, ORANGE, TRACK } from './fx'

type Props = { frac: number; label: string; live: boolean; failed: boolean; width: number }
type Ref = { target: number; shown: number; t: number; live: boolean; failed: boolean }
type State = { r: Ref }

const EMBER_BG = '#3b1a0a'
const EMBER_HI = '#ffb070'
// figure space: as wide as a digit in any font, so blank cells match the label's cells
const FILL = ' '

// ponytail: fixed embers (offset, speed, size); add more if the field looks sparse on wide bars
const EMBERS = [
  [0.05, 0.11, 1.6],
  [0.27, 0.07, 2.2],
  [0.48, 0.13, 1.3],
  [0.66, 0.09, 1.9],
  [0.83, 0.06, 2.6],
  [0.94, 0.12, 1.4],
] as const

/**
 * The global bar. Every cell is the same character (a space) and only its
 * background colour changes, so the bar never changes width. The filled part
 * glows orange and embers drift right through it; the fill eases toward its target.
 */
const GlobalBar: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  let st = surface.state
  if (!st) {
    const r: Ref = { target: props.frac, shown: 0, t: 0, live: props.live, failed: props.failed }
    st = { r }
    surface.setState(st)
    surface.every(80, () => {
      const settled = r.shown === r.target
      r.shown = ease(r.shown, r.target, 0.06)
      r.t += 1
      if (r.live || !settled) surface.setState({ r })
    })
  }
  const r = st.r
  r.target = Math.max(0, Math.min(1, props.frac))
  r.live = props.live
  r.failed = props.failed

  const w = Math.max(10, props.width)
  const filled = r.shown * w
  const full = Math.floor(filled)
  const edge = filled - full
  // split by code point, capped to the bar, so an emoji in a step label never breaks the cell count
  const label = [...` ${props.label} `].slice(0, Math.max(10, props.width))
  const ls = Math.max(0, Math.floor((w - label.length) / 2))
  const accent = r.failed ? '#f85149' : ORANGE
  const sec = r.t * 0.08

  const glow = (i: number) => {
    // a slow breathing base plus soft embers drifting right inside the filled span
    let g = 0.25 + 0.1 * Math.sin(sec * 1.3 + i * 0.45)
    if (r.live && full > 0) {
      for (const [off, speed, size] of EMBERS) {
        const x = (off * full + sec * speed * full) % Math.max(1, full)
        const d = Math.abs(i - x)
        g += Math.max(0, 1 - d / size) * 0.75
      }
    }
    return Math.min(1, g)
  }

  const cells = []
  for (let i = 0; i < w; i++) {
    const li = i - ls
    let bg: string
    if (i < full) bg = mix(mix(EMBER_BG, accent, 0.55), EMBER_HI, glow(i))
    else if (i === full && edge > 0) bg = mix(TRACK, mix(EMBER_BG, accent, 0.55), edge)
    else bg = TRACK
    if (li >= 0 && li < label.length) {
      // the label sits on the bar itself, its cells only a little darker for contrast
      cells.push(
        <Text key={`c${i}`} color="#ffffff" backgroundColor={mix(bg, '#000000', 0.3)} bold>
          {label[li]}
        </Text>,
      )
      continue
    }
    cells.push(
      <Text key={`c${i}`} backgroundColor={bg}>
        {FILL}
      </Text>,
    )
  }
  return (
    <Box flexDirection="row" flexShrink={0}>
      {cells}
    </Box>
  )
}

export default GlobalBar
