import type { ClientModule } from 'claude-code'

type Props = { text: string; color: string; pulse: number; age: number }
type Ref = { start: number; pulse: number; t: number }
type State = { r: Ref }

const DURATION = 1800

const rgb = (c: string) => {
  const n = parseInt(c.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
const mix = (a: string, b: string, k: number) => {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  const h = (x: number, y: number) => Math.round(x + (y - x) * Math.max(0, Math.min(1, k))).toString(16).padStart(2, '0')
  return `#${h(r1, r2)}${h(g1, g2)}${h(b1, b2)}`
}

/**
 * A file name that shimmers for a moment after Claude touches it: a bright band
 * sweeps across the letters, then the name settles in its state colour. Only
 * colours change, so the name never changes width.
 */
const Shimmer: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  let st = surface.state
  if (!st) {
    const r: Ref = { start: Date.now() - props.age, pulse: props.pulse, t: 0 }
    st = { r }
    surface.setState(st)
    surface.every(50, () => {
      if (Date.now() - r.start < DURATION) {
        r.t += 1
        surface.setState({ r })
      }
    })
  }
  const r = st.r
  if (props.pulse !== r.pulse) {
    // touched again: replay the sweep
    r.pulse = props.pulse
    r.start = Date.now() - props.age
  }
  const k = (Date.now() - r.start) / DURATION
  if (k >= 1) return <Text color={props.color}>{props.text}</Text>

  const chars = [...props.text]
  const head = k * (chars.length + 6) - 3
  return (
    <Box flexDirection="row" flexShrink={0}>
      {chars.map((c, i) => (
        <Text key={`c${i}`} color={mix(props.color, '#ffffff', Math.max(0, 1 - Math.abs(i - head) / 3) * 0.85)} bold>
          {c}
        </Text>
      ))}
    </Box>
  )
}

export default Shimmer
