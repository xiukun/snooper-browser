import type { DeleteResult, DeleteSelection, DeleteTarget, DeleteSkipped } from '../../lib/knowledge-types'
import { libraryRequest, requireSuccess } from './favorite-control'

/** A preview token authorizes exactly the displayed selection, including favorites. */
export async function confirmLibraryDelete(selection: DeleteSelection): Promise<DeleteResult | null> {
  const preview = await libraryRequest('LIBRARY_PREPARE_DELETE', selection as Record<string, unknown>)
  requireSuccess(preview)
  const targets = preview.targets as DeleteTarget[]
  const skipped = preview.skipped as DeleteSkipped[]
  if (!targets.length) throw new Error(skipped[0]?.reason || '没有可删除的资料')
  const transcripts = targets.filter(t => t.kind === 'transcript').length
  const notes = targets.filter(t => t.kind === 'note')
  const noteEntries = notes.reduce((sum, t) => sum + (t.kind === 'note' ? t.entryIds.length : 0), 0)
  const previousFocus = document.activeElement as HTMLElement | null
  const dialog = document.createElement('dialog')
  dialog.className = 'library-delete-dialog'
  dialog.setAttribute('aria-label', '确认删除资料')
  dialog.style.cssText = 'max-width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:20px;border-radius:12px;border:1px solid var(--border-color,GrayText);background:var(--bg-secondary,Canvas);color:var(--text-main,CanvasText);margin:auto;line-height:1.7'
  const heading = document.createElement('h2'); heading.textContent = '确认删除资料'; heading.style.fontSize = '18px'
  const summary = document.createElement('p')
  summary.dataset.testid = 'delete-impact'
  summary.textContent = `将删除 ${transcripts} 条转写记录、${noteEntries} 条笔记内容，同时移除 ${preview.favoriteCount} 条收藏。独立另存的笔记会保留。此操作不可恢复。`
  const status = document.createElement('p'); status.setAttribute('role', 'alert'); status.style.overflowWrap = 'anywhere'
  if (skipped.length) status.textContent = `${skipped.length} 项已跳过：${skipped.map(s => s.reason).join('；')}`
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:14px'
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-secondary'; cancel.textContent = '取消'; cancel.dataset.action = 'cancel-delete'
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'btn btn-danger'; confirm.textContent = '确认删除'; confirm.dataset.action = 'confirm-delete'
  actions.append(cancel, confirm); dialog.append(heading, summary, status, actions); document.body.append(dialog)
  return new Promise(resolve => {
    let result: DeleteResult | null = null
    let busy = false
    let stale = false
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault() })
    dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.focus(); resolve(result) }, { once: true })
    cancel.addEventListener('click', () => dialog.close())
    confirm.addEventListener('click', async () => {
      busy = true; confirm.disabled = true; cancel.disabled = true; status.textContent = '正在删除…'
      try {
        const response = await libraryRequest('LIBRARY_DELETE', { token: preview.token })
        requireSuccess(response)
        const deletion = response as unknown as DeleteResult
        if (deletion.pending.length) {
          status.textContent = `已完成 ${deletion.completed.length} 项，${deletion.pending.length} 项尚未完成：${deletion.pending.map(p => p.error).join('；')}。可重试，或稍后在搜索页的存储状态中处理。`
        } else { result = deletion; dialog.close(); return }
      } catch (error) {
        stale = !!error && typeof error === 'object' && 'code' in error && error.code === 'CONFIRMATION_STALE'
        status.textContent = `删除未完成：${error instanceof Error ? error.message : String(error)}${stale ? '。请关闭后重新选择，核对最新影响数量。' : ''}`
      } finally { busy = false; confirm.disabled = stale; cancel.disabled = false }
      confirm.textContent = stale ? '请重新预览' : '重试删除'; cancel.textContent = '稍后处理'
    })
    dialog.showModal(); cancel.focus()
  })
}
