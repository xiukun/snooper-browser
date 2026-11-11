import { videoKeyForUrl } from '../../../lib/video-key'
import { openSource } from '../source-opening'
import { transitionSource } from '../source-sessions'
/**
 * Content → background video-clock samples (ADR-033).
 *
 * Only a live capture needs the timeline, so samples outside
 * starting/running/stopping are acknowledged and dropped instead of growing an
 * idle buffer. The sender tab is the key: two recordings on two tabs keep two
 * independent clocks.
 */

import { sanitizeVideoClockSample } from '../../../lib/video-clock'
import { sessions } from '../session-store'
import { recordVideoClock } from '../video-clock'
import type { MessageHandlerMap } from './types'

/** Content samples are real-time; anything further away is not trustworthy. */
const MAX_SAMPLE_SKEW_MS = 120_000

export const videoClockHandlers: MessageHandlerMap = {
  OPEN_SOURCE: (message, { tabId, sendResponse }) => {
    void openSource(message.sourceRef, message.videoTime, tabId ?? message.tabId).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  },
  VIDEO_CLOCK: (message, { tabId, sendResponse }) => {
    const session = sessions.get(tabId)
    const active = session
      && (session.state === 'running' || session.state === 'starting' || session.state === 'stopping')
    if (!active) {
      sendResponse({ ok: true, ignored: true })
      return false
    }

    void (async () => {
      const bound = message.sourceRef && typeof message.sourceRef.url === 'string'
        ? await transitionSource(tabId, message.sourceRef)
        : session
      if (!bound || (bound.state !== 'running' && bound.state !== 'starting')) return
      if (message.sourceRef?.url && bound.sourceIdentity !== videoKeyForUrl(message.sourceRef.url)) return
      const sample = sanitizeVideoClockSample(message)
      if (sample && Math.abs(Date.now() - sample.at) <= MAX_SAMPLE_SKEW_MS) recordVideoClock(tabId, sample, bound.sourceEpoch)
    })().then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }))
    return true
  },
}
