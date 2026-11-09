/** Session lifecycle + Q&A + panel-opening handlers. */

import { describeCaptureSuspects } from '../../capture-recovery'
import type { AppConfig } from '../../../lib/providers'
import {
  buildAskParts,
  deleteSession as agentDeleteSession,
  listSessions as agentListSessions,
  loadAgentStore,
  recordExchange,
  resolveCurrentSession,
  saveAgentStore,
  selectHistoryTurns,
  switchSession as agentSwitchSession,
} from '../agent'
import { loadConfig } from '../config'
import { persistSessionHistory } from '../history'
import { askLLM } from '../llm'
import {
  forceResetOffscreenCapture,
  offscreenHasCapture,
  sendToOffscreen,
  stopOrphanCapture,
} from '../offscreen'
import {
  getOrCreateSession,
  maybeCloseOffscreen,
  nextGeneration,
  pushSession,
  reconcileSessionState,
  safeSession,
  sessions,
} from '../session-store'
import type { MessageHandlerMap } from './types'

interface StartResult {
  ok: boolean
  error?: string
  code?: string
  alreadyRunning?: boolean
  cancelled?: boolean
  session?: ReturnType<typeof safeSession>
}

interface StartAttempt {
  version: number
  promise: Promise<StartResult>
}

/** In-flight START per tab, so duplicate clicks share one capture attempt. */
const startAttempts = new Map<number, StartAttempt>()
const startCancelVersions = new Map<number, number>()
const stopAttempts = new Map<number, Promise<void>>()

function currentStartVersion(tabId: number): number {
  return startCancelVersions.get(tabId) || 0
}

function cancelStart(tabId: number): void {
  startCancelVersions.set(tabId, currentStartVersion(tabId) + 1)
}

function requestStreamId(tabId: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else if (!id) {
        reject(new Error('获取音频流 ID 失败'))
      } else {
        resolve(id)
      }
    })
  })
}

async function runStart(message: any, tabId: number, startVersion: number): Promise<StartResult> {
  const s = await reconcileSessionState(tabId)
  if (currentStartVersion(tabId) !== startVersion) return { ok: true, cancelled: true }

  if (s.state === 'running' || s.state === 'starting') {
    // In-memory state can outlive the offscreen capture after a service
    // worker restart. Only block when a capture is really alive.
    const live = await offscreenHasCapture(tabId)
    if (live) {
      // START is idempotent. A stale toolbar must never tear down a
      // capture that is still translating in the background.
      return { ok: true, alreadyRunning: true, session: safeSession(s) }
    }
    s.state = 'idle'
    s.streamId = ''
    s.configSnapshot = null
    s.streamingSubtitle = null
    pushSession(tabId)
  }

  const config: AppConfig = await loadConfig()
  if (currentStartVersion(tabId) !== startVersion) return { ok: true, cancelled: true }

  // Missing configuration is a setup state, not an error. Returning before
  // the generation is bumped keeps the console and session history clean.
  const hasKey = config.providers.some((p) => p.apiKey && p.apiKey.trim().length > 0)
  if (!hasKey) {
    console.info('[RTTS] START skipped: 尚未配置 API Key')
    return {
      ok: false,
      code: 'CONFIG_REQUIRED',
      error: '尚未配置 API Key。设置面板已打开，填入后保存再开始',
    }
  }
  const audioRoute = config.routes.audio
  const audioProvider = config.providers.find((p) => p.id === audioRoute.providerId)
  if (!audioProvider || !audioProvider.apiKey) {
    console.info('[RTTS] START skipped: 音频转写服务商缺少 API Key')
    return {
      ok: false,
      code: 'CONFIG_REQUIRED',
      error: `音频转写服务商「${audioProvider?.name || '未配置'}」缺少 API Key，请在设置中配置`,
    }
  }
  if (!audioRoute.model) {
    console.info('[RTTS] START skipped: 音频转写未选择模型')
    return {
      ok: false,
      code: 'CONFIG_REQUIRED',
      error: '音频转写未选择模型，请在设置中选择',
    }
  }

  s.state = 'starting'
  s.sourceLang = message.sourceLang || 'auto'
  s.targetLang = message.targetLang || 'zh'
  s.generation = nextGeneration()
  s.subtitles = []
  s.streamingSubtitle = null
  s.audioSilent = false
  s.configSnapshot = JSON.parse(JSON.stringify(config))
  // Don't clear messages – they persist across restarts
  pushSession(tabId)

  const generation = s.generation
  const isCurrent = () =>
    currentStartVersion(tabId) === startVersion &&
    s.state === 'starting' &&
    s.generation === generation

  try {
    console.log('[RTTS] START:', tabId, 'gen:', generation, 'lang:', s.sourceLang, '→', s.targetLang)

    // Clear an orphaned capture left behind by a restarted service
    // worker. tabCapture refuses a new stream while one is alive.
    await stopOrphanCapture(tabId)
    if (!isCurrent()) return { ok: true, cancelled: true }

    let streamId: string
    try {
      streamId = await requestStreamId(tabId)
    } catch (err: any) {
      if (!/active stream/i.test(err?.message || '')) throw err
      // Offscreen teardown is asynchronous. Confirm the old capture is
      // gone before asking Chrome for a replacement stream id.
      await stopOrphanCapture(tabId)
      // A restarted offscreen document can lose its session map while
      // Chrome keeps the native tab-capture owner alive. Recreating the
      // document is the only reliable way to release that orphan.
      await forceResetOffscreenCapture()
      try {
        streamId = await requestStreamId(tabId)
      } catch (retryErr: any) {
        if (/active stream/i.test(retryErr?.message || '')) {
          throw new Error('录音流在重置后仍被浏览器占用')
        }
        throw retryErr
      }
    }
    if (!isCurrent()) return { ok: true, cancelled: true }

    s.streamId = streamId
    console.log('[RTTS] streamId obtained for tab', tabId)

    // Send to offscreen for capture
    const started = await sendToOffscreen({
      type: 'START_CAPTURE',
      tabId,
      streamId,
      sourceLang: s.sourceLang,
      targetLang: s.targetLang,
      config: s.configSnapshot,
      generation,
    })
    if (started && started.ok === false) {
      throw new Error(started.error || '启动录音失败')
    }

    // A STOP can arrive while tabCapture/getUserMedia is still starting.
    // Only the still-current attempt may commit `running`; otherwise the
    // capture we just created would outlive the stop and block the next
    // start with `active stream`.
    if (!isCurrent()) {
      await sendToOffscreen({ type: 'STOP_CAPTURE', tabId, generation }).catch(() => {})
      return { ok: true, cancelled: true }
    }

    s.state = 'running'
    pushSession(tabId)
    return { ok: true }
  } catch (err: any) {
    if (!isCurrent()) {
      console.info('[RTTS] START cancelled during startup')
      return { ok: true, cancelled: true }
    }

    console.warn('[RTTS] START failed:', err.message)
    s.state = 'idle'
    s.configSnapshot = null
    s.streamId = ''
    s.streamingSubtitle = null
    pushSession(tabId)
    const msg = (err && err.message) || String(err)
    let friendly = msg
    // tabCapture requires the extension to have host permission for the
    // tab. With <all_urls> host permissions this should never fire, but
    // if it does (e.g. Chrome internal pages), guide the user clearly.
    if (/重置后仍被浏览器占用/i.test(msg)) {
      friendly = '浏览器仍占用本页的录音流。请关闭其他录音扩展或标签页，完全退出并重新打开 Chrome 后再试'
    } else if (/active stream/i.test(msg)) {
      friendly = '该标签页仍有残留录音流（扩展后台重启所致）。已自动清理，请再点一次「录音」；若仍失败，请刷新页面后重试'
    } else if (/旧录音流释放超时|无法停止旧录音流|无法确认旧录音流状态/i.test(msg)) {
      friendly = '旧录音流未能释放。请刷新页面后重试；若仍失败，请在扩展管理页重新加载 snooper 后再试'
    } else if (/录音组件释放超时|其他标签页仍在录音|无法确认其他录音状态/i.test(msg)) {
      friendly = '浏览器仍占用本页的录音流。请先停止其他标签页的录音，再刷新本页重试'
    } else if (/重置后仍被浏览器占用|录音流在重置后仍被/i.test(msg)) {
      const suspects = await describeCaptureSuspects(
        await chrome.management.getAll().then((all) =>
          all
            .filter((e) => (e.permissions || []).includes('tabCapture'))
            .map((e) => ({ name: e.name, id: e.id })),
        ).catch(() => []),
      )
      friendly = suspects
        ? `浏览器仍占用本页的录音流，疑似来自：${suspects}。请停用对应扩展后重试`
        : '浏览器仍占用本页的录音流。请关闭其他录音扩展或标签页，完全退出并重新打开 Chrome 后再试'
    } else if (/not been invoked|activeTab/i.test(msg)) {
      friendly = '需要先完成一次授权：点击浏览器工具栏的 snooper 图标（弹出的面板可立即关闭），之后本页可直接使用'
    } else if (/permission|Permission|not allowed|not permitted/i.test(msg)) {
      friendly = '缺少录音权限：请确认扩展已获得「读取和更改网站数据」权限，然后重试'
    }
    return { ok: false, error: friendly }
  }
}

export const sessionHandlers: MessageHandlerMap = {
  /* ---------- Session (content script) ---------- */
  GET_SESSION: (_message, { tabId, sendResponse }) => {
    reconcileSessionState(tabId).then((s) => {
      sendResponse({
        ok: true,
        session: safeSession(s),
      })
    }).catch(() => sendResponse({ ok: false, error: '无法同步当前转写状态' }))
    return true
  },

  SET_LANG: (message, { tabId, sendResponse }) => {
    (async () => {
      const s = await reconcileSessionState(tabId)
      if (message.sourceLang) s.sourceLang = message.sourceLang
      if (message.targetLang) s.targetLang = message.targetLang

      pushSession(tabId)
      // Also forward to offscreen if running. Reconcile first so a stale
      // recovered session cannot briefly publish an idle state here.
      if (s.state === 'running') {
        await sendToOffscreen({
          type: 'SET_LANG',
          tabId,
          sourceLang: s.sourceLang,
          targetLang: s.targetLang,
        })
      }
      sendResponse({ ok: true, session: safeSession(s) })
    })().catch((err: any) => sendResponse({ ok: false, error: err.message || '语言切换失败' }))
    return true
  },

  START: (message, { tabId, sendResponse }) => {
    // One in-flight attempt per tab. A double click used to race past the
    // `starting` check before the offscreen capture existed, creating two
    // stream ids and two audio pipelines. Duplicate messages now share the
    // first attempt instead of starting the tab twice.
    const startVersion = currentStartVersion(tabId)
    const previous = startAttempts.get(tabId)
    let attempt: StartAttempt
    if (previous?.version === startVersion) {
      attempt = previous
    } else {
      const pendingStop = stopAttempts.get(tabId)
      const afterPrevious = previous ? previous.promise.catch(() => undefined) : Promise.resolve()
      const afterStop = pendingStop ? pendingStop.catch(() => undefined) : Promise.resolve()
      const run = Promise.all([afterPrevious, afterStop])
        .then(() => runStart(message, tabId, startVersion))
      attempt = { version: startVersion, promise: run }
      startAttempts.set(tabId, attempt)
      const settle = () => {
        if (startAttempts.get(tabId) !== attempt) return
        startAttempts.delete(tabId)
        startCancelVersions.delete(tabId)
      }
      run.then(settle, settle)
    }
    attempt.promise.then(
      (result) => sendResponse(result),
      (err) => sendResponse({ ok: false, error: err?.message || '启动失败' }),
    )
    return true // async
  },

  STOP: (_message, { tabId, sendResponse }) => {
    // Invalidate a START even if it has not finished reconciling the session
    // yet. Otherwise STOP can observe idle and a pending START can resurrect
    // capture after the STOP response.
    cancelStart(tabId)
    const s = sessions.get(tabId)
    if (!s) {
      // Still tear down: a restarted worker has no session object, but the
      // offscreen capture may be alive and would block the next START.
      const stop = stopOrphanCapture(tabId).then(() => undefined).catch(() => undefined)
      stopAttempts.set(tabId, stop)
      stop.finally(() => {
        if (stopAttempts.get(tabId) === stop) stopAttempts.delete(tabId)
      }).catch(() => {})
      stop.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: true }))
      return true
    }
    // Deliberately idempotent. A stop request must always clear the capture;
    // refusing it with "not transcribing" is how an orphan stream survived.
    if (s.state === 'idle' && s.generation !== 0) {
      const stop = stopOrphanCapture(tabId).then(() => undefined).catch(() => undefined)
      stopAttempts.set(tabId, stop)
      stop.finally(() => {
        if (stopAttempts.get(tabId) === stop) stopAttempts.delete(tabId)
      }).catch(() => {})
      stop.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: true }))
      return true
    }

    s.state = 'stopping'
    pushSession(tabId)

    // Invalidate in-flight ASR/translation results immediately. Late
    // responses from the stopped segment carry the old generation and are
    // dropped, so nothing new appears after the user hits stop.
    const stoppedGeneration = s.generation
    s.generation = nextGeneration()

    const stop = sendToOffscreen({
      type: 'STOP_CAPTURE',
      tabId,
      generation: stoppedGeneration,
    }).catch(() => {
      // Offscreen may already be closed
    }).finally(() => {
      s.state = 'idle'
      s.streamId = ''
      s.configSnapshot = null
      s.streamingSubtitle = null
      s.audioSilent = false
      // Save to session history
      if (s.subtitles && s.subtitles.length > 0) {
        persistSessionHistory(tabId)
      }
      pushSession(tabId)
      maybeCloseOffscreen()
      sendResponse({ ok: true, session: safeSession(s) })
    })
    stopAttempts.set(tabId, stop)
    stop.finally(() => {
      if (stopAttempts.get(tabId) === stop) stopAttempts.delete(tabId)
    }).catch(() => {})
    // Keep the response open until the offscreen teardown finishes. This
    // prevents an immediate GET_SESSION from observing the old live capture
    // and putting the toolbar back into the running state after STOP.
    return true
  },

  ASK: (message, { tabId, sendResponse }) => {
    // Chat stays available after stop: it uses subtitle history as context
    // and loads config on demand instead of relying on the capture session.
    const s = getOrCreateSession(tabId)
    const question = (message.question || '').trim()
    const images: string[] = Array.isArray(message.images) ? message.images.slice(0, 4) : []
    if (question.length > 2000) {
      sendResponse({ ok: false, error: '问题过长（最多 2000 字）' })
      return false
    }

    const requestId = message.requestId || `ask_${Date.now()}`
    s.pendingAskRequestId = requestId

    if (!question && images.length === 0) {
      s.pendingAskRequestId = null
      sendResponse({ ok: false, error: '问题不能为空' })
      return false
    }

    // Multi-turn memory: replay recent turns through the agent, attach the
    // subtitle context to the current question only.
    const recentContext = s.subtitles
      .slice(-20)
      .map((sub) => `[${sub.source}] → ${sub.target}`)
      .join('\n')

    void (async () => {
      const config = s.configSnapshot || await loadConfig()
      const store = await loadAgentStore()
      const session = await resolveCurrentSession(store, message.newSession === true)
      const history = selectHistoryTurns([...session.turns, { role: 'user', content: question, images, at: Date.now() }])
      const parts = buildAskParts({ history, subtitleContext: recentContext, question, images })
      const answer = await askLLM({ parts, config, sourceLang: s.sourceLang, targetLang: s.targetLang })
      if (s.pendingAskRequestId !== requestId) return
      s.pendingAskRequestId = null
      s.messages.push({ role: 'assistant', content: answer })
      pushSession(tabId)
      await recordExchange(
        store,
        session,
        { role: 'user', content: question, images, at: Date.now() },
        { role: 'assistant', content: answer, at: Date.now() },
      )
      sendResponse({ ok: true, answer, session: safeSession(s) })
    })().catch((err: any) => {
      if (s.pendingAskRequestId !== requestId) return
      s.pendingAskRequestId = null
      sendResponse({ ok: false, error: err.message || '获取回答失败' })
    })

    // Store user message optimistically
    s.messages.push({ role: 'user', content: question, images })
    pushSession(tabId)

    return true // async – response will be sent later
  },

  /* ---------- Agent conversation management ---------- */

  AGENT_LIST_SESSIONS: (_message, { sendResponse }) => {
    void loadAgentStore().then((store) => sendResponse({ ok: true, sessions: agentListSessions(store), currentId: store.currentId }))
    return true
  },

  AGENT_SWITCH_SESSION: (message, { sendResponse }) => {
    void loadAgentStore().then(async (store) => {
      const session = agentSwitchSession(store, String(message.id || ''))
      if (!session) {
        sendResponse({ ok: false, error: '会话不存在' })
        return
      }
      await saveAgentStore(store).catch(() => {})
      sendResponse({ ok: true, currentId: store.currentId })
    })
    return true
  },

  AGENT_NEW_SESSION: (_message, { sendResponse }) => {
    void loadAgentStore().then(async (store) => {
      await resolveCurrentSession(store, true)
      await saveAgentStore(store).catch(() => {})
      sendResponse({ ok: true, currentId: store.currentId })
    })
    return true
  },

  AGENT_DELETE_SESSION: (message, { sendResponse }) => {
    void loadAgentStore().then(async (store) => {
      await agentDeleteSession(store, String(message.id || ''))
      sendResponse({ ok: true, currentId: store.currentId })
    })
    return true
  },
  OPEN_SETTINGS: (_message, { tabId, sendResponse }) => {
    // sidePanel.open() from SW requires user gesture; content script messages
    // don't qualify, so this may fail. Fallback instructs user to click icon.
    chrome.sidePanel.open({ tabId }).then(() => {
      sendResponse({ ok: true })
    }).catch(() => {
      sendResponse({ ok: false, error: '请点击浏览器工具栏的 snooper-browser 图标打开配置面板' })
    })
    return true
  },

  OPEN_IMAGE_GEN: (message, { tabId, sendResponse }) => {
    // Forward prompt to image gen — open side panel with image gen context
    chrome.sidePanel.open({ tabId }).then(() => {
      // Store prompt in sessionStorage for the side panel to pick up
      try {
        sessionStorage.setItem('snooper.image-gen-prompt', message.prompt || '')
      } catch { /* ignore */ }
      sendResponse({ ok: true })
    }).catch(() => {
      sendResponse({ ok: false, error: '请点击浏览器工具栏图标打开配置面板' })
    })
    return true
  },
}
