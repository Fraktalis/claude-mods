// Shared by the surface modules (Clients). Plain functions, no `$`.

const rgb = (c: string) => {
  const n = parseInt(c.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}

/** a→b by t (0..1), both '#rrggbb'. */
export const mix = (a: string, b: string, t: number) => {
  const k = Math.max(0, Math.min(1, t))
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  const h = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0')
  return `#${h(r1, r2)}${h(g1, g2)}${h(b1, b2)}`
}

/** Deterministic noise in 0..1 for a cell and a time bucket. */
export const noise = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** Ease `shown` toward `target`; snaps when close. */
export const ease = (shown: number, target: number, k = 0.09) => {
  const next = shown + (target - shown) * k
  return Math.abs(target - next) < 0.002 ? target : next
}

export const TRACK = '#3d444d'
export const ORANGE = '#e8743b'
