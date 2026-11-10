import type { DeleteResult } from '../../lib/knowledge-types'
import { libraryRequest, requireSuccess } from '../content/favorite-control'
import { createLibrarySearch, type QueryState } from './library'
import { button, createResultRenderer, element } from './library-render'

interface Usage {
  complete: boolean; errors: { area: string; message: string }[]; bytes: number | null
  transcriptCount: number | null; noteCount: number | null; noteEntryCount: number | null; favoriteCount: number | null
  pendingWrites: { transcriptLines: number; sessions: number; noteMigration: boolean | null }; pendingDeletes: DeleteResult[] | null
}
export function mountLibraryPanel(showTab: (tab: string) => void) {
  const root = document.getElementById('panel-search')!
  const query = document.getElementById('library-query') as HTMLInputElement
  const filter = document.getElementById('library-favorites-only') as HTMLInputElement
  const status = document.getElementById('library-status')!
  const warning = document.getElementById('library-warning')!
  const message = document.getElementById('library-message')!
  const retry = document.getElementById('library-retry') as HTMLButtonElement
  const restart = document.getElementById('library-restart') as HTMLButtonElement
  const cancel = document.getElementById('library-cancel') as HTMLButtonElement
  const usage = document.getElementById('library-usage')!
  const notify = (text: string): void => { message.textContent = text }
  const results = createResultRenderer(document.getElementById('library-results')!, notify)
  function changed(state: QueryState, added: Parameters<typeof results.update>[1], reset: boolean): void {
    results.update(state, added, reset)
    const count = state.hits.size
    status.textContent = ({
      idle: `已保存 ${state.scopes.length} 份资料。输入关键词搜索原文、译文和笔记。`,
      searching: `搜索中… 已读取 ${state.scanned} 条，找到 ${count} 条`,
      complete: `搜索完成 · ${count} 条匹配 · 已读取 ${state.scanned} 条`,
      'no-match': `搜索完成，未找到匹配 · 已读取 ${state.scanned} 条`,
      empty: '还没有已保存的资料。保存字幕或笔记后可在这里检索。',
      partial: `尚未完整读取 · 已找到 ${count} 条。请重试读取失败的资料。`,
      failed: `请求失败，检索未完成：${state.error}。请重试或重新搜索。`,
      cancelled: `已停止搜索 · 当前 ${count} 条结果未覆盖全部资料。`,
    })[state.status]
    root.dataset.status = state.status
    warning.textContent = [state.changed ? '搜索期间内容或收藏已变化。当前结果来自搜索开始时的资料，请刷新结果。' : '', ...state.errors.map(e => `读取失败：${e.message}`)].filter(Boolean).join('\n')
    retry.hidden = !['partial', 'failed'].includes(state.status)
    restart.hidden = !state.changed && !['partial', 'failed', 'cancelled', 'complete', 'no-match'].includes(state.status)
    cancel.hidden = state.status !== 'searching'
    if (reset) message.textContent = ''
  }
  const controller = createLibrarySearch({ changed })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['snooper.library.favorites.v1'] && controller.state.query) {
      controller.state.changed = true
      changed(controller.state, [], false)
    }
  })
  const input = (): void => controller.input(query.value, filter.checked)
  query.addEventListener('input', input); filter.addEventListener('change', input)
  retry.addEventListener('click', () => { void controller.retry() })
  restart.addEventListener('click', () => { void controller.start(query.value, filter.checked); void results.refreshFavorites(); void refreshUsage() })
  cancel.addEventListener('click', controller.cancel)
  document.getElementById('library-manage-history')!.addEventListener('click', () => showTab('history'))
  document.getElementById('library-manage-notes')!.addEventListener('click', () => showTab('notes'))
  document.getElementById('library-refresh-usage')!.addEventListener('click', () => { void refreshUsage() })
  let usageSequence = 0
  async function refreshUsage(): Promise<void> {
    const sequence = ++usageSequence
    usage.textContent = '正在读取本地存储状态…'
    try {
      const response = await libraryRequest('LIBRARY_USAGE'); requireSuccess(response)
      if (sequence !== usageSequence) return
      const stats = response as unknown as Usage
      const number = (value: number | null): string => value === null ? '读取失败' : String(value)
      usage.textContent = ''
      usage.append(element('p', '', `本地扩展存储 ${stats.bytes === null ? '读取失败' : (stats.bytes / 1024 / 1024).toFixed(2) + ' MB'}（包含设置与附件）。${number(stats.transcriptCount)} 条转写记录 · ${number(stats.noteCount)} 篇笔记 / ${number(stats.noteEntryCount)} 条内容 · ${number(stats.favoriteCount)} 条收藏。`))
      usage.append(element('p', 'section-desc', '正文不会按数量或时间自动清理。可前往转写或笔记历史导出，再手动删除不需要的资料。'))
      if (stats.pendingWrites.transcriptLines || stats.pendingWrites.noteMigration || stats.pendingWrites.noteMigration === null) usage.append(element('p', 'library-warning', `${stats.pendingWrites.transcriptLines} 条字幕尚未保存。${stats.pendingWrites.noteMigration ? '旧笔记仍待合并。' : stats.pendingWrites.noteMigration === null ? '旧笔记合并状态读取失败。' : ''}请在笔记页重试保存或导出可用内容；页面内笔记草稿请在原页面处理。`))
      if (!stats.complete) usage.append(element('p', 'library-warning', `存储状态未完整读取：${stats.errors.map(e => e.message).join('；')}`))
      if (stats.pendingDeletes === null) usage.append(element('p', 'library-warning', '未完成删除的状态读取失败，请刷新重试。'))
      for (const operation of stats.pendingDeletes || []) {
        const line = element('div', 'library-pending-delete')
        line.append(element('p', '', `${operation.pending.length} 项删除未完成：${operation.pending.map(p => p.error).join('；')}`))
        const again = button('重试删除', 'retry-delete', async () => {
          again.disabled = true
          try {
            const result = await libraryRequest('LIBRARY_RETRY_DELETE', { operationId: operation.operationId }); requireSuccess(result)
            const pending = (result as unknown as DeleteResult).pending
            notify(pending.length ? `仍有 ${pending.length} 项删除未完成，请检查存储后再试` : '已完成这次删除')
          } catch (error) { notify(`删除重试失败：${String(error)}`) }
          await refreshUsage()
        })
        line.append(again); usage.append(line)
      }
    } catch (error) { if (sequence === usageSequence) usage.textContent = `存储状态读取失败：${String(error)}。请点击刷新状态重试。` }
  }
  return { activate(): void { void refreshUsage(); void results.refreshFavorites(); if (controller.state.status === 'idle' && !controller.state.scopes.length) void controller.start(query.value, filter.checked) }, controller }
}
