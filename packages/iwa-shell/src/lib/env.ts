// Environment probes. Kept out of components so the UI stays declarative.

export interface FrameSupport {
  available: boolean
  detail: string
}

/** Is <controlledframe> real here, or are we in a plain browser tab? */
export function detectControlledFrame(): FrameSupport {
  const el = document.createElement('controlledframe')
  const ctor = el.constructor?.name ?? 'unknown'
  if (el instanceof HTMLUnknownElement) {
    return { available: false, detail: `unknown element (${ctor})` }
  }
  return { available: true, detail: ctor }
}

export const controlledFrame = detectControlledFrame()

/** Proof that the IWA CSP blocks runtime codegen.
 *
 *  This must run from real page script: DevTools and CDP `Runtime.evaluate`
 *  are exempt from CSP, so probing eval through them reports a false
 *  "allowed". AsyncFunction is the one that matters — it's what
 *  @mdx-js/mdx's evaluate() builds compiled modules with. */
export function cspSelfTest(): string[] {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  const out: string[] = []
  const check = (label: string, fn: () => unknown) => {
    try {
      out.push(`csp ${label}: ALLOWED → ${String(fn())}`)
    } catch (e) {
      out.push(`csp ${label}: blocked (${e instanceof Error ? e.name : 'error'})`)
    }
  }
  check('new Function', () => new Function('return 41+1')())
  check('AsyncFunction', () => typeof new AsyncFunction('return 1'))
  return out
}
