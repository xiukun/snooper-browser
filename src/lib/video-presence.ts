/**
 * Decide whether a page has a video worth surfacing the toolbar for
 * (ADR-041).
 *
 * The content script runs on every page. Auto-showing on any `<video>` is
 * wrong: B 站 home cards, YouTube hover previews and ad players all create
 * real playing videos. A presenter must be large enough to be the page's
 * main content — small previews stay hidden until the user opens the
 * toolbar from the extension icon.
 *
 * Pure so the thresholds are unit-testable without a DOM.
 */

export interface VideoRect {
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** A real player is at least this large in CSS pixels. */
export const AUTO_SHOW_MIN_WIDTH = 320
export const AUTO_SHOW_MIN_HEIGHT = 180
/** ...and covers at least this share of the viewport. */
export const AUTO_SHOW_MIN_VIEWPORT_RATIO = 0.12

export function isPresentableVideo(rect: VideoRect, viewport: ViewportSize): boolean {
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false
  if (rect.width < AUTO_SHOW_MIN_WIDTH || rect.height < AUTO_SHOW_MIN_HEIGHT) return false

  const viewportArea = viewport.width * viewport.height
  if (!Number.isFinite(viewportArea) || viewportArea <= 0) return false

  return (rect.width * rect.height) / viewportArea >= AUTO_SHOW_MIN_VIEWPORT_RATIO
}
