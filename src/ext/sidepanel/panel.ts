/**
 * snooper-browser Side Panel — notes history + Obsidian integration.
 *
 * Provider / key configuration lives in the in-page settings modal (the ⚙
 * button in the page toolbar). This panel never touches credentials.
 */

(() => {
  /* ===== Types ===== */
  interface NoteEntry {
    id: string
    type: 'subtitle' | 'image' | 'svg' | 'screenshot' | 'text' | 'summary'
    at: number
    source?: string
    target?: string
    imageUrl?: string
    svg?: string
    text?: string
    speaker?: string
    sourceLang?: string
    targetLang?: string
  }

  interface NoteDocument {
    id: string
    title: string
    createdAt: number
    updatedAt: number
    entries: NoteEntry[]
    sessionInfo?: { source: string; mediaName?: string; duration?: number }
  }

  interface ObsidianConfig {
    enabled: boolean
    vaultPath: string
    apiProtocol: 'http' | 'https'
    apiPort: number
    apiKey: string
    noteFolder: string
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
  const NOTES_KEY = 'snooper.notes.v1'
  const OBSIDIAN_KEY = 'snooper.obsidian-config.v1'

  function loadNotes(): Promise<NoteDocument[]> {
    return (async () => {
      // 1. Shared store — same key the in-page drawer writes to
      try {
        const got = await chrome.storage.local.get(NOTES_KEY)
        const stored = got?.[NOTES_KEY]
        if (Array.isArray(stored)) return stored as NoteDocument[]
      } catch { /* ignore */ }
      // 2. Legacy panel localStorage -> migrate into the shared store
      try {
        const raw = localStorage.getItem(NOTES_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed) && parsed.length > 0) {
            try { await chrome.storage.local.set({ [NOTES_KEY]: parsed }) } catch { /* ignore */ }
            return parsed as NoteDocument[]
          }
        }
      } catch { /* ignore */ }
      return []
    })()
  }

  function saveNotes(next: NoteDocument[]) {
    try { chrome.storage.local.set({ [NOTES_KEY]: next }) } catch { /* ignore */ }
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

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
      apiKey: typeof r.apiKey === 'string' ? r.apiKey : '',
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

  /* ===== DOM refs ===== */
  const noticeBanner = document.getElementById('noticeBanner')!
  const tabNotes = document.getElementById('tab-notes')!
  const tabObsidian = document.getElementById('tab-obsidian')!
  const notesList = document.getElementById('notes-list')!
  const notesRefreshBtn = document.getElementById('notes-refresh-btn')!
  const openPageConfigBtn = document.getElementById('open-page-config') as HTMLButtonElement | null

  const obsidianEnabled = document.getElementById('obsidian-enabled') as HTMLInputElement
  const obsidianProtocol = document.getElementById('obsidian-protocol') as HTMLSelectElement
  const obsidianPort = document.getElementById('obsidian-port') as HTMLInputElement
  const obsidianFolder = document.getElementById('obsidian-folder') as HTMLInputElement
  const obsidianKey = document.getElementById('obsidian-key') as HTMLInputElement
  const obsidianTest = document.getElementById('obsidian-test') as HTMLButtonElement
  const obsidianTestStatus = document.getElementById('obsidian-test-status')!
  const saveConfigBtn = document.getElementById('saveConfigBtn')!

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
    if (tab === 'notes') void loadAndRenderNotes()
  }

  tabNotes.addEventListener('click', () => switchTab('notes'))
  tabObsidian.addEventListener('click', () => switchTab('obsidian'))

  /* ===== Open the in-page settings modal ===== */
  openPageConfigBtn?.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error('没有活动标签页')
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PAGE_SETTINGS' })
      showNotice('已打开页面配置')
    } catch {
      showNotice('当前页面没有 snooper 悬浮栏，请刷新页面后点击页面上的 ⚙', true)
    }
  })

  /* ===== Notes ===== */
  async function loadAndRenderNotes() {
    notes = await loadNotes()

    notesList.textContent = ''
    if (notes.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'empty-hint'
      empty.textContent = '暂无笔记。在页面浮层点击「记笔记」或「生成配图」即可添加。'
      notesList.appendChild(empty)
      return
    }

    const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
    sorted.forEach((note) => {
      const card = document.createElement('div')
      card.className = 'note-card'

      const header = document.createElement('div')
      header.className = 'note-card-header'

      const title = document.createElement('span')
      title.className = 'note-card-title'
      title.textContent = note.title || '未命名笔记'

      const count = document.createElement('span')
      count.className = 'note-card-count'
      count.textContent = `${note.entries.length} 条`

      header.appendChild(title)
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

      const delBtn = document.createElement('button')
      delBtn.type = 'button'
      delBtn.className = 'btn btn-danger-ghost btn-xs'
      delBtn.textContent = '删除'
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (confirm('确定删除这篇笔记？')) {
          notes = notes.filter((n) => n.id !== note.id)
          saveNotes(notes)
          void loadAndRenderNotes()
          showNotice('笔记已删除')
        }
      })
      actions.appendChild(delBtn)

      card.appendChild(actions)
      notesList.appendChild(card)
    })
  }

  function exportNote(note: NoteDocument) {
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
        case 'subtitle':
          lines.push(`### 字幕 ${time}`)
          if (entry.target) lines.push(`**译文**：${entry.target}`)
          if (entry.source) lines.push(`**原文**：${entry.source}`)
          lines.push('')
          break
        case 'text':
          lines.push(`### 笔记 ${time}`)
          lines.push(entry.text || '')
          lines.push('')
          break
        case 'screenshot':
          lines.push(`### 截图 ${time}`)
          lines.push(entry.text || '截图')
          if (entry.imageUrl) lines.push(`![](${entry.imageUrl})`)
          lines.push('')
          break
        case 'image':
          lines.push(`### 配图 ${time}`)
          lines.push(entry.text || entry.source || '')
          if (entry.imageUrl) lines.push(`![](${entry.imageUrl})`)
          lines.push('')
          break
        case 'svg':
          lines.push(`### SVG ${time}`)
          lines.push(entry.text || entry.source || '')
          if (entry.svg) lines.push('```svg\n' + entry.svg + '\n```')
          lines.push('')
          break
      }
    }

    lines.push('', '---', '*由 snooper-browser 生成*')

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    showNotice('笔记已导出')
  }

  notesRefreshBtn.addEventListener('click', loadAndRenderNotes)

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
  void loadAndRenderNotes()

  // Keep the note counter fresh when the panel is reopened.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void loadAndRenderNotes()
  })
})()
