import type { ClientModule } from 'claude-code'

import { ease, mix, TRACK } from './fx'

type Status = 'waiting' | 'running' | 'done' | 'failed'
type Props = { frac: number | null; color: string; status: Status; width: number }
type Ref = { target: number | null; shown: number; t: number; status: Status; flash: number; color: string }
type State = { r: Ref }

/**
 * One agent's bar: the fill eases toward its fraction; unknown progress shows a
 * comet sweeping the track; finishing sweeps to full and flashes once.
 */
const AgentBar: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  let st = surface.state
  if (!st) {
    const r: Ref = { target: props.frac, shown: props.frac ?? 0, t: 0, status: props.status, flash: 0, color: props.color }
    st = { r }
    surface.setState(st)
    surface.every(50, () => {
      const goal = r.target ?? 0
      const moving = r.target !== null && r.shown !== goal
      if (r.target !== null) r.shown = ease(r.shown, goal, 0.1)
      r.flash = Math.max(0, r.flash - 0.06)
      r.t += 1
      if (moving || r.flash > 0 || (r.target === null && r.status === 'running')) surface.setState({ r })
    })
  }
  const r = st.r
  if (props.status !== r.status && (props.status === 'done' || props.status === 'failed')) r.flash = 1
  r.status = props.status
  r.target = props.frac
  r.color = props.color

  // the width comes from the hooks, never from the region: drawing to the region's size fed back into it
  const w = Math.max(6, props.width)
  const base = r.flash > 0 ? mix(r.color, '#ffffff', r.flash * 0.7) : r.color
  const cells = []

  if (r.target === null) {
    // comet: a bright head with a fading tail, sweeping while running
    const head = r.status === 'running' ? ((r.t * 0.7) % (w + 8)) - 4 : -99
    for (let i = 0; i < w; i++) {
      const d = head - i
      const b = d >= 0 && d < 6 ? 1 - d / 6 : d < 0 && d > -1.5 ? 0.6 : 0
      cells.push(
        <Text key={`c${i}`} color={b > 0 ? mix(TRACK, base, b) : TRACK}>
          ━
        </Text>,
      )
    }
  } else {
    const filled = r.shown * w
    const full = Math.floor(filled)
    const edge = filled - full
    for (let i = 0; i < w; i++) {
      // one glyph everywhere, only colours move: the bar never changes width
      const sheen = i < full && r.status === 'running' ? Math.max(0, 1 - Math.abs(((r.t * 0.5) % (w + 10)) - 5 - i) / 3) * 0.35 : 0
      const color = i < full ? mix(base, '#ffffff', sheen) : i === full ? mix(TRACK, base, edge) : TRACK
      cells.push(
        <Text key={`c${i}`} color={color}>
          ━
        </Text>,
      )
    }
  }
  return (
    <Box flexDirection="row" flexShrink={0}>
      {cells}
    </Box>
  )
}

export default AgentBar
