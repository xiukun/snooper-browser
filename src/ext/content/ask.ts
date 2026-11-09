/**
 * Ask flow: post a question (text + optional images), merge the background
 * answer exactly once, and keep the composer busy state honest.
 */

import { hasAssistantTail, isLatestAssistantReply } from '../chat-state'
import type { SessionState } from './types'

export interface AskRefs {
  editor: HTMLElement
  sendButton: HTMLButtonElement
}

export interface AskDeps {
  refs: AskRefs
  getSession: () => SessionState
  adoptSession: (session: any) => void
  bg: (type: string, payload?: Record<string, any>) => Promise<any>
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  updateChat: () => void
  beforeSend: () => void
  getText: () => string
  getImages: () => string[]
  clearComposer: () => void
}

export function createAsk(deps: AskDeps) {
  let busy = false

  async function submitQuestion(question: string, images: string[]) {
    if (busy) {
      deps.toast('正在回答上一题，请稍候', 'info')
      return
    }
    busy = true
    deps.refs.editor.setAttribute('contenteditable', 'false')
    deps.refs.sendButton.disabled = true
    deps.refs.sendButton.textContent = '...'

    const session = deps.getSession()
    if (!session.messages) session.messages = []
    session.messages.push({
      role: 'user',
      content: question || '（图片）',
      images: images.length > 0 ? images : undefined,
    })
    deps.updateChat()

    const requestId = 'q_' + Date.now()
    const res = await deps.bg('ASK', { question, images, requestId })
    const current = deps.getSession()

    // The background pushes the assistant answer through SESSION_UPDATE, and
    // that update can arrive before or after this response. Appending the
    // answer unconditionally produced two identical bubbles for a moment.
    if (res.ok && res.answer) {
      if (!isLatestAssistantReply(current.messages || [], res.answer)) {
        if (res.session) {
          // The background session is canonical and already contains this
          // answer. Trust its assistant tail instead of comparing the text a
          // second time: a provider may normalize whitespace.
          deps.adoptSession(res.session)
          const adopted = deps.getSession()
          if (!hasAssistantTail(adopted.messages || [])) {
            if (!Array.isArray(adopted.messages)) adopted.messages = []
            adopted.messages.push({ role: 'assistant', content: res.answer })
          }
        } else {
          if (!Array.isArray(current.messages)) current.messages = []
          current.messages.push({ role: 'assistant', content: res.answer })
        }
      }
    } else {
      if (!Array.isArray(current.messages)) current.messages = []
      current.messages.push({
        role: 'assistant',
        content: '请求失败：' + (res.error || '未知错误'),
      })
    }
    busy = false
    deps.refs.editor.setAttribute('contenteditable', 'plaintext-only')
    deps.refs.sendButton.disabled = false
    deps.refs.sendButton.textContent = '发送'
    deps.updateChat()
    deps.refs.editor.focus()
  }

  async function sendQuestion() {
    if (busy) return
    // Close the cite popover and leave Markdown preview first: a hidden
    // editor reports '' from innerText.
    deps.beforeSend()
    const text = deps.getText()
    const images = deps.getImages()
    if (!text && images.length === 0) return
    deps.clearComposer()
    await submitQuestion(text, images)
  }

  deps.refs.sendButton.addEventListener('click', sendQuestion)
  deps.refs.editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void sendQuestion()
    }
  })

  return { submitQuestion, sendQuestion }
}
