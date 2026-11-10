/**
 * Notes: active-note lifecycle, persistence, and the drawer list.
 *
 * Notes are local to the content surface but persisted through the shared
 * store so the side panel and the page never diverge.
 */

import type { NoteDocument, NoteEntry } from '../../lib/types'
import { createNoteDocument, addNoteEntry, deleteNoteEntry, loadNotes, hasRetainedLegacyNotes, exportRetainedLegacyNotes } from './notes-store'
import { renderMarkdownLite } from './markdown'
import { seekTo } from './video-seek'
import type { SessionState } from './types'

export interface NotesRefs {
  count: HTMLElement
  badge: HTMLElement
  button: HTMLElement
  list: HTMLElement
}

export interface NotesDeps {
  refs: NotesRefs
  getSession: () => SessionState
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  openShotPreview: (url: string, saved: boolean, insertable?: boolean) => void
}

export function createNotes(deps: NotesDeps) {
  const r = deps.refs

  // ADR-037: summaries and notes render `[mm:ss]` stamps as buttons (ADR-036
  // renderer); clicking one seeks the video the same way chat does.
  r.list.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest?.('.chat-time-ref') as HTMLElement | null
    if (!target) return
    const seconds = Number(target.dataset.t)
    if (Number.isFinite(seconds)) seekTo(seconds)
  })

  let loadError = ''
  function setLoadError(error: unknown): void { loadError = String(error); render() }
  const pending = new Map<string, { note: NoteDocument; entry: NoteEntry; error: string }>()
  const saving = new Map<string, Promise<boolean>>()
  function adopt(notes: NoteDocument[]): void {
    loadError = ''
    const merged = structuredClone(notes)
    for (const item of pending.values()) {
      let note = merged.find(n => n.id === item.note.id)
      if (!note) { note = { ...item.note, entries: [] }; merged.push(note) }
      if (!note.entries.some(e => e.id === item.entry.id)) note.entries.push(item.entry)
    }
    const session = deps.getSession()
    session.notes = merged
    if (!merged.some(n => n.id === session.activeNoteId)) session.activeNoteId = merged[0]?.id ?? null
    render()
  }
  function persistEntry(key: string): Promise<boolean> {
    const current = saving.get(key)
    if (current) return current
    const item = pending.get(key)
    if (!item) return Promise.resolve(true)
    const run = addNoteEntry(item.note, item.entry).then(notes => {
      pending.delete(key)
      adopt(notes)
      return true
    }).catch(error => {
      item.error = error.message || String(error)
      deps.toast('有笔记未保存，请在笔记中重试或导出', 'err')
      render()
      return false
    }).finally(() => saving.delete(key))
    saving.set(key, run)
    return run
  }

  function getOrCreateActiveNote(): NoteDocument {
    const session = deps.getSession()
    if (session.activeNoteId) {
      const existing = session.notes.find((note) => note.id === session.activeNoteId)
      if (existing) return existing
    }
    const note = createNoteDocument(
      `翻译笔记 ${new Date().toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      { source: 'translate' },
    )
    session.notes.push(note)
    session.activeNoteId = note.id
    return note
  }

  function addEntry(entry: NoteEntry): Promise<boolean> {
    const note = getOrCreateActiveNote()
    const key = `${note.id}:${entry.id}`
    if (!note.entries.some(e => e.id === entry.id)) note.entries.push(entry)
    pending.set(key, { note, entry, error: '' })
    note.updatedAt = Date.now()
    render()
    return persistEntry(key)
  }

  function render() {
    const session = deps.getSession()
    const active = session.activeNoteId
      ? session.notes.find((note) => note.id === session.activeNoteId)
      : null

    const count = active?.entries.length ?? 0
    r.count.textContent = String(count)
    r.button.setAttribute('data-tip', `笔记${count ? `（${count}）` : ''}`)
    r.badge.textContent = count > 99 ? '99+' : String(count)
    r.badge.hidden = count === 0

    r.list.textContent = ''
    if (hasRetainedLegacyNotes()) {
      const legacyWarning = document.createElement('p')
      legacyWarning.setAttribute('role', 'status')
      legacyWarning.textContent = '此页的旧版笔记尚未确认合并，原副本已保留。请导出旧副本；检索只包含已保存资料。'
      const exportLegacy = document.createElement('button')
      exportLegacy.textContent = '导出旧版副本'
      exportLegacy.className = 'rtts-btn-ghost'
      exportLegacy.addEventListener('click', exportRetainedLegacyNotes)
      legacyWarning.appendChild(exportLegacy)
      r.list.appendChild(legacyWarning)
    }
    if (loadError) {
      const error = document.createElement('p')
      error.textContent = `笔记读取失败：${loadError}`
      const retry = document.createElement('button')
      retry.textContent = '重试读取'
      retry.className = 'rtts-btn-ghost'
      retry.addEventListener('click', () => { void loadNotes().then(adopt).catch(setLoadError) })
      error.appendChild(retry)
      r.list.appendChild(error)
    }
    const hasEntries = !!(active && active.entries.length > 0)
    if (!hasEntries && !loadError) {
      const empty = document.createElement('p')
      empty.id = 'rtts-notes-empty'
      empty.textContent = '还没有笔记，点击右侧的「记入笔记」开始记录。'
      r.list.appendChild(empty)
    }
    if (!hasEntries || !active) return

    if (pending.size) {
      const status = document.createElement('p')
      const cause = [...pending.values()].find(item => item.error)?.error
      status.textContent = `有 ${pending.size} 条笔记未保存，请重试或导出。${cause ? `原因：${cause}。` : ''}关闭页面可能丢失未保存内容。`
      const retry = document.createElement('button')
      retry.textContent = '重试保存'
      retry.className = 'rtts-btn-ghost'
      retry.addEventListener('click', () => { for (const key of pending.keys()) void persistEntry(key) })
      const exportBtn = document.createElement('button')
      exportBtn.textContent = '导出未保存笔记'
      exportBtn.className = 'rtts-btn-ghost'
      exportBtn.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify([...pending.values()].map(p => ({ ...p.note, entries: [p.entry] })), null, 2)], { type: 'application/json' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'snooper-unsaved-notes.json'
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      })
      status.setAttribute('role', 'status')
      const actions = document.createElement('div')
      actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px'
      actions.append(retry, exportBtn)
      status.appendChild(actions)
      r.list.appendChild(status)
    }
    active.entries.slice(-10).forEach((entry) => {
      const item = document.createElement('div')
      item.className = 'note-item'
      if (entry.type === 'image' || entry.type === 'svg' || entry.type === 'screenshot') {
        item.style.flexDirection = 'column'
        item.style.gap = '4px'
      }

      if ((entry.type === 'image' || entry.type === 'screenshot') && entry.imageUrl) {
        const img = document.createElement('img')
        img.src = entry.imageUrl
        img.className = 'note-img-preview'
        img.alt = '笔记图片'
        img.style.cssText = 'max-width:100%;max-height:80px;border-radius:4px;object-fit:cover;cursor:pointer'
        img.addEventListener('click', () => deps.openShotPreview(entry.imageUrl!, !pending.has(`${active.id}:${entry.id}`), true))
        item.appendChild(img)
      }

      if (entry.type === 'svg' && entry.svg) {
        const svgPreview = document.createElement('div')
        svgPreview.style.cssText = 'max-width:100%;max-height:60px;overflow:hidden;border-radius:4px'
        try {
          const parsed = new DOMParser().parseFromString(entry.svg, 'image/svg+xml')
          const svgEl = parsed.querySelector('svg')
          if (svgEl) {
            svgEl.setAttribute('width', '100%')
            svgPreview.appendChild(svgEl)
          }
        } catch {
          svgPreview.textContent = 'SVG 预览不可用'
        }
        item.appendChild(svgPreview)
      }

      const row = document.createElement('div')
      row.style.cssText = 'display:flex;align-items:flex-start;gap:4px;width:100%'

      const text = document.createElement('span')
      const content = entry.text || entry.target || entry.source || '笔记'
      if (entry.type === 'text' || entry.type === 'summary') {
        // Notes are Markdown: render the same safe subset the composer uses
        // instead of showing raw asterisks and backticks. Summaries are
        // Markdown documents (ADR-037), so they render the same way.
        text.className = 'note-text note-md'
        text.innerHTML = renderMarkdownLite(content)
      } else {
        text.className = 'note-text truncated'
        text.textContent = content
      }
      row.appendChild(text)

      const typeLabel = document.createElement('span')
      typeLabel.className = 'note-type'
      const typeMap: Record<string, string> = {
        subtitle: '字幕',
        image: '配图',
        svg: '矢量',
        screenshot: '截图',
        text: '文本',
        summary: '摘要',
      }
      typeLabel.textContent = typeMap[entry.type] || '笔记'
      row.appendChild(typeLabel)

      const delBtn = document.createElement('button')
      delBtn.className = 'note-del'
      delBtn.setAttribute('aria-label', '删除笔记条目')
      delBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      delBtn.addEventListener('click', async (event) => {
        event.stopPropagation()
        try {
          const notes = await deleteNoteEntry(active.id, entry.id)
          pending.delete(`${active.id}:${entry.id}`)
          adopt(notes)
        } catch (error) { deps.toast(`删除失败，请重试：${String(error)}`, 'err') }
      })
      row.appendChild(delBtn)

      item.appendChild(row)
      r.list.appendChild(item)
    })

    // Newest entry is at the bottom; keep it in view after adding.
    r.list.scrollTop = r.list.scrollHeight
  }

  return { addEntry, render, adopt, setLoadError }
}
