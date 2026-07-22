// When a dismissed picture-in-picture corner is allowed to come back.
//
// Its own file with its own tests because it has been wrong twice. Both times
// the rule was written against how the corner behaved that week — first "the
// video stopped", then "the video paused" — rather than against what
// dismissing something means. What it means is: not this, not now. So it holds
// for exactly as long as the thing that was sent away is still the thing that
// would come back.

export interface Dismissal {
  /** The tab whose corner was sent away. */
  hidden: string
  /** The panes on screen: a tab you can see needs no corner. */
  firstId: string | null
  splitId: string | null
  /** What the browser currently counts as playing. */
  mediaId: string | null
  /** Whether that tab is still open at all. */
  exists: boolean
}

/** True when the dismissal has served its purpose and should be forgotten.
 *
 *  Deliberately says nothing about playing or paused. Pausing a video is not a
 *  reason to show a corner again — it's the opposite, which is how pressing ✕
 *  on a paused video came to look like a button that did nothing. */
export function dismissalSpent(d: Dismissal): boolean {
  if (!d.exists) return true
  if (d.hidden === d.firstId || d.hidden === d.splitId) return true
  // Something else is playing now: that's a new corner, not the dismissed one.
  return d.mediaId !== d.hidden
}
