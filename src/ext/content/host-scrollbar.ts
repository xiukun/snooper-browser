/**
 * Skin the host page's root scrollbar while the drawer is open.
 *
 * The drawer is a fixed overlay, but a classic scrollbar is painted outside
 * the layout viewport: `right: 0` stops at its inner edge, so the strip next
 * to a dark drawer stays the page's light scrollbar. Repainting that strip is
 * the only way to remove the seam. Only the root scrollbar is touched; the
 * page's own scroll containers keep their styling.
 *
 * Gated on a non-zero scrollbar gutter. On overlay-scrollbar platforms there
 * is no strip to repaint, and declaring ::-webkit-scrollbar there would force
 * a classic scrollbar and shift the page layout. Colours are the only
 * properties set, so the existing scrollbar width is preserved.
 */
const STYLE_ID = 'rtts-host-scrollbar'

export function setHostScrollbarTheme(active: boolean): void {
  const existing = document.getElementById(STYLE_ID)
  if (!active) {
    existing?.remove()
    return
  }
  if (existing) return

  const gutter = window.innerWidth - document.documentElement.clientWidth
  if (gutter <= 0) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    html::-webkit-scrollbar { background: rgba(10,10,16,0.9); }
    html::-webkit-scrollbar-track { background: rgba(10,10,16,0.9); }
    /* The thumb stays invisible so the strip reads as part of the drawer
       instead of a second scrollbar directly beside the drawer's own rail.
       Hovering the strip still reveals it, so dragging keeps working. */
    html::-webkit-scrollbar-thumb {
      background: transparent;
      border: 2px solid transparent;
      border-radius: 999px;
      background-clip: padding-box;
    }
    html::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.22);
      background-clip: padding-box;
    }
  `
  ;(document.head ?? document.documentElement).appendChild(style)
}
