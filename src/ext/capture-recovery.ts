export interface CaptureReleaseOptions {
  maxAttempts?: number
  delayMs?: number
  sleep?: (delayMs: number) => Promise<void>
}

export type OffscreenReleaseResult = 'busy' | 'released' | 'timeout'

/** Wait until the browser no longer reports a live tab-capture session. */
export async function waitForCaptureRelease(
  isCaptureAlive: () => Promise<boolean>,
  options: CaptureReleaseOptions = {},
): Promise<boolean> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 8)
  const delayMs = Math.max(0, options.delayMs ?? 100)
  const sleep = options.sleep ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)))

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!(await isCaptureAlive())) return true
    if (attempt < maxAttempts - 1) await sleep(delayMs)
  }

  return false
}

/**
 * Close an offscreen document that has lost its in-memory session state while
 * Chrome still owns the underlying tab-capture stream.
 */
export async function forceReleaseOffscreenDocument(
  getActiveTabIds: () => Promise<number[]>,
  closeDocument: () => Promise<void>,
  hasDocument: () => Promise<boolean>,
  options: CaptureReleaseOptions = {},
): Promise<OffscreenReleaseResult> {
  if ((await getActiveTabIds()).length > 0) return 'busy'

  await closeDocument()
  const released = await waitForCaptureRelease(hasDocument, options)
  return released ? 'released' : 'timeout'
}
