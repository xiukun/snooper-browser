/**
 * Screenshot preview modal: show a captured frame, download it, save it as a
 * note entry, or cite it in the chat composer.
 */

import type { NoteEntry } from '../../lib/types'

export interface ShotRefs {
  modal: HTMLElement
  image: HTMLImageElement
  close: HTMLButtonElement
  closeX: HTMLButtonElement
  download: HTMLButtonElement
  save: HTMLButtonElement
  insert: HTMLButtonElement
}

export interface ShotDeps {
  refs: ShotRefs
  addNoteEntry: (entry: NoteEntry) => Promise<boolean>
  addImage: (url: string) => 'ok' | 'duplicate' | 'full'
  openDrawer: (tab: 'chat' | 'notes') => void
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
}

export function createShotPreview(deps: ShotDeps) {
  const r = deps.refs
  let previewUrl = ''

  function open(dataUrl: string, saved: boolean, insertable = false) {
    previewUrl = dataUrl
    r.image.src = dataUrl
    r.save.disabled = saved
    r.save.textContent = saved ? '已存入笔记' : '存入笔记'
    r.insert.style.display = insertable ? '' : 'none'
    r.modal.classList.add('open')
  }

  function close() {
    r.modal.classList.remove('open')
    r.image.removeAttribute('src')
  }

  function download() {
    if (!previewUrl) return
    const anchor = document.createElement('a')
    anchor.href = previewUrl
    anchor.download = `snooper-video-${Date.now()}.jpg`
    anchor.click()
  }

  r.close.addEventListener('click', close)
  r.closeX.addEventListener('click', close)
  r.download.addEventListener('click', download)
  r.modal.addEventListener('click', (event) => {
    if (event.target === r.modal) close()
  })
  r.save.addEventListener('click', async () => {
    if (!previewUrl) return
    const saved = await deps.addNoteEntry({
      id: `screenshot_${Date.now()}`,
      type: 'screenshot',
      at: Date.now(),
      imageUrl: previewUrl,
      text: '视频截图',
    })
    if (!saved) return
    r.save.disabled = true
    r.save.textContent = '已存入笔记'
    deps.toast('截图已存入笔记', 'ok')
  })
  r.insert.addEventListener('click', () => {
    if (!previewUrl) return
    const outcome = deps.addImage(previewUrl)
    if (outcome === 'duplicate') {
      deps.toast('这张截图已经引用了', 'ok')
    } else if (outcome === 'full') {
      deps.toast('最多 4 张图片', 'err')
      return
    }
    close()
    deps.openDrawer('chat')
    deps.toast('已插入伴学对话', 'ok')
  })

  return { open, close }
}
