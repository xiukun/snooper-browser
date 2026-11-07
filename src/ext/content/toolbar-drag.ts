/**
 * Draggable toolbar position.
 *
 * Pointer drag, keyboard nudging, viewport clamping, and persistence to both
 * localStorage (instant) and chrome.storage.local (survives origin changes).
 */

const BAR_POS_KEY = 'snooper.toolbar-position.v1'

export interface ToolbarDragDeps {
  bar: HTMLElement
  grip: HTMLElement
  isLangPickerOpen: () => boolean
  positionLangPicker: () => void
}

export function createToolbarDrag(deps: ToolbarDragDeps) {
  const { bar, grip } = deps

  function readBarPosition(): { x: number; y: number } | null {
    try {
      const raw = localStorage.getItem(BAR_POS_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed
    } catch { /* ignore */ }
    return null
  }

  function clamp(x: number, y: number) {
    const rect = bar.getBoundingClientRect()
    return {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - rect.width - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - rect.height - 8)),
    }
  }

  function applyBarPosition(x: number, y: number, persist = false) {
    const pos = clamp(x, y)
    bar.style.transform = 'none'
    bar.style.left = `${pos.x}px`
    bar.style.top = `${pos.y}px`
    bar.classList.toggle('tips-up', pos.y > window.innerHeight / 2)
    if (persist) {
      try { localStorage.setItem(BAR_POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
      try {
        void (chrome as any).storage?.local?.set({ [BAR_POS_KEY]: pos })
      } catch { /* ignore */ }
    }
    if (deps.isLangPickerOpen()) deps.positionLangPicker()
  }

  async function initBarPosition() {
    let saved = readBarPosition()
    if (!saved) {
      try {
        const stored = await (chrome as any).storage?.local?.get(BAR_POS_KEY)
        const value = stored?.[BAR_POS_KEY]
        if (typeof value?.x === 'number' && typeof value?.y === 'number') saved = value
      } catch { /* ignore */ }
    }
    if (saved) {
      applyBarPosition(saved.x, saved.y)
      return
    }
    const rect = bar.getBoundingClientRect()
    applyBarPosition((window.innerWidth - rect.width) / 2, 16)
  }

  let barDrag: { dx: number; dy: number } | null = null

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    const rect = bar.getBoundingClientRect()
    barDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    bar.classList.add('dragging')
    grip.setPointerCapture(e.pointerId)
  })

  grip.addEventListener('pointermove', (e) => {
    if (!barDrag) return
    applyBarPosition(e.clientX - barDrag.dx, e.clientY - barDrag.dy)
  })

  function endBarDrag() {
    if (!barDrag) return
    barDrag = null
    bar.classList.remove('dragging')
    const rect = bar.getBoundingClientRect()
    applyBarPosition(rect.left, rect.top, true)
  }

  grip.addEventListener('pointerup', endBarDrag)
  grip.addEventListener('pointercancel', endBarDrag)

  grip.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 24 : 8
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    const rect = bar.getBoundingClientRect()
    applyBarPosition(rect.left + move[0], rect.top + move[1], true)
  })

  window.addEventListener('resize', () => {
    const rect = bar.getBoundingClientRect()
    applyBarPosition(rect.left, rect.top, true)
  })

  return { initBarPosition, applyBarPosition }
}
