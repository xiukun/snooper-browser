/**
 * Language picker popup: source/target rows, positioning, outside-click close.
 */

import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from '../../lib/models'

export const LANG_MAP: Record<string, string> = Object.fromEntries(
  [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES].map((l) => [l.code, l.label]),
)
export const LANG_SHORT: Record<string, string> = Object.fromEntries(
  [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES].map((l) => [l.code, l.short]),
)

export interface LangPickerDeps {
  shadow: ShadowRoot
  bar: HTMLElement
  langBtn: HTMLElement
  langLabel: HTMLElement
  langPicker: HTMLElement
  sourceLangsEl: HTMLElement
  targetLangsEl: HTMLElement
  getSession: () => { sourceLang: string; targetLang: string }
  setSourceLang: (code: string) => void
  setTargetLang: (code: string) => void
  onSourceChanged: (code: string) => void
  onTargetChanged: (code: string) => void
}

export function createLangPicker(deps: LangPickerDeps) {
  let langPickerOpen = false

  function build() {
    deps.sourceLangsEl.textContent = ''
    deps.targetLangsEl.textContent = ''
    SOURCE_LANGUAGES.forEach((l) => {
      const src = document.createElement('span')
      src.className = 'lang-opt' + (l.code === deps.getSession().sourceLang ? ' active' : '')
      src.textContent = l.label
      ;(src as any).dataset.code = l.code
      src.addEventListener('click', () => {
        deps.setSourceLang(l.code)
        refresh()
        updateLabel()
        deps.onSourceChanged(l.code)
      })
      deps.sourceLangsEl.appendChild(src)
    })

    TARGET_LANGUAGES.forEach((l) => {
      const tgt = document.createElement('span')
      tgt.className = 'lang-opt' + (l.code === deps.getSession().targetLang ? ' active' : '')
      tgt.textContent = l.label
      ;(tgt as any).dataset.code = l.code
      tgt.addEventListener('click', () => {
        deps.setTargetLang(l.code)
        refresh()
        updateLabel()
        close()
        deps.onTargetChanged(l.code)
      })
      deps.targetLangsEl.appendChild(tgt)
    })
  }

  function refresh() {
    deps.sourceLangsEl.querySelectorAll('.lang-opt').forEach((el) => {
      el.classList.toggle('active', (el as any).dataset.code === deps.getSession().sourceLang)
    })
    deps.targetLangsEl.querySelectorAll('.lang-opt').forEach((el) => {
      el.classList.toggle('active', (el as any).dataset.code === deps.getSession().targetLang)
    })
  }

  function updateLabel() {
    const session = deps.getSession()
    const src = LANG_MAP[session.sourceLang] || session.sourceLang
    const tgt = LANG_MAP[session.targetLang] || session.targetLang
    // Short codes keep the chip narrow; the tooltip carries the full names.
    const srcShort = LANG_SHORT[session.sourceLang] || String(session.sourceLang).toUpperCase()
    const tgtShort = LANG_SHORT[session.targetLang] || String(session.targetLang).toUpperCase()
    deps.langLabel.textContent = `${srcShort}→${tgtShort}`
    deps.langBtn.setAttribute('data-tip', `语言：${src} → ${tgt}`)
  }

  deps.langBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    langPickerOpen = !langPickerOpen
    deps.langPicker.classList.toggle('open', langPickerOpen)
    if (langPickerOpen) position()
  })

  function close() {
    langPickerOpen = false
    deps.langPicker.classList.remove('open')
  }

  // Anchor the picker under the draggable toolbar, flipping above when needed.
  function position() {
    if (!langPickerOpen) return
    const br = deps.bar.getBoundingClientRect()
    const pr = deps.langPicker.getBoundingClientRect()
    const width = pr.width || 300
    const height = pr.height || 280
    const left = Math.min(
      Math.max(8, br.left + br.width / 2 - width / 2),
      Math.max(8, window.innerWidth - width - 8),
    )
    let top = br.bottom + 10
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, br.top - height - 10)
    }
    deps.langPicker.style.transform = 'none'
    deps.langPicker.style.left = `${Math.round(left)}px`
    deps.langPicker.style.top = `${Math.round(top)}px`
  }

  // Close picker on outside click. Shadow DOM retargets events to the host,
  // so detection must use composedPath instead of e.target.
  document.addEventListener('click', (e) => {
    if (!langPickerOpen) return
    const path = e.composedPath()
    if (path.includes(deps.langPicker) || path.includes(deps.langBtn)) return
    close()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && langPickerOpen) close()
  })

  return { build, refresh, updateLabel, close, position, isOpen: () => langPickerOpen }
}
