/**
 * Pure helpers for the in-page companion chat.
 *
 * The background owns the canonical message list. The content script may
 * optimistically show the user's question, but it must never append a second
 * copy of an answer that a `SESSION_UPDATE` already delivered. Keeping this
 * decision pure makes the duplicate-rendering race testable.
 */

export interface ChatMessageLike {
  role: string
  content: string
  images?: string[]
  /**
   * True when the turn originally carried images whose data URLs are no
   * longer available (history replay). The bubble shows a small marker so a
   * later answer never silently contradicts an image the user remembers.
   */
  hasImages?: boolean
}

/** Shape of a persisted agent turn as projected into the chat pane. */
export interface AgentTurnLike {
  role: string
  content: string
  hasImages?: boolean
}

/** True when the current last message is exactly the answer we just received. */
export function isLatestAssistantReply(messages: ChatMessageLike[], answer: string): boolean {
  const last = messages[messages.length - 1]
  return !!last && last.role === 'assistant' && last.content === answer
}

/**
 * True when the canonical list already ends with an assistant message.
 *
 * After adopting the background session we only need to know that the answer
 * landed; comparing the text again is unsafe because providers may normalize
 * whitespace between the returned answer and the stored history.
 */
export function hasAssistantTail(messages: ChatMessageLike[]): boolean {
  const last = messages[messages.length - 1]
  return !!last && last.role === 'assistant'
}

/**
 * Project stored turns into the bubble list the content script renders.
 * Images are not restored (their data URLs are not persisted); `hasImages`
 * preserves the fact that one existed.
 */
export function messagesFromTurns(turns: AgentTurnLike[]): ChatMessageLike[] {
  return turns.map((turn) => ({
    role: turn.role === 'assistant' ? 'assistant' : 'user',
    content: turn.content,
    ...(turn.hasImages ? { hasImages: true } : {}),
  }))
}

/**
 * Stable signature for the chat pane, used to skip redundant DOM rebuilds.
 * Image payloads are large, so only their count participates: adding or
 * removing an attachment changes the signature, while the text itself is
 * compared in full. `hasImages` participates because history replay can
 * change it without changing the text.
 */
export function chatRenderSignature(messages: ChatMessageLike[]): string {
  return JSON.stringify(messages.map((message) => [
    message.role,
    message.content,
    message.images?.length || 0,
    message.hasImages ? 1 : 0,
  ]))
}
