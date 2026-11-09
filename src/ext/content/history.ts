/**
 * Companion session controls: 新话题 and the per-video history popover.
 *
 * Both actions share one truth source — the background `AgentSession` — and
 * project its turns into `SessionState.messages` (ADR-030). The content script
 * never invents a session or a turn list locally.
 */

import { messagesFromTurns } from '../chat-state'
import type { SessionState } from './types'
import type { VideoContext } from './video-context'

export interface CompanionSessionRefs {
  newTopic: HTMLButtonElement
  historyButton: HTMLButtonElement
  popover: HTMLElement
  list: HTMLElement
  empty: HTMLElement
  close: HTMLButtonElement
}

export interface CompanionSessionDeps {
  refs: CompanionSessionRefs
  getSession: () => SessionState
  getVideoContext: () => VideoContext
  bg: (type: string, payload?: Record<string, any>) => Promise<any>
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  updateChat: () => void
  clearComposer: () => void
  focusComposer: () => void
  /** True while an answer is in flight; switching would corrupt the projection. */
  isBusy: () => boolean
}

interface HistorySession {
  id: string
  title: string
  videoTitle?: string
  turnCount: number
  updatedAt: number
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (!Number.isFinite(diff) || diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function createCompanionSessions(deps: CompanionSessionDeps) {
  const r = deps.refs
  let isOpen = false

  function setOpen(next: boolean) {
    isOpen = next
    r.popover.hidden = !next
    r.historyButton.setAttribute('aria-expanded', String(next))
    if (next) void refresh()
  }

  function close() {
    setOpen(false)
  }

  function renderList(sessions: HistorySession[], currentId: string | null) {
    r.list.textContent = ''
    const visible = sessions.filter((session) => session.turnCount > 0)
    r.empty.hidden = visible.length > 0
    for (const session of visible) {
      const row = document.createElement('div')
      row.className = 'rtts-history-item' + (session.id === currentId ? ' active' : '')

      const main = document.createElement('button')
      main.type = 'button'
      main.className = 'rtts-history-main'
      main.dataset.id = session.id
      main.title = session.title || '未命名对话'

      const title = document.createElement('span')
      title.className = 'rtts-history-title'
      title.textContent = session.title || '未命名对话'
      main.appendChild(title)

      const meta = document.createElement('span')
      meta.className = 'rtts-history-meta'
      const rounds = Math.max(1, Math.ceil(session.turnCount / 2))
      meta.textContent = `${rounds} 轮 · ${relativeTime(session.updatedAt)}`
      main.appendChild(meta)

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'rtts-history-del'
      remove.dataset.del = session.id
      remove.title = '删除这个会话'
      remove.setAttribute('aria-label', `删除会话 ${session.title || '未命名对话'}`)
      remove.textContent = '✕'

      row.append(main, remove)
      r.list.appendChild(row)
    }
  }

  async function refresh() {
    const video = deps.getVideoContext()
    const res = await deps.bg('AGENT_LIST_SESSIONS', { videoKey: video.videoKey })
    if (!res.ok) {
      deps.toast(res.error || '读取历史失败', 'err')
      return
    }
    const currentId = res.currentId ?? deps.getSession().agentSessionId ?? null
    renderList(Array.isArray(res.sessions) ? res.sessions : [], currentId)
  }

  function applySession(currentId: string | null, turns: unknown) {
    const session = deps.getSession()
    session.agentSessionId = currentId
    session.messages = messagesFromTurns(Array.isArray(turns) ? turns as any[] : [])
    deps.updateChat()
  }

  async function startNewTopic() {
    if (deps.isBusy()) {
      deps.toast('正在回答上一题，请稍候', 'info')
      return
    }
    const res = await deps.bg('AGENT_NEW_SESSION', { ...deps.getVideoContext() })
    if (!res.ok) {
      deps.toast(res.error || '新建会话失败', 'err')
      return
    }
    applySession(res.currentId ?? null, [])
    deps.clearComposer()
    deps.focusComposer()
    setOpen(false)
    deps.toast('已开始新话题', 'ok')
  }

  async function switchTo(id: string) {
    if (deps.isBusy()) {
      deps.toast('正在回答上一题，请稍候', 'info')
      return
    }
    const video = deps.getVideoContext()
    const res = await deps.bg('AGENT_SWITCH_SESSION', { id, videoKey: video.videoKey })
    if (!res.ok) {
      deps.toast(res.error || '切换会话失败', 'err')
      return
    }
    applySession(res.currentId ?? null, res.turns)
    setOpen(false)
    deps.focusComposer()
  }

  async function remove(id: string) {
    if (deps.isBusy()) {
      deps.toast('正在回答上一题，请稍候', 'info')
      return
    }
    const video = deps.getVideoContext()
    const res = await deps.bg('AGENT_DELETE_SESSION', { id, videoKey: video.videoKey })
    if (!res.ok) {
      deps.toast(res.error || '删除会话失败', 'err')
      return
    }
    applySession(res.currentId ?? null, res.turns)
    await refresh()
  }

  r.historyButton.addEventListener('click', () => {
    setOpen(!isOpen)
  })
  r.close.addEventListener('click', () => setOpen(false))
  r.newTopic.addEventListener('click', () => {
    void startNewTopic()
  })
  r.list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const removeButton = target.closest('.rtts-history-del') as HTMLElement | null
    if (removeButton?.dataset.del) {
      event.stopPropagation()
      void remove(removeButton.dataset.del)
      return
    }
    const main = target.closest('.rtts-history-main') as HTMLElement | null
    if (main?.dataset.id) void switchTo(main.dataset.id)
  })

  return {
    isOpen: () => isOpen,
    open: () => setOpen(true),
    close,
    refresh,
    startNewTopic,
  }
}
