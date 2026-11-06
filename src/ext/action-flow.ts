export interface PageMessage {
  type: string
}

export interface PageMessageOptions {
  tabUrl?: string
  sendMessage: (tabId: number, message: PageMessage) => Promise<unknown>
  injectContentScript: (tabId: number) => Promise<unknown>
}

export class UnsupportedPageError extends Error {
  readonly code = 'UNSUPPORTED_PAGE'

  constructor() {
    super('此页面受浏览器限制，无法运行 snooper。请切换到普通网页后重试。')
    this.name = 'UnsupportedPageError'
  }
}

export function isUnsupportedTabUrl(url?: string): boolean {
  return /^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i.test(url || '')
    || /^https?:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)(?:\/|$)/i.test(url || '')
}

export async function sendToPageWithInjection(
  tabId: number,
  message: PageMessage,
  tabUrl: string | undefined,
  { sendMessage, injectContentScript }: PageMessageOptions,
): Promise<{ ok: true; injected: boolean }> {
  if (isUnsupportedTabUrl(tabUrl)) throw new UnsupportedPageError()

  try {
    await sendMessage(tabId, message)
    return { ok: true, injected: false }
  } catch (firstError) {
    try {
      await injectContentScript(tabId)
      await sendMessage(tabId, message)
      return { ok: true, injected: true }
    } catch (retryError) {
      const error = retryError instanceof Error ? retryError : new Error(String(retryError))
      if (firstError instanceof Error) error.cause ??= firstError
      throw error
    }
  }
}

export function openToolbarForTab(
  tabId: number,
  options: PageMessageOptions,
): Promise<{ ok: true; injected: boolean }> {
  return sendToPageWithInjection(tabId, { type: 'TOGGLE_TOOLBAR' }, options.tabUrl, options)
}
