/**
 * Page-scoped toolbar visibility (ADR-041 follow-up).
 *
 * `uiHidden` is persisted in `localStorage`, which every page of an origin
 * shares. A capture started on a video site therefore left the toolbar open on
 * later same-origin pages with no player at all. The policy now has three
 * rules, all pure:
 *
 *  - a persisted choice is restored only when the page that wrote it had a
 *    real player, or a capture is still running in the tab;
 *  - a reveal made for a capture is temporary;
 *  - when a capture ends, a page with a player keeps the toolbar (auto-show
 *    owns it again) and a page without one hides it.
 *
 * `src/ext` has no TypeScript gate, so these rules live here as pure
 * functions with a regression test instead of inside `content.ts`.
 */

/**
 * Decide whether the persisted toolbar choice applies to this page.
 *
 * @param storedHidden  persisted `uiHidden`, or null when nothing was stored
 * @param storedScope   kind of page that wrote it: 'video' | 'other' | null
 * @param captureActive a capture is running or starting in this tab
 */
export function shouldRestoreUiHidden(
  storedHidden: string | null | undefined,
  storedScope: string | null,
  captureActive: boolean,
): boolean {
  if (storedHidden === null || storedHidden === undefined) return false
  // A running capture must stay reachable: the toolbar is the only way to
  // stop it.
  if (captureActive) return true
  // The choice was written on a page that hosted a real player.
  return storedScope === 'video'
}

export type CaptureSettle = 'hidden' | 'keep' | 'hide'

/**
 * What the toolbar should do when a capture ends on this page.
 *
 * 'keep' hands the toolbar back to the auto-show watcher; 'hide' restores the
 * default for pages that do not host a player.
 */
export function settleAfterCapture(visible: boolean, hasPlayer: boolean): CaptureSettle {
  if (!visible) return 'hidden'
  return hasPlayer ? 'keep' : 'hide'
}
