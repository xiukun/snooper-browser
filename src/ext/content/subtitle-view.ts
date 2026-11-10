/**
 * Subtitle overlay: history rows, streaming row, auto-idle collapse, sizing,
 * positioning and drag/resize handles.
 */

import { chatRenderSignature } from '../chat-state'
import { renderMarkdownLite } from './markdown'
import { formatVideoTime } from '../../lib/video-clock'
import { isFillerOnly } from '../../lib/asr-guard'
import { sortByStart } from '../../lib/subtitle-order'
import { seekTo } from './video-seek'
import type { StreamingSubtitle } from './types'

const SUB_BOX_SIZE_KEY = 'snooper.subtitle-box-size.v1'
const SUB_BOX_COMPACT_KEY = 'snooper.subtitle-box-compact.v1'
const SUB_BOX_IDLE_MS = 6500

export interface SubtitleViewRefs {
  recordBtn: HTMLElement
  recordLabelEl: HTMLElement
  subBox: HTMLElement
  subHandle: HTMLElement
  subResize: HTMLElement
  subScroll: HTMLElement
  subRows: HTMLElement
  subPlaceholder: HTMLElement
  subStatus: HTMLElement
  subListening: HTMLElement
  streamingRow: HTMLElement
  streamingText: HTMLElement
  streamingSource: HTMLElement
  streamingLabel: HTMLElement
  chatEl: HTMLElement
}

export interface SubtitleViewSession {
  state: string
  isDemoMode: boolean
  subtitles: Array<{ target?: string; source?: string; id?: string; at?: number; videoTime?: number | null }>
  messages?: Array<{ role: string; content: string; images?: string[] }>
  streamingSubtitle?: StreamingSubtitle | null
  audioSilent?: boolean
}

export interface SubtitleViewDeps {
  refs: SubtitleViewRefs
  getSession: () => SubtitleViewSession
  isUiHidden: () => boolean
  applyUiHidden: () => void
  updateLangLabel: () => void
  renderNotes: () => void
  openShotPreview: (dataUrl: string, saved: boolean, insertable?: boolean) => void
}

export function createSubtitleView(deps: SubtitleViewDeps) {
  const r = deps.refs
  let subBoxAutoPosition = true
  let subBoxCompact = false
  let subIdleTimer: number | null = null
  let lastSubtitleSignal = ''
  let lastRowsSignature = ''
  let lastChatSignature: string | null = null
  let streamingScrollRaf = 0
  let dragState: { el: HTMLElement; offsetX: number; offsetY: number } | null = null
  let subResizeState: { pointerId: number; startX: number; startY: number; width: number; height: number } | null = null

  /* ===== Full render ===== */

  function render() {
    const session = deps.getSession()
    const s = session.state
    r.recordBtn.className = 'rtts-btn rtts-record-btn' + (s === 'running' ? ' running' : '')
    const recordLabel = session.isDemoMode
      ? s === 'running' ? '停止演示' : '开始真实转写'
      : s === 'running' ? '停止转写' : s === 'starting' ? '启动中' : '开始转写'
    r.recordBtn.setAttribute('data-tip', recordLabel)
    // The button carries a visible label now, so it must not say
    // "实时字幕" while recording.
    r.recordLabelEl.textContent = session.isDemoMode
      ? (s === 'running' ? '停止演示' : '演示')
      : s === 'running' ? '停止' : s === 'starting' ? '启动中' : '实时字幕'
    r.recordBtn.setAttribute('aria-label', recordLabel)
    deps.updateLangLabel()

    // === Scrollable Subtitle Display (full history) ===
    // ADR-038: segment starts define order. Out-of-order completion must not
    // reorder the gutter (24:28 followed by 24:24 read as broken time).
    const subs = sortByStart(session.subtitles || [])
    const streaming = session.streamingSubtitle
    const last = subs[subs.length - 1]
    const subtitleSignal = `${subs.length}:${last?.id || ''}:${streaming?.at || ''}`
    if (subtitleSignal !== lastSubtitleSignal) {
      lastSubtitleSignal = subtitleSignal
      if (last || streaming) markSubtitleActivity()
    }

    if (!deps.isUiHidden() && (s === 'running' || subs.length > 0 || streaming)) {
      r.subBox.classList.remove('hidden')
      const hasContent = subs.length > 0 || !!streaming
      const silent = s === 'running' && !!session.audioSilent
      r.subStatus.classList.toggle('hidden', !silent)
      r.subPlaceholder.style.display = hasContent || silent ? 'none' : ''
      r.subPlaceholder.textContent = session.isDemoMode
        ? '演示模式启动中…'
        : '正在聆听…'

      // ADR-040: while audio accumulates and the panel already has content,
      // a quiet breathing row replaces the blank gap so "nothing yet" never
      // reads as "frozen". The empty-panel case stays with subPlaceholder,
      // so the two never show together. Demo mode has no real audio.
      const listening = s === 'running'
        && !session.isDemoMode
        && !silent
        && hasContent
        && !streaming
      r.subListening.classList.toggle('hidden', !listening)

      // Stopped with content on screen: keep the last lines readable, but the
      // box must reach an end state — re-arm the idle collapse even though no
      // new subtitle will arrive. Without this the box froze on screen forever
      // when stop happened >6.5s after the last line (timer never armed).
      if (s !== 'running' && s !== 'starting') {
        markSubtitleActivity()
      }

      // Build subtitle rows (show ALL, auto-scroll to bottom)
      // ADR-041: a full rebuild on every session update was the visible
      // jitter — a long transcript was recreated just because the audio
      // silence flag flipped. Rebuild only when the rendered content changed.
      const rowsSignature = subs
        .map((sub) => `${sub.id ?? ''}\u0001${sub.at ?? ''}\u0001${sub.videoTime ?? ''}\u0001${sub.target ?? ''}\u0001${sub.source ?? ''}\u0001${(sub as { kind?: string }).kind ?? ''}`)
        .join('\u0002')
      const rowsChanged = rowsSignature !== lastRowsSignature
      const wasAtBottom = r.subScroll.scrollHeight - r.subScroll.scrollTop - r.subScroll.clientHeight < 40

      if (rowsChanged) {
        lastRowsSignature = rowsSignature
        r.subRows.textContent = ''

        subs.forEach((sub) => {
          const row = document.createElement('div')
          row.className = 'sub-row history'

          const anchored = typeof sub.videoTime === 'number' && Number.isFinite(sub.videoTime) && sub.videoTime >= 0
          if (anchored) {
            // ADR-038: the time lives in its own narrow gutter so a dragged-wide
            // panel cannot split the row into three columns.
            row.classList.add('has-time')
            // The chip is the seek affordance (ADR-034); the text stays
            // selectable, so only the chip handles clicks.
            const chip = document.createElement('button')
            chip.type = 'button'
            chip.className = 'sub-time-chip'
            chip.textContent = formatVideoTime(sub.videoTime!)
            chip.setAttribute('aria-label', `跳转到 ${formatVideoTime(sub.videoTime!)}`)
            chip.title = '点击跳转到视频对应位置'
            const activate = () => {
              const result = seekTo(sub.videoTime!)
              row.classList.remove('seek-ok', 'seek-fail')
              // Force a reflow so the flash restarts on rapid re-clicks.
              void row.offsetWidth
              row.classList.add(result.ok ? 'seek-ok' : 'seek-fail')
            }
            chip.addEventListener('click', (event) => {
              event.stopPropagation()
              activate()
            })
            chip.addEventListener('keydown', (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                activate()
              }
            })
            row.appendChild(chip)
          }

          if (sub.kind === 'screen') {
            row.classList.add('screen')
            const badge = document.createElement('span')
            badge.className = 'sub-screen-badge'
            badge.textContent = '画面'
            badge.title = '来自画面硬字幕，不是语音识别'
            row.appendChild(badge)
          }

          const trans = document.createElement('div')
          trans.className = 'sub-trans'
          trans.textContent = sub.target || '...'
          row.appendChild(trans)

          if (sub.source) {
            const src = document.createElement('div')
            src.className = 'sub-source'
            src.textContent = sub.source
            row.appendChild(src)
          }

          // ADR-039: filler-only lines remain in the transcript but are dimmed
          // on the overlay so they do not compete with content.
          if (isFillerOnly(sub.target || sub.source || '')) {
            row.classList.add('filler')
          }

          r.subRows.appendChild(row)
        })

        // Highlight the latest entry without dropping the layout classes
        // (ADR-038: the old className overwrite was why the last row's chip
        // jumped above the text).
        const lastRow = r.subRows.lastElementChild
        if (lastRow) lastRow.classList.add('current')
      }

      // Render streaming row (if active)
      if (streaming) {
        renderStreaming(streaming)
      } else {
        clearStreaming()
      }

      // Auto-scroll only when the content actually changed; a no-op render
      // must not move the user's reading position.
      if (rowsChanged && (wasAtBottom || subs.length <= 3)) {
        r.subScroll.scrollTop = r.subScroll.scrollHeight
      }
    } else {
      r.subPlaceholder.style.display = ''
      r.subPlaceholder.textContent = '点击「录音」开始实时转写'
      r.subRows.textContent = ''
      lastRowsSignature = ''
      clearStreaming()
      r.subListening.classList.add('hidden')
      r.subBox.classList.add('hidden')
      r.subBox.classList.remove('auto-idle')
    }
    deps.applyUiHidden()

    // Position subtitle box near video
    positionSubBox()

    // Chat
    updateChat()

    // Notes
    deps.renderNotes()
  }

  /* ===== Chat bubbles ===== */

  function updateChat() {
    const msgs = deps.getSession().messages || []
    const signature = chatRenderSignature(msgs as any)
    if (signature === lastChatSignature) return
    lastChatSignature = signature
    r.chatEl.textContent = ''
    if (msgs.length === 0) {
      const w = document.createElement('div')
      w.className = 'rtts-msg assistant'
      w.textContent = '你好，我是视频伴学助手，可以问我关于当前视频内容的问题。'
      r.chatEl.appendChild(w)
    } else {
      msgs.forEach((m: { role: string; content: string; images?: string[]; hasImages?: boolean }) => {
        const b = document.createElement('div')
        b.className = `rtts-msg ${m.role === 'user' ? 'user' : 'assistant'}`
        const contentEl = document.createElement('div')
        contentEl.innerHTML = renderMarkdownLite(m.content || '')
        b.appendChild(contentEl)
        // Render attached images
        if (Array.isArray(m.images) && m.images.length > 0) {
          const imgGrid = document.createElement('div')
          imgGrid.className = 'rtts-msg-images'
          for (const url of m.images) {
            const thumb = document.createElement('img')
            thumb.src = url
            thumb.alt = '图片'
            thumb.addEventListener('click', () => deps.openShotPreview(url, true))
            imgGrid.appendChild(thumb)
          }
          b.appendChild(imgGrid)
        } else if (m.hasImages) {
          // The image itself is not persisted with history (ADR-030); keep the
          // fact visible so a later answer cannot silently contradict it.
          const note = document.createElement('div')
          note.className = 'rtts-msg-image-note'
          note.textContent = '含图片 · 历史记录不保留图片'
          b.appendChild(note)
        }
        r.chatEl.appendChild(b)
      })
    }
    r.chatEl.scrollTop = r.chatEl.scrollHeight
  }

  // ADR-036: `[mm:ss]` stamps in answers seek the video. One delegated
  // listener covers every bubble, including re-renders.
  r.chatEl.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest?.('.chat-time-ref') as HTMLElement | null
    if (!target) return
    const seconds = Number(target.dataset.t)
    if (!Number.isFinite(seconds)) return
    const result = seekTo(seconds)
    const bubble = target.closest('.rtts-msg')
    if (bubble) {
      bubble.classList.remove('seek-ok', 'seek-fail')
      void (bubble as HTMLElement).offsetWidth
      bubble.classList.add(result.ok ? 'seek-ok' : 'seek-fail')
    }
  })

  /* ===== Streaming Subtitle Rendering ===== */

  function renderStreaming(sub: StreamingSubtitle | null) {
    if (!sub || (!sub.partialTarget && !sub.source)) {
      r.streamingRow.classList.add('hidden')
      return
    }

    r.streamingRow.classList.remove('hidden')
    markSubtitleActivity()

    // Streaming translation text (with cursor)
    const displayText = sub.partialTarget || '⋯'
    r.streamingText.textContent = displayText

    // Source text
    if (sub.source) {
      r.streamingSource.textContent = sub.source
      r.streamingSource.style.display = 'block'
    } else {
      r.streamingSource.style.display = 'none'
    }

    r.streamingLabel.textContent = '翻译中'

    // Auto-scroll to show the streaming row. SSE deltas arrive several times
    // per second; rAF coalescing keeps the panel from twitching on every
    // delta (ADR-041).
    if (!streamingScrollRaf) {
      streamingScrollRaf = requestAnimationFrame(() => {
        streamingScrollRaf = 0
        if (r.subScroll.scrollHeight - r.subScroll.scrollTop - r.subScroll.clientHeight < 120) {
          r.subScroll.scrollTop = r.subScroll.scrollHeight
        }
      })
    }
  }

  function clearStreaming() {
    r.streamingRow.classList.add('hidden')
  }

  /**
   * Collapse and fade the subtitle box when the video has produced no new
   * lines for a while, so it stops covering the picture. Any new subtitle,
   * pointer hover, focus or manual toggling brings it back.
   */
  function markSubtitleActivity() {
    r.subBox.classList.remove('auto-idle')
    if (subIdleTimer) window.clearTimeout(subIdleTimer)
    subIdleTimer = window.setTimeout(() => {
      const session = deps.getSession()
      const hasContent = session.subtitles.length > 0 || !!session.streamingSubtitle
      if (!subBoxCompact && hasContent && !r.subBox.matches(':hover') && !r.subBox.classList.contains('hidden')) {
        r.subBox.classList.add('auto-idle')
      }
    }, SUB_BOX_IDLE_MS)
  }

  function wakeSubtitleBox() {
    r.subBox.classList.remove('auto-idle')
    markSubtitleActivity()
  }

  function persistSubBoxSize(width: number, height: number) {
    const size = { width: Math.round(width), height: Math.round(height) }
    try { localStorage.setItem(SUB_BOX_SIZE_KEY, JSON.stringify(size)) } catch { /* ignore */ }
    try { void (chrome as any).storage?.local?.set({ [SUB_BOX_SIZE_KEY]: size }) } catch { /* ignore */ }
  }

  async function restoreSubBoxPreferences() {
    try {
      const localSize = JSON.parse(localStorage.getItem(SUB_BOX_SIZE_KEY) || 'null')
      let size = localSize
      if (!size) {
        const stored = await (chrome as any).storage?.local?.get(SUB_BOX_SIZE_KEY)
        size = stored?.[SUB_BOX_SIZE_KEY]
      }
      if (typeof size?.width === 'number' && typeof size?.height === 'number') {
        subBoxAutoPosition = false
        applySubBoxSize(size.width, size.height)
      }
      const storedCompact = await (chrome as any).storage?.local?.get(SUB_BOX_COMPACT_KEY)
      subBoxCompact = localStorage.getItem(SUB_BOX_COMPACT_KEY) === 'true' || storedCompact?.[SUB_BOX_COMPACT_KEY] === true
      r.subBox.classList.toggle('compact', subBoxCompact)
    } catch { /* ignore */ }
  }

  function applySubBoxSize(width: number, height: number) {
    const rect = r.subBox.getBoundingClientRect()
    // Keep the panel inside the viewport from its current top-left corner, so
    // a resize handle anchored at the right or bottom edge does not drift.
    const maxWidth = Math.max(220, Math.min(window.innerWidth - 24, window.innerWidth - rect.left - 12))
    const maxHeight = Math.max(100, Math.min(window.innerHeight - 24, window.innerHeight - rect.top - 12))
    r.subBox.style.width = `${Math.max(220, Math.min(maxWidth, width))}px`
    r.subBox.style.height = `${Math.max(72, Math.min(maxHeight, height))}px`
    r.subBox.style.maxHeight = 'none'
  }

  function positionSubBox() {
    // ADR-041: writing styles for a hidden overlay was needless style
    // invalidation on every page scroll and body resize.
    if (r.subBox.classList.contains('hidden')) return
    if (!subBoxAutoPosition) return
    const maxWidth = Math.max(220, window.innerWidth - 32)
    const video = document.querySelector('video')
    if (video && video.readyState > 0) {
      const vr = video.getBoundingClientRect()
      const top = vr.top + vr.height * 0.75
      const width = Math.min(vr.width * 0.72, 560, maxWidth)
      r.subBox.style.top = Math.max(top, 80) + 'px'
      r.subBox.style.width = `${Math.max(220, Math.round(width))}px`
      r.subBox.style.height = 'auto'
      r.subBox.style.maxHeight = '24vh'
      r.subBox.style.bottom = 'auto'
    } else {
      r.subBox.style.top = ''
      r.subBox.style.bottom = '26px'
      r.subBox.style.width = `${Math.min(Math.round(window.innerWidth * 0.72), 560, maxWidth)}px`
      r.subBox.style.height = 'auto'
      r.subBox.style.maxHeight = '24vh'
    }
  }

  const ro = (window as any).ResizeObserver
    ? new ResizeObserver(() => positionSubBox())
    : { observe() {}, disconnect() {} }
  ro.observe(document.body)
  document.addEventListener('scroll', positionSubBox, { passive: true })
  window.addEventListener('resize', positionSubBox, { passive: true })

  /* ===== Drag (subtitle overlay) ===== */

  function startDrag(e: MouseEvent, el: HTMLElement, offsetX: number, offsetY: number) {
    dragState = { el, offsetX, offsetY }
    el.style.cursor = 'grabbing'
    el.style.transition = 'none'
    e.preventDefault()
  }

  r.subHandle.addEventListener('mousedown', (e) => {
    subBoxAutoPosition = false
    const rect = r.subBox.getBoundingClientRect()
    startDrag(e, r.subBox, e.clientX - rect.left, e.clientY - rect.top)
  })

  r.subBox.addEventListener('dblclick', (event) => {
    if ((event.target as HTMLElement).closest('#rtts-sub-resize, #rtts-sub-handle')) return
    subBoxCompact = !subBoxCompact
    r.subBox.classList.remove('auto-idle')
    r.subBox.classList.toggle('compact', subBoxCompact)
    try { localStorage.setItem(SUB_BOX_COMPACT_KEY, String(subBoxCompact)) } catch { /* ignore */ }
    try { void (chrome as any).storage?.local?.set({ [SUB_BOX_COMPACT_KEY]: subBoxCompact }) } catch { /* ignore */ }
  })

  r.subBox.addEventListener('pointerenter', wakeSubtitleBox)
  r.subBox.addEventListener('pointerleave', markSubtitleActivity)
  r.subBox.addEventListener('focusin', wakeSubtitleBox)

  r.subResize.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    subBoxAutoPosition = false
    const rect = r.subBox.getBoundingClientRect()
    // Anchor the top-left corner so the right/bottom edge follows the pointer.
    r.subBox.style.transform = 'none'
    r.subBox.style.left = `${rect.left}px`
    r.subBox.style.top = `${rect.top}px`
    r.subBox.style.bottom = 'auto'
    subResizeState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height }
    r.subResize.setPointerCapture(event.pointerId)
  })
  r.subResize.addEventListener('pointermove', (event) => {
    if (!subResizeState || subResizeState.pointerId !== event.pointerId) return
    const width = subResizeState.width + event.clientX - subResizeState.startX
    const height = subResizeState.height + event.clientY - subResizeState.startY
    applySubBoxSize(width, height)
  })
  const endSubResize = (event: PointerEvent) => {
    if (!subResizeState || subResizeState.pointerId !== event.pointerId) return
    subResizeState = null
    const rect = r.subBox.getBoundingClientRect()
    persistSubBoxSize(rect.width, rect.height)
  }
  r.subResize.addEventListener('pointerup', endSubResize)
  r.subResize.addEventListener('pointercancel', endSubResize)
  r.subResize.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 48 : 16
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    const rect = r.subBox.getBoundingClientRect()
    subBoxAutoPosition = false
    applySubBoxSize(rect.width + move[0], rect.height + move[1])
    persistSubBoxSize(r.subBox.getBoundingClientRect().width, r.subBox.getBoundingClientRect().height)
  })
  void restoreSubBoxPreferences()
  window.addEventListener('resize', () => {
    if (subBoxAutoPosition) return
    const rect = r.subBox.getBoundingClientRect()
    applySubBoxSize(rect.width, rect.height)
  }, { passive: true })

  document.addEventListener('mousemove', (e) => {
    if (!dragState) return
    const { el, offsetX, offsetY } = dragState
    const x = e.clientX - offsetX
    const y = e.clientY - offsetY
    el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, x)) + 'px'
    el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, y)) + 'px'
    el.style.transform = 'none'
  })

  document.addEventListener('mouseup', () => {
    if (!dragState) return
    const el = dragState.el
    dragState = null
    el.style.cursor = el === r.subBox ? 'grab' : ''
    setTimeout(() => { el.style.transition = '' }, 50)
  })

  return {
    render,
    updateChat,
    renderStreaming,
    clearStreaming,
    positionSubBox,
    markSubtitleActivity,
    wakeSubtitleBox,
    persistSubBoxSize,
    applySubBoxSize,
    restoreSubBoxPreferences,
  }
}
