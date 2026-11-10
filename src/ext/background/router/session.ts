/** Session lifecycle + Q&A + panel-opening handlers. */

import { describeCaptureSuspects } from '../../capture-recovery'
import type { AppConfig } from '../../../lib/providers'
import { messagesFromTurns } from '../../chat-state'
import {
  buildAskParts,
  buildSubtitleDigest,
  buildSummaryParts,
  deleteSession as agentDeleteSession,
  getAgentPersistError,
  listSessions as agentListSessions,
  loadAgentStore,
  recordExchange,
  resolveCurrentSession,
  saveAgentStore,
  selectHistoryTurns,
  switchSession as agentSwitchSession,
  type AgentSession,
  type AgentVideo,
} from '../agent'
import { loadConfig } from '../config'
import { askLLM } from '../llm'
import {
  beginTranscript,
  finalizeTranscript,
} from '../transcript-store'
import {
  forceResetOffscreenCapture,
  offscreenHasCapture,
  sendToOffscreen,
  stopOrphanCapture,
} from '../offscreen'
import {
  getOrCreateSession,
  finishSessionTranscript,
  markTranscriptSaveError,
  retrySessionTranscript,
  maybeCloseOffscreen,
  nextGeneration,
  pushSession,
  reconcileSessionState,
  safeSession,
  sessions,
} from '../session-store'
import { resetVideoClock } from '../video-clock'
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

function videoFromMessage(message: any): AgentVideo {
  const rawKey = typeof message.videoKey === 'string' ? message.videoKey.trim() : ''
  return {
    videoKey: rawKey || 'page:unknown',
    videoTitle: typeof message.videoTitle === 'string' ? message.videoTitle : '',
    videoUrl: typeof message.videoUrl === 'string' ? message.videoUrl : '',
  }
}

function videoKeyFromMessage(message: any): string | undefined {
  return typeof message.videoKey === 'string' && message.videoKey.trim()
    ? message.videoKey.trim()
    : undefined
}

/** Project a stored session into the per-tab bubble list. */
function showSessionInTab(tabId: number, session: AgentSession | null): void {
  const s = getOrCreateSession(tabId)
  s.agentSessionId = session?.id ?? null
  s.messages = session ? messagesFromTurns(session.turns) : []
  pushSession(tabId)
}

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

  if (s.saveState?.status === 'error' || s.pendingTranscriptLines?.length) {
    try { await retrySessionTranscript(s); await finishSessionTranscript(s) }
    catch { return { ok: false, error: '上一场有内容未保存，请先重试或导出' } }
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
  s.stoppedGeneration = undefined
  s.subtitles = []
  s.pendingTranscriptLines = []
  s.saveState = { status: 'saved' }
  s.transcriptId = null
  s.streamingSubtitle = null
  s.audioSilent = false
  s.configSnapshot = JSON.parse(JSON.stringify(config))
  // A new generation must not inherit the previous video position: the page
  // may have been on a different episode or paused at a different time.
  resetVideoClock(tabId)
  // Don't clear messages – they persist across restarts
  pushSession(tabId)

  const generation = s.generation
  const isCurrent = () =>
    currentStartVersion(tabId) === startVersion &&
    s.state === 'starting' &&
    s.generation === generation

  try {
    // Open the durable record before capture starts so the first segment is
    // never lost. A storage failure must not block live translation: the
    // lazy ensureTranscript path in offscreen-events retries later.
    try {
      const tab = await chrome.tabs.get(tabId).catch(() => null)
      const record = await beginTranscript({
        tabId,
        generation,
        pageTitle: typeof message.pageTitle === 'string' && message.pageTitle
          ? message.pageTitle
          : (tab?.title || ''),
        url: typeof message.pageUrl === 'string' && message.pageUrl
          ? message.pageUrl
          : (tab?.url || ''),
        sourceLang: s.sourceLang,
        targetLang: s.targetLang,
      })
      if (!isCurrent()) {
        void finalizeTranscript(record.id).catch(error => markTranscriptSaveError(s, error))
        return { ok: true, cancelled: true }
      }
      s.transcriptId = record.id
      pushSession(tabId)
    } catch (err) {
      markTranscriptSaveError(s, err)
    }

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
      // A STOP may have raced the record creation; finalize whatever exists.
      try { await finishSessionTranscript(s) } catch { /* ignore */ }
      return { ok: true, cancelled: true }
    }

    console.warn('[RTTS] START failed:', err.message)
    s.state = 'idle'
    s.stoppedGeneration = undefined
    s.configSnapshot = null
    s.streamId = ''
    s.streamingSubtitle = null
    // An empty record is removed by finalization; a partial one is kept.
    try { await finishSessionTranscript(s) } catch { /* ignore */ }
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
    // dropped, so nothing new appears after the user hits stop — except the
    // final line of a rename that was already segmenting, which the router
    // still accepts for `stoppedGeneration` while `stopping`.
    const stoppedGeneration = s.generation
    s.stoppedGeneration = stoppedGeneration
    s.generation = nextGeneration()

    const stop = sendToOffscreen({
      type: 'STOP_CAPTURE',
      tabId,
      generation: stoppedGeneration,
      // Bounded drain: let the in-flight segment finish so the last subtitle
      // of the session reaches the transcript before it is finalized.
      drain: true,
    }).catch(() => {
      // Offscreen may already be closed
    }).finally(async () => {
      s.state = 'idle'
      s.stoppedGeneration = undefined
      s.streamId = ''
      s.configSnapshot = null
      s.streamingSubtitle = null
      s.audioSilent = false
      // Flush the final chunk and close the record. Keeping transcriptId
      // lets copy/export read the full session after stop (ADR-031).
      try {
        await finishSessionTranscript(s)
      } catch (err) {
        console.warn('[RTTS] transcript finalize failed:', err)
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

    const video = videoFromMessage(message)
    const videoTime = typeof message.videoTime === 'number' && Number.isFinite(message.videoTime)
      ? message.videoTime
      : 0
    // Snapshot the digest now so subtitles arriving during the request cannot
    // change the evidence under the answer.
    const subtitleContext = buildSubtitleDigest(s.subtitles)

    void (async () => {
      const config = s.configSnapshot || await loadConfig()
      const store = await loadAgentStore()
      const session = await resolveCurrentSession(store, video, message.newSession === true)

      // The tab may still be showing an older session (another tab switched,
      // or this page just reloaded). Replace the projection before answering
      // so the UI and the replayed memory describe the same conversation.
      if (s.agentSessionId !== session.id) {
        s.agentSessionId = session.id
        s.messages = [
          ...messagesFromTurns(session.turns),
          { role: 'user', content: question || '（图片）', images: images.length ? images : undefined },
        ]
        pushSession(tabId)
      }

      const history = selectHistoryTurns([
        ...session.turns,
        { role: 'user', content: question, images, at: Date.now() },
      ])
      const parts = buildAskParts({
        history,
        subtitleContext,
        question,
        images,
        videoTitle: session.videoTitle || video.videoTitle,
        videoTime,
      })
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
      sendResponse({
        ok: true,
        answer,
        session: safeSession(s),
        persistWarning: getAgentPersistError() || undefined,
      })
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

  /**
   * ADR-037: one-shot session summary. Evidence comes from the server-side
   * session state (same digest as ASK), the answer goes back to the content
   * script which owns note writes. Chat history is untouched — a summary is a
   * document, not a conversation turn.
   */
  SUMMARIZE: (message, { tabId, sendResponse }) => {
    const s = getOrCreateSession(tabId)
    const digest = buildSubtitleDigest(s.subtitles)
    if (!digest.trim() || s.subtitles.length === 0) {
      sendResponse({ ok: false, error: '还没有可总结的字幕，先开启实时翻译' })
      return false
    }

    const video = videoFromMessage(message)
    void (async () => {
      try {
        const config = s.configSnapshot || await loadConfig()
        const parts = buildSummaryParts({
          digest,
          videoTitle: video.videoTitle,
          subtitleCount: s.subtitles.length,
        })
        const summary = await askLLM({
          parts,
          config,
          sourceLang: s.sourceLang,
          targetLang: s.targetLang,
        })
        // Anchor for the note entry: the evidence window's latest position.
        let videoTime: number | null = null
        for (let i = s.subtitles.length - 1; i >= 0; i -= 1) {
          const t = s.subtitles[i]?.videoTime
          if (typeof t === 'number' && Number.isFinite(t)) {
            videoTime = t
            break
          }
        }
        sendResponse({ ok: true, summary, videoTime, subtitleCount: s.subtitles.length })
      } catch (err: any) {
        sendResponse({ ok: false, error: err?.message || '生成纪要失败' })
      }
    })()

    return true
  },

  /* ---------- Agent conversation management ---------- */

  AGENT_LIST_SESSIONS: (message, { sendResponse }) => {
    const videoKey = videoKeyFromMessage(message)
    void loadAgentStore().then((store) => {
      sendResponse({
        ok: true,
        sessions: agentListSessions(store, videoKey),
        currentId: videoKey ? store.activeByVideo[videoKey] ?? null : null,
      })
    })
    return true
  },

  AGENT_SWITCH_SESSION: (message, { tabId, sendResponse }) => {
    void loadAgentStore().then(async (store) => {
      const session = agentSwitchSession(
        store,
        String(message.id || ''),
        videoKeyFromMessage(message),
      )
      if (!session) {
        sendResponse({ ok: false, error: '会话不存在或属于其他视频' })
        return
      }
      await saveAgentStore(store).catch(() => {})
      showSessionInTab(tabId, session)
      sendResponse({
        ok: true,
        currentId: session.id,
        turns: session.turns,
        session: safeSession(getOrCreateSession(tabId)),
      })
    })
    return true
  },

  AGENT_NEW_SESSION: (message, { tabId, sendResponse }) => {
    void loadAgentStore().then(async (store) => {
      const session = await resolveCurrentSession(store, videoFromMessage(message), true)
      await saveAgentStore(store).catch(() => {})
      showSessionInTab(tabId, session)
      sendResponse({
        ok: true,
        currentId: session.id,
        turns: session.turns,
        session: safeSession(getOrCreateSession(tabId)),
      })
    })
    return true
  },

  AGENT_DELETE_SESSION: (message, { tabId, sendResponse }) => {
    const videoKey = videoKeyFromMessage(message)
    void loadAgentStore().then(async (store) => {
      await agentDeleteSession(store, String(message.id || ''))

      // Re-read the video's active pointer: deleting the current session
      // promotes the newest remaining one, or clears the pane.
      const activeId = videoKey ? store.activeByVideo[videoKey] : undefined
      const active = activeId
        ? store.sessions.find((session) => session.id === activeId) ?? null
        : null
      showSessionInTab(tabId, active)
      sendResponse({
        ok: true,
        currentId: active?.id ?? null,
        turns: active?.turns ?? [],
        session: safeSession(getOrCreateSession(tabId)),
      })
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
