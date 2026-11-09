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
  /**
   * Make the toolbar visible again. A capture can only be observed through the
   * in-page toolbar, so every start path guarantees it is on screen — a hidden
   * toolbar used to make capture look like "nothing happened".
   */
  ensureToolbarVisible: () => void
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

    // Starting a capture always reveals the toolbar: a start click is only
    // reachable from the visible toolbar anyway, so this only repairs a state
    // where something else hid it mid-flight.
    deps.ensureToolbarVisible()
    session.state = 'starting'
    deps.render()
    const res = await deps.bg('START', {
      sourceLang: session.sourceLang,
      targetLang: session.targetLang,
    })
    if (!res.ok) {
      const message = res.error || '启动失败'
      // Missing configuration is a first-run setup step, not a failure.
      const needsSetup = res.code === 'CONFIG_REQUIRED'
        || message.includes('API Key')
        || message.includes('未选择模型')
      deps.toast(message, needsSetup ? 'info' : 'err')
      if (needsSetup) deps.openSettings()
      await deps.syncSession()
      // A failed start must leave the UI where the user can see the reason
      // instead of a toolbar that looks like it closed itself.
      deps.ensureToolbarVisible()
      return
    }
    if (res.session) deps.adoptSession(res.session)
    else await deps.syncSession()
    deps.ensureToolbarVisible()
  })
}
