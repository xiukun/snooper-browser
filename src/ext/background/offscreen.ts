/**
 * Offscreen document lifecycle.
 *
 * One hidden document hosts every tab capture. These helpers create it on
 * demand, talk to it, and release orphaned captures left behind by a
 * service-worker restart.
 */

import {
  forceReleaseOffscreenDocument,
  waitForCaptureRelease,
} from '../capture-recovery'

export const OFFSCREEN_PATH = 'offscreen.html'

let offscreenCreationPromise: Promise<void> | null = null

export async function ensureOffscreen(): Promise<void> {
  if (offscreenCreationPromise) return offscreenCreationPromise

  offscreenCreationPromise = (async () => {
    try {
      const hasDoc = typeof chrome.offscreen !== 'undefined' &&
        typeof chrome.offscreen.hasDocument === 'function' &&
        (await chrome.offscreen.hasDocument())
      if (hasDoc) return
    } catch {
      // hasDocument not available or error
    }

    try {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_PATH),
        reasons: ['USER_MEDIA'],
        justification: 'Capture tab audio stream for real-time transcription and translation',
      })
    } catch (err: any) {
      // If document already exists, Chrome throws; ignore
      if (!err.message?.includes('already exists')) {
        throw err
      }
    }
  })()

  try {
    await offscreenCreationPromise
  } finally {
    offscreenCreationPromise = null
  }
}

export async function sendToOffscreen(message: Record<string, any>): Promise<any> {
  await ensureOffscreen()
  try {
    const resp = await chrome.runtime.sendMessage({
      target: 'offscreen',
      ...message,
    })
    return resp
  } catch (err: any) {
    // Offscreen may not be listening yet
    throw new Error('Offscreen 通信失败: ' + (err.message || '未知错误'))
  }
}

export async function hasOffscreenDocument(): Promise<boolean> {
  try {
    return typeof chrome.offscreen !== 'undefined' &&
      typeof chrome.offscreen.hasDocument === 'function' &&
      (await chrome.offscreen.hasDocument())
  } catch {
    return false
  }
}

export async function closeOffscreenDocument(): Promise<void> {
  try {
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument()
    }
  } catch {
    // ignore
  }
}

/** True when a live offscreen capture session exists for this tab. */
export async function getLiveCaptureGeneration(tabId: number): Promise<number | undefined> {
  if (!(await hasOffscreenDocument())) return undefined
  try {
    const res: any = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_CAPTURE_SESSIONS',
    })
    const generation = res?.sessions?.[String(tabId)]
    return res?.ok && typeof generation === 'number' ? generation : undefined
  } catch {
    return undefined
  }
}

export async function offscreenHasCapture(tabId: number): Promise<boolean> {
  return typeof await getLiveCaptureGeneration(tabId) === 'number'
}

/**
 * Stop a capture for a tab without creating the offscreen document. Used
 * before START: a restarted service worker may have left an old capture
 * alive, and tabCapture rejects a second stream for the same tab.
 */
export async function stopOrphanCapture(tabId: number): Promise<boolean> {
  if (!(await hasOffscreenDocument())) return true

  const response: any = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'STOP_CAPTURE',
    tabId,
  })
  if (!response?.ok) {
    throw new Error(response?.error || '无法停止旧录音流')
  }

  const released = await waitForCaptureRelease(
    async () => {
      const live = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'GET_CAPTURE_SESSIONS',
      }) as any
      if (!live?.ok) throw new Error(live?.error || '无法确认旧录音流状态')
      return typeof live.sessions?.[String(tabId)] === 'number'
    },
    { maxAttempts: 10, delayMs: 100 },
  )
  if (!released) throw new Error('旧录音流释放超时')
  return true
}

export async function forceResetOffscreenCapture(): Promise<boolean> {
  if (!(await hasOffscreenDocument())) return true

  const result = await forceReleaseOffscreenDocument(
    async () => {
      const live: any = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'GET_CAPTURE_SESSIONS',
      })
      if (!live?.ok) throw new Error(live?.error || '无法确认其他录音状态')
      return Array.isArray(live.tabIds) ? live.tabIds : []
    },
    async () => {
      await chrome.offscreen.closeDocument()
    },
    hasOffscreenDocument,
    { maxAttempts: 10, delayMs: 100 },
  )

  if (result === 'busy') throw new Error('其他标签页仍在录音，无法重置录音组件')
  if (result === 'timeout') throw new Error('录音组件释放超时')
  return true
}
