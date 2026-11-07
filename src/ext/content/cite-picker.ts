/**
 * Screenshot picker for the chat composer ("cite" a saved note image).
 *
 * Anchored above the composer shell rather than at a fixed offset, because
 * the composer grows as the editor wraps or attachments are added.
 */

import type { NoteDocument } from '../../lib/types'

export interface CiteRefs {
  button: HTMLButtonElement
  popover: HTMLElement
  list: HTMLElement
  empty: HTMLElement
  close: HTMLButtonElement
  editor: HTMLElement
  shadow: ShadowRoot
}

export interface CiteDeps {
  refs: CiteRefs
  getNotes: () => NoteDocument[]
  hasImage: (url: string) => boolean
  addImage: (url: string) => 'ok' | 'duplicate' | 'full'
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
}

export function createCitePicker(deps: CiteDeps) {
  const r = deps.refs

  function candidates(): Array<{ url: string; label: string }> {
    const seen = new Set<string>()
    const out: Array<{ url: string; label: string }> = []
    const notes = [...deps.getNotes()].sort((a, b) => b.updatedAt - a.updatedAt)
    for (const note of notes) {
      for (let i = note.entries.length - 1; i >= 0; i--) {
        const entry = note.entries[i]!
        if (entry.type !== 'screenshot' && entry.type !== 'image') continue
        if (!entry.imageUrl || seen.has(entry.imageUrl)) continue
        seen.add(entry.imageUrl)
        const time = new Date(entry.at).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
        })
        out.push({
          url: entry.imageUrl,
          label: `${entry.type === 'screenshot' ? '截图' : '图片'} · ${time}`,
        })
      }
    }
    return out.slice(0, 24)
  }

  function renderList() {
    const items = candidates()
    r.list.textContent = ''
    r.empty.hidden = items.length > 0

    for (const candidate of items) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'rtts-cite-item'
      if (deps.hasImage(candidate.url)) item.classList.add('used')
      item.setAttribute('aria-label', `引用${candidate.label}`)

      const img = document.createElement('img')
      img.src = candidate.url
      img.alt = candidate.label
      item.appendChild(img)

      const caption = document.createElement('span')
      caption.textContent = candidate.label
      item.appendChild(caption)

      item.addEventListener('click', () => {
        const outcome = deps.addImage(candidate.url)
        if (outcome === 'duplicate') {
          deps.toast('这张截图已经引用了', 'ok')
          return
        }
        if (outcome === 'full') {
          deps.toast('最多引用 4 张图片', 'err')
          return
        }
        position()
        item.classList.add('used')
        deps.toast('已引用截图，可以继续提问', 'ok')
      })

      r.list.appendChild(item)
    }
  }

  function position() {
    const composer = r.popover.parentElement
    const shell = composer?.querySelector<HTMLElement>('.rtts-md-shell')
    if (!composer || !shell) return
    const shellTop = shell.getBoundingClientRect().top
    const gap = 6
    const top = Math.max(8, shellTop - gap)
    r.popover.style.bottom = `${Math.max(8, composer.getBoundingClientRect().bottom - top)}px`
    r.popover.style.maxHeight = `${Math.max(140, top - 12)}px`
  }

  function setOpen(open: boolean) {
    if (open) renderList()
    // Never strand focus on a node that is about to become hidden.
    if (!open && r.popover.contains(r.shadow.activeElement)) r.button.focus()
    r.popover.hidden = !open
    r.button.setAttribute('aria-expanded', String(open))
    r.button.classList.toggle('active', open)
    if (open) {
      position()
      const first = r.list.querySelector<HTMLButtonElement>('.rtts-cite-item')
      first?.focus()
    }
  }

  // Keep it anchored while the drawer resizes or the editor grows.
  window.addEventListener('resize', () => {
    if (!r.popover.hidden) position()
  })
  r.editor.addEventListener('input', () => {
    if (!r.popover.hidden) position()
  })

  r.button.addEventListener('click', (event) => {
    event.stopPropagation()
    setOpen(r.popover.hidden !== false)
  })
  r.close.addEventListener('click', () => {
    setOpen(false)
    r.editor.focus()
  })
  document.addEventListener('click', (event) => {
    if (r.popover.hidden) return
    if (event.composedPath().includes(r.popover) || event.composedPath().includes(r.button)) return
    setOpen(false)
  })

  return { setOpen, position }
}
