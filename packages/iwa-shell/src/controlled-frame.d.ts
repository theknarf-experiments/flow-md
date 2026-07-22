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
  /** The guest's own context menu, inherited from <webview>. Items added here
   *  are drawn by the browser in the native menu, next to Copy and Look Up —
   *  the shell can't draw over a guest, and wouldn't want to replace what's
   *  already there. */
  contextMenus?: ContextMenus
  /** True while the guest is making noise — not whether it has media, but
   *  whether that media is audible right now. */
  /** Register scripts the guest injects itself, on every matching page and
   *  across navigations — what an extension's content scripts are. */
  addContentScripts?(scripts: unknown[]): Promise<void> | void
  removeContentScripts?(names?: string[]): Promise<void> | void
  getAudioState?(): Promise<boolean>
  isAudioMuted?(): Promise<boolean>
  setAudioMuted?(muted: boolean): void
}

/** The guest's context menu. An EventTarget, not a bag of callbacks: an item
 *  is created by name, and its click arrives here as an event carrying which
 *  item it was. Passing an `onclick` inside the create properties is
 *  <webview>'s convention and is quietly ignored, which shows up as a menu
 *  item that draws correctly and does nothing. */
export interface ContextMenus extends EventTarget {
  create(properties: {
    id?: string
    title: string
    contexts?: string[]
  }): Promise<void>
  remove?(id: string): Promise<void>
  removeAll?(): Promise<void>
  addEventListener(
    type: 'click',
    listener: (event: ContextMenusClickEvent) => void,
  ): void
}

export interface ContextMenusClickEvent extends Event {
  readonly menuItem?: { id: string }
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
