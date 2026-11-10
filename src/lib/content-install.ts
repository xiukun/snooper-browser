/**
 * Content-script install marker (extension-reload recovery).
 *
 * The content script must not initialize twice in one page: two toolbars and
 * two `onMessage` listeners would double-handle every message. A global
 * boolean used to guard this, but it also blocked recovery: after the
 * extension is reloaded, the page keeps the old script's marker while that
 * script's extension APIs are dead (`Extension context invalidated`), so a
 * fresh injection bailed out and clicking the icon failed with
 * "Could not establish connection".
 *
 * The marker is now an object with a liveness probe. `alive()` runs in the
 * context that created it: a live script can read its manifest, an orphaned
 * one throws. `shouldSkipContentInstall` only stands down when that probe
 * proves the previous instance is alive; anything unprovable (a legacy
 * boolean, a corrupt value, a throwing probe) lets boot continue.
 */

export interface ContentInstallMarker {
  alive: () => boolean
}

/**
 * True only when a previous content script in this page is provably alive.
 *
 * - no marker: nothing installed, boot
 * - legacy boolean: it cannot prove liveness, and the only reason the
 *   background re-injects is that the old listener did not answer — boot
 * - object marker: stand down only when `alive()` returns true
 */
export function shouldSkipContentInstall(marker: unknown): boolean {
  if (!marker) return false
  if (typeof marker !== 'object') return false

  const alive = (marker as Partial<ContentInstallMarker>).alive
  if (typeof alive !== 'function') return false
  try {
    return alive() === true
  } catch {
    return false
  }
}

interface ChromeLike {
  chrome?: {
    runtime?: {
      getManifest?: () => unknown
    }
  }
}

/**
 * Liveness probe used by the content script itself. `chrome.runtime` is
 * revoked in an orphaned content script, so `getManifest()` throwing is the
 * reliable signal (a property read of `runtime.id` may still succeed).
 */
export function createContentInstallMarker(): ContentInstallMarker {
  return {
    alive: () => {
      // `chrome` only exists inside the extension. The SPA type-checks this
      // module too, so the global is reached through globalThis instead of
      // relying on the extension-only ambient declaration.
      const runtime = (globalThis as ChromeLike).chrome?.runtime
      if (!runtime || typeof runtime.getManifest !== 'function') return false
      try {
        runtime.getManifest()
        return true
      } catch {
        return false
      }
    },
  }
}
