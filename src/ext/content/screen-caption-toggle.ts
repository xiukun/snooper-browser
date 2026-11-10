/**
 * Screen-caption toggle (ADR-043).
 *
 * One menu item turns the burned-in-subtitle channel on or off for the current
 * capture. The label reflects the session state, which the background owns:
 * the offscreen document may stop the channel on its own after repeated
 * provider failures.
 */

import type { SessionState } from './types'

export interface ScreenToggleDeps {
  button: HTMLElement
  getSession: () => SessionState
  bg: (type: string, payload?: Record<string, any>) => Promise<any>
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  adoptSession: (session: any) => void
  openSettings: () => void
}

export function bindScreenCaptionToggle(deps: ScreenToggleDeps) {
  const label = deps.button.querySelector('b')
  const hint = deps.button.querySelector('small')
  let lastStatus = ''

  function sync(): void {
    const session = deps.getSession()
    const status = session.screenCaption || 'off'
    const active = status === 'on'
    deps.button.classList.toggle('active', active)
    deps.button.setAttribute('aria-pressed', active ? 'true' : 'false')
    if (label) label.textContent = active ? '画面字幕 · 开' : '画面字幕'
    if (hint) {
      hint.textContent = status === 'error'
        ? (session.screenCaptionError || '画面字幕已停止')
        : active
          ? '正在读取画面里的硬字幕'
          : '读取画面里的硬字幕并翻译'
    }

    // A channel that died on its own must say why exactly once.
    if (status === 'error' && lastStatus !== 'error') {
      deps.toast(session.screenCaptionError || '画面字幕已停止，请重试', 'err')
    }
    lastStatus = status
  }

  async function toggle(): Promise<void> {
    const session = deps.getSession()
    if (session.state !== 'running' && session.state !== 'starting') {
      deps.toast('请先开始录音：画面字幕需要录制中的视频画面', 'info')
      return
    }

    const active = session.screenCaption === 'on'
    deps.button.classList.add('busy')
    try {
      const result = active
        ? await deps.bg('STOP_SCREEN_CAPTION')
        : await deps.bg('START_SCREEN_CAPTION', { targetLang: session.targetLang })
      if (result?.session) deps.adoptSession(result.session)
      if (!result?.ok) {
        const message = result?.error || '画面字幕切换失败'
        deps.toast(message, 'err')
        if (/API Key|服务商|Base URL|模型/.test(message)) deps.openSettings()
        return
      }
      deps.toast(
        active ? '画面字幕已关闭，恢复语音字幕' : '画面字幕已开启：画面有硬字幕时优先显示',
        active ? 'info' : 'ok',
      )
      sync()
    } finally {
      deps.button.classList.remove('busy')
    }
  }

  deps.button.addEventListener('click', () => {
    void toggle()
  })

  return { sync }
}