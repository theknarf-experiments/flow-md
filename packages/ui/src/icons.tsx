import type { SVGProps } from 'react'

/** Drawn rather than typed. The obvious shortcut for a toolbar is a glyph —
 *  ‹ › ⟳ — but those are typographic marks: they inherit the font's weight
 *  and optical size, so they come out thin and small next to a real icon, and
 *  they shift between fonts. These are strokes at a size we choose. */
export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Edge length in px. The stroke scales with it, so icons stay balanced. */
  size?: number
}

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // The button beside it carries the label; announcing the path is noise.
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 5.5 8.5 12l6.5 6.5" />
    </Icon>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5.5 15.5 12 9 18.5" />
    </Icon>
  )
}

/** A panel with its leading column marked — the shape everything from Arc to
 *  VS Code uses for "show/hide sidebar". */
export function SidebarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
      {/* The panel itself, shaded — an outline alone reads as a table. */}
      <rect
        x="4.1"
        y="5.6"
        width="4.3"
        height="12.8"
        rx="1.8"
        fill="currentColor"
        stroke="none"
        opacity="0.45"
      />
    </Icon>
  )
}

export function ReloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      {/* Open at the top right, where the arrowhead goes — a closed circle
          would read as a stop button. */}
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20.5 4v4.5H16" />
    </Icon>
  )
}
