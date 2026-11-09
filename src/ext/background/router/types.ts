/** Shared background message-router contracts. */

export interface RouterContext {
  tabId: number
  sender: any
  sendResponse: (response?: any) => void
}

/**
 * Return `true` when the response is sent asynchronously, matching Chrome's
 * `onMessage` contract. Returning `false` closes the channel immediately.
 */
export type MessageHandler = (message: any, ctx: RouterContext) => boolean | void

export type MessageHandlerMap = Record<string, MessageHandler>
