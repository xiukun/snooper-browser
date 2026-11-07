/**
 * Tab-screen capture with a video crop hint.
 *
 * First principle: the screenshot is the composited tab surface, not a DOM
 * node. A <video> only tells us where to crop. Therefore a missing, hidden, or
 * cross-origin video degrades to a full-tab screenshot instead of failing.
 */

export interface ScreenshotRect {
  x: number
  y: number
  w: number
  h: number
}

interface VideoCandidate {
  video: HTMLVideoElement
  rect: ScreenshotRect
  score: number
}

export interface ScreenshotCaptureResult {
  dataUrl: string
  cropped: boolean
}

export interface ScreenshotDeps {
  /** The injected UI root that must not appear in the screenshot. */
  host: HTMLElement
  /** Background request, e.g. `() => bg('CAPTURE_SCREENSHOT')`. */
  capture: () => Promise<{ ok: boolean; dataUrl?: string; error?: string; path?: string }>
  maxWidth?: number
  jpegQuality?: number
  /** Let the compositor settle after hiding the UI. */
  hideDelayMs?: number
}

interface FrameGeometry {
  x: number
  y: number
  clip: { left: number; top: number; right: number; bottom: number }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('截图解码失败'))
    img.src = src
  })
}

/**
 * Collect videos from the document, open shadow roots and same-origin
 * iframes. Cross-origin iframes stay inaccessible by design; the tab capture
 * still sees their rendered pixels.
 */
function collectVideos(root: Document | ShadowRoot, out: HTMLVideoElement[], depth: number): void {
  if (depth > 3) return
  root.querySelectorAll('video').forEach((video) => out.push(video as HTMLVideoElement))
  root.querySelectorAll('iframe').forEach((frame) => {
    try {
      const doc = (frame as HTMLIFrameElement).contentDocument
      if (doc) collectVideos(doc, out, depth + 1)
    } catch { /* cross-origin iframe */ }
  })
  root.querySelectorAll('*').forEach((el) => {
    const shadowRoot = (el as HTMLElement).shadowRoot
    if (shadowRoot) collectVideos(shadowRoot, out, depth + 1)
  })
}

/**
 * Offset of a same-origin frame's viewport inside the top-level viewport, plus
 * the intersection of every ancestor frame and the top viewport. Without the
 * clip, a video cropped by an iframe would produce a wrong rectangle.
 */
function getFrameGeometry(win: Window | null): FrameGeometry {
  const frames: Element[] = []
  let current = win
  for (let depth = 0; current && current !== window && depth < 5; depth++) {
    let frame: Element | null = null
    try { frame = current.frameElement } catch { break }
    if (!frame) break
    frames.unshift(frame)
    current = frame.ownerDocument.defaultView
  }

  let x = 0
  let y = 0
  let clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  for (const frame of frames) {
    const rect = frame.getBoundingClientRect()
    const left = x + rect.left
    const top = y + rect.top
    clip = {
      left: Math.max(clip.left, left),
      top: Math.max(clip.top, top),
      right: Math.min(clip.right, left + rect.width),
      bottom: Math.min(clip.bottom, top + rect.height),
    }
    x = left
    y = top
  }
  return { x, y, clip }
}

function getVideoContentRect(video: HTMLVideoElement): ScreenshotRect | null {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return null
  const win = video.ownerDocument.defaultView
  if (!win) return null

  const style = win.getComputedStyle(video)
  if (style.display === 'none' || style.visibility === 'hidden') return null
  if (Number(style.opacity) < 0.05) return null

  const r = video.getBoundingClientRect()
  if (!r.width || !r.height) return null
  const frame = getFrameGeometry(win)
  let x = r.left + frame.x
  let y = r.top + frame.y
  let w = r.width
  let h = r.height

  const fit = style.objectFit || 'contain'
  if (fit === 'contain' || fit === 'scale-down') {
    const videoAspect = video.videoWidth / video.videoHeight
    const boxAspect = w / h
    if (videoAspect > boxAspect) {
      const nh = w / videoAspect
      y += (h - nh) / 2
      h = nh
    } else {
      const nw = h * videoAspect
      x += (w - nw) / 2
      w = nw
    }
  }

  const left = Math.max(frame.clip.left, x)
  const top = Math.max(frame.clip.top, y)
  const right = Math.min(frame.clip.right, x + w)
  const bottom = Math.min(frame.clip.bottom, y + h)
  if (right - left < 64 || bottom - top < 64) return null
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * Pick the largest visible playing video instead of trusting the first
 * `<video>` in the document (preload players, ads and PiP clones are real).
 */
export function findBestVideoCandidate(): { video: HTMLVideoElement; rect: ScreenshotRect; count: number } | null {
  const videos: HTMLVideoElement[] = []
  collectVideos(document, videos, 0)
  let best: VideoCandidate | null = null
  for (const video of videos) {
    const rect = getVideoContentRect(video)
    if (!rect) continue
    const score = rect.w * rect.h * (video.paused ? 0.6 : 1)
    if (!best || score > best.score) best = { video, rect, score }
  }
  return best ? { video: best.video, rect: best.rect, count: videos.length } : null
}

export function createScreenshotCapturer(deps: ScreenshotDeps) {
  const maxWidth = deps.maxWidth ?? 1600
  const quality = deps.jpegQuality ?? 0.9
  const hideDelayMs = deps.hideDelayMs ?? 120

  async function render(dataUrl: string, rect: ScreenshotRect | null): Promise<string> {
    const img = await loadImageElement(dataUrl)
    const scaleX = img.naturalWidth / Math.max(1, window.innerWidth)
    const scaleY = img.naturalHeight / Math.max(1, window.innerHeight)

    let sx = 0
    let sy = 0
    let sw = img.naturalWidth
    let sh = img.naturalHeight
    if (rect) {
      sx = Math.min(img.naturalWidth - 1, Math.max(0, Math.round(rect.x * scaleX)))
      sy = Math.min(img.naturalHeight - 1, Math.max(0, Math.round(rect.y * scaleY)))
      sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round(rect.w * scaleX)))
      sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round(rect.h * scaleY)))
      if (sw < 32 || sh < 32) throw new Error('视频裁剪区域过小')
    }

    let outW = sw
    let outH = sh
    if (outW > maxWidth) {
      outH = Math.round((outH * maxWidth) / outW)
      outW = maxWidth
    }

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
    return canvas.toDataURL('image/jpeg', quality)
  }

  async function captureVideoFrame(): Promise<ScreenshotCaptureResult> {
    const candidate = findBestVideoCandidate()
    console.log('[RTTS] screenshot candidates', {
      count: candidate?.count ?? 0,
      chosen: candidate
        ? { width: candidate.video.videoWidth, height: candidate.video.videoHeight, area: Math.round(candidate.rect.w * candidate.rect.h) }
        : null,
    })

    deps.host.style.display = 'none'
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      await new Promise((resolve) => setTimeout(resolve, hideDelayMs))

      const res = await deps.capture()
      if (!res.ok || !res.dataUrl) throw new Error(res.error || '浏览器截图失败')

      let dataUrl = res.dataUrl
      let cropped = false
      if (candidate) {
        try {
          dataUrl = await render(res.dataUrl, candidate.rect)
          cropped = true
        } catch (err) {
          console.warn('[RTTS] screenshot crop failed, using the full frame:', err)
        }
      }
      if (!cropped) dataUrl = await render(res.dataUrl, null)

      console.log('[RTTS] screenshot', {
        path: res.path || 'unknown',
        cropped,
        bytes: dataUrl.length,
      })
      return { dataUrl, cropped }
    } finally {
      deps.host.style.display = ''
    }
  }

  return { captureVideoFrame, findBestVideoCandidate }
}
