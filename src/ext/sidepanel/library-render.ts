import type { EntryRef, HighlightRange, LibraryEntry, LibraryHit, SourceRef } from '../../lib/knowledge-types'
import { refKey } from '../../lib/knowledge-search'
import { formatVideoTime } from '../../lib/video-clock'
import { createFavoriteButton, favoriteState, libraryRequest, requireSuccess } from '../content/favorite-control'
import type { QueryState } from './library'

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node
}
export function button(text: string, action: string, run: () => void): HTMLButtonElement {
  const node = element('button', 'btn btn-sm btn-secondary', text); node.type = 'button'; node.dataset.action = action; node.addEventListener('click', run); return node
}
export function appendHighlight(container: HTMLElement, text: string, ranges: HighlightRange[] = []): void {
  let offset = 0
  for (const [start, end] of ranges) {
    if (start < offset || end > text.length || end <= start) continue
    container.append(document.createTextNode(text.slice(offset, start)), element('mark', '', text.slice(start, end)))
    offset = end
  }
  container.append(document.createTextNode(text.slice(offset)))
}
export async function openEntrySource(ref: EntryRef): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const response = await libraryRequest('LIBRARY_OPEN_SOURCE', { ref, ...(tab?.id !== undefined ? { tabId: tab.id } : {}) })
  requireSuccess(response)
  return response.action === 'seeked' ? '已定位到原视频对应位置' : String(response.degraded || '已打开来源页面；播放位置由来源页面处理')
}
export function renderEntry(entry: LibraryEntry, notify: (message: string) => void, options: { highlights?: LibraryHit['highlights']; context?: boolean; neighbors?: boolean } = {}): HTMLElement {
  const row = element('article', `library-entry${options.context ? ' library-neighbor' : ''}`)
  row.dataset.ref = refKey(entry.ref)
  const type = entry.ref.kind === 'transcript' ? entry.type === 'screen' ? '画面字幕' : '字幕' : ({text:'笔记',subtitle:'字幕笔记',summary:'学习纪要',image:'配图',screenshot:'截图',svg:'矢量图'}[entry.type] || '笔记')
  const clock = entry.videoTime !== null ? `视频 ${formatVideoTime(entry.videoTime)}` : '未保存播放时间'
  const at = entry.at ? new Date(entry.at).toLocaleString('zh-CN') : '时间未知'
  row.append(element('p', 'library-entry-meta', `${options.context ? '上下文 · ' : ''}${type} · ${clock} · ${at}`))
  for (const field of ['source', 'target', 'text'] as const) {
    if (!entry[field]) continue
    const content = element('p', `library-${field}`)
    content.append(element('span', 'library-field-label', {source:'原文',target:'译文',text:'笔记'}[field]))
    appendHighlight(content, entry[field], options.highlights?.[field])
    row.append(content)
  }
  if (!entry.source && !entry.target && !entry.text) row.append(element('p', '', '此条目仅含图片或附件，文字正文为空。可从笔记历史导出附件。'))
  const actions = element('div', 'library-actions')
  actions.append(createFavoriteButton(entry.ref, notify))
  const source = button('查看来源', 'source', () => {
    source.disabled = true
    void openEntrySource(entry.ref).then(notify).catch(error => notify(String(error))).finally(() => { source.disabled = false })
  })
  source.disabled = !entry.sourceRef.url
  source.title = entry.sourceRef.confidence === 'exact' ? '核验来源后跳转；不能定位时打开来源' : '来源课节未核验，仅打开来源页面'
  actions.append(source)
  if (options.neighbors !== false) {
    const contextArea = element('div', 'library-context'); contextArea.hidden = true
    const context = button('查看上下文', 'context', async () => {
      if (!contextArea.hidden) { contextArea.hidden = true; context.textContent = '查看上下文'; return }
      context.disabled = true; contextArea.hidden = false; contextArea.textContent = '正在读取上下文…'
      try {
        const response = await libraryRequest('LIBRARY_CONTEXT', { ref: entry.ref }); requireSuccess(response)
        contextArea.textContent = ''
        contextArea.append(element('p', 'section-desc', '前后相邻文字仅用于理解上下文，收藏按钮分别对应各自条目。'))
        for (const neighbor of response.before as LibraryEntry[]) contextArea.append(renderEntry(neighbor, notify, { context: true, neighbors: false }))
        contextArea.append(renderEntry(response.entry as LibraryEntry, notify, { neighbors: false }))
        for (const neighbor of response.after as LibraryEntry[]) contextArea.append(renderEntry(neighbor, notify, { context: true, neighbors: false }))
        context.textContent = '收起上下文'
      } catch (error) { contextArea.textContent = `上下文读取失败：${String(error)}`; context.textContent = '重试上下文' }
      finally { context.disabled = false }
    })
    actions.append(context); row.append(actions, contextArea)
  } else row.append(actions)
  return row
}
export function groupKey(hit: LibraryHit): string {
  return hit.sourceRef.confidence === 'exact' ? hit.sourceRef.key : hit.ref.kind === 'transcript' ? `record:${hit.ref.recordId}` : `note:${hit.ref.noteId}`
}
interface GroupView { source: SourceRef; hits: LibraryHit[]; list: HTMLElement; count: HTMLElement; more: HTMLButtonElement; shown: number; limit: number }
/** Append only new results; per-group DOM batches never restrict accumulated hits. */
export function createResultRenderer(container: HTMLElement, notify: (message: string) => void) {
  const groups = new Map<string, GroupView>()
  const favorites = favoriteState()
  function paint(group: GroupView): void {
    const end = Math.min(group.hits.length, group.limit)
    for (; group.shown < end; group.shown++) {
      const hit = group.hits[group.shown]!
      group.list.append(renderEntry(hit, notify, { highlights: hit.highlights }))
    }
    group.count.textContent = `${group.hits.length} 条匹配`
    group.more.hidden = group.shown >= group.hits.length
    group.more.textContent = group.limit === 3 ? `展开全部（${group.hits.length} 条）` : `显示更多（剩余 ${group.hits.length - group.shown} 条）`
  }
  function update(state: QueryState, added: LibraryHit[], reset: boolean): void {
    if (reset) { groups.clear(); container.textContent = '' }
    const touched = new Set<GroupView>()
    for (const hit of added) {
      const key = groupKey(hit)
      let group = groups.get(key)
      if (!group) {
        const section = element('section', 'library-group'); section.dataset.group = key
        const head = element('div', 'library-group-heading')
        const heading = element('h3', '', hit.sourceRef.title || hit.title || '未命名资料')
        const count = element('span', 'section-badge')
        head.append(heading, count)
        const list = element('div', 'library-group-entries')
        const more = button('', 'more', () => { group!.limit = group!.limit === 3 ? 53 : group!.limit + 50; paint(group!) })
        group = { source: hit.sourceRef, hits: [], list, count, more, shown: 0, limit: 3 }
        section.append(head, element('p', 'library-provenance', hit.sourceRef.confidence === 'exact' ? '已核验课节来源' : hit.ref.kind === 'transcript' ? '来源未核验 · 按原转写记录区分' : '来源未核验 · 按原笔记区分'), list, more)
        container.append(section); groups.set(key, group)
      }
      group.hits.push(hit); touched.add(group)
    }
    for (const group of touched) paint(group)
    container.setAttribute('aria-busy', String(state.status === 'searching'))
    // Snapshot membership is retained until refresh, even after unfavoriting.
    container.dataset.total = String(state.hits.size)
  }
  return { update, refreshFavorites: () => favorites.refresh() }
}
