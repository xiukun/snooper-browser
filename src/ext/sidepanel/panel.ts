import { mountLibraryPanel } from './library-panel'
import { renderEntry } from './library-render'
import { disposeFavoriteControls, favoriteState } from '../content/favorite-control'
import { legacySourceRef } from '../../lib/video-key'
import { confirmLibraryDelete } from '../content/library-client'
import type { SourceRef } from '../../lib/knowledge-types'
import type { NoteDocument } from '../../lib/types'
import { loadNotes, deleteNoteDocuments, hasRetainedLegacyNotes, exportRetainedLegacyNotes } from '../content/notes-store'
/**
 * snooper-browser Side Panel — notes history + Obsidian integration.
 *
 * Provider / key configuration lives in the in-page settings modal. This panel
 * opens it on the active tab without requiring the toolbar to be visible first.
 */

import { injectContentScriptFresh, sendToPageWithInjection } from '../action-flow'
import { buildZip, collectAssets, decodeExportAsset } from '../../lib/export-assets'
import { formatVideoTime } from '../../lib/video-clock'
import { videoDeepLink } from '../../lib/deep-link'

(() => {
  /* ===== Types ===== */
  interface ObsidianConfig {
    enabled: boolean
    vaultPath: string
    apiProtocol: 'http' | 'https'
    apiPort: number
    apiKey: string
    noteFolder: string
  }

  interface HistorySubtitle {
    id: string
    kind?: 'screen'
    sourceRef?: SourceRef
    at?: number
    endedAt?: number | null
    /** Video-timeline position in seconds (ADR-033). */
    videoTime?: number | null
    source: string
    target: string
    latency?: number
  }

  interface HistoryEntry {
    id: string
    pageTitle: string
    url: string
    startedAt: number
    endedAt: number | null
    sourceLang: string
    targetLang: string
    subtitleCount: number
    status: 'recording' | 'completed'
    lastAt: number
  }

  const DEFAULT_OBSIDIAN: ObsidianConfig = {
    enabled: false,
    vaultPath: '',
    apiProtocol: 'http',
    apiPort: 27123,
    apiKey: '',
    noteFolder: 'snooper-notes',
  }

  /* ===== Persistence ===== */
  const OBSIDIAN_KEY = 'snooper.obsidian-config.v1'

  function normalizeObsidianConfig(raw: any): ObsidianConfig {
    const r = raw && typeof raw === 'object' ? raw : {}
    const port = Number(r.apiPort) || DEFAULT_OBSIDIAN.apiPort
    const protocol: 'http' | 'https' =
      r.apiProtocol === 'https' || r.apiProtocol === 'http'
        ? r.apiProtocol
        : port === 27124 ? 'https' : 'http'
    return {
      enabled: !!r.enabled,
      vaultPath: typeof r.vaultPath === 'string' ? r.vaultPath : '',
      apiProtocol: protocol,
      apiPort: port,
      // Users copy the plugin's "Bearer <token>" line; store only the token.
      apiKey: typeof r.apiKey === 'string'
        ? r.apiKey.trim().replace(/^Bearer\s+/i, '').trim()
        : '',
      noteFolder: typeof r.noteFolder === 'string' && r.noteFolder.trim()
        ? r.noteFolder.trim()
        : DEFAULT_OBSIDIAN.noteFolder,
    }
  }

  async function loadObsidianConfig(): Promise<ObsidianConfig> {
    // 1. Shared store (in-page + side panel)
    try {
      const got = await chrome.storage.local.get(OBSIDIAN_KEY)
      const stored = got?.[OBSIDIAN_KEY]
      if (stored && typeof stored === 'object') return normalizeObsidianConfig(stored)
    } catch { /* ignore */ }
    // 2. Legacy panel localStorage -> migrate to shared store
    try {
      const raw = localStorage.getItem(OBSIDIAN_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        const config = normalizeObsidianConfig(parsed)
        try { await chrome.storage.local.set({ [OBSIDIAN_KEY]: config }) } catch { /* ignore */ }
        return config
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_OBSIDIAN }
  }

  async function saveObsidianConfig(config: ObsidianConfig) {
    const normalized = normalizeObsidianConfig(config)
    try { await chrome.storage.local.set({ [OBSIDIAN_KEY]: normalized }) } catch { /* ignore */ }
    try { localStorage.setItem(OBSIDIAN_KEY, JSON.stringify(normalized)) } catch { /* ignore */ }
  }

  let obsidianCfg: ObsidianConfig = { ...DEFAULT_OBSIDIAN }
  let notes: NoteDocument[] = []
  let noteAssetNames = new Map<string, string>()

  /* ===== DOM refs ===== */
  const noticeBanner = document.getElementById('noticeBanner')!
  const tabNotes = document.getElementById('tab-notes')!
  const tabObsidian = document.getElementById('tab-obsidian')!
  const tabHistory = document.getElementById('tab-history')!
  const notesList = document.getElementById('notes-list')!
  const notesRefreshBtn = document.getElementById('notes-refresh-btn')!
  const notesSelectAll = document.getElementById('notes-select-all') as HTMLInputElement
  const notesDeleteSelected = document.getElementById('notes-delete-selected') as HTMLButtonElement
  const openPageConfigBtn = document.getElementById('open-page-config') as HTMLButtonElement | null

  const obsidianEnabled = document.getElementById('obsidian-enabled') as HTMLInputElement
  const obsidianProtocol = document.getElementById('obsidian-protocol') as HTMLSelectElement
  const obsidianPort = document.getElementById('obsidian-port') as HTMLInputElement
  const obsidianFolder = document.getElementById('obsidian-folder') as HTMLInputElement
  const obsidianKey = document.getElementById('obsidian-key') as HTMLInputElement
  const obsidianTest = document.getElementById('obsidian-test') as HTMLButtonElement
  const obsidianTestStatus = document.getElementById('obsidian-test-status')!
  const saveConfigBtn = document.getElementById('saveConfigBtn')!

  const historyList = document.getElementById('history-list')!
  const historyEmpty = document.getElementById('history-empty')!
  const historyCount = document.getElementById('history-count')!
  const historySelectAll = document.getElementById('history-select-all') as HTMLInputElement
  const historyDeleteSelected = document.getElementById('history-delete-selected') as HTMLButtonElement
  const historyClear = document.getElementById('history-clear') as HTMLButtonElement

  /* ===== Utilities ===== */
  function showNotice(text: string, isError = false) {
    noticeBanner.textContent = text
    noticeBanner.className = `notice-banner ${isError ? 'error' : 'success'}`
    noticeBanner.hidden = false
    setTimeout(() => { noticeBanner.hidden = true }, 4000)
  }

  /* ===== Tabs ===== */
  function switchTab(tab: string) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.remove('active')
      btn.setAttribute('aria-selected', 'false')
    })
    document.querySelectorAll('.tab-content').forEach((content) => content.classList.remove('active'))
    const nextTab = document.getElementById(`tab-${tab}`)
    nextTab?.classList.add('active')
    nextTab?.setAttribute('aria-selected', 'true')
    document.getElementById(`panel-${tab}`)?.classList.add('active')
    document.querySelector<HTMLElement>('.panel-footer')!.hidden = tab !== 'obsidian'
    if (tab === 'search') library.activate()
    if (tab === 'notes') void loadAndRenderNotes()
    if (tab === 'history') void loadAndRenderHistory()
  }

  const library = mountLibraryPanel(switchTab)
  document.getElementById('tab-search')!.addEventListener('click', () => switchTab('search'))
  tabNotes.addEventListener('click', () => switchTab('notes'))
  tabObsidian.addEventListener('click', () => switchTab('obsidian'))
  tabHistory.addEventListener('click', () => switchTab('history'))

  /* ===== Open the in-page settings modal ===== */
  openPageConfigBtn?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('没有活动标签页')
      await sendToPageWithInjection(tab.id, { type: 'OPEN_PAGE_SETTINGS' }, tab.url, {
        sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
        injectContentScript: injectContentScriptFresh,
      })
      showNotice('已打开页面配置')
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '打开配置失败，请重试。', true)
    }
  })

  /* ===== Notes ===== */
  function getSelectedNoteIds(): string[] {
    return Array.from(notesList.querySelectorAll<HTMLInputElement>('input.note-check:checked'))
      .map((el) => el.dataset.id || '').filter(Boolean)
  }

  function updateNoteSelection() {
    const all = Array.from(notesList.querySelectorAll<HTMLInputElement>('input.note-check'))
    const selected = all.filter((el) => el.checked)
    notesDeleteSelected.disabled = selected.length === 0
    notesDeleteSelected.textContent = selected.length > 0 ? `删除所选 (${selected.length})` : '删除所选'
    notesSelectAll.checked = all.length > 0 && selected.length === all.length
    notesSelectAll.indeterminate = selected.length > 0 && selected.length < all.length
    notesSelectAll.disabled = all.length === 0
  }

  const saveFailures = document.createElement('div')
  saveFailures.setAttribute('role', 'status')
  notesList.before(saveFailures)
  async function renderSaveFailures(): Promise<void> {
    try {
      const result = await chrome.runtime.sendMessage({ target: 'background', type: 'GET_SAVE_FAILURES' })
      if (!result?.ok) return
      saveFailures.textContent = ''
      for (const failure of result.failures || []) {
        const item = document.createElement('p')
        item.className = 'empty-hint'
        item.textContent = `有内容未保存（${failure.pendingCount} 条待保存）：${failure.saveState.message}`
        const retry = document.createElement('button')
        retry.textContent = '重试保存'
        retry.className = 'btn btn-sm btn-secondary'
        retry.addEventListener('click', async () => {
          retry.disabled = true
          try {
            const res = await chrome.runtime.sendMessage({ target: 'background', type: 'RETRY_TRANSCRIPT', tabId: failure.tabId })
            if (!res?.ok) showNotice(res?.error || '保存失败，请导出')
          } catch (error) { showNotice(`保存失败：${String(error)}`) }
          await renderSaveFailures()
        })
        const exportBtn = document.createElement('button')
        exportBtn.textContent = '导出可用内容'
        exportBtn.className = 'btn btn-sm btn-secondary'
        exportBtn.addEventListener('click', async () => {
          try {
            const res = await chrome.runtime.sendMessage({ target: 'background', type: 'GET_TRANSCRIPT', tabId: failure.tabId })
            const lines = Array.isArray(res?.subtitles) ? res.subtitles : []
            if (!lines.length) { showNotice(res?.error || '暂无可导出内容，请重试读取'); return }
            const text = lines.map((line: HistorySubtitle) => `${line.source}\n${line.target}`).join('\n\n')
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
            const a = document.createElement('a')
            a.href = url
            a.download = 'snooper-unsaved-transcript.txt'
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 2000)
            showNotice(res.complete ? '已导出当前转写（含未保存内容）' : '仅导出可用内容，部分正文读取失败')
          } catch (error) { showNotice(`导出失败：${String(error)}`) }
        })
        item.style.overflowWrap = 'anywhere'
        const actions = document.createElement('div')
        actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px'
        actions.append(retry, exportBtn)
        item.appendChild(actions)
        saveFailures.appendChild(item)
      }
    } catch (error) { showNotice(`保存状态读取失败：${String(error)}`) }
  }

  const legacyWarning = document.createElement('p')
  notesList.before(legacyWarning)
  function renderLegacyWarning(): void {
    legacyWarning.textContent = ''
    legacyWarning.hidden = !hasRetainedLegacyNotes()
    if (hasRetainedLegacyNotes()) {
      legacyWarning.className = 'empty-hint'
      legacyWarning.setAttribute('role', 'status')
      legacyWarning.textContent = '侧栏旧版笔记尚未确认合并，原副本已保留。请导出旧副本；检索只包含已保存资料。'
      const exportLegacy = document.createElement('button')
      exportLegacy.textContent = '导出旧版副本'
      exportLegacy.className = 'btn btn-sm btn-secondary'
      exportLegacy.addEventListener('click', exportRetainedLegacyNotes)
      legacyWarning.appendChild(exportLegacy)
    }
  }

  async function loadAndRenderNotes() {
    await renderSaveFailures()
    try { notes = await loadNotes() }
    catch (error) { showNotice(`笔记读取失败，请点刷新重试：${String(error)}`); return }
    finally { renderLegacyWarning() }

    disposeFavoriteControls(notesList)
    notesList.textContent = ''
    if (notes.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'empty-hint'
      empty.textContent = '暂无笔记。在页面浮层点击「记笔记」或「生成配图」即可添加。'
      notesList.appendChild(empty)
      updateNoteSelection()
      return
    }

    const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
    sorted.forEach((note) => {
      const card = document.createElement('div')
      card.className = 'note-card'

      const header = document.createElement('div')
      header.className = 'note-card-header'

      const select = document.createElement('input')
      select.type = 'checkbox'
      select.className = 'note-check'
      select.dataset.id = note.id
      select.setAttribute('aria-label', `选择 ${note.title || '笔记'}`)
      select.addEventListener('change', updateNoteSelection)

      const title = document.createElement('span')
      title.className = 'note-card-title'
      title.textContent = note.title || '未命名笔记'

      const count = document.createElement('span')
      count.className = 'note-card-count'
      count.textContent = `${note.entries.length} 条`

      const titleWrap = document.createElement('div')
      titleWrap.className = 'note-card-title-wrap'
      titleWrap.appendChild(select)
      titleWrap.appendChild(title)
      header.appendChild(titleWrap)
      header.appendChild(count)
      card.appendChild(header)

      const meta = document.createElement('div')
      meta.className = 'note-card-meta'
      const date = new Date(note.updatedAt).toLocaleString('zh-CN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
      meta.textContent = `更新于 ${date}`
      card.appendChild(meta)

      if (note.entries.length > 0) {
        const preview = document.createElement('div')
        preview.className = 'note-card-preview'
        const last = note.entries[note.entries.length - 1]
        preview.textContent = last.text || last.target || last.source || '(空)'
        card.appendChild(preview)
      }

      const actions = document.createElement('div')
      actions.className = 'note-card-actions'

      const exportBtn = document.createElement('button')
      exportBtn.type = 'button'
      exportBtn.className = 'btn btn-ghost btn-xs'
      exportBtn.textContent = '导出 Markdown'
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        exportNote(note)
      })
      actions.appendChild(exportBtn)
      const detail = document.createElement('div')
      detail.className = 'note-entry-detail'
      detail.hidden = true
      let shown = 0
      const rows = document.createElement('div')
      const more = document.createElement('button')
      more.type = 'button'; more.className = 'btn btn-sm btn-secondary'; more.dataset.action = 'note-more'
      function paintNotes(): void {
        const end = Math.min(note.entries.length, shown + 50)
        for (; shown < end; shown++) {
          const entry = note.entries[shown]!
          rows.append(renderEntry({
            ref: { kind: 'note', noteId: note.id, entryId: entry.id },
            sourceRef: entry.sourceRef || legacySourceRef(entry.videoUrl || '', note.title, note.id),
            title: note.title, at: entry.at, videoTime: entry.videoTime ?? null,
            source: entry.source || '', target: entry.target || '', text: entry.text || '', type: entry.type,
          }, text => showNotice(text)))
        }
        more.hidden = shown >= note.entries.length
        more.textContent = `显示更多（剩余 ${note.entries.length - shown} 条）`
      }
      more.addEventListener('click', paintNotes); detail.append(rows, more)
      const view = document.createElement('button')
      view.type = 'button'; view.className = 'btn btn-ghost btn-xs'; view.textContent = '查看全部内容'; view.dataset.action = 'note-detail'
      view.addEventListener('click', () => {
        detail.hidden = !detail.hidden; view.textContent = detail.hidden ? '查看全部内容' : '收起内容'
        if (!shown) paintNotes()
      })
      actions.appendChild(view)
      card.appendChild(detail)

      const delBtn = document.createElement('button')
      delBtn.type = 'button'
      delBtn.className = 'icon-btn icon-btn-danger'
      delBtn.setAttribute('aria-label', `删除${note.title || '笔记'}`)
      delBtn.title = '删除笔记'
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>'
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        try {
          const updated = await deleteNoteDocuments([note.id])
          if (!updated) return
          notes = updated
          await loadAndRenderNotes()
          showNotice('笔记已删除')
        } catch (error) { showNotice(`删除失败，请重试：${String(error)}`) }
      })
      actions.appendChild(delBtn)

      card.appendChild(actions)
      notesList.appendChild(card)
    })
    updateNoteSelection()
  }

  function exportNote(note: NoteDocument) {
    // Decode assets FIRST: the Markdown references them by name, so the map
    // must be filled before any line is rendered (a previous version built
    // the text before decoding, so the first export always showed
    // placeholders and only a second export worked).
    const assets = collectAssets([note], []).map((asset) => ({
      ...asset,
      entryId: asset.entryId.replace(/^note:[^:]+:/, `note:${note.id}:`),
    }))
    const decoded: Array<{ name: string; bytes: Uint8Array }> = []
    noteAssetNames = new Map()
    for (const asset of assets) {
      const result = decodeExportAsset(asset)
      if (result) {
        noteAssetNames.set(asset.entryId, asset.fileName)
        decoded.push({ name: `assets/${asset.fileName}`, bytes: result.file.bytes })
      }
    }

    const lines = [
      `# ${note.title}`,
      '',
      `- **创建时间**：${new Date(note.createdAt).toLocaleString('zh-CN')}`,
      `- **条目数**：${note.entries.length}`,
      '',
      '---',
      '',
    ]

    for (const entry of note.entries) {
      const time = new Date(entry.at).toLocaleTimeString('zh-CN')
      switch (entry.type) {
        case 'subtitle': {
          lines.push(`### 字幕 ${time}`)
          if (entry.target) lines.push(`**译文**：${entry.target}`)
          if (entry.source) lines.push(`**原文**：${entry.source}`)
          // ADR-035: deep-link the anchor when the entry carries one.
          const link = entry.sourceRef?.confidence === 'exact' && typeof entry.videoTime === 'number' && Number.isFinite(entry.videoTime)
            ? videoDeepLink(entry.sourceRef.url, entry.videoTime)
            : null
          if (link) lines.push(`**视频锚点**：[\`${formatVideoTime(entry.videoTime!)}\`](${link})`)
          lines.push('')
          break
        }
        case 'text':
          lines.push(`### 笔记 ${time}`)
          lines.push(entry.text || '')
          lines.push('')
          break
        case 'summary':
          // ADR-037: the summary entry is already Markdown; give it a heading
          // so it reads as a document section in Obsidian.
          lines.push(`### 学习纪要 ${time}`)
          lines.push(entry.text || '')
          lines.push('')
          break
        case 'screenshot':
        case 'image': {
          const title = entry.type === 'screenshot' ? '截图' : '配图'
          lines.push(`### ${title} ${time}`)
          lines.push(entry.text || entry.source || title)
          const assetName = noteAssetNames.get(`note:${note.id}:${entry.id}`)
          if (assetName) lines.push(`![](assets/${assetName})`)
          else lines.push(`> [图片：${entry.text || title} — 图片数据未能随导出携带]`)
          lines.push('')
          break
        }
        case 'svg': {
          lines.push(`### SVG ${time}`)
          lines.push(entry.text || entry.source || '')
          const svgName = noteAssetNames.get(`note:${note.id}:${entry.id}`)
          if (svgName) lines.push(`![](assets/${svgName})`)
          else if (entry.svg) lines.push('```svg\n' + entry.svg + '\n```')
          lines.push('')
          break
        }
      }
    }

    lines.push('', '---', '*由 snooper-browser 生成*')
    const markdown = lines.join('\n')

    if (decoded.length === 0) {
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')}.md`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      showNotice('笔记已导出')
      return
    }

    decoded.unshift({ name: 'note.md', bytes: new TextEncoder().encode(markdown) })
    const zipBlob = new Blob([buildZip(decoded) as unknown as BlobPart], { type: 'application/zip' })
    const zipUrl = URL.createObjectURL(zipBlob)
    const zipAnchor = document.createElement('a')
    zipAnchor.href = zipUrl
    zipAnchor.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')}.zip`
    zipAnchor.click()
    setTimeout(() => URL.revokeObjectURL(zipUrl), 2000)
    showNotice(`笔记已导出（ZIP，${decoded.length} 个文件）`)
  }

  notesRefreshBtn.addEventListener('click', loadAndRenderNotes)

  notesSelectAll.addEventListener('change', () => {
    notesList.querySelectorAll<HTMLInputElement>('input.note-check').forEach((el) => { el.checked = notesSelectAll.checked })
    updateNoteSelection()
  })

  notesDeleteSelected.addEventListener('click', async () => {
    const ids = getSelectedNoteIds()
    if (ids.length === 0) return
    try {
      const updated = await deleteNoteDocuments(ids)
      if (!updated) return
      notes = updated
      await loadAndRenderNotes()
      showNotice(`已删除 ${ids.length} 篇笔记`)
    } catch (error) { showNotice(`删除失败，请重试：${String(error)}`) }
  })

  /* ===== History ===== */

  const HISTORY_PAGE_SIZE = 300

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function getSelectedHistoryIds(): string[] {
    return Array.from(historyList.querySelectorAll<HTMLInputElement>('input.history-check:checked'))
      .map((el) => el.dataset.id || '')
      .filter(Boolean)
  }

  function updateHistorySelection() {
    const all = Array.from(historyList.querySelectorAll<HTMLInputElement>('input.history-check'))
    const selectable = all.filter((el) => !el.disabled)
    const selected = selectable.filter((el) => el.checked)
    historyDeleteSelected.disabled = selected.length === 0
    historyDeleteSelected.textContent = selected.length > 0
      ? `删除所选 (${selected.length})`
      : '删除所选'
    historySelectAll.checked = selectable.length > 0 && selected.length === selectable.length
    historySelectAll.indeterminate = selected.length > 0 && selected.length < selectable.length
    historySelectAll.disabled = selectable.length === 0
  }

  async function fetchHistoryTranscript(id: string): Promise<HistorySubtitle[]> {
    const res: any = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'GET_HISTORY_TRANSCRIPT',
      id,
    })
    if (!res?.ok || !Array.isArray(res.subtitles)) throw new Error(res?.error || '正文读取失败，请重试')
    return res.subtitles
  }

  function appendHistoryRows(container: HTMLElement, subtitles: HistorySubtitle[], from: number, to: number, record: HistoryEntry): void {
    for (let index = from; index < to && index < subtitles.length; index++) {
      const line = subtitles[index]!
      container.append(renderEntry({
        ref: { kind: 'transcript', recordId: record.id, lineId: line.id },
        sourceRef: line.sourceRef || legacySourceRef(record.url, record.pageTitle, record.id),
        title: record.pageTitle, at: line.at || 0, videoTime: line.videoTime ?? null,
        source: line.source || '', target: line.target || '', text: '', type: line.kind || 'subtitle',
      }, text => showNotice(text)))
    }
  }

  /**
   * Detail is loaded on demand: GET_HISTORY only returns summaries, and a
   * two-hour transcript can hold thousands of rows (ADR-031).
   */
  function mountHistoryDetail(detail: HTMLElement, item: HistoryEntry) {
    let loaded = false
    let rows: HistorySubtitle[] = []
    let shown = 0

    const list = document.createElement('div')
    list.className = 'history-subtitle-list'
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'btn btn-sm btn-secondary history-more'
    more.hidden = true
    detail.append(list, more)

    function paintNextBatch() {
      const next = Math.min(rows.length, shown + HISTORY_PAGE_SIZE)
      appendHistoryRows(list, rows, shown, next, item)
      shown = next
      const remaining = rows.length - shown
      more.hidden = remaining <= 0
      more.textContent = `显示更多（剩余 ${remaining} 条）`
    }

    more.addEventListener('click', paintNextBatch)

    return async function ensureLoaded(): Promise<void> {
      if (loaded) return
      detail.textContent = '正在读取…'
      try { rows = await fetchHistoryTranscript(item.id) }
      catch (error) { detail.textContent = `读取失败：${String(error)}。收起后重新展开可重试。`; return }
      if (!detail.isConnected) return
      disposeFavoriteControls(detail)
      detail.textContent = ''
      detail.append(list, more)
      loaded = true
      if (rows.length === 0) {
        detail.textContent = '这条记录没有保存字幕正文。'
        return
      }
      paintNextBatch()
    }
  }

  async function loadAndRenderHistory() {
    let res: any
    try { res = await chrome.runtime.sendMessage({ target: 'background', type: 'GET_HISTORY' }) }
    catch (error) { historyEmpty.style.display = 'block'; historyEmpty.textContent = `历史读取失败：${String(error)}。请切换回来重试。`; return }
    if (!res?.ok || !Array.isArray(res.history)) { historyEmpty.style.display = 'block'; historyEmpty.textContent = `历史读取失败：${res?.error || '请切换回来重试'}`; return }
    await favoriteState().refresh()
    const items: HistoryEntry[] = res.history
    historyEmpty.textContent = '还没有历史记录'
    historyCount.textContent = String(items.length)
    disposeFavoriteControls(historyList)
    historyList.textContent = ''

    if (items.length === 0) {
      historyList.style.display = 'none'
      historyEmpty.style.display = 'block'
      updateHistorySelection()
      return
    }
    historyList.style.display = 'flex'
    historyEmpty.style.display = 'none'

    items.forEach((item) => {
      const recording = item.status === 'recording'
      const el = document.createElement('div')
      el.className = 'history-item'

      const check = document.createElement('input')
      check.type = 'checkbox'
      check.className = 'history-check'
      check.dataset.id = item.id
      check.disabled = recording
      check.title = recording ? '正在录制的记录不能删除' : ''
      check.setAttribute('aria-label', `选择 ${item.pageTitle || '记录'}`)
      check.addEventListener('change', updateHistorySelection)
      el.appendChild(check)

      const main = document.createElement('div')
      main.className = 'history-item-main'
      const title = document.createElement('div')
      title.className = 'history-item-title'
      // ADR-036: the title returns to the video. Records without a stored URL
      // (very old versions) keep the plain text.
      if (item.url) {
        title.classList.add('history-item-link')
        title.setAttribute('role', 'link')
        title.tabIndex = 0
        title.title = `打开原视频：${item.pageTitle || ''}`
        const open = async () => {
          try {
            const result = await chrome.runtime.sendMessage({ target: 'background', type: 'LIBRARY_OPEN_SOURCE', recordId: item.id })
            showNotice(result?.ok ? '已打开来源页面' : result?.error || '打开来源失败', !result?.ok)
          } catch (error) { showNotice(`打开来源失败：${String(error)}`, true) }
        }
        title.addEventListener('click', open)
        title.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            open()
          }
        })
      } else {
        title.title = item.pageTitle || ''
      }
      title.textContent = item.pageTitle || '未知页面'
      const meta = document.createElement('div')
      meta.className = 'history-item-meta'
      const parts = [
        formatTime(item.startedAt),
        `${item.subtitleCount || 0} 条字幕`,
        `${item.sourceLang || 'auto'} → ${item.targetLang || 'zh'}`,
      ]
      if (recording) parts.push('录制中')
      meta.textContent = parts.join(' · ')
      main.append(title, meta)
      el.appendChild(main)

      const detail = document.createElement('div')
      detail.className = 'history-item-detail'
      detail.hidden = true
      el.appendChild(detail)

      const actions = document.createElement('div')
      actions.className = 'history-item-actions'

      let ensureDetail: (() => Promise<void>) | null = null
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'btn btn-sm btn-secondary'
      toggle.textContent = '查看内容'
      toggle.addEventListener('click', async () => {
        if (!detail.hidden) {
          detail.hidden = true
          toggle.textContent = '查看内容'
          return
        }
        detail.hidden = false
        toggle.textContent = '收起内容'
        if (!ensureDetail) ensureDetail = mountHistoryDetail(detail, item)
        toggle.disabled = true
        try {
          await ensureDetail()
        } finally {
          toggle.disabled = false
        }
      })
      actions.appendChild(toggle)

      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'btn btn-sm btn-secondary'
      copy.textContent = '复制'
      copy.addEventListener('click', async () => {
        copy.disabled = true
        try {
          const rows = await fetchHistoryTranscript(item.id)
          if (rows.length === 0) {
            showNotice('这条记录没有保存字幕正文，无法复制', true)
            return
          }
          const text = rows.map((subtitle) => `${subtitle.source || ''}\n${subtitle.target || ''}`).join('\n\n')
          const ok = await copyText(text)
          showNotice(ok ? '已复制完整转写内容' : '复制失败，请在浏览器设置中允许剪贴板访问', !ok)
        } catch (error) { showNotice(`复制失败：${String(error)}`, true) } finally {
          copy.disabled = false
        }
      })
      actions.appendChild(copy)

      const exportButton = document.createElement('button')
      exportButton.type = 'button'
      exportButton.className = 'btn btn-sm btn-secondary'
      exportButton.textContent = '导出 Markdown'
      exportButton.addEventListener('click', async () => {
        exportButton.disabled = true
        try {
          const rows = await fetchHistoryTranscript(item.id)
          if (rows.length === 0) {
            showNotice('这条记录没有保存字幕正文，无法导出', true)
            return
          }
          const blob = new Blob([historyMarkdown(item, rows)], { type: 'text/markdown;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `snooper-history-${item.id}.md`
          anchor.click()
          setTimeout(() => URL.revokeObjectURL(url), 2000)
        } catch (error) { showNotice(`导出失败：${String(error)}`, true) } finally {
          exportButton.disabled = false
        }
      })
      actions.appendChild(exportButton)

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'btn btn-sm btn-secondary'
      del.textContent = '删除'
      del.disabled = recording
      del.title = recording ? '正在录制的记录不能删除' : ''
      del.addEventListener('click', async () => {
        try {
          const res = await confirmLibraryDelete({transcriptIds:[item.id]})
          if (!res) return
          if (res.skipped.length) showNotice('正在录制的记录已跳过', true)
          await loadAndRenderHistory()
        } catch (error) { showNotice(`删除未完成：${String(error)}`, true) }
      })
      actions.appendChild(del)
      el.appendChild(actions)

      historyList.appendChild(el)
    })

    updateHistorySelection()
  }

  historySelectAll.addEventListener('change', () => {
    const checked = historySelectAll.checked
    historyList.querySelectorAll<HTMLInputElement>('input.history-check:not(:disabled)').forEach((el) => {
      el.checked = checked
    })
    updateHistorySelection()
  })

  historyDeleteSelected.addEventListener('click', async () => {
    const ids = getSelectedHistoryIds()
    if (ids.length === 0) return
    try {
      const res = await confirmLibraryDelete({transcriptIds:ids})
      if (!res) return
      if (res.skipped.length) showNotice('正在录制的记录已跳过', true)
      await loadAndRenderHistory()
    } catch (error) { showNotice(`删除未完成：${String(error)}`, true) }
  })

  historyClear.addEventListener('click', async () => {
    try {
      const history = await chrome.runtime.sendMessage({target:'background',type:'GET_HISTORY'})
      if (!history?.ok) throw new Error(history?.error || '无法读取历史记录')
      const res = await confirmLibraryDelete({transcriptIds:history.history.map((item: HistoryEntry)=>item.id)})
      if (!res) return
      if (res.skipped.length) showNotice('正在录制的记录已跳过', true)
      await loadAndRenderHistory()
    } catch (error) { showNotice(`删除未完成：${String(error)}`, true) }
  })

  function historyMarkdown(item: HistoryEntry, subtitles: HistorySubtitle[]): string {
    const anchored = subtitles.some(
      (subtitle) => typeof subtitle.videoTime === 'number' && Number.isFinite(subtitle.videoTime),
    )
    const lines = [
      `# ${item.pageTitle || '转写历史'}`,
      '',
      `- **开始**：${formatTime(item.startedAt)}`,
      `- **结束**：${formatTime(item.endedAt ?? item.lastAt)}`,
      `- **语言**：${item.sourceLang || 'auto'} → ${item.targetLang || 'zh'}`,
      `- **字幕条目**：${subtitles.length} 条`,
      '',
      anchored ? '| 视频时间 | 录制时间 | 原文 | 译文 |' : '| 时间 | 原文 | 译文 |',
      anchored ? '| :--- | :--- | :--- | :--- |' : '| :--- | :--- | :--- |',
    ]
    for (const subtitle of subtitles) {
      const wall = subtitle.at ? new Date(subtitle.at).toLocaleTimeString('zh-CN') : ''
      const source = (subtitle.source || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')
      const target = (subtitle.target || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')
      if (anchored) {
        const hasTime = typeof subtitle.videoTime === 'number' && Number.isFinite(subtitle.videoTime)
        const video = hasTime ? formatVideoTime(subtitle.videoTime!) : ''
        // ADR-035: link the timestamp back to the record's own page when the
        // site supports ?t= seeks.
        const link = hasTime && subtitle.sourceRef?.confidence === 'exact' ? videoDeepLink(subtitle.sourceRef.url, subtitle.videoTime!) : null
        lines.push(`| ${link ? `[\`${video}\`](${link})` : video} | ${wall} | ${source} | ${target} |`)
      } else {
        lines.push(`| ${wall} | ${source} | ${target} |`)
      }
    }
    return lines.join('\n')
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      textarea.remove()
      return ok
    }
  }

  /* ===== Obsidian ===== */
  async function renderObsidianConfig() {
    obsidianCfg = await loadObsidianConfig()
    obsidianEnabled.checked = obsidianCfg.enabled
    obsidianProtocol.value = obsidianCfg.apiProtocol
    obsidianPort.value = String(obsidianCfg.apiPort)
    obsidianFolder.value = obsidianCfg.noteFolder
    obsidianKey.value = obsidianCfg.apiKey
    obsidianTestStatus.hidden = true
  }

  async function syncObsidianForm() {
    obsidianCfg.enabled = obsidianEnabled.checked
    obsidianCfg.apiProtocol = obsidianProtocol.value === 'https' ? 'https' : 'http'
    obsidianCfg.apiPort = parseInt(obsidianPort.value, 10) || (obsidianCfg.apiProtocol === 'https' ? 27124 : 27123)
    obsidianCfg.noteFolder = obsidianFolder.value.trim() || 'snooper-notes'
    obsidianCfg.apiKey = obsidianKey.value.trim()
    await saveObsidianConfig(obsidianCfg)
  }

  saveConfigBtn.addEventListener('click', async () => {
    await syncObsidianForm()
    showNotice('Obsidian 设置已保存')
  })

  obsidianTest.addEventListener('click', async () => {
    await syncObsidianForm()
    obsidianTest.disabled = true
    obsidianTestStatus.textContent = '正在测试…'
    obsidianTestStatus.hidden = false
    obsidianTestStatus.className = 'obsidian-test-status'
    try {
      const res: any = await chrome.runtime.sendMessage({
        target: 'background',
        type: 'TEST_OBSIDIAN',
        obsidianConfig: obsidianCfg,
      })
      if (res && res.ok) {
        obsidianCfg.apiProtocol = res.protocol
        obsidianCfg.apiPort = res.port
        await saveObsidianConfig(obsidianCfg)
        obsidianProtocol.value = res.protocol
        obsidianPort.value = String(res.port)
        obsidianTestStatus.textContent = `连接成功（${String(res.protocol).toUpperCase()} ${res.port}），已保存`
        obsidianTestStatus.className = 'obsidian-test-status ok'
      } else {
        obsidianTestStatus.textContent = res?.error || '连接失败，请确认 Obsidian 正在运行且 Local REST API 插件已启用'
        obsidianTestStatus.className = 'obsidian-test-status err'
      }
    } catch (err: any) {
      obsidianTestStatus.textContent = err.message || '通信异常'
      obsidianTestStatus.className = 'obsidian-test-status err'
    } finally {
      obsidianTest.disabled = false
    }
  })

  obsidianProtocol.addEventListener('change', () => {
    const port = parseInt(obsidianPort.value, 10)
    if (!port || port === 27123 || port === 27124) {
      obsidianPort.value = obsidianProtocol.value === 'https' ? '27124' : '27123'
    }
  })

  /* ===== Init ===== */
  void renderObsidianConfig()
  library.activate()
  void loadAndRenderNotes()

  // Keep the note counter fresh when the panel is reopened.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void loadAndRenderNotes()
      if (document.getElementById('panel-search')?.classList.contains('active')) library.activate()
    }
  })
})()
