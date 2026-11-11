/**
 * In-page image generation: prompt helpers built from live subtitles, the
 * panel wiring, and the fun-mode questions ("roast" / "continue" / "line").
 */

import { createImagePanel, type ImageFunKind } from '../image-panel'
import type { SessionState } from './types'

export interface ImageGenDeps {
  refs: {
    modal: HTMLElement
    close: HTMLButtonElement
    prompt: HTMLTextAreaElement
    size: HTMLSelectElement
    negative: HTMLInputElement
    status: HTMLElement
    result: HTMLElement
    resultFrame: HTMLElement
    actions: HTMLElement
    generate: HTMLButtonElement
    save: HTMLButtonElement
    insert: HTMLButtonElement
    download: HTMLButtonElement
    fun: HTMLElement
    openOriginal: HTMLAnchorElement
  }
  getSession: () => SessionState
  bg: (type: string, payload?: Record<string, any>) => Promise<any>
  addNoteEntry: (entry: { id: string; type: 'image'; at: number; imageUrl: string; text: string }) => Promise<boolean>
  addImage: (url: string) => 'ok' | 'duplicate' | 'full'
  openDrawer: (tab: 'chat' | 'notes') => void
  submitQuestion: (question: string, images: string[]) => Promise<void>
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
}

function subtitleDigest(session: SessionState, limit = 6): string {
  const text = session.subtitles
    .slice(-limit)
    .map((line) => (line.target && line.target !== line.source ? `${line.source} / ${line.target}` : line.source))
    .filter(Boolean)
    .join('；')
  return text || '（当前还没有字幕，可以按画面自由发挥）'
}

function funQuestion(session: SessionState, kind: ImageFunKind): string {
  const context = subtitleDigest(session)
  if (kind === 'roast') {
    return `请用一句犀利但不冒犯的吐槽点评这张图，结合当前剧情：\n${context}`
  }
  if (kind === 'continue') {
    return `根据这张图和当前字幕，续写接下来 3 句剧情，保持人物和语气一致：\n${context}`
  }
  return `为这张图配一句有冲击力的台词，贴合当前剧情：\n${context}`
}

export function createImageGen(deps: ImageGenDeps) {
  const panel = createImagePanel({
    refs: deps.refs,
    generate: (input) => deps.bg('GENERATE_IMAGE', input),
    materialize: async (url) => {
      const res = await deps.bg('FETCH_IMAGE', { url })
      if (!res.ok || !res.dataUrl) throw new Error(res.error || '无法缓存图片')
      return res.dataUrl
    },
    addNote: async (imageUrl, text) => {
      const saved = await deps.addNoteEntry({
        id: `image_${Date.now()}`,
        type: 'image',
        at: Date.now(),
        imageUrl,
        text,
      })
      if (!saved) throw new Error('配图未保存，请在笔记中重试或导出')
    },
    insertChat: (imageUrl) => {
      const outcome = deps.addImage(imageUrl)
      if (outcome === 'full') {
        // Let the panel's error path report this; a silent return would show
        // a success toast for an image that was never attached.
        throw new Error('最多 4 张图片')
      }
      deps.openDrawer('chat')
    },
    play: (kind, imageUrl) => {
      deps.openDrawer('chat')
      void deps.submitQuestion(funQuestion(deps.getSession(), kind), [imageUrl])
    },
    toast: deps.toast,
  })

  return {
    open: (prompt?: string) => panel.open(prompt),
    close: () => panel.close(),
  }
}
