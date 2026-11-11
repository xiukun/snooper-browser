import type { LibraryHit, LibrarySearchResult } from '../../lib/knowledge-types'
import { refKey } from '../../lib/knowledge-search'
import { libraryRequest, requireSuccess, type LibraryRequest } from '../content/favorite-control'

export type QueryStatus = 'idle' | 'searching' | 'complete' | 'no-match' | 'empty' | 'partial' | 'failed' | 'cancelled'
export interface QueryState {
  query: string; favoritesOnly: boolean; status: QueryStatus; sequence: number
  hits: Map<string, LibraryHit>; cursor: string | null; scanned: number
  errors: LibrarySearchResult['errors']; changed: boolean; scopes: LibrarySearchResult['scopes']; error: string
}
interface SearchDeps {
  request?: LibraryRequest
  changed: (state: QueryState, added: LibraryHit[], reset: boolean) => void
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void
}
/** Batches checkpoint in the background; this controller fences obsolete UI work. */
export function createLibrarySearch(deps: SearchDeps) {
  const request = deps.request || libraryRequest
  const schedule = deps.schedule || setTimeout
  const unschedule = deps.unschedule || clearTimeout
  const state: QueryState = { query: '', favoritesOnly: false, status: 'idle', sequence: 0, hits: new Map(), cursor: null, scanned: 0, errors: [], changed: false, scopes: [], error: '' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const emit = (added: LibraryHit[] = [], reset = false): void => deps.changed(state, added, reset)
  const cancelCursor = (cursor: string | null): void => { if (cursor) void request('LIBRARY_CANCEL_SEARCH', { cursor }).catch(() => {}) }
  function invalidate(): number {
    state.sequence++
    if (timer !== undefined) { unschedule(timer); timer = undefined }
    cancelCursor(state.cursor); state.cursor = null
    return state.sequence
  }
  async function scan(sequence: number): Promise<void> {
    state.status = 'searching'; state.error = ''; state.errors = []; emit()
    do {
      try {
        const response = await request('LIBRARY_SEARCH', { query: state.query, favoritesOnly: state.favoritesOnly, ...(state.cursor ? { cursor: state.cursor } : {}) })
        if (sequence !== state.sequence) { cancelCursor(typeof response?.cursor === 'string' ? response.cursor : null); return }
        requireSuccess(response)
        const result = response as unknown as LibrarySearchResult
        const added: LibraryHit[] = []
        for (const hit of result.hits) { const key = refKey(hit.ref); if (!state.hits.has(key)) { state.hits.set(key, hit); added.push(hit) } }
        state.cursor = result.cursor; state.scanned = result.scanned; state.errors = result.errors
        state.changed ||= result.changed; state.scopes = result.scopes
        state.status = result.errors.length ? 'partial' : result.complete
          ? !result.scopes.length ? 'empty' : !state.query.trim() ? 'idle' : !state.hits.size ? 'no-match' : 'complete'
          : 'searching'
        emit(added)
        // An error cursor is deliberately retryable. Never auto-loop it.
        if (result.errors.length || result.complete || !result.cursor) return
      } catch (error) {
        if (sequence !== state.sequence) return
        state.status = 'failed'; state.error = error instanceof Error ? error.message : String(error)
        if (error && typeof error === 'object' && 'code' in error && ['CURSOR_EXPIRED', 'CURSOR_MISMATCH'].includes(String(error.code))) state.cursor = null
        emit(); return
      }
    } while (sequence === state.sequence)
  }
  async function start(query: string, favoritesOnly: boolean): Promise<void> {
    const sequence = invalidate()
    Object.assign(state, { query: query.trim(), favoritesOnly, status: 'searching', hits: new Map(), scanned: 0, errors: [], changed: false, scopes: [], error: '' })
    emit([], true)
    await scan(sequence)
  }
  function input(query: string, favoritesOnly: boolean): void {
    const sequence = invalidate()
    Object.assign(state, { query: query.trim(), favoritesOnly, status: 'searching', hits: new Map(), scanned: 0, errors: [], changed: false, scopes: [], error: '' })
    emit([], true)
    timer = schedule(() => { if (sequence === state.sequence) return start(query, favoritesOnly) }, 180)
  }
  async function retry(): Promise<void> {
    if (state.status === 'searching') return
    if (!state.cursor) return start(state.query, state.favoritesOnly)
    await scan(state.sequence)
  }
  function cancel(): void { invalidate(); state.status = 'cancelled'; emit() }
  return { state, start, input, retry, cancel }
}
