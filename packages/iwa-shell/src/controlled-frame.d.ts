// Minimal typing for <controlledframe>. It isn't in lib.dom, and the API is
// still moving, so this covers only what the prototype touches — everything
// else is probed at runtime (see inspectApi in main.ts).
export interface ControlledFrame extends HTMLElement {
  src: string
  partition: string
  /** Runs code in the guest and resolves with the per-frame results. */
  executeScript?(details: { code: string }): Promise<unknown>
  reload?(): void
  back?(): Promise<void> | void
  forward?(): Promise<void> | void
  stop?(): void
  clearData?(options?: unknown, types?: unknown): Promise<void>
  /** True while the guest is making noise — not whether it has media, but
   *  whether that media is audible right now. */
  getAudioState?(): Promise<boolean>
  isAudioMuted?(): Promise<boolean>
  setAudioMuted?(muted: boolean): void
}

/** Raised when a guest asks for a window of its own: ⌘-click, a target of
 *  _blank, or window.open. The embedder decides what that means — here, a new
 *  tab in the same space. */
export interface NewWindowEvent extends Event {
  targetUrl?: string
  /** The requested window, which can be adopted into another frame or thrown
   *  away. Left unattached it is discarded, which is what we want: the tab is
   *  opened from the url instead. */
  window?: { discard?(): void; attach?(frame: unknown): void }
}
