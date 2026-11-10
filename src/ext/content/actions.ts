import { legacySourceRef } from '../../lib/video-key'
import type { SourceRef } from '../../lib/knowledge-types'
import { readVideoContext, type VideoContext } from './video-context'
/**
 * Toolbar actions: copy subtitles, export TXT/Markdown, capture the current
 * line as a note, open image generation, and screenshot the video.
 */

import type { NoteEntry } from '../../lib/types'
import type { SubtitleLine } from '../../lib/types'
import { buildZip, collectAssets, decodeExportAsset, formatBytes } from '../../lib/export-assets'
import { downloadBlob, getSubtitleMarkdown, getSubtitleText } from './exporter'
import type { SessionState } from './types'

export interface ActionRefs {
  copy: HTMLElement
  exportTxt: HTMLElement
  exportMd: HTMLElement
  note: HTMLElement
  summary: HTMLElement
  image: HTMLElement
  screenshot: HTMLButtonElement
}

export interface ActionDeps {
  refs: ActionRefs
  getSession: () => SessionState
  /** Full-session rows from transcript-store; the visible window is only a preview. */
  getTranscript: () => Promise<{ subtitles: Array<Partial<SubtitleLine>>; complete: boolean }>
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  flashChip: (button: HTMLElement, ms?: number) => void
  addNoteEntry: (entry: NoteEntry) => Promise<boolean>
  openImagePanel: (prompt?: string) => void
  captureVideoFrame: () => Promise<{ dataUrl: string; cropped: boolean }>
  openShotPreview: (url: string, saved: boolean, insertable?: boolean, source?: VideoContext) => void
  /** ADR-037: the background round-trip lives in content.ts (it owns `bg`). */
  summarize: () => Promise<{ ok: boolean; summary?: string; sourceRef?: SourceRef; videoTime?: number | null; error?: string }>
  /** ADR-037: reveal the notes pane after the summary lands. */
  openNotes: () => void
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

/** True when the session carries at least one decodable image asset. */
function sessionHasAssets(session: SessionState): boolean {
  return collectAssets(session.notes, session.messages).length > 0
}

/**
 * Prefer the durable transcript. If the background has no record (storage
 * failure or a session created before the record existed), fall back to the
 * visible window so copy/export still returns what the user can see.
 */
async function resolveSubtitles(deps: ActionDeps): Promise<{ subtitles: Array<Partial<SubtitleLine>>; complete: boolean }> {
  try {
    const result = await deps.getTranscript()
    if (result.complete) return result
    const byId = new Map<string, Partial<SubtitleLine>>()
    for (const [i, line] of [...result.subtitles, ...deps.getSession().subtitles].entries()) byId.set(line.id || `fallback:${i}`, line)
    return { subtitles: [...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0)), complete: false }
  } catch {
    return { subtitles: deps.getSession().subtitles, complete: false }
  }
}

function downloadZip(filename: string, files: Array<{ name: string; bytes: Uint8Array }>): void {
  const blob = new Blob([buildZip(files) as unknown as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function bindActions(deps: ActionDeps) {
  const r = deps.refs

  r.copy.addEventListener('click', async () => {
    const result = await resolveSubtitles(deps)
    const text = getSubtitleText(result.subtitles)
    if (!text) { deps.toast('没有字幕可复制', 'err'); return }
    const ok = await copyText(text)
    if (ok) {
      deps.flashChip(r.copy)
      deps.toast(result.complete ? '已复制全部字幕' : '仅复制可用内容，完整正文读取失败', result.complete ? 'ok' : 'err')
    } else {
      deps.toast('复制失败，请在浏览器设置中允许剪贴板访问', 'err')
    }
  })

  r.exportTxt.addEventListener('click', async () => {
    const result = await resolveSubtitles(deps)
    const text = getSubtitleText(result.subtitles)
    if (!text) { deps.toast('没有字幕可导出', 'err'); return }
    downloadBlob(`snooper-subtitles-${Date.now()}.txt`, text)
    deps.flashChip(r.exportTxt)
    deps.toast(result.complete ? 'TXT 已导出' : '仅导出可用内容，完整正文读取失败', result.complete ? 'ok' : 'err')
  })

  r.exportMd.addEventListener('click', async () => {
    const session = deps.getSession()
    const result = await resolveSubtitles(deps)
    const subtitles = result.subtitles
    // ADR-035: the current page is the session's video for deep links.
    const text = getSubtitleMarkdown({ ...session, subtitles, pageUrl: location.href, pageTitle: document.title })
    if (!text) { deps.toast('没有内容可导出', 'err'); return }
    deps.flashChip(r.exportMd)

    if (!sessionHasAssets(session)) {
      downloadBlob(`snooper-notes-${Date.now()}.md`, text)
      deps.toast(result.complete ? 'Markdown 已导出' : '仅导出可用内容，完整正文读取失败', result.complete ? 'ok' : 'err')
      return
    }

    // With images: single-file Markdown cannot carry them readably, and raw
    // Base64 in `.md` is what made old exports look like garbage. Package a
    // ZIP with `record.md` + `assets/` instead.
    const assets = collectAssets(session.notes, session.messages)
    const names = new Map<string, string>()
    const files: Array<{ name: string; bytes: Uint8Array }> = []
    let failed = 0
    for (const asset of assets) {
      const decoded = decodeExportAsset(asset)
      if (decoded) {
        names.set(asset.entryId, `assets/${asset.fileName}`)
        files.push({ name: `assets/${asset.fileName}`, bytes: decoded.file.bytes })
      } else {
        failed += 1
      }
    }
    const markdown = getSubtitleMarkdown(
      { ...session, subtitles, pageUrl: location.href, pageTitle: document.title },
      new Map([...names].map(([entryId, name]) => [entryId, name])),
    )
    files.unshift({ name: 'record.md', bytes: new TextEncoder().encode(markdown) })
    downloadZip(`snooper-notes-${Date.now()}.zip`, files)
    const partial = result.complete ? '' : '，仅导出可用内容（完整正文读取失败）'
    const note = failed > 0 ? `，${failed} 张图片无法读取已用占位说明` : ''
    deps.toast(`已导出 ZIP（${files.length} 个文件，${formatBytes(files.reduce((sum, file) => sum + file.bytes.length, 0))}）${note}${partial}`, failed > 0 || !result.complete ? 'err' : 'ok')
  })

  // Capture the current subtitle as a note.
  r.note.addEventListener('click', async () => {
    const session = deps.getSession()
    const subs = session.subtitles
    if (subs.length === 0) { deps.toast('没有字幕可记录', 'err'); return }
    const last = subs[subs.length - 1]!
    const saved = await deps.addNoteEntry({
      id: `note_${Date.now()}`,
      type: 'subtitle',
      at: Date.now(),
      source: last.source,
      target: last.target,
      sourceLang: session.sourceLang,
      targetLang: session.targetLang,
      // ADR-035: carry the anchor so exports can deep-link back to the video.
      videoTime: typeof last.videoTime === 'number' ? last.videoTime : null,
      sourceRef: last.sourceRef || legacySourceRef('', '', session.transcriptId || last.id || 'subtitle'),
      videoUrl: last.sourceRef?.url,
    })
    if (!saved) return
    deps.flashChip(r.note)
    deps.toast('已记入笔记', 'ok')
  })

  // ADR-037: summarize the evidence digest into a note entry. The background
  // owns the LLM call; this surface owns the note write and the feedback.
  let summaryBusy = false
  r.summary.addEventListener('click', async () => {
    if (summaryBusy) return
    const session = deps.getSession()
    if (!session.subtitles || session.subtitles.length === 0) {
      deps.toast('还没有字幕可总结，先开启实时翻译', 'err')
      return
    }
    summaryBusy = true
    r.summary.setAttribute('aria-disabled', 'true')
    deps.toast('正在生成纪要…', 'info')
    try {
      const res = await deps.summarize()
      if (!res.ok || !res.summary) {
        deps.toast(res.error || '生成纪要失败', 'err')
        return
      }
      const saved = await deps.addNoteEntry({
        id: `summary_${Date.now()}`,
        type: 'summary',
        at: Date.now(),
        text: res.summary,
        videoTime: typeof res.videoTime === 'number' ? res.videoTime : null,
        sourceRef: res.sourceRef,
        videoUrl: res.sourceRef?.url,
      })
      deps.openNotes()
      if (!saved) return
      deps.flashChip(r.summary)
      deps.toast('纪要已记入笔记', 'ok')
    } finally {
      summaryBusy = false
      r.summary.removeAttribute('aria-disabled')
    }
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
      const origin = readVideoContext()
      const shot = await deps.captureVideoFrame()
      const saved = await deps.addNoteEntry({
        id: `screenshot_${Date.now()}`,
        type: 'screenshot',
        sourceRef: origin.sourceRef,
        videoUrl: origin.videoUrl,
        videoTime: origin.videoTime,
        at: Date.now(),
        imageUrl: shot.dataUrl,
        text: shot.cropped ? '视频截图' : '页面截图',
      })
      deps.openShotPreview(shot.dataUrl, saved, true, origin)
      if (!saved) return
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
