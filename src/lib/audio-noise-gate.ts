import { SPEECH_RMS_THRESHOLD } from './audio-segments'

export interface AudioFeatureDecision {
  accept: boolean
  reason: 'empty' | 'too-short' | 'steady-noise' | 'speech'
  speechRatio: number
  transitions: number
  variation: number
}

/**
 * Conservative pre-ASR gate for steady music beds and background noise.
 * RMS remains the first cheap gate; this only rejects long, active and nearly
 * unchanging energy. Short clicks and quiet speech are handled by the normal
 * speech-duration gate instead of being classified as noise here.
 */
export function classifyAudioFrames(
  frameRms: number[],
  frameLens: number[],
  sampleRate: number,
): AudioFeatureDecision {
  const totalMs = frameLens.reduce((sum, length) => sum + length, 0) / sampleRate * 1000
  const active = frameRms.filter((rms) => rms >= SPEECH_RMS_THRESHOLD)
  const speechRatio = frameRms.length === 0 ? 0 : active.length / frameRms.length
  if (frameRms.length === 0 || totalMs <= 0) {
    return { accept: false, reason: 'empty', speechRatio, transitions: 0, variation: 0 }
  }

  const transitions = frameRms.slice(1).reduce((count, rms, index) => {
    const wasActive = frameRms[index]! >= SPEECH_RMS_THRESHOLD
    const isActive = rms >= SPEECH_RMS_THRESHOLD
    return count + (wasActive !== isActive ? 1 : 0)
  }, 0)
  const activeRms = active.length > 0 ? active : [0]
  const mean = activeRms.reduce((sum, rms) => sum + rms, 0) / activeRms.length
  const variation = mean > 0
    ? activeRms.reduce((sum, rms) => sum + Math.abs(rms - mean), 0) / activeRms.length / mean
    : 0

  if (totalMs < 320 || active.length === 0) {
    return { accept: false, reason: 'too-short', speechRatio, transitions, variation }
  }

  // A long, almost continuously active signal with little frame-to-frame
  // variation is more likely a music bed or steady appliance noise than speech.
  if (totalMs >= 900 && speechRatio >= 0.9 && transitions <= 2 && variation < 0.16) {
    return { accept: false, reason: 'steady-noise', speechRatio, transitions, variation }
  }

  return { accept: true, reason: 'speech', speechRatio, transitions, variation }
}
