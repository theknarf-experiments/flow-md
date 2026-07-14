// Type-level shim for @modular-svg/core (see tsconfig paths). The real
// package ships raw TypeScript with `.ts`-extension imports; resolving those
// sources into our program would need allowImportingTsExtensions and drags
// their whole compiler surface in. This mirrors just the pipeline we call —
// the bundler resolves the real implementation (browser entry, no Node deps).

export interface Scene {
  nodes: unknown[]
  operators: unknown[]
  warnings?: string[]
}

export type LayoutResult = Record<
  string,
  { x: number; y: number; width: number; height: number; fill?: string }
>

export declare function buildSceneFromJson(
  json: Record<string, unknown>,
): Scene

export declare function solveLayout(
  scene: Scene,
  opts?: { maxIter?: number; epsilon?: number; damping?: number },
): LayoutResult

export declare function layoutToSvg(
  layout: LayoutResult,
  nodes?: unknown[],
  margin?: number,
): string
