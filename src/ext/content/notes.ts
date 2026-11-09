/**
 * Notes: active-note lifecycle, persistence, and the drawer list.
 *
 * Notes are local to the content surface but persisted through the shared
 * store so the side panel and the page never diverge.
 */

import type { NoteDocument, NoteEntry } from '../../lib/types'
import { createNoteDocument, saveNotes } from './notes-store'
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

  function persistNotes() {
    saveNotes(deps.getSession().notes)
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
    persistNotes()
    return note
  }

  function addEntry(entry: NoteEntry) {
    const note = getOrCreateActiveNote()
    note.entries.push(entry)
    note.updatedAt = Date.now()
    persistNotes()
    render()
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
    const hasEntries = !!(active && active.entries.length > 0)
    if (!hasEntries) {
      const empty = document.createElement('p')
      empty.id = 'rtts-notes-empty'
      empty.textContent = '还没有笔记，点击右侧的「记入笔记」开始记录。'
      r.list.appendChild(empty)
    }
    if (!hasEntries || !active) return

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
        img.addEventListener('click', () => deps.openShotPreview(entry.imageUrl!, true, true))
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
      delBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        active.entries = active.entries.filter((candidate) => candidate.id !== entry.id)
        persistNotes()
        render()
      })
      row.appendChild(delBtn)

      item.appendChild(row)
      r.list.appendChild(item)
    })

    // Newest entry is at the bottom; keep it in view after adding.
    r.list.scrollTop = r.list.scrollHeight
  }

  return { addEntry, render, persistNotes }
}
