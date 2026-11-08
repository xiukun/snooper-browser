/**
 * In-page image generation panel.
 *
 * The panel owns its own loading/error states: a request that returns HTTP 200
 * is not success until the <img> actually decoded. Remote fallbacks stay
 * visible through an explicit "open original" link instead of a silent blank
 * box.
 */

export type ImageTone = 'info' | 'ok' | 'err'
export type ImageFunKind = 'roast' | 'continue' | 'line'

export interface ImageGenerateResult {
  ok: boolean
  images?: string[]
  remoteImages?: string[]
  warnings?: string[]
  error?: string
  model?: string
}

export interface ImagePanelRefs {
  modal: HTMLElement
  close: HTMLButtonElement
  prompt: HTMLTextAreaElement
  size: HTMLSelectElement
  negative: HTMLInputElement
  status: HTMLElement
  result: HTMLElement
  /** Container for the extension-origin viewer iframe (see showImage). */
  resultFrame: HTMLElement
  actions: HTMLElement
  generate: HTMLButtonElement
  save: HTMLButtonElement
  insert: HTMLButtonElement
  download: HTMLButtonElement
  fun: HTMLElement
  openOriginal: HTMLAnchorElement
}

export interface ImagePanelDeps {
  refs: ImagePanelRefs
  generate: (input: { prompt: string; size: string; negativePrompt: string }) => Promise<ImageGenerateResult>
  /** Background fetch fallback; must return a data URL or throw. */
  materialize: (url: string) => Promise<string>
  addNote: (imageUrl: string, prompt: string) => void
  insertChat: (imageUrl: string, prompt: string) => void
  play: (kind: ImageFunKind, imageUrl: string, prompt: string) => void
  toast: (message: string, tone?: ImageTone) => void
}

export function createImagePanel(deps: ImagePanelDeps) {
  const { refs } = deps
  let lastImageUrl = ''
  let lastRemoteUrl = ''
  let lastPrompt = ''

  function resetResult() {
    lastImageUrl = ''
    lastRemoteUrl = ''
    refs.result.classList.remove('show')
    refs.actions.classList.remove('show')
    refs.fun.classList.remove('show')
    destroyViewer()
    refs.openOriginal.hidden = true
    refs.openOriginal.removeAttribute('href')
  }

  function setStatus(message: string, tone: ImageTone = 'info') {
    refs.status.className = 'rtts-status show' + (tone === 'info' ? ' info' : ` ${tone}`)
    refs.status.textContent = message
  }

  /** Only http(s) may become a clickable "open original" link. */
  function safeExternalUrl(url: string): string {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : ''
    } catch {
      return ''
    }
  }

  function clearStatus() {
    refs.status.className = 'rtts-status'
    refs.status.textContent = ''
  }

  /**
   * Render the image inside an extension-origin iframe (image-viewer.html).
   *
   * Why not a plain <img> in the host page: the page's CSP `img-src` governs
   * it, and video sites commonly forbid both data: URLs and third-party CDN
   * hosts — the image generated fine, "open original" worked (direct
   * navigation is not subject to the page CSP), but the panel stayed blank.
   * An extension-origin document is governed by the extension's own CSP, so
   * the same URL always renders there.
   *
   * The iframe is recreated per image (cheap, stateless) and torn down on
   * reset so no viewer document outlives the panel.
   */
  let viewerFrame: HTMLIFrameElement | null = null
  let viewerReport: ((event: MessageEvent) => void) | null = null
  let viewerToken = 0

  function destroyViewer() {
    viewerToken++
    if (viewerReport) window.removeEventListener('message', viewerReport)
    viewerReport = null
    viewerFrame?.remove()
    viewerFrame = null
  }

  function showImage(url: string, remote: string) {
    lastImageUrl = url
    lastRemoteUrl = remote
    refs.result.classList.add('show')
    refs.actions.classList.add('show')
    refs.fun.classList.add('show')

    destroyViewer()
    const token = viewerToken
    const frame = document.createElement('iframe')
    frame.className = 'rtts-image-frame-element'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('title', '生成的配图')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    viewerFrame = frame
    refs.resultFrame.textContent = ''
    refs.resultFrame.appendChild(frame)

    const report = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string; width?: number; height?: number } | null
      if (!data || event.source !== frame.contentWindow) return
      if (data.type === 'rtts-image-viewer:ready') {
        if (token !== viewerToken) return // a newer image already owns the panel
        setStatus(`生成完成${data.width ? ` · ${data.width} × ${data.height}` : ''}`, 'ok')
        refs.openOriginal.hidden = true
      } else if (data.type === 'rtts-image-viewer:error') {
        if (token !== viewerToken) return
        setStatus('图片已生成，但当前页面无法加载。可打开原图或重新生成。', 'err')
        const safeRemote = remote ? safeExternalUrl(remote) : ''
        if (safeRemote) {
          refs.openOriginal.href = safeRemote
          refs.openOriginal.hidden = false
        }
      }
    }
    viewerReport = report
    window.addEventListener('message', report)
    frame.addEventListener('load', () => {
      if (token !== viewerToken || viewerFrame !== frame) return
      frame.contentWindow?.postMessage({ type: 'rtts-image-viewer:show', src: url, id: String(token) }, '*')
    })
    frame.src = chrome.runtime.getURL('image-viewer.html')
  }

  async function ensureDataUrl(): Promise<string> {
    if (lastImageUrl.startsWith('data:')) return lastImageUrl
    if (lastRemoteUrl) {
      const dataUrl = await deps.materialize(lastRemoteUrl)
      if (dataUrl.startsWith('data:')) {
        lastImageUrl = dataUrl
        return dataUrl
      }
    }
    throw new Error('图片还没有缓存到本地，请先下载或重新生成')
  }

  function open(prompt = '') {
    resetResult()
    clearStatus()
    lastPrompt = prompt
    refs.prompt.value = prompt
    refs.modal.classList.add('open')
    setTimeout(() => refs.prompt.focus(), 30)
  }

  function close() {
    refs.modal.classList.remove('open')
  }

  // The float layer has no dark mask, so clicking anywhere outside the panel
  // (the transparent area around it) is the dismiss affordance. Clicks inside
  // the panel bubble from .rtts-modal and are ignored.
  refs.modal.addEventListener('click', (event) => {
    if (event.target === refs.modal) close()
  })

  async function generate() {
    const prompt = refs.prompt.value.trim()
    if (!prompt) {
      deps.toast('请先输入提示词', 'err')
      return
    }
    lastPrompt = prompt
    refs.generate.disabled = true
    refs.generate.classList.add('loading')
    const label = refs.generate.querySelector('span')
    if (label) label.textContent = '生成中…'
    resetResult()
    setStatus('正在请求生图接口，通常需要 20–30 秒', 'info')

    try {
      const res = await deps.generate({
        prompt,
        size: refs.size.value,
        negativePrompt: refs.negative.value.trim(),
      })
      if (!res.ok || !Array.isArray(res.images) || res.images.length === 0) {
        setStatus(res.error || '生成失败', 'err')
        return
      }
      const remote = res.remoteImages?.[0] || ''
      showImage(res.images[0]!, remote)
      if (res.warnings?.length) {
        console.warn('[RTTS] image generation warnings', res.warnings)
      }
    } catch (err: any) {
      setStatus(err?.message || '生成失败', 'err')
    } finally {
      refs.generate.disabled = false
      refs.generate.classList.remove('loading')
      if (label) label.textContent = '生成图片'
    }
  }

  async function saveToNotes() {
    try {
      const dataUrl = await ensureDataUrl()
      deps.addNote(dataUrl, lastPrompt.slice(0, 80) || '生成配图')
      deps.toast('已存入笔记', 'ok')
      close()
    } catch (err: any) {
      deps.toast(err?.message || '存入笔记失败', 'err')
    }
  }

  async function insertToChat() {
    try {
      const dataUrl = await ensureDataUrl()
      deps.insertChat(dataUrl, lastPrompt)
      deps.toast('已插入伴学对话', 'ok')
      close()
    } catch (err: any) {
      deps.toast(err?.message || '插入失败', 'err')
    }
  }

  function download() {
    if (!lastImageUrl) return
    const extension = lastImageUrl.startsWith('data:image/jpeg')
      ? 'jpg'
      : lastImageUrl.startsWith('data:image/webp')
        ? 'webp'
        : lastImageUrl.startsWith('data:image/gif')
          ? 'gif'
          : 'png'
    const a = document.createElement('a')
    a.href = lastImageUrl
    a.download = `snooper-${Date.now()}.${extension}`
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
  }

  async function play(kind: ImageFunKind) {
    try {
      const dataUrl = await ensureDataUrl()
      deps.play(kind, dataUrl, lastPrompt)
      close()
    } catch (err: any) {
      deps.toast(err?.message || '操作失败', 'err')
    }
  }

  refs.close.addEventListener('click', close)
  refs.modal.addEventListener('click', (event) => {
    if (event.target === refs.modal) close()
  })
  refs.generate.addEventListener('click', () => { void generate() })
  refs.save.addEventListener('click', () => { void saveToNotes() })
  refs.insert.addEventListener('click', () => { void insertToChat() })
  refs.download.addEventListener('click', download)
  refs.fun.querySelectorAll<HTMLButtonElement>('[data-fun]').forEach((button) => {
    button.addEventListener('click', () => {
      void play(button.dataset.fun as ImageFunKind)
    })
  })

  return { open, close, generate, saveToNotes, insertToChat, download, play }
}
