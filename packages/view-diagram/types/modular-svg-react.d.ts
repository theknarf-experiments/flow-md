// Type-level shim for @modular-svg/react. The real package ships raw .ts
// source (vendored submodule) that compiles under its own tsconfig but not
// under our stricter flags (noUncheckedIndexedAccess), so we keep it out of
// our typecheck program. Vite ignores tsconfig paths, so the bundler still
// uses the real reconciler-based implementation — this file only mirrors the
// surface we consume.
import type { HTMLAttributes, ReactNode } from 'react'

export interface GraphicProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
  margin?: number
  title?: string
}

/**
 * Renders modular-svg scene JSX (lowercase primitives: stackH, stackV,
 * align, distribute, background, arrow, ref, rect, circle, text, …) through
 * a custom React reconciler, solves the layout, and paints inline SVG in a
 * div (which receives the remaining HTML props).
 */
export declare function Graphic(props: GraphicProps): ReactNode
