/**
 * RTTS Background Service Worker (MV3) — TypeScript
 *
 * Responsibilities:
 * 1. Session management – one independent session per tabId
 * 2. Message routing – content script ↔ background ↔ offscreen ↔ side panel
 * 3. Content script injection on action click
 * 4. Offscreen document lifecycle (single document, multi-session)
 * 5. Config persistence in chrome.storage.local (TRUSTED_CONTEXTS)
 * 6. Generation counter to reject stale results after stop / navigation / restart
 */

import type { AppConfig } from '../lib/providers'

/* ===== Constants ===== */

const CONFIG_KEY = 'snooper.extension.config.v1';
const SESSION_RECOVERY_KEY = 'snooper.extension.sessions.v1';
const OFFSCREEN_PATH = 'offscreen.html';
const CONTENT_SCRIPT_FILE = 'content.js';
const FS_BRIDGE_FILE = 'fullscreen-bridge.js';

const DEFAULT_CONFIG: AppConfig = {
  providers: [
    {
      id: 'moss-official',
      name: 'MOSS 官方',
      baseUrl: 'https://api.mosi.cn/v1',
      apiKey: '',
      protocol: 'moss',
      note: '官方 MOSS 网关',
      models: [],
      lastSyncedAt: null,
      status: 'unknown',
      lastError: '',
    },
  ],
  routes: {
    llm: { providerId: 'moss-official', model: 'moss-vl-1.0' },
    audio: { providerId: 'moss-official', model: 'moss-transcribe-1.0' },
    video: { providerId: 'moss-official', model: 'moss-vl-realtime-1.0' },
  },
};

/* ===== Session Types ===== */

interface SubtitleEntry {
  id: string
  at: number
  endedAt: number | null
  source: string
  target: string
  latency: number
}

interface MessageEntry {
  role: string
  content: string
}

interface StreamingSubtitle {
  at: number
  source: string
  partialTarget: string
  latency: number
}

interface SessionState {
  tabId: number
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'error'
  sourceLang: string
  targetLang: string
  generation: number
  configSnapshot: AppConfig | null
  subtitles: SubtitleEntry[]
  messages: MessageEntry[]
  streamId: string
  pendingAskRequestId: string | null
  streamingSubtitle: StreamingSubtitle | null
}

/** @type {Map<number, SessionState>} */
const sessions = new Map<number, SessionState>();

let generationCounter = 0;

function nextGeneration() {
  return ++generationCounter;
}

function createSession(tabId: number): SessionState {
  const s: SessionState = {
    tabId,
    state: 'idle',
    sourceLang: 'auto',
    targetLang: 'zh',
    generation: 0,
    configSnapshot: null,
    subtitles: [],
    messages: [],
    streamId: '',
    pendingAskRequestId: null,
    streamingSubtitle: null,
  };
  sessions.set(tabId, s);
  return s;
}

function getOrCreateSession(tabId: number): SessionState {
  let s = sessions.get(tabId);
  if (!s) {
    s = createSession(tabId);
  }
  return s;
}

function removeSession(tabId: number) {
  sessions.delete(tabId);
  // Also tell offscreen to clean up
  sendToOffscreen({ type: 'STOP_CAPTURE', tabId }).catch(() => {});
  checkAndCloseOffscreen();
}

/* ===== Offscreen Document Management ===== */

let offscreenCreationPromise: Promise<void> | null = null;

async function ensureOffscreen() {
  if (offscreenCreationPromise) return offscreenCreationPromise;

  offscreenCreationPromise = (async () => {
    try {
      const hasDoc = typeof chrome.offscreen !== 'undefined' &&
        typeof chrome.offscreen.hasDocument === 'function' &&
        (await chrome.offscreen.hasDocument());
      if (hasDoc) return;
    } catch {
      // hasDocument not available or error
    }

    try {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_PATH),
        reasons: ['USER_MEDIA'],
        justification: 'Capture tab audio stream for real-time transcription and translation',
      });
    } catch (err: any) {
      // If document already exists, Chrome throws; ignore
      if (!err.message?.includes('already exists')) {
        throw err;
      }
    }
  })();

  try {
    await offscreenCreationPromise;
  } finally {
    offscreenCreationPromise = null;
  }
}

async function sendToOffscreen(message: Record<string, any>) {
  await ensureOffscreen();
  try {
    const resp = await chrome.runtime.sendMessage({
      target: 'offscreen',
      ...message,
    });
    return resp;
  } catch (err: any) {
    // Offscreen may not be listening yet
    throw new Error('Offscreen 通信失败: ' + (err.message || '未知错误'));
  }
}

async function checkAndCloseOffscreen() {
  let hasActive = false;
  for (const s of sessions.values()) {
    if (s.state === 'running' || s.state === 'starting') {
      hasActive = true;
      break;
    }
  }
  if (hasActive) return;

  try {
    const hasDoc = typeof chrome.offscreen !== 'undefined' &&
      typeof chrome.offscreen.hasDocument === 'function' &&
      (await chrome.offscreen.hasDocument());
    if (hasDoc) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    // ignore
  }
}

/* ===== Config Persistence ===== */

async function loadConfig(): Promise<AppConfig> {
  try {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    if (result[CONFIG_KEY]) {
      return JSON.parse(result[CONFIG_KEY]);
    }
  } catch {
    // corrupted or missing
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

async function saveConfig(config: AppConfig) {
  // Basic validation
  if (!config || typeof config !== 'object') {
    throw new Error('配置格式无效');
  }
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error('至少需要配置一个服务商');
  }
  for (const p of config.providers) {
    if (!p.id || typeof p.id !== 'string') throw new Error('服务商缺少有效 ID');
    if (!p.baseUrl || typeof p.baseUrl !== 'string') throw new Error(`服务商 "${p.name}" 缺少 Base URL`);
    try {
      new URL(p.baseUrl);
    } catch {
      throw new Error(`服务商 "${p.name}" 的 Base URL 格式无效: ${p.baseUrl}`);
    }
    if (p.apiKey && typeof p.apiKey === 'string' && p.apiKey.length > 1024) {
      throw new Error(`服务商 "${p.name}" 的 API Key 过长`);
    }
  }
  if (!config.routes || typeof config.routes !== 'object') {
    throw new Error('能力路由配置无效');
  }

  const json = JSON.stringify(config);
  await chrome.storage.local.set({ [CONFIG_KEY]: json });
  // Ensure only trusted extension contexts can read config
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // Available in Chrome 116+; older versions ignore
  }
}

/* ===== Content Script Injection ===== */

async function injectContentScript(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch (err: any) {
    // May already be injected or tab not ready
    console.warn('[RTTS] injectContentScript error:', err.message);
  }
}

/* ===== Side Panel Management ===== */

async function openSidePanel(tabId: number) {
  try {
    await chrome.sidePanel.open({ tabId });
  } catch (err: any) {
    console.warn('[RTTS] openSidePanel error:', err.message);
  }
}

/* ===== Push Session to Content Script ===== */

function pushSession(tabId: number) {
  const s = sessions.get(tabId);
  if (!s) return;

  // Build a safe session object (no config/keys)
  const safeSession = {
    state: s.state,
    sourceLang: s.sourceLang,
    targetLang: s.targetLang,
    subtitles: s.subtitles,
    messages: s.messages,
    streamingSubtitle: s.streamingSubtitle,
  };

  chrome.tabs.sendMessage(tabId, {
    type: 'SESSION_UPDATE',
    session: safeSession,
  }).catch(() => {
    // Tab may have been closed or content script not loaded
  });
}

/**
 * Send a lightweight streaming update to the content script.
 * This is separate from pushSession to avoid re-rendering all subtitles
 * on every SSE delta.
 */
function pushStreamingUpdate(tabId: number) {
  const s = sessions.get(tabId);
  if (!s) return;

  chrome.tabs.sendMessage(tabId, {
    type: 'STREAMING_UPDATE',
    streamingSubtitle: s.streamingSubtitle, // null clears the streaming state
  }).catch(() => {
    // Tab may be closed; best-effort
  });
}

/* ===== Message Router ===== */

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  // Only handle messages targeted at background
  if (message?.target !== 'background') {
    // If targeted at offscreen, ignore here
    return false;
  }

  const tabId = sender.tab?.id;
  const isContentScript = !!tabId;
  const isSidePanel = sender.url?.startsWith(chrome.runtime.getURL('sidepanel/'));

  // For content script messages, reject if no valid tab context
  if (isContentScript && !tabId) {
    sendResponse({ ok: false, error: '无法确定标签页上下文' });
    return false;
  }

  // For side panel messages, reject non-extension origins
  if (!isContentScript && !isSidePanel) {
    sendResponse({ ok: false, error: '未经授权的来源' });
    return false;
  }

  switch (message.type) {
    /* ---------- Config (side panel only) ---------- */
    case 'GET_CONFIG': {
      if (!isSidePanel) {
        sendResponse({ ok: false, error: '仅配置面板可读取配置' });
        return false;
      }
      loadConfig().then((config) => {
        sendResponse({ ok: true, config });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // async
    }

    case 'SAVE_CONFIG': {
      if (!isSidePanel) {
        sendResponse({ ok: false, error: '仅配置面板可修改配置' });
        return false;
      }
      saveConfig(message.config).then(() => {
        sendResponse({ ok: true });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // async
    }

    /* ---------- Session (content script) ---------- */
    case 'GET_SESSION': {
      const s = getOrCreateSession(tabId);
      sendResponse({
        ok: true,
        session: {
          state: s.state,
          sourceLang: s.sourceLang,
          targetLang: s.targetLang,
          subtitles: s.subtitles,
          messages: s.messages,
          streamingSubtitle: s.streamingSubtitle,
        },
      });
      return false;
    }

    case 'SET_LANG': {
      const s = getOrCreateSession(tabId);
      if (message.sourceLang) s.sourceLang = message.sourceLang;
      if (message.targetLang) s.targetLang = message.targetLang;
      pushSession(tabId);

      // Also forward to offscreen if running
      if (s.state === 'running') {
        sendToOffscreen({ type: 'SET_LANG', tabId, sourceLang: s.sourceLang, targetLang: s.targetLang }).catch(() => {});
      }

      sendResponse({ ok: true });
      return false;
    }

    case 'START': {
      const s = getOrCreateSession(tabId);
      if (s.state === 'running' || s.state === 'starting') {
        sendResponse({ ok: false, error: '当前标签页已在转写中' });
        return false;
      }

      s.state = 'starting';
      s.sourceLang = message.sourceLang || 'auto';
      s.targetLang = message.targetLang || 'zh';
      s.generation = nextGeneration();
      s.subtitles = [];
      // Don't clear messages – they persist across restarts
      pushSession(tabId);

      // Load config and take a snapshot
      loadConfig().then(async (config) => {
        // Pre-check: verify at least one provider has API key
        const hasKey = config.providers.some((p) => p.apiKey && p.apiKey.trim().length > 0);
        if (!hasKey) {
          throw new Error('尚未配置 API Key，请先在侧栏「服务商配置」中填入有效的密钥');
        }
        // Pre-check: audio route must resolve
        const audioRoute = config.routes.audio;
        const audioProvider = config.providers.find((p) => p.id === audioRoute.providerId);
        if (!audioProvider || !audioProvider.apiKey) {
          throw new Error(`音频转写服务商「${audioProvider?.name || '未配置'}」缺少 API Key`);
        }
        if (!audioRoute.model) {
          throw new Error('音频转写未选择模型');
        }

        s.configSnapshot = JSON.parse(JSON.stringify(config));
        console.log('[RTTS] START:', tabId, 'gen:', s.generation, 'lang:', s.sourceLang, '→', s.targetLang);

        // Get stream ID
        try {
          const streamId = await new Promise<string>((resolve, reject) => {
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (!id) {
                reject(new Error('获取音频流 ID 失败'));
              } else {
                resolve(id);
              }
            });
          });
          s.streamId = streamId;
          console.log('[RTTS] streamId obtained for tab', tabId);

          // Send to offscreen for capture
          await sendToOffscreen({
            type: 'START_CAPTURE',
            tabId,
            streamId,
            sourceLang: s.sourceLang,
            targetLang: s.targetLang,
            config: s.configSnapshot,
            generation: s.generation,
          });

          s.state = 'running';
          pushSession(tabId);
          sendResponse({ ok: true });
        } catch (err: any) {
          console.warn('[RTTS] START failed:', err.message);
          s.state = 'idle';
          s.configSnapshot = null;
          s.streamId = '';
          sendResponse({ ok: false, error: err.message });
        }
      }).catch((err) => {
        console.warn('[RTTS] START config error:', err.message);
        s.state = 'idle';
        s.configSnapshot = null;
        sendResponse({ ok: false, error: err.message });
      });

      return true; // async
    }

    case 'STOP': {
      const s = sessions.get(tabId);
      if (!s || (s.state !== 'running' && s.state !== 'starting')) {
        sendResponse({ ok: false, error: '当前标签页未在转写' });
        return false;
      }

      s.state = 'stopping';
      pushSession(tabId);

      sendToOffscreen({
        type: 'STOP_CAPTURE',
        tabId,
        generation: s.generation,
      }).catch(() => {
        // Offscreen may already be closed
      }).finally(() => {
        s.state = 'idle';
        s.streamId = '';
        s.configSnapshot = null;
        s.streamingSubtitle = null;
        pushSession(tabId);
        checkAndCloseOffscreen();
      });

      sendResponse({ ok: true });
      return false;
    }

    case 'ASK': {
      const s = sessions.get(tabId);
      if (!s || s.state !== 'running') {
        sendResponse({ ok: false, error: '当前标签页未在运行，请先开始转写' });
        return false;
      }

      const question = (message.question || '').trim();
      if (!question) {
        sendResponse({ ok: false, error: '问题不能为空' });
        return false;
      }
      if (question.length > 2000) {
        sendResponse({ ok: false, error: '问题过长（最多 2000 字）' });
        return false;
      }

      const requestId = message.requestId || `ask_${Date.now()}`;
      s.pendingAskRequestId = requestId;

      // Build context from recent subtitles
      const recentContext = s.subtitles
        .slice(-20)
        .map((sub) => `[${sub.source}] → ${sub.target}`)
        .join('\n');

      // Handle ASK via offscreen (which has fetch capability)
      sendToOffscreen({
        type: 'ASK_QUESTION',
        tabId,
        question,
        requestId,
        generation: s.generation,
        config: s.configSnapshot,
        context: recentContext,
        sourceLang: s.sourceLang,
        targetLang: s.targetLang,
      }).then((result: any) => {
        if (s.pendingAskRequestId !== requestId) return; // stale
        s.pendingAskRequestId = null;

        if (result && result.ok && result.answer) {
          s.messages.push({ role: 'assistant', content: result.answer });
          pushSession(tabId);
          sendResponse({ ok: true, answer: result.answer });
        } else {
          sendResponse({ ok: false, error: result?.error || '获取回答失败' });
        }
      }).catch((err: any) => {
        if (s.pendingAskRequestId !== requestId) return;
        s.pendingAskRequestId = null;
        sendResponse({ ok: false, error: err.message });
      });

      // Store user message optimistically
      s.messages.push({ role: 'user', content: question });
      pushSession(tabId);

      return true; // async – response will be sent later
    }

    case 'OPEN_SETTINGS': {
      // sidePanel.open() from SW requires user gesture; content script messages
      // don't qualify, so this may fail. Fallback instructs user to click icon.
      chrome.sidePanel.open({ tabId }).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false, error: '请点击浏览器工具栏的 RTTS 图标打开配置面板' });
      });
      return true;
    }

    default:
      sendResponse({ ok: false, error: `未知消息类型: ${message.type}` });
      return false;
  }
});

/* ===== Offscreen → Background Messages ===== */

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  // Only process messages FROM offscreen
  if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PATH)) {
    return false;
  }

  switch (message.type) {
    case 'CAPTURE_SUBTITLE_STREAMING': {
      const s = sessions.get(message.tabId);
      if (!s || s.generation !== message.generation) {
        // Stale streaming update — ignore
        return false;
      }

      // Update the streaming subtitle in-place (not pushed to subtitles[] yet)
      s.streamingSubtitle = {
        at: message.at || Date.now(),
        source: message.source || '',
        partialTarget: message.partialTarget || '',
        latency: message.latency || 0,
      };

      // Forward to content script via lightweight message
      pushStreamingUpdate(message.tabId);
      return false;
    }

    case 'CAPTURE_SUBTITLE': {
      const s = sessions.get(message.tabId);
      if (!s || s.generation !== message.generation) {
        // Stale result – ignore
        return false;
      }

      // Clear streaming state (final subtitle has arrived)
      s.streamingSubtitle = null;

      s.subtitles.push({
        id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        at: message.at || Date.now(),
        endedAt: message.endedAt || null,
        source: message.source || '',
        target: message.target || '',
        latency: message.latency || 0,
      });

      // Keep subtitle history bounded
      if (s.subtitles.length > 200) {
        s.subtitles = s.subtitles.slice(-150);
      }

      pushSession(message.tabId);
      return false;
    }

    case 'CAPTURE_ERROR': {
      const s = sessions.get(message.tabId);
      if (!s || s.generation !== message.generation) return false;

      s.state = 'error';
      s.streamingSubtitle = null;
      pushStreamingUpdate(message.tabId);
      pushSession(message.tabId);
      return false;
    }

    case 'ASK_RESULT': {
      // This is handled in the main message router via the async response
      return false;
    }
  }

  return false;
});

/* ===== Tab Lifecycle ===== */

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId: number) => {
  removeSession(tabId);
});

// Clean up on navigation
chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any) => {
  if (changeInfo.url) {
    const s = sessions.get(tabId);
    if (s && (s.state === 'running' || s.state === 'starting')) {
      // Navigation while capturing – stop gracefully
      sendToOffscreen({ type: 'STOP_CAPTURE', tabId, generation: s.generation }).catch(() => {});
      s.state = 'idle';
      s.streamId = '';
      s.configSnapshot = null;
      s.subtitles = [];
      s.streamingSubtitle = null;
      // Keep messages across navigation
      pushSession(tabId);
      checkAndCloseOffscreen();
    }
  }
});

/* ===== Action Click ===== */

chrome.action.onClicked.addListener((tab: any) => {
  // 1. Inject MAIN-world fullscreen bridge (needs MAIN to intercept requestFullscreen)
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [FS_BRIDGE_FILE],
    world: 'MAIN',
  }).catch((err: any) => {
    console.warn('[RTTS] FS bridge injection error:', err.message);
  });

  // 2. Inject ISOLATED-world content script (floating pill + subtitles)
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [CONTENT_SCRIPT_FILE],
  }).catch((err: any) => {
    console.warn('[RTTS] content script injection error:', err.message);
  });

  // 3. Open side panel for configuration
  chrome.sidePanel.open({ tabId: tab.id }).catch((err: any) => {
    console.warn('[RTTS] sidePanel.open error:', err.message);
  });
});

/* ===== Extension Install / Update ===== */

chrome.runtime.onInstalled.addListener(async () => {
  // Set side panel behavior
  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: false, // We handle this manually in onClicked
    });
  } catch {
    // Older Chrome versions
  }

  // Ensure default config exists
  const existing = await loadConfig();
  if (!existing || !existing.providers || existing.providers.length === 0) {
    await saveConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
  }
});

/* ===== Recovery on Service Worker Restart ===== */

async function recoverSessions() {
  try {
    const result = await chrome.storage.session.get(SESSION_RECOVERY_KEY);
    if (!result[SESSION_RECOVERY_KEY]) return;

    const recovered = JSON.parse(result[SESSION_RECOVERY_KEY]);
    for (const [tabIdStr, s] of Object.entries(recovered)) {
      const tabId = Number(tabIdStr);
      if ((s as any).state === 'running' || (s as any).state === 'starting') {
        // Can't recover capture streams after SW restart; set to idle
        (s as any).state = 'idle';
        (s as any).streamId = '';
      }
      sessions.set(tabId, s as SessionState);
    }
  } catch {
    // ignore
  }
}

// Periodically persist sessions for recovery
function persistSessions() {
  const obj: Record<string, any> = {};
  for (const [tabId, s] of sessions.entries()) {
    obj[String(tabId)] = {
      tabId: s.tabId,
      state: s.state,
      sourceLang: s.sourceLang,
      targetLang: s.targetLang,
      generation: s.generation,
      subtitles: s.subtitles,
      messages: s.messages,
    };
  }
  try {
    chrome.storage.session.set({ [SESSION_RECOVERY_KEY]: JSON.stringify(obj) });
  } catch {
    // session storage may be full
  }
}

// Recover on startup
recoverSessions();

// Persist every 30 seconds
setInterval(persistSessions, 30000);

// Also persist on each session change via a pushSession wrapper
const origPushSession = pushSession;
pushSession = function (tabId: number) {
  origPushSession(tabId);
  persistSessions();
};

console.log('[RTTS] Background service worker (TS) initialized');
