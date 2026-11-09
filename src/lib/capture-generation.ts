/** Pure generation fencing for asynchronous capture start/stop requests. */
export interface CaptureGenerationState {
  requested?: number
  stopped: number
}

export interface StopGenerationResult {
  cancelRequested: boolean
  stopActive: boolean
}

export function requestCaptureGeneration(
  state: CaptureGenerationState,
  generation: number,
): boolean {
  if (generation <= state.stopped) return false
  if (state.requested !== undefined && generation < state.requested) return false
  state.requested = generation
  return true
}

export function isCurrentCaptureGeneration(
  state: CaptureGenerationState,
  generation: number,
): boolean {
  return state.requested === generation && generation > state.stopped
}

export function stopCaptureGeneration(
  state: CaptureGenerationState,
  activeGeneration: number | undefined,
  generation?: number,
): StopGenerationResult {
  if (generation === undefined) {
    state.requested = undefined
    if (activeGeneration !== undefined) {
      state.stopped = Math.max(state.stopped, activeGeneration)
    }
    return {
      cancelRequested: true,
      stopActive: activeGeneration !== undefined,
    }
  }

  state.stopped = Math.max(state.stopped, generation)
  const cancelRequested = state.requested === generation
  if (cancelRequested) state.requested = undefined

  return {
    cancelRequested,
    stopActive: cancelRequested || activeGeneration === generation,
  }
}
