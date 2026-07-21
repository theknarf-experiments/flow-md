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

/** Chrome's title bar is gone only in "unframed" display mode, which needs
 *  the window-management permission granted on top of the manifest and the
 *  enable-unframed-iwa flag. The grant has to come from a user gesture, so
 *  the shell offers it rather than making anyone dig through App settings. */
export async function windowManagementState(): Promise<PermissionState | 'unsupported'> {
  try {
    const status = await navigator.permissions.query({
      name: 'window-management' as PermissionName,
    })
    return status.state
  } catch {
    return 'unsupported'
  }
}

/** Triggers Chrome's permission prompt. Allowing it persists in the profile;
 *  the window becomes unframed the next time it's opened. */
export async function requestWindowManagement(): Promise<boolean> {
  try {
    await (window as { getScreenDetails?: () => Promise<unknown> }).getScreenDetails?.()
    return (await windowManagementState()) === 'granted'
  } catch {
    return false
  }
}

/** True when Chrome is drawing its own title bar above us. */
export function hasTitleBar(): boolean {
  return window.outerHeight - window.innerHeight > 4
}

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
