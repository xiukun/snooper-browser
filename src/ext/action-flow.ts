export interface PageMessage {
  type: string
  /** ADR-034 SEEK_VIDEO payload: target position in seconds. */
  seconds?: number
}

export interface PageMessageOptions {
  tabUrl?: string
  sendMessage: (tabId: number, message: PageMessage) => Promise<unknown>
  injectContentScript: (tabId: number) => Promise<unknown>
  /**
   * ADR-036: inspect the content script's own response. The envelope this
   * function returns (`{ ok, injected }`) says nothing about what the page
   * *did*; callers that need the handler's verdict (e.g. whether a seek
   * succeeded) pass this hook and read `responseOk` from the envelope.
   */
  collectResponse?: (raw: unknown) => boolean
}

export class UnsupportedPageError extends Error {
  readonly code = 'UNSUPPORTED_PAGE'

  constructor() {
    super('此页面受浏览器限制，无法运行 snooper。请切换到普通网页后重试。')
    this.name = 'UnsupportedPageError'
  }
}

const CONTENT_SCRIPT_FILE = 'content.js'

/**
 * Inject the content script after clearing the install marker left by an
 * orphaned instance (extension-reload recovery).
 *
 * Reloading the extension leaves open tabs with the previous script: its
 * listener cannot answer, but its marker still sits in the page's isolated
 * world. Injecting over it used to bail out and the retried message failed
 * with "Receiving end does not exist". This runs only after a send failed, so
 * no live listener exists and clearing cannot create a duplicate toolbar.
 */
export async function injectContentScriptFresh(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: () => {
      delete (globalThis as any).__rttsContentInstalled
    },
  })
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  })
}

export function isUnsupportedTabUrl(url?: string): boolean {
  return /^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i.test(url || '')
    || /^https?:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)(?:\/|$)/i.test(url || '')
}

export async function sendToPageWithInjection(
  tabId: number,
  message: PageMessage,
  tabUrl: string | undefined,
  { sendMessage, injectContentScript, collectResponse }: PageMessageOptions,
): Promise<{ ok: true; injected: boolean; responseOk?: boolean }> {
  if (isUnsupportedTabUrl(tabUrl)) throw new UnsupportedPageError()

  try {
    const raw = await sendMessage(tabId, message)
    return {
      ok: true,
      injected: false,
      ...(collectResponse ? { responseOk: collectResponse(raw) } : {}),
    }
  } catch (firstError) {
    try {
      await injectContentScript(tabId)
      const raw = await sendMessage(tabId, message)
      return {
        ok: true,
        injected: true,
        ...(collectResponse ? { responseOk: collectResponse(raw) } : {}),
      }
    } catch (retryError) {
      const error = retryError instanceof Error ? retryError : new Error(String(retryError))
      if (firstError instanceof Error) error.cause ??= firstError
      throw error
    }
  }
}

/**
 * Show the toolbar for a tab, injecting the content script first when needed.
 *
 * `TOGGLE_TOOLBAR` flips visibility, so a stale double-send would hide the bar
 * it just revealed. Injection + toggle is therefore the *only* resend path,
 * and the content script acknowledges every toggle so a slow first response
 * can never be mistaken for "content script missing".
 */
export function openToolbarForTab(
  tabId: number,
  options: PageMessageOptions,
): Promise<{ ok: true; injected: boolean }> {
  return sendToPageWithInjection(tabId, { type: 'TOGGLE_TOOLBAR' }, options.tabUrl, options)
}
