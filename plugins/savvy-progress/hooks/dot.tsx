import type { ClientModule } from 'claude-code'

import { mix, ORANGE } from './fx'

type Status = 'waiting' | 'running' | 'done' | 'failed'
type Props = { status: Status }
type Ref = { t: number; status: Status }
type State = { r: Ref }

/** Status mark: pulsing ● running, breathing ◌ waiting, ✓ done, ✗ failed. */
const Dot: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  let st = surface.state
  if (!st) {
    const r: Ref = { t: 0, status: props.status }
    st = { r }
    surface.setState(st)
    surface.every(120, () => {
      r.t += 1
      if (r.status === 'running' || r.status === 'waiting') surface.setState({ r })
    })
  }
  const r = st.r
  r.status = props.status
  if (r.status === 'running') {
    const k = 0.5 + 0.5 * Math.sin(r.t / 2)
    return <Text color={mix('#5a2a12', ORANGE, 0.35 + 0.65 * k)}>●</Text>
  }
  if (r.status === 'waiting') {
    // same glyph every frame (a rotating glyph changes width in a proportional font)
    const k = 0.5 + 0.5 * Math.sin(r.t / 3)
    return <Text color={mix('#484f58', '#8b949e', k)}>◌</Text>
  }
  if (r.status === 'done') return <Text color="#3fb950">✓</Text>
  return <Text color="#f85149">✗</Text>
}

export default Dot
