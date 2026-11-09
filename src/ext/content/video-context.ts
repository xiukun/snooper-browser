/**
 * Content-side video metadata for companion sessions.
 *
 * The URL is the stable identity (ADR-030); the <video> element only
 * contributes the current playback position for the prompt. A page without a
 * detectable video is normal — chat still works from subtitles and images.
 */

import { videoKeyForUrl, videoTitleFromDocumentTitle } from '../../lib/video-key'
import { findBestVideoCandidate } from '../screenshot'

export interface VideoContext {
  videoKey: string
  videoTitle: string
  videoUrl: string
  /** Seconds into the current video; 0 when no video is detected. */
  videoTime: number
}

export function readVideoContext(): VideoContext {
  const videoUrl = location.href
  let videoTime = 0
  try {
    const candidate = findBestVideoCandidate()
    const time = candidate?.video?.currentTime
    if (typeof time === 'number' && Number.isFinite(time) && time > 0) videoTime = time
  } catch {
    // A hostile page can make layout queries throw; identity still works.
  }
  return {
    videoKey: videoKeyForUrl(videoUrl),
    videoTitle: videoTitleFromDocumentTitle(document.title),
    videoUrl,
    videoTime,
  }
}
