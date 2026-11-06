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
import { openToolbarForTab } from './action-flow'
import { reconcileSessionWithCapture } from './session-state'

/* ===== Constants ===== */

const CONFIG_KEY = 'snooper.extension.config.v1';
const SESSION_RECOVERY_KEY = 'snooper.extension.sessions.v1';
const HISTORY_KEY = 'snooper.extension.history.v1';
const MAX_HISTORY = 100;
const OFFSCREEN_PATH = 'offscreen.html';

/**
 * Obsidian's Local REST API plugin displays the key as "Bearer <token>".
 * Users copy that whole string; sending it back with another "Bearer " prefix
 * produces "Bearer Bearer <token>" and a 401. Normalize at every entry point.
 */
function normalizeObsidianKey(raw: unknown): string {
  return String(raw || '').trim().replace(/^Bearer\s+/i, '').trim();
}
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
    image: { providerId: 'moss-official', model: 'moss-image-sft-1.0' },
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
  images?: string[]
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
  createdAt: number
  configSnapshot: AppConfig | null
  subtitles: SubtitleEntry[]
  messages: MessageEntry[]
  streamId: string
  pendingAskRequestId: string | null
  streamingSubtitle: StreamingSubtitle | null
  /** True when the capture is alive but no audio above the gate is arriving. */
  audioSilent: boolean
}

/** @type {Map<number, SessionState>} */
const sessions = new Map<number, SessionState>();
// All session reads and writes wait for service-worker recovery. Without this
// barrier, a tab can ask for GET_SESSION while recoverSessions() is still
// hydrating and temporarily receive a fresh idle session.
let recoveryReady: Promise<void> = Promise.resolve();

// Seed with the clock so a restarted service worker never reuses a
// generation that a still-alive offscreen session already holds.
let generationCounter = Date.now();

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
    createdAt: Date.now(),
    configSnapshot: null,
    subtitles: [],
    messages: [],
    streamId: '',
    pendingAskRequestId: null,
    streamingSubtitle: null,
    audioSilent: false,
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

async function hasOffscreenDocument(): Promise<boolean> {
  try {
    return typeof chrome.offscreen !== 'undefined' &&
      typeof chrome.offscreen.hasDocument === 'function' &&
      (await chrome.offscreen.hasDocument());
  } catch {
    return false;
  }
}

/** True when a live offscreen capture session exists for this tab. */
async function getLiveCaptureGeneration(tabId: number): Promise<number | undefined> {
  if (!(await hasOffscreenDocument())) return undefined;
  try {
    const res: any = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_CAPTURE_SESSIONS',
    });
    const generation = res?.sessions?.[String(tabId)];
    return res?.ok && typeof generation === 'number' ? generation : undefined;
  } catch {
    return undefined;
  }
}

async function offscreenHasCapture(tabId: number): Promise<boolean> {
  return typeof await getLiveCaptureGeneration(tabId) === 'number';
}

async function reconcileSessionState(tabId: number): Promise<SessionState> {
  await recoveryReady
  const session = getOrCreateSession(tabId);
  const liveGeneration = await getLiveCaptureGeneration(tabId);
  const reconciled = reconcileSessionWithCapture(session, liveGeneration)
  if (reconciled !== session) {
    Object.assign(session, reconciled)
    persistSessionsThrottled()
  }
  return session
}

function safeSession(s: SessionState) {
  return {
    state: s.state,
    sourceLang: s.sourceLang,
    targetLang: s.targetLang,
    subtitles: s.subtitles,
    messages: s.messages,
    streamingSubtitle: s.streamingSubtitle,
    audioSilent: s.audioSilent,
  }
}

/**
 * Stop a capture for a tab without creating the offscreen document. Used
 * before START: a restarted service worker may have left an old capture
 * alive, and tabCapture rejects a second stream for the same tab.
 */
async function stopOrphanCapture(tabId: number) {
  if (!(await hasOffscreenDocument())) return;
  try {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'STOP_CAPTURE',
      tabId,
    });
  } catch {
    // Offscreen may be shutting down; best-effort.
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
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  });
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

  chrome.tabs.sendMessage(tabId, {
    type: 'SESSION_UPDATE',
    session: safeSession(s),
  }).catch(() => {
    // Tab may have been closed or content script not loaded
  });

  persistSessionsThrottled();
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

/* ===== LLM Q&A ===== */

async function askLLM({ question, images, context, config, sourceLang, targetLang }: {
  question: string
  images: string[]
  context: string
  config: AppConfig
  sourceLang: string
  targetLang: string
}): Promise<string> {
  const route = config.routes.llm;
  const provider = config.providers.find((p) => p.id === route.providerId);
  if (!provider || !provider.apiKey) {
    throw new Error('尚未配置 LLM 服务商，请点击页面悬浮栏的 ⚙ 填入 API Key');
  }
  if (!route.model) {
    throw new Error('未选择 LLM 模型，请点击页面悬浮栏的 ⚙ 配置');
  }

  const baseUrl = provider.baseUrl.replace(/\/+$/, '');
  const parts: any[] = [{
    type: 'text',
    text: [
      '你是一个视频伴学助手。',
      context ? `【最近的字幕上下文】\n${context}\n` : '',
      '请基于字幕上下文和用户提供的内容回答。用简体中文回答，保持简洁准确。',
      '',
      `【用户提问】\n${question || '请描述这张图片，并结合视频上下文解释。'}`,
    ].filter(Boolean).join('\n'),
  }];
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img } });
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages: [{ role: 'user', content: parts }],
      temperature: 0.3,
      max_tokens: 2048,
      stream: false,
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const text = await res.text();
      if (text) msg = text.slice(0, 240);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map((p: any) => p.text || '').join('').trim();
  return String(json.output_text || '').trim();
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
    /* ---------- Config (in-page settings modal + side panel) ---------- */
    // Both surfaces are trusted extension contexts: the content script runs in
    // an isolated world that page scripts cannot reach, and `sender.tab` proves
    // the message came from an injected content script rather than the page.
    case 'GET_CONFIG': {
      loadConfig().then((config) => {
        sendResponse({ ok: true, config });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // async
    }

    case 'SAVE_CONFIG': {
      saveConfig(message.config).then(() => {
        sendResponse({ ok: true });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // async
    }

    /* ---------- Connection test (in-page settings modal) ---------- */
    case 'TEST_CONNECTION': {
      (async () => {
        try {
          const config: AppConfig = message.config || (await loadConfig());
          const provider = Array.isArray(config.providers) ? config.providers[0] : null;
          if (!provider?.baseUrl) throw new Error('请先填写 Base URL');
          let origin: string;
          try {
            origin = new URL(provider.baseUrl).origin;
          } catch {
            throw new Error('Base URL 格式无效');
          }
          const res = await fetch(`${origin}${new URL(provider.baseUrl).pathname.replace(/\/+$/, '')}/models`, {
            headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
          });
          const text = await res.text().catch(() => '');
          if (!res.ok) {
            let detail = '';
            try {
              const parsed = JSON.parse(text) as { error?: { message?: string } };
              detail = parsed.error?.message || '';
            } catch {
              detail = text.slice(0, 160);
            }
            throw new Error(`HTTP ${res.status}${detail ? ` · ${detail}` : ''}`);
          }
          let ids: string[] = [];
          try {
            const payload = JSON.parse(text) as { data?: Array<{ id?: string }> };
            ids = (payload.data || []).map((item) => item.id).filter(Boolean) as string[];
          } catch {
            throw new Error('返回内容不是有效的模型列表');
          }
          sendResponse({ ok: true, count: ids.length, models: ids.slice(0, 60) });
        } catch (err: any) {
          sendResponse({ ok: false, error: err.message || '连接失败' });
        }
      })();
      return true; // async
    }

    /* ---------- In-page image generation ---------- */
    case 'GENERATE_IMAGE': {
      (async () => {
        try {
          const config: AppConfig = await loadConfig();
          const route = config.routes.image;
          const provider =
            config.providers.find((p) => p.id === route?.providerId) || config.providers[0];
          if (!provider?.apiKey) {
            throw new Error('尚未配置 API Key，请点击页面悬浮栏的 ⚙ 在页面内配置');
          }
          const prompt = String(message.prompt || '').trim();
          if (!prompt) throw new Error('提示词不能为空');
          if (prompt.length > 4000) throw new Error('提示词过长（最多 4000 字）');

          const baseUrl = provider.baseUrl.replace(/\/+$/, '');
          const body: Record<string, unknown> = {
            model: route?.model || 'moss-image-sft-1.0',
            prompt,
            n: 1,
            size: message.size || '1024x1024',
            prompt_enhance: true,
            output_watermark: { enabled: false },
          };
          const negative = String(message.negativePrompt || '').trim();
          if (negative) body.negative_prompt = negative;

          async function tryGenerate(body: Record<string, unknown>): Promise<string[]> {
            const res = await fetch(`${baseUrl}/images/generations`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${provider.apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            });
            const text = await res.text().catch(() => '');
            if (!res.ok) {
              let detail = '';
              try {
                const parsed = JSON.parse(text) as { error?: { message?: string } };
                detail = parsed.error?.message || '';
              } catch {
                detail = text.slice(0, 200);
              }
              const errMsg = `HTTP ${res.status}${detail ? ` · ${detail}` : ''}`;
              // Retry once without optional params on 4xx errors
              if (res.status >= 400 && res.status < 500 && body.prompt_enhance !== undefined) {
                const retryBody = { ...body };
                delete retryBody.prompt_enhance;
                delete retryBody.output_watermark;
                const r2 = await fetch(`${baseUrl}/images/generations`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${provider.apiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(retryBody),
                });
                const text2 = await r2.text().catch(() => '');
                if (r2.ok) {
                  const imgs = parseImageResponse(text2);
                  if (imgs.length > 0) return imgs;
                }
                // Retry failed too; show first error
                throw new Error(`生图失败 ${errMsg}`);
              }
              throw new Error(`生图失败 ${errMsg}`);
            }
            return parseImageResponse(text);
          }

          function parseImageResponse(text: string): string[] {
            const payload = JSON.parse(text);
            const images: string[] = [];
            // Standard OpenAI-style: data[{url}], data[{b64_json}]
            if (Array.isArray(payload.data)) {
              for (const item of payload.data) {
                if (item.url) images.push(item.url);
                else if (item.b64_json) images.push(`data:image/png;base64,${item.b64_json}`);
              }
            }
            // Alternative: images[{url}], images[string]
            if (payload.images && Array.isArray(payload.images)) {
              for (const item of payload.images) {
                if (typeof item === 'string' && item.length > 0) images.push(item);
                else if (item.url) images.push(item.url);
                else if (item.b64_json) images.push(`data:image/png;base64,${item.b64_json}`);
              }
            }
            // output field
            if (images.length === 0 && payload.output) {
              if (typeof payload.output === 'string' && payload.output.length > 0) images.push(payload.output);
              else if (Array.isArray(payload.output)) {
                for (const o of payload.output) {
                  if (typeof o === 'string' && o.length > 0) images.push(o);
                  else if (o.url) images.push(o.url);
                  else if (o.b64_json) images.push(`data:image/png;base64,${o.b64_json}`);
                }
              }
            }
            if (images.length === 0) throw new Error('生图接口响应中没有找到图片');
            return images;
          }

          const images = await tryGenerate(body);
          sendResponse({ ok: true, images, model: route?.model || 'moss-image-sft-1.0' });
        } catch (err: any) {
          sendResponse({ ok: false, error: err.message || '生图失败' });
        }
      })();
      return true; // async
    }

    /* ---------- Session (content script) ---------- */
    case 'GET_SESSION': {
      reconcileSessionState(tabId).then((s) => {
        sendResponse({
          ok: true,
          session: safeSession(s),
        });
      }).catch(() => sendResponse({ ok: false, error: '无法同步当前转写状态' }));
      return true;
    }

    case 'SET_LANG': {
      (async () => {
        const s = await reconcileSessionState(tabId);
        if (message.sourceLang) s.sourceLang = message.sourceLang;
        if (message.targetLang) s.targetLang = message.targetLang;

        pushSession(tabId);
        // Also forward to offscreen if running. Reconcile first so a stale
        // recovered session cannot briefly publish an idle state here.
        if (s.state === 'running') {
          await sendToOffscreen({
            type: 'SET_LANG',
            tabId,
            sourceLang: s.sourceLang,
            targetLang: s.targetLang,
          });
        }
        sendResponse({ ok: true, session: safeSession(s) });
      })().catch((err: any) => sendResponse({ ok: false, error: err.message || '语言切换失败' }));
      return true;
    }

    case 'START': {
      (async () => {
        const s = await reconcileSessionState(tabId);

        if (s.state === 'running' || s.state === 'starting') {
          // In-memory state can outlive the offscreen capture after a service
          // worker restart. Only block when a capture is really alive.
          const live = await offscreenHasCapture(tabId);
          if (live) {
            // START is idempotent. A stale toolbar must never tear down a
            // capture that is still translating in the background.
            sendResponse({ ok: true, alreadyRunning: true, session: safeSession(s) });
            return;
          }
          s.state = 'idle';
          s.streamId = '';
          s.configSnapshot = null;
          s.streamingSubtitle = null;
        }

        s.state = 'starting';
        s.sourceLang = message.sourceLang || 'auto';
        s.targetLang = message.targetLang || 'zh';
        s.generation = nextGeneration();
        s.subtitles = [];
        s.streamingSubtitle = null;
        s.audioSilent = false;
        // Don't clear messages – they persist across restarts
        pushSession(tabId);

        try {
          const config = await loadConfig();

          // Pre-check: verify at least one provider has API key
          const hasKey = config.providers.some((p) => p.apiKey && p.apiKey.trim().length > 0);
          if (!hasKey) {
            throw new Error('尚未配置 API Key。请点击页面悬浮栏的 ⚙ 按钮，在页面内填入密钥后重试');
          }
          // Pre-check: audio route must resolve
          const audioRoute = config.routes.audio;
          const audioProvider = config.providers.find((p) => p.id === audioRoute.providerId);
          if (!audioProvider || !audioProvider.apiKey) {
            throw new Error(`音频转写服务商「${audioProvider?.name || '未配置'}」缺少 API Key，请点击 ⚙ 在页面内配置`);
          }
          if (!audioRoute.model) {
            throw new Error('音频转写未选择模型，请点击悬浮栏的 ⚙ 在页面内配置');
          }

          s.configSnapshot = JSON.parse(JSON.stringify(config));
          console.log('[RTTS] START:', tabId, 'gen:', s.generation, 'lang:', s.sourceLang, '→', s.targetLang);

          // Clear an orphaned capture left behind by a restarted service
          // worker. tabCapture refuses a new stream while one is alive.
          await stopOrphanCapture(tabId);

          const requestStreamId = () => new Promise<string>((resolve, reject) => {
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

          let streamId: string;
          try {
            streamId = await requestStreamId();
          } catch (err: any) {
            if (!/active stream/i.test(err?.message || '')) throw err;
            // Offscreen teardown is asynchronous – clean once more and retry.
            await stopOrphanCapture(tabId);
            await new Promise((resolve) => setTimeout(resolve, 500));
            streamId = await requestStreamId();
          }

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
          s.streamingSubtitle = null;
          pushSession(tabId);
          const msg = (err && err.message) || String(err);
          let friendly = msg;
          // tabCapture requires the extension to have host permission for the
          // tab. With <all_urls> host permissions this should never fire, but
          // if it does (e.g. Chrome internal pages), guide the user clearly.
          if (/active stream/i.test(msg)) {
            friendly = '该标签页仍有残留录音流（扩展后台重启所致）。已自动清理，请再点一次「录音」；若仍失败，请刷新页面后重试';
          } else if (/not been invoked|activeTab/i.test(msg)) {
            friendly = '需要先完成一次授权：点击浏览器工具栏的 snooper 图标（弹出的面板可立即关闭），之后本页可直接使用';
          } else if (/permission|Permission|not allowed|not permitted/i.test(msg)) {
            friendly = '缺少录音权限：请确认扩展已获得「读取和更改网站数据」权限，然后重试';
          }
          sendResponse({ ok: false, error: friendly });
        }
      })();
      return true; // async
    }

    case 'STOP': {
      const s = sessions.get(tabId);
      if (!s) {
        // Still tear down: a restarted worker has no session object, but the
        // offscreen capture may be alive and would block the next START.
        stopOrphanCapture(tabId).catch(() => {});
        sendResponse({ ok: true });
        return false;
      }
      // Deliberately idempotent. A stop request must always clear the capture;
      // refusing it with "not transcribing" is how an orphan stream survived.
      if (s.state === 'idle' && s.generation !== 0) {
        stopOrphanCapture(tabId).catch(() => {});
        sendResponse({ ok: true });
        return false;
      }

      s.state = 'stopping';
      pushSession(tabId);

      // Invalidate in-flight ASR/translation results immediately. Late
      // responses from the stopped segment carry the old generation and are
      // dropped, so nothing new appears after the user hits stop.
      const stoppedGeneration = s.generation;
      s.generation = nextGeneration();

      sendToOffscreen({
        type: 'STOP_CAPTURE',
        tabId,
        generation: stoppedGeneration,
      }).catch(() => {
        // Offscreen may already be closed
      }).finally(() => {
        s.state = 'idle';
        s.streamId = '';
        s.configSnapshot = null;
        s.streamingSubtitle = null;
        s.audioSilent = false;
        // Save to session history
        if (s.subtitles && s.subtitles.length > 0) {
          persistSessionHistory(tabId);
        }
        pushSession(tabId);
        checkAndCloseOffscreen();
        sendResponse({ ok: true, session: safeSession(s) });
      });
      // Keep the response open until the offscreen teardown finishes. This
      // prevents an immediate GET_SESSION from observing the old live capture
      // and putting the toolbar back into the running state after STOP.
      return true;
    }

    case 'ASK': {
      // Chat stays available after stop: it uses subtitle history as context
      // and loads config on demand instead of relying on the capture session.
      const s = getOrCreateSession(tabId);
      const question = (message.question || '').trim();
      const images: string[] = Array.isArray(message.images) ? message.images.slice(0, 4) : [];
      if (!question && images.length === 0) {
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

      (async () => {
        const config = s.configSnapshot || await loadConfig();
        const answer = await askLLM({
          question,
          images,
          context: recentContext,
          config,
          sourceLang: s.sourceLang,
          targetLang: s.targetLang,
        });
        if (s.pendingAskRequestId !== requestId) return;
        s.pendingAskRequestId = null;
        s.messages.push({ role: 'assistant', content: answer });
        pushSession(tabId);
        sendResponse({ ok: true, answer });
      })().catch((err: any) => {
        if (s.pendingAskRequestId !== requestId) return;
        s.pendingAskRequestId = null;
        sendResponse({ ok: false, error: err.message || '获取回答失败' });
      });

      // Store user message optimistically
      s.messages.push({ role: 'user', content: question, images });
      pushSession(tabId);

      return true; // async – response will be sent later
    }

    case 'OPEN_SETTINGS': {
      // sidePanel.open() from SW requires user gesture; content script messages
      // don't qualify, so this may fail. Fallback instructs user to click icon.
      chrome.sidePanel.open({ tabId }).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false, error: '请点击浏览器工具栏的 snooper-browser 图标打开配置面板' });
      });
      return true;
    }

    case 'OPEN_IMAGE_GEN': {
      // Forward prompt to image gen — open side panel with image gen context
      chrome.sidePanel.open({ tabId }).then(() => {
        // Store prompt in sessionStorage for the side panel to pick up
        try {
          sessionStorage.setItem('snooper.image-gen-prompt', message.prompt || '');
        } catch { /* ignore */ }
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false, error: '请点击浏览器工具栏图标打开配置面板' });
      });
      return true;
    }

    case 'CAPTURE_SCREENSHOT': {
      // Try visible tab capture first. When a tab has an active audio capture
      // (tabCapture), this method throws "Cannot capture a tab with an active
      // stream." In that case we ask offscreen to grab a video frame.
      chrome.tabs.captureVisibleTab({ format: 'png' }).then((dataUrl) => {
        sendResponse({ ok: true, dataUrl });
      }).catch(async (err) => {
        if (err.message && /active stream/i.test(err.message)) {
          // Only a running offscreen capture can supply a frame. Do not create
          // an empty offscreen document just to ask for one.
          if (!(await hasOffscreenDocument())) {
            sendResponse({ ok: false, error: '截图失败：标签页正被其他录音占用，请停止后重试' });
            return;
          }
          // Fallback: ask offscreen for a frame from its capture video element
          sendToOffscreen({ type: 'CAPTURE_FRAME', tabId }).then((frame: any) => {
            if (frame && frame.dataUrl) {
              sendResponse({ ok: true, dataUrl: frame.dataUrl });
            } else {
              sendResponse({ ok: false, error: frame?.error || '截图失败：无法获取视频帧' });
            }
          }).catch((e) => {
            sendResponse({ ok: false, error: '截图失败：' + (e.message || '') });
          });
        } else {
          sendResponse({ ok: false, error: err.message || '截图失败' });
        }
      });
      return true;
    }

    case 'FETCH_URL': {
      const url = String(message.url || '').trim();
      if (!url) {
        sendResponse({ ok: false, error: 'URL 为空' });
        return false;
      }
      (async () => {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onload = () => sendResponse({ ok: true, dataUrl: reader.result });
          reader.onerror = () => sendResponse({ ok: false, error: '无法读取图片' });
          reader.readAsDataURL(blob);
        } catch (err: any) {
          sendResponse({ ok: false, error: '无法下载图片：' + (err.message || '') });
        }
      })();
      return true;
    }

    case 'EXPORT_TO_OBSIDIAN': {
      const content = message.content || '';
      const title = message.title || `snooper-笔记-${Date.now()}`;
      if (!content) {
        sendResponse({ ok: false, error: '没有内容可导出' });
        return false;
      }

      // Use config sent from content script, or fall back to defaults.
      // The plugin serves plain HTTP on 27123 and self-signed HTTPS on 27124;
      // Chrome rejects the self-signed cert, so HTTP is the default.
      const oc = message.obsidianConfig || {};
      const obsidianPort = Number(oc.apiPort) || 27123;
      const protocol = oc.apiProtocol === 'https'
        ? 'https'
        : oc.apiProtocol === 'http'
          ? 'http'
          : (obsidianPort === 27124 ? 'https' : 'http');
      const obsidianApiKey = normalizeObsidianKey(oc.apiKey);
      const noteFolder = String(oc.noteFolder || 'snooper-notes').replace(/^\/+|\/+$/g, '');
      const fileName = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')}.md`;
      const base = `${protocol}://127.0.0.1:${obsidianPort}`;
      const vaultPath = noteFolder ? `/vault/${noteFolder}/${encodeURIComponent(fileName)}` : `/vault/${encodeURIComponent(fileName)}`;

      (async () => {
        try {
          const res = await fetch(base + vaultPath, {
            method: 'PUT',
            headers: {
              'Content-Type': 'text/markdown',
              ...(obsidianApiKey ? { Authorization: `Bearer ${obsidianApiKey}` } : {}),
            },
            body: content,
          });
          if (res.ok) {
            sendResponse({ ok: true });
            return;
          }
          if (res.status === 401 || res.status === 403) {
            sendResponse({ ok: false, error: 'Obsidian 拒绝访问：API Key 不正确或未填写' });
            return;
          }
          if (res.status === 404) {
            sendResponse({ ok: false, error: 'Obsidian 找不到写入路径，请检查笔记目录设置' });
            return;
          }
          sendResponse({ ok: false, error: `Obsidian API 返回 ${res.status}` });
        } catch (err: any) {
          const hint = protocol === 'https'
            ? 'HTTPS 27124 使用自签名证书，Chrome 会拒绝。请在 Obsidian → Local REST API 设置中开启「Enable Non-encrypted (HTTP) Server」，然后在侧栏把协议改为 HTTP、端口 27123。'
            : '请确认 Obsidian 正在运行、Local REST API 插件已启用，并开启「Enable Non-encrypted (HTTP) Server」（端口 27123）。';
          sendResponse({ ok: false, error: `无法连接 Obsidian（${base}）。${hint}` });
        }
      })();
      return true;
    }

    case 'OBSIDIAN_UPLOAD_ASSET': {
      // Upload a note image (data URL or remote URL) to the vault so the
      // exported markdown can embed it with ![[file]]. Obsidian does not
      // render data: URLs, which is why exported images used to be blank.
      const oc = message.obsidianConfig || {};
      const key = normalizeObsidianKey(oc.apiKey);
      const port = Number(oc.apiPort) || 27123;
      const protocol = oc.apiProtocol === 'https' ? 'https' : oc.apiProtocol === 'http' ? 'http' : (port === 27124 ? 'https' : 'http');
      const folder = String(oc.noteFolder || 'snooper-notes').replace(/^\/+|\/+$/g, '');
      const fileName = String(message.fileName || '').replace(/[^a-zA-Z0-9._-]/g, '-');
      if (!fileName) {
        sendResponse({ ok: false, error: '资产文件名为空' });
        return false;
      }

      (async () => {
        try {
          let bytes: Uint8Array;
          let mime = String(message.mimeType || 'image/png');
          const dataUrl = String(message.dataUrl || '');

          if (dataUrl.startsWith('data:')) {
            const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
            if (!match) throw new Error('图片数据格式无法识别');
            if (match[1]) mime = match[1];
            const isBase64 = /;base64,/.test(dataUrl);
            if (isBase64) {
              const binary = atob(match[2] || '');
              bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            } else {
              bytes = new TextEncoder().encode(decodeURIComponent(match[2] || ''));
            }
          } else if (/^https?:\/\//i.test(dataUrl)) {
            const r = await fetch(dataUrl);
            if (!r.ok) throw new Error(`下载图片失败 HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            bytes = new Uint8Array(buf);
            mime = r.headers.get('content-type') || mime;
          } else if (String(message.rawText || '')) {
            // SVG entries are stored as markup, not as a URL.
            bytes = new TextEncoder().encode(String(message.rawText));
            mime = 'image/svg+xml';
          } else {
            throw new Error('没有可上传的图片数据');
          }

          const base = `${protocol}://127.0.0.1:${port}`;
          const assetPath = folder ? `/vault/${folder}/assets/${encodeURIComponent(fileName)}` : `/vault/assets/${encodeURIComponent(fileName)}`;
          const res = await fetch(base + assetPath, {
            method: 'PUT',
            headers: {
              'Content-Type': mime,
              ...(key ? { Authorization: `Bearer ${key}` } : {}),
            },
            body: bytes as unknown as BodyInit,
          });
          if (!res.ok) {
            sendResponse({ ok: false, error: `图片上传失败 HTTP ${res.status}` });
            return;
          }
          sendResponse({ ok: true, fileName });
        } catch (err: any) {
          sendResponse({ ok: false, error: err.message || '图片上传失败' });
        }
      })();
      return true;
    }

    case 'TEST_OBSIDIAN': {
      const oc = message.obsidianConfig || {};
      const key = normalizeObsidianKey(oc.apiKey);
      const configuredPort = Number(oc.apiPort) || 27123;
      const configuredProtocol = oc.apiProtocol === 'https' ? 'https' : oc.apiProtocol === 'http' ? 'http' : (configuredPort === 27124 ? 'https' : 'http');
      const seen = new Set<string>();
      const candidates: Array<{ protocol: 'http' | 'https'; port: number }> = [];
      for (const c of [
        { protocol: configuredProtocol as 'http' | 'https', port: configuredPort },
        { protocol: 'http' as const, port: 27123 },
        { protocol: 'https' as const, port: 27124 },
      ]) {
        const id = `${c.protocol}:${c.port}`;
        if (!seen.has(id)) { seen.add(id); candidates.push(c); }
      }

      (async () => {
        for (const c of candidates) {
          try {
            const res = await fetch(`${c.protocol}://127.0.0.1:${c.port}/vault/`, {
              headers: key ? { Authorization: `Bearer ${key}` } : {},
            });
            if (res.ok) {
              sendResponse({ ok: true, protocol: c.protocol, port: c.port });
              return;
            }
            if (res.status === 401 || res.status === 403) {
              sendResponse({
                ok: false,
                protocol: c.protocol,
                port: c.port,
                error: `已连上 ${c.protocol}://127.0.0.1:${c.port}，但 API Key 不正确，请在插件设置中重新复制`,
              });
              return;
            }
          } catch { /* try next */ }
        }
        sendResponse({
          ok: false,
          error: '无法连接。请确认 Obsidian 正在运行、Local REST API 插件已启用，并开启「Enable Non-encrypted (HTTP) Server」（端口 27123）',
        });
      })();
      return true;
    }

    case 'GET_HISTORY': {
      readHistory().then((history) => {
        sendResponse({ ok: true, history });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    case 'DELETE_HISTORY': {
      const ids = Array.isArray(message.ids)
        ? message.ids.map((id: any) => String(id))
        : [String(message.id || '')];
      deleteHistoryEntries(ids).then(() => sendResponse({ ok: true })).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }

    case 'DELETE_ALL_HISTORY': {
      clearHistory().then(() => sendResponse({ ok: true })).catch(() => {
        sendResponse({ ok: false });
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
    case 'CAPTURE_AUDIO_STATE': {
      // Offscreen tells us when the tab goes quiet (paused video, muted, or a
      // silent stretch). The UI uses this to say "no audio" instead of looking
      // like it is translating something invisible.
      const s = sessions.get(message.tabId);
      if (s && s.generation === message.generation) {
        const next = !!message.silent;
        if (s.audioSilent !== next) {
          s.audioSilent = next;
          pushSession(message.tabId);
        }
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'CAPTURE_KEEPALIVE': {
      // Receiving this message resets the MV3 service-worker idle timer, which
      // is what keeps the background alive through long silent stretches.
      const s = sessions.get(message.tabId);
      // Only finish an in-flight start. Reviving any non-running state would
      // resurrect a session the user already stopped.
      if (s && s.state === 'starting' && s.generation === message.generation) {
        s.state = 'running';
        pushSession(message.tabId);
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'CAPTURE_ENDED': {
      // The captured audio track ended (tab audio stopped, close button in
      // Chrome's sharing bar, device change...). Reflect reality instead of
      // leaving the toolbar stuck on "recording".
      const s = sessions.get(message.tabId);
      if (s && (s.state === 'running' || s.state === 'starting')) {
        s.state = 'idle';
        s.streamId = '';
        s.configSnapshot = null;
        s.streamingSubtitle = null;
        s.audioSilent = false;
        if (s.subtitles.length > 0) persistSessionHistory(message.tabId);
        pushSession(message.tabId);
        checkAndCloseOffscreen();
      }
      sendResponse({ ok: true });
      return false;
    }

    case 'CAPTURE_SUBTITLE_STREAMING': {
      const s = sessions.get(message.tabId);
      if (!s || s.generation !== message.generation) {
        // Stale streaming update — ignore
        return false;
      }
      // A session that is no longer running must not keep painting subtitles.
      // Previously a stray tab-lifecycle stop left the offscreen capture
      // alive, so subtitles kept streaming into a "stopped" toolbar.
      if (s.state !== 'running' && s.state !== 'starting') {
        return false;
      }

      // Empty content means an explicit clear (e.g. the segment errored).
      // Only apply it if it targets the currently streaming segment, so a
      // failed older segment can't clobber a newer segment still streaming.
      if (!message.source && !message.partialTarget) {
        if (!s.streamingSubtitle || s.streamingSubtitle.at === message.at) {
          s.streamingSubtitle = null;
        }
      } else {
        // Update the streaming subtitle in-place (not pushed to subtitles[] yet)
        s.streamingSubtitle = {
          at: message.at || Date.now(),
          source: message.source || '',
          partialTarget: message.partialTarget || '',
          latency: message.latency || 0,
        };
      }

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

      // Clear streaming state only if the final subtitle belongs to the
      // currently streaming segment. If a NEWER segment is already streaming
      // (overlapping in-flight segments), leave it visible so it never
      // "disappears for a second" while waiting for its own final.
      if (s.streamingSubtitle && s.streamingSubtitle.at === (message.at || Date.now())) {
        s.streamingSubtitle = null;
      }

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
function stopSessionForTab(tabId: number) {
  const s = sessions.get(tabId);
  if (!s || (s.state !== 'running' && s.state !== 'starting')) return;
  if (s.subtitles.length > 0) persistSessionHistory(tabId);
  sendToOffscreen({ type: 'STOP_CAPTURE', tabId, generation: s.generation }).catch(() => {});
  s.state = 'idle';
  s.streamId = '';
  s.configSnapshot = null;
  s.subtitles = [];
  s.streamingSubtitle = null;
  s.audioSilent = false;
  // Keep messages across navigation
  pushSession(tabId);
  checkAndCloseOffscreen();
}

chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: any) => {
  // Only a real document load (`status: 'loading'`) destroys the content
  // script and therefore invalidates the capture. SPA history.pushState URL
  // changes keep the script alive, so stopping there would end a recording
  // for no reason (e.g. Bilibili switching a player parameter).
  if (changeInfo.status === 'loading') {
    stopSessionForTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  const s = sessions.get(tabId);
  if (!s) return;
  if (s.subtitles.length > 0) persistSessionHistory(tabId);
  sendToOffscreen({ type: 'STOP_CAPTURE', tabId, generation: s.generation }).catch(() => {});
  sessions.delete(tabId);
  persistSessions();
  checkAndCloseOffscreen();
});
chrome.tabs.onActivated.addListener(async (activeInfo: any) => {
  await recoveryReady;
  // Push current session state to the newly active tab
  const session = await reconcileSessionState(activeInfo.tabId);
  if (session.state === 'running' || session.state === 'starting') pushSession(activeInfo.tabId);
});

/* ===== Action Click ===== */

chrome.action.onClicked.addListener((tab: any) => {
  if (typeof tab.id !== 'number') return;

  // Inject MAIN-world fullscreen bridge (needs MAIN to intercept requestFullscreen)
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [FS_BRIDGE_FILE],
    world: 'MAIN',
  }).catch((err: any) => {
    console.warn('[RTTS] FS bridge injection error:', err.message);
  });

  // A newly opened or restored tab may not have the content script yet.
  void openToolbarForTab(tab.id, {
    tabUrl: tab.url,
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    injectContentScript,
  }).catch((err: any) => {
    console.warn('[RTTS] toolbar unavailable:', err.message);
  });

  // Open side panel for configuration
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

/* ===== Session History ===== */

interface HistoryEntry {
  id: string
  pageTitle: string
  url: string
  startedAt: number
  endedAt: number
  sourceLang: string
  targetLang: string
  subtitleCount: number
}

async function persistSessionHistory(tabId: number) {
  const s = sessions.get(tabId);
  if (!s || !s.subtitles || s.subtitles.length === 0) return;
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const entry: HistoryEntry = {
      id: `h_${Date.now().toString(36)}_${tabId}`,
      pageTitle: tab?.title || '',
      url: tab?.url || '',
      startedAt: s.createdAt || Date.now(),
      endedAt: Date.now(),
      sourceLang: s.sourceLang || 'auto',
      targetLang: s.targetLang || 'zh',
      subtitleCount: s.subtitles.length,
    };
    const got = await chrome.storage.local.get(HISTORY_KEY);
    const history: HistoryEntry[] = Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [];
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch { /* best-effort */ }
}

async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const got = await chrome.storage.local.get(HISTORY_KEY);
    return Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [];
  } catch { return []; }
}

async function deleteHistoryEntries(ids: string[]) {
  try {
    const got = await chrome.storage.local.get(HISTORY_KEY);
    let history: HistoryEntry[] = Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [];
    const remove = new Set(ids);
    history = history.filter((h) => !remove.has(h.id));
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch { /* ignore */ }
}

async function clearHistory() {
  try {
    await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  } catch { /* ignore */ }
}

async function recoverSessions() {
  try {
    const result = await chrome.storage.session.get(SESSION_RECOVERY_KEY);
    if (!result[SESSION_RECOVERY_KEY]) return;

    const recovered = JSON.parse(result[SESSION_RECOVERY_KEY]);

    // The offscreen document outlives a background restart. Ask it which
    // captures are still alive instead of assuming they are gone: assuming
    // "gone" left an orphaned tabCapture running with a toolbar that said
    // "stopped", and the next START failed with "active stream".
    let liveGenerations: Record<string, number> = {};
    if (await hasOffscreenDocument()) {
      try {
        const live: any = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'GET_CAPTURE_SESSIONS',
        });
        if (live?.ok && live.sessions && typeof live.sessions === 'object') {
          liveGenerations = live.sessions;
        }
      } catch {
        // Offscreen may be mid-shutdown; treat as no live captures.
      }
    }

    for (const [tabIdStr, stored] of Object.entries(recovered)) {
      const tabId = Number(tabIdStr);
      const s = stored as SessionState;
      const liveGeneration = liveGenerations[String(tabId)];

      if (typeof liveGeneration === 'number') {
        // Capture survived: keep the session running so STOP still reaches it
        // and the content script shows the correct recording state.
        s.state = 'running';
        s.generation = liveGeneration;
        s.streamId = '';
      } else if (s.state === 'running' || s.state === 'starting' || s.state === 'stopping') {
        s.state = 'idle';
        s.streamId = '';
        s.configSnapshot = null;
        s.streamingSubtitle = null;
      }
      sessions.set(tabId, s);
      pushSession(tabId);
    }
  } catch {
    // ignore
  }
}

// Streaming updates fire often; keep the recovery snapshot fresh without
// writing to chrome.storage.session on every delta.
let lastPersistAt = 0;
function persistSessionsThrottled() {
  const now = Date.now();
  if (now - lastPersistAt < 3000) return;
  lastPersistAt = now;
  persistSessions();
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
      audioSilent: false,
    };
  }
  try {
    chrome.storage.session.set({ [SESSION_RECOVERY_KEY]: JSON.stringify(obj) });
  } catch {
    // session storage may be full
  }
}

// Recover on startup. Message handlers wait for this promise before reading
// sessions, so a service-worker restart cannot publish a transient idle state.
recoveryReady = recoverSessions();

// Persist every 30 seconds
setInterval(persistSessions, 30000);

// Session changes persist through pushSession() itself (throttled), so a
// service-worker suspension never loses the recovery snapshot. The old code
// reassigned this function declaration, which TypeScript rejects and which
// silently stopped working if the file was ever re-ordered.

console.log('[RTTS] Background service worker (TS) initialized');
