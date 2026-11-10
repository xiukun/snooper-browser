/** Outer boundary for note migration/additions and library read/confirm/delete.
 * Callers holding this lock use notesUnderLibraryLock; never acquire it twice.
 * Transcript persistence keeps its independent inner queue (no reverse lock).
 */
let queue: Promise<unknown> = Promise.resolve()
export function withLibraryOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => {}).then(operation)
  queue = run.catch(() => {})
  return run
}
