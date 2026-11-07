/**
 * Toolbar actions: copy subtitles, export TXT/Markdown, capture the current
 * line as a note, open image generation, and screenshot the video.
 */

import type { NoteEntry } from '../../lib/types'
import { downloadBlob, getSubtitleMarkdown, getSubtitleText } from './exporter'
import type { SessionState } from './types'

export interface ActionRefs {
  copy: HTMLElement
  exportTxt: HTMLElement
  exportMd: HTMLElement
  note: HTMLElement
  image: HTMLElement
  screenshot: HTMLButtonElement
}

export interface ActionDeps {
  refs: ActionRefs
  getSession: () => SessionState
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  flashChip: (button: HTMLElement, ms?: number) => void
  addNoteEntry: (entry: NoteEntry) => void
  openImagePanel: (prompt?: string) => void
  captureVideoFrame: () => Promise<{ dataUrl: string; cropped: boolean }>
  openShotPreview: (url: string, saved: boolean, insertable?: boolean) => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for pages without clipboard permission: hidden textarea + execCommand.
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      textarea.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function bindActions(deps: ActionDeps) {
  const r = deps.refs

  r.copy.addEventListener('click', async () => {
    const text = getSubtitleText(deps.getSession().subtitles)
    if (!text) { deps.toast('没有字幕可复制', 'err'); return }
    const ok = await copyText(text)
    if (ok) {
      deps.flashChip(r.copy)
      deps.toast('已复制全部字幕', 'ok')
    } else {
      deps.toast('复制失败，请在浏览器设置中允许剪贴板访问', 'err')
    }
  })

  r.exportTxt.addEventListener('click', () => {
    const text = getSubtitleText(deps.getSession().subtitles)
    if (!text) { deps.toast('没有字幕可导出', 'err'); return }
    downloadBlob(`snooper-subtitles-${Date.now()}.txt`, text)
    deps.flashChip(r.exportTxt)
    deps.toast('TXT 已导出', 'ok')
  })

  r.exportMd.addEventListener('click', () => {
    const text = getSubtitleMarkdown(deps.getSession())
    if (!text) { deps.toast('没有内容可导出', 'err'); return }
    downloadBlob(`snooper-notes-${Date.now()}.md`, text)
    deps.flashChip(r.exportMd)
    deps.toast('Markdown 已导出', 'ok')
  })

  // Capture the current subtitle as a note.
  r.note.addEventListener('click', () => {
    const session = deps.getSession()
    const subs = session.subtitles
    if (subs.length === 0) { deps.toast('没有字幕可记录', 'err'); return }
    const last = subs[subs.length - 1]!
    deps.addNoteEntry({
      id: `note_${Date.now()}`,
      type: 'subtitle',
      at: Date.now(),
      source: last.source,
      target: last.target,
      sourceLang: session.sourceLang,
      targetLang: session.targetLang,
    })
    deps.flashChip(r.note)
    deps.toast('已记入笔记', 'ok')
  })

  // Open image generation with the current subtitle as the prompt seed.
  r.image.addEventListener('click', () => {
    const subs = deps.getSession().subtitles
    const last = subs[subs.length - 1]
    deps.openImagePanel(last?.target || last?.source || '')
  })

  // Capture only the video area, save it, then show an in-page preview
  // (never window.open on a data URL).
  r.screenshot.addEventListener('click', async () => {
    r.screenshot.classList.add('busy')
    try {
      const shot = await deps.captureVideoFrame()
      deps.addNoteEntry({
        id: `screenshot_${Date.now()}`,
        type: 'screenshot',
        at: Date.now(),
        imageUrl: shot.dataUrl,
        text: shot.cropped ? '视频截图' : '页面截图',
      })
      deps.openShotPreview(shot.dataUrl, true, true)
      deps.flashChip(r.screenshot)
      deps.toast(
        shot.cropped
          ? '已截取视频画面并存入笔记'
          : '已截取当前画面（未识别到视频区域）并存入笔记',
        'ok',
      )
    } catch (err: any) {
      deps.toast('截图失败：' + (err.message || '未知错误'), 'err')
    } finally {
      r.screenshot.classList.remove('busy')
    }
  })
}
