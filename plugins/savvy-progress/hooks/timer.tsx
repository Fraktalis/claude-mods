import type { ClientModule } from 'claude-code'

type Props = { elapsed: number; running: boolean; bold?: boolean; dim?: boolean }
type Ref = { base: number; elapsed: number; running: boolean }
type State = { r: Ref }

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** An elapsed-time label that ticks on the surface's own clock, so the hooks never redraw for it. */
const Timer: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  let st = surface.state
  if (!st) {
    const r: Ref = { base: Date.now() - props.elapsed, elapsed: props.elapsed, running: props.running }
    st = { r }
    surface.setState(st)
    surface.every(1000, () => {
      if (r.running) surface.setState({ r })
    })
  }
  const r = st.r
  if (props.elapsed !== r.elapsed) {
    // a redraw brought a fresher reading from the hooks: rebase on it
    r.elapsed = props.elapsed
    r.base = Date.now() - props.elapsed
  }
  r.running = props.running
  const ms = r.running ? Date.now() - r.base : r.elapsed
  return (
    <Text bold={props.bold} dimColor={props.dim}>
      {fmt(ms)}
    </Text>
  )
}

export default Timer
