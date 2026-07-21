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
}
