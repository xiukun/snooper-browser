/**
 * Record button: start/stop real capture, or stop the demo loop.
 *
 * The session object is owned by content.ts and can be replaced wholesale when
 * a background snapshot arrives, so every branch re-reads it through the
 * getter instead of closing over an old reference.
 */

import type { SessionState } from './types'

export interface RecorderDeps {
  button: HTMLElement
  getSession: () => SessionState
  bg: (type: string, payload?: Record<string, any>) => Promise<any>
  render: () => void
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  openSettings: () => void
  stopDemo: () => void
  syncSession: () => Promise<boolean>
  adoptSession: (session: any) => void
}

export function bindRecorder(deps: RecorderDeps) {
  deps.button.addEventListener('click', async () => {
    const session = deps.getSession()
    const state = session.state
    if (session.isDemoMode && state === 'running') {
      deps.stopDemo()
      session.isDemoMode = false
      session.state = 'idle'
      deps.render()
      return
    }
    if (state === 'running' || state === 'starting') {
      session.state = 'stopping'
      deps.render()
      await deps.bg('STOP')
      await deps.syncSession()
      return
    }

    // Stop the demo before a real session starts, and drop its filler lines.
    if (session.isDemoMode) {
      deps.stopDemo()
      session.isDemoMode = false
      session.subtitles = []
    }

    session.state = 'starting'
    deps.render()
    const res = await deps.bg('START', {
      sourceLang: session.sourceLang,
      targetLang: session.targetLang,
    })
    if (!res.ok) {
      const message = res.error || '启动失败'
      deps.toast(message, 'err')
      if (message.includes('API Key') || message.includes('未选择模型')) deps.openSettings()
      await deps.syncSession()
      return
    }
    if (res.session) deps.adoptSession(res.session)
    else await deps.syncSession()
  })
}
