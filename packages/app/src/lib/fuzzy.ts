// Tiny fuzzy matcher for the command palette. Subsequence matching with the
// usual affordances: consecutive runs and word-boundary hits score higher,
// earlier matches beat later ones. Pure, so it's unit-testable.

const BOUNDARY = new Set(['/', '-', '_', '.', ' '])

/** Score `query` against `target`; higher is better, null means no match.
 *  Case-insensitive subsequence semantics: every query char must appear in
 *  order in the target. Greedy matching is tried from every occurrence of
 *  the first query char (so "cal" anchors on the C of "calendar" rather
 *  than the c of "docs/") and the best alignment wins. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 0
  let best: number | null = null
  for (
    let seed = t.indexOf(q[0]!);
    seed >= 0;
    seed = t.indexOf(q[0]!, seed + 1)
  ) {
    const s = greedyFrom(q, t, seed)
    if (s !== null && (best === null || s > best)) best = s
  }
  return best
}

function greedyFrom(q: string, t: string, seed: number): number | null {
  let score = 0
  let lastHit = -2
  let ti = seed
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at < 0) return null
    score += 1
    if (at === lastHit + 1) score += 3 // consecutive run
    if (at === 0 || BOUNDARY.has(t[at - 1]!)) score += 2 // word start
    score -= at * 0.01 // light penalty for late matches
    lastHit = at
    ti = at + 1
  }
  // Prefer shorter targets when scores otherwise tie.
  return score - t.length * 0.001
}

/** Filter + rank `items` by fuzzy-matching `query` against `key(item)`. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  key: (item: T) => string,
  limit = 8,
): T[] {
  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const s = fuzzyScore(query, key(item))
    if (s !== null) scored.push({ item, score: s })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item)
}
