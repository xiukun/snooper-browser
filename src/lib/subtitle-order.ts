/**
 * Subtitle ordering (ADR-038).
 *
 * Segments are finalized concurrently (queue depth 3), so an earlier segment
 * can arrive after a later one when its ASR or translation is slower. Arrival
 * order is therefore not speech order. `at` (the segment's start wall clock)
 * is the authoritative key: `videoTime` is derived from it by interpolation
 * and must never be used to re-order rows.
 */

export interface StartOrdered {
  at?: number | null
}

/** Finite, non-negative start timestamp; missing values sort as 0. */
export function startOf(item: StartOrdered): number {
  return typeof item.at === 'number' && Number.isFinite(item.at) && item.at > 0 ? item.at : 0
}

export function compareStart(a: StartOrdered, b: StartOrdered): number {
  return startOf(a) - startOf(b)
}

/** Stable copy in speech order. */
export function sortByStart<T extends StartOrdered>(items: readonly T[]): T[] {
  return items.slice().sort(compareStart)
}

/**
 * Insert in place, after any existing line with the same start, so equal
 * timestamps keep arrival order. The returned array is the same reference.
 */
export function insertByStart<T extends StartOrdered>(items: T[], item: T): T[] {
  let index = items.length
  while (index > 0 && startOf(items[index - 1]!) > startOf(item)) {
    index -= 1
  }
  items.splice(index, 0, item)
  return items
}
