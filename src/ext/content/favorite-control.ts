import type { EntryRef, SaveState } from '../../lib/knowledge-types'
import { refKey } from '../../lib/knowledge-search'

export interface BackgroundResponse { ok: boolean; error?: string; code?: string; [key: string]: unknown }
export type LibraryRequest = (type: string, fields?: Record<string, unknown>) => Promise<BackgroundResponse>
export const libraryRequest: LibraryRequest = (type, fields = {}) => chrome.runtime.sendMessage({ target: 'background', type, ...fields })
export function requireSuccess(result: BackgroundResponse): void {
  if (!result?.ok) {
    const messages: Record<string, string> = { CURSOR_EXPIRED: '这次搜索已失效，请刷新结果', CURSOR_MISMATCH: '搜索条件已更改，请刷新结果', CONFIRMATION_STALE: '资料或收藏已变化，请重新预览删除范围' }
    throw Object.assign(new Error(messages[result?.code || ''] || result?.error || '请求失败，请重试'), { code: result?.code })
  }
}

/** One acknowledged reference set per UI surface; storage events only invalidate it. */
export function createFavoriteState(request: LibraryRequest = libraryRequest) {
  let refs = new Set<string>()
  let status: 'loading' | 'ready' | 'error' = 'loading'
  let error = ''
  let serial = 0
  const busy = new Set<string>()
  const listeners = new Set<() => void>()
  const emit = (): void => listeners.forEach(fn => fn())
  async function refresh(): Promise<void> {
    const sequence = ++serial
    try {
      const result = await request('LIBRARY_FAVORITES')
      requireSuccess(result)
      if (sequence !== serial) return
      refs = new Set((result.refs as EntryRef[]).map(refKey))
      status = 'ready'; error = ''
    } catch (cause) {
      if (sequence !== serial) return
      status = 'error'; error = String(cause)
    }
    emit()
  }
  async function toggle(ref: EntryRef): Promise<boolean> {
    const key = refKey(ref)
    if (status !== 'ready') throw new Error('收藏状态尚未读取，请重试')
    if (busy.has(key)) return refs.has(key)
    busy.add(key); emit()
    try {
      const result = await request('LIBRARY_FAVORITE', { ref, favorite: !refs.has(key) })
      requireSuccess(result)
      // In-flight list reads must not overwrite an acknowledged mutation.
      serial++
      const favorite = result.favorite === true
      if (favorite) refs.add(key); else refs.delete(key)
      return favorite
    } finally { busy.delete(key); emit() }
  }
  return { refresh, toggle, get status() { return status }, get error() { return error }, has: (ref: EntryRef) => refs.has(refKey(ref)), busy: (ref: EntryRef) => busy.has(refKey(ref)), subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) } }
}
export type FavoriteState = ReturnType<typeof createFavoriteState>
let shared: FavoriteState | undefined
export function favoriteState(): FavoriteState {
  if (!shared) {
    shared = createFavoriteState()
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['snooper.library.favorites.v1']) void shared?.refresh()
    })
    void shared.refresh()
  }
  return shared
}

export function subtitleFavoriteRef(session: { transcriptId?: string | null; saveState?: SaveState; isDemoMode?: boolean }, line: { id?: string }): EntryRef | null {
  return !session.isDemoMode && session.saveState?.status === 'saved' && session.transcriptId && line.id
    ? { kind: 'transcript', recordId: session.transcriptId, lineId: line.id } : null
}

export function createFavoriteButton(ref: EntryRef | null, notify: (message: string) => void, state = favoriteState()): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'library-favorite btn btn-sm btn-secondary'
  button.dataset.action = 'favorite'
  const update = (): void => {
    button.disabled = !ref || state.busy(ref) || state.status === 'loading'
    button.textContent = !ref ? '保存后可收藏' : state.status === 'loading' ? '读取收藏…' : state.status === 'error' ? '重试读取收藏' : state.has(ref) ? '★ 已收藏' : '☆ 收藏'
    button.setAttribute('aria-pressed', String(!!ref && state.has(ref)))
    button.title = !ref ? '正文成功保存后才能收藏' : state.status === 'error' ? state.error : '收藏此条原文与译文'
  }
  update()
  let unsubscribe: () => void = () => {}
  unsubscribe = state.subscribe(() => { if (!button.isConnected) { unsubscribe(); return }; update() })
  button.addEventListener('click', async event => {
    event.stopPropagation()
    if (!ref) return
    if (state.status === 'error') { await state.refresh(); return }
    try { await state.toggle(ref) }
    catch (error) { notify(`收藏未更改：${error instanceof Error ? error.message : String(error)}`) }
  })
  return button
}
