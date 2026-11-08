// src/ext/action-flow.ts
var UnsupportedPageError = class extends Error {
  code = "UNSUPPORTED_PAGE";
  constructor() {
    super("\u6B64\u9875\u9762\u53D7\u6D4F\u89C8\u5668\u9650\u5236\uFF0C\u65E0\u6CD5\u8FD0\u884C snooper\u3002\u8BF7\u5207\u6362\u5230\u666E\u901A\u7F51\u9875\u540E\u91CD\u8BD5\u3002");
    this.name = "UnsupportedPageError";
  }
};
function isUnsupportedTabUrl(url) {
  return /^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i.test(url || "") || /^https?:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)(?:\/|$)/i.test(url || "");
}
async function sendToPageWithInjection(tabId, message, tabUrl, { sendMessage, injectContentScript: injectContentScript2 }) {
  if (isUnsupportedTabUrl(tabUrl)) throw new UnsupportedPageError();
  try {
    await sendMessage(tabId, message);
    return { ok: true, injected: false };
  } catch (firstError) {
    try {
      await injectContentScript2(tabId);
      await sendMessage(tabId, message);
      return { ok: true, injected: true };
    } catch (retryError) {
      const error = retryError instanceof Error ? retryError : new Error(String(retryError));
      if (firstError instanceof Error) error.cause ??= firstError;
      throw error;
    }
  }
}
function openToolbarForTab(tabId, options) {
  return sendToPageWithInjection(tabId, { type: "TOGGLE_TOOLBAR" }, options.tabUrl, options);
}

// src/ext/background/config.ts
var CONFIG_KEY = "snooper.extension.config.v1";
var DEFAULT_CONFIG = {
  providers: [
    {
      id: "moss-official",
      name: "MOSS \u5B98\u65B9",
      baseUrl: "https://api.mosi.cn/v1",
      apiKey: "",
      protocol: "moss",
      note: "\u5B98\u65B9 MOSS \u7F51\u5173",
      models: [],
      lastSyncedAt: null,
      status: "unknown",
      lastError: ""
    }
  ],
  routes: {
    llm: { providerId: "moss-official", model: "moss-vl-1.0" },
    audio: { providerId: "moss-official", model: "moss-transcribe-1.0" },
    video: { providerId: "moss-official", model: "moss-vl-realtime-1.0" },
    image: { providerId: "moss-official", model: "moss-image-sft-1.0" }
  }
};
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    if (result[CONFIG_KEY]) {
      return JSON.parse(result[CONFIG_KEY]);
    }
  } catch {
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
async function saveConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("\u914D\u7F6E\u683C\u5F0F\u65E0\u6548");
  }
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error("\u81F3\u5C11\u9700\u8981\u914D\u7F6E\u4E00\u4E2A\u670D\u52A1\u5546");
  }
  for (const p of config.providers) {
    if (!p.id || typeof p.id !== "string") throw new Error("\u670D\u52A1\u5546\u7F3A\u5C11\u6709\u6548 ID");
    if (!p.baseUrl || typeof p.baseUrl !== "string") throw new Error(`\u670D\u52A1\u5546 "${p.name}" \u7F3A\u5C11 Base URL`);
    try {
      new URL(p.baseUrl);
    } catch {
      throw new Error(`\u670D\u52A1\u5546 "${p.name}" \u7684 Base URL \u683C\u5F0F\u65E0\u6548: ${p.baseUrl}`);
    }
    if (p.apiKey && typeof p.apiKey === "string" && p.apiKey.length > 1024) {
      throw new Error(`\u670D\u52A1\u5546 "${p.name}" \u7684 API Key \u8FC7\u957F`);
    }
  }
  if (!config.routes || typeof config.routes !== "object") {
    throw new Error("\u80FD\u529B\u8DEF\u7531\u914D\u7F6E\u65E0\u6548");
  }
  const json = JSON.stringify(config);
  await chrome.storage.local.set({ [CONFIG_KEY]: json });
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
  }
}

// src/ext/session-state.ts
function reconcileSessionWithCapture(session, liveGeneration) {
  if (typeof liveGeneration !== "number" || session.state === "stopping") return session;
  if (session.state === "running" && session.generation === liveGeneration) return session;
  return {
    ...session,
    state: "running",
    generation: liveGeneration
  };
}

// src/ext/capture-recovery.ts
async function waitForCaptureRelease(isCaptureAlive, options = {}) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 8);
  const delayMs = Math.max(0, options.delayMs ?? 100);
  const sleep2 = options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!await isCaptureAlive()) return true;
    if (attempt < maxAttempts - 1) await sleep2(delayMs);
  }
  return false;
}
async function forceReleaseOffscreenDocument(getActiveTabIds, closeDocument, hasDocument, options = {}) {
  if ((await getActiveTabIds()).length > 0) return "busy";
  await closeDocument();
  const released = await waitForCaptureRelease(hasDocument, options);
  return released ? "released" : "timeout";
}
function describeCaptureSuspects(extensions) {
  const names = [];
  let snooperCount = 0;
  for (const ext of extensions) {
    if (/^snooper-browser$/i.test(ext.name)) {
      snooperCount++;
      if (snooperCount > 1) names.push(`\u53E6\u4E00\u4EFD ${ext.name}`);
    } else {
      names.push(ext.name);
    }
  }
  return names.join("\u3001");
}

// src/ext/background/offscreen.ts
var OFFSCREEN_PATH = "offscreen.html";
var offscreenCreationPromise = null;
async function ensureOffscreen() {
  if (offscreenCreationPromise) return offscreenCreationPromise;
  offscreenCreationPromise = (async () => {
    try {
      const hasDoc = typeof chrome.offscreen !== "undefined" && typeof chrome.offscreen.hasDocument === "function" && await chrome.offscreen.hasDocument();
      if (hasDoc) return;
    } catch {
    }
    try {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_PATH),
        reasons: ["USER_MEDIA"],
        justification: "Capture tab audio stream for real-time transcription and translation"
      });
    } catch (err) {
      if (!err.message?.includes("already exists")) {
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
async function sendToOffscreen(message) {
  await ensureOffscreen();
  try {
    const resp = await chrome.runtime.sendMessage({
      target: "offscreen",
      ...message
    });
    return resp;
  } catch (err) {
    throw new Error("Offscreen \u901A\u4FE1\u5931\u8D25: " + (err.message || "\u672A\u77E5\u9519\u8BEF"));
  }
}
async function hasOffscreenDocument() {
  try {
    return typeof chrome.offscreen !== "undefined" && typeof chrome.offscreen.hasDocument === "function" && await chrome.offscreen.hasDocument();
  } catch {
    return false;
  }
}
async function closeOffscreenDocument() {
  try {
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
  }
}
async function getLiveCaptureGeneration(tabId) {
  if (!await hasOffscreenDocument()) return void 0;
  try {
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "GET_CAPTURE_SESSIONS"
    });
    const generation = res?.sessions?.[String(tabId)];
    return res?.ok && typeof generation === "number" ? generation : void 0;
  } catch {
    return void 0;
  }
}
async function offscreenHasCapture(tabId) {
  return typeof await getLiveCaptureGeneration(tabId) === "number";
}
async function stopOrphanCapture(tabId) {
  if (!await hasOffscreenDocument()) return true;
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "STOP_CAPTURE",
    tabId
  });
  if (!response?.ok) {
    throw new Error(response?.error || "\u65E0\u6CD5\u505C\u6B62\u65E7\u5F55\u97F3\u6D41");
  }
  const released = await waitForCaptureRelease(
    async () => {
      const live = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "GET_CAPTURE_SESSIONS"
      });
      if (!live?.ok) throw new Error(live?.error || "\u65E0\u6CD5\u786E\u8BA4\u65E7\u5F55\u97F3\u6D41\u72B6\u6001");
      return typeof live.sessions?.[String(tabId)] === "number";
    },
    { maxAttempts: 10, delayMs: 100 }
  );
  if (!released) throw new Error("\u65E7\u5F55\u97F3\u6D41\u91CA\u653E\u8D85\u65F6");
  return true;
}
async function forceResetOffscreenCapture() {
  if (!await hasOffscreenDocument()) return true;
  const result = await forceReleaseOffscreenDocument(
    async () => {
      const live = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "GET_CAPTURE_SESSIONS"
      });
      if (!live?.ok) throw new Error(live?.error || "\u65E0\u6CD5\u786E\u8BA4\u5176\u4ED6\u5F55\u97F3\u72B6\u6001");
      return Array.isArray(live.tabIds) ? live.tabIds : [];
    },
    async () => {
      await chrome.offscreen.closeDocument();
    },
    hasOffscreenDocument,
    { maxAttempts: 10, delayMs: 100 }
  );
  if (result === "busy") throw new Error("\u5176\u4ED6\u6807\u7B7E\u9875\u4ECD\u5728\u5F55\u97F3\uFF0C\u65E0\u6CD5\u91CD\u7F6E\u5F55\u97F3\u7EC4\u4EF6");
  if (result === "timeout") throw new Error("\u5F55\u97F3\u7EC4\u4EF6\u91CA\u653E\u8D85\u65F6");
  return true;
}

// src/ext/background/session-store.ts
var SESSION_RECOVERY_KEY = "snooper.extension.sessions.v1";
var sessions = /* @__PURE__ */ new Map();
var recoveryReady = Promise.resolve();
function setRecoveryReady(promise) {
  recoveryReady = promise;
}
var generationCounter = Date.now();
function nextGeneration() {
  return ++generationCounter;
}
function createSession(tabId) {
  const s = {
    tabId,
    state: "idle",
    sourceLang: "auto",
    targetLang: "zh",
    generation: 0,
    createdAt: Date.now(),
    configSnapshot: null,
    subtitles: [],
    messages: [],
    streamId: "",
    pendingAskRequestId: null,
    streamingSubtitle: null,
    audioSilent: false
  };
  sessions.set(tabId, s);
  return s;
}
function getOrCreateSession(tabId) {
  let s = sessions.get(tabId);
  if (!s) {
    s = createSession(tabId);
  }
  return s;
}
async function reconcileSessionState(tabId) {
  await recoveryReady;
  const session = getOrCreateSession(tabId);
  const liveGeneration = await getLiveCaptureGeneration(tabId);
  const reconciled = reconcileSessionWithCapture(session, liveGeneration);
  if (reconciled !== session) {
    Object.assign(session, reconciled);
    persistSessionsThrottled();
  }
  return session;
}
function safeSession(s) {
  return {
    state: s.state,
    sourceLang: s.sourceLang,
    targetLang: s.targetLang,
    subtitles: s.subtitles,
    messages: s.messages,
    streamingSubtitle: s.streamingSubtitle,
    audioSilent: s.audioSilent
  };
}
function hasActiveSession() {
  for (const s of sessions.values()) {
    if (s.state === "running" || s.state === "starting") return true;
  }
  return false;
}
function maybeCloseOffscreen() {
  if (hasActiveSession()) return;
  closeOffscreenDocument().catch(() => {
  });
}
function pushSession(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  chrome.tabs.sendMessage(tabId, {
    type: "SESSION_UPDATE",
    session: safeSession(s)
  }).catch(() => {
  });
  persistSessionsThrottled();
}
function pushStreamingUpdate(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  chrome.tabs.sendMessage(tabId, {
    type: "STREAMING_UPDATE",
    streamingSubtitle: s.streamingSubtitle
    // null clears the streaming state
  }).catch(() => {
  });
}
var lastPersistAt = 0;
function persistSessionsThrottled() {
  const now = Date.now();
  if (now - lastPersistAt < 3e3) return;
  lastPersistAt = now;
  persistSessions();
}
function persistSessions() {
  const obj = {};
  for (const [tabId, s] of sessions.entries()) {
    obj[String(tabId)] = {
      tabId: s.tabId,
      state: s.state,
      sourceLang: s.sourceLang,
      targetLang: s.targetLang,
      generation: s.generation,
      subtitles: s.subtitles,
      messages: s.messages,
      audioSilent: false
    };
  }
  try {
    chrome.storage.session.set({ [SESSION_RECOVERY_KEY]: JSON.stringify(obj) });
  } catch {
  }
}

// src/ext/background/history.ts
var HISTORY_KEY = "snooper.extension.history.v1";
var MAX_HISTORY = 100;
var MAX_SUBTITLES_PER_RECORD = 500;
async function persistSessionHistory(tabId) {
  const s = sessions.get(tabId);
  if (!s || !s.subtitles || s.subtitles.length === 0) return;
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const entry = {
      id: `h_${Date.now().toString(36)}_${tabId}`,
      pageTitle: tab?.title || "",
      url: tab?.url || "",
      startedAt: s.createdAt || Date.now(),
      endedAt: Date.now(),
      sourceLang: s.sourceLang || "auto",
      targetLang: s.targetLang || "zh",
      subtitleCount: s.subtitles.length,
      subtitles: s.subtitles.slice(-MAX_SUBTITLES_PER_RECORD).map(({ at, endedAt, source, target, latency }) => ({
        at,
        endedAt,
        source,
        target,
        latency
      }))
    };
    const got = await chrome.storage.local.get(HISTORY_KEY);
    const history = Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [];
    history.unshift(entry);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch {
  }
}
async function readHistory() {
  try {
    const got = await chrome.storage.local.get(HISTORY_KEY);
    return Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [];
  } catch {
    return [];
  }
}
async function deleteHistoryEntries(ids) {
  try {
    const got = await chrome.storage.local.get(HISTORY_KEY);
    let history = Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [];
    const remove = new Set(ids);
    history = history.filter((h) => !remove.has(h.id));
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch {
  }
}
async function clearHistory() {
  try {
    await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  } catch {
  }
}

// src/ext/background/lifecycle.ts
var CONTENT_SCRIPT_FILE = "content.js";
var FS_BRIDGE_FILE = "fullscreen-bridge.js";
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE]
  });
}
function removeSession(tabId) {
  sessions.delete(tabId);
  sendToOffscreen({ type: "STOP_CAPTURE", tabId }).catch(() => {
  });
  maybeCloseOffscreen();
}
function stopSessionForTab(tabId) {
  const s = sessions.get(tabId);
  if (!s || s.state !== "running" && s.state !== "starting") return;
  if (s.subtitles.length > 0) persistSessionHistory(tabId);
  sendToOffscreen({ type: "STOP_CAPTURE", tabId, generation: s.generation }).catch(() => {
  });
  s.state = "idle";
  s.streamId = "";
  s.configSnapshot = null;
  s.subtitles = [];
  s.streamingSubtitle = null;
  s.audioSilent = false;
  pushSession(tabId);
  maybeCloseOffscreen();
}
function registerLifecycleListeners() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    removeSession(tabId);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
      stopSessionForTab(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    const s = sessions.get(tabId);
    if (!s) return;
    if (s.subtitles.length > 0) persistSessionHistory(tabId);
    sendToOffscreen({ type: "STOP_CAPTURE", tabId, generation: s.generation }).catch(() => {
    });
    sessions.delete(tabId);
    persistSessions();
    maybeCloseOffscreen();
  });
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const session = await reconcileSessionState(activeInfo.tabId);
    if (session.state === "running" || session.state === "starting") pushSession(activeInfo.tabId);
  });
  chrome.action.onClicked.addListener((tab) => {
    if (typeof tab.id !== "number") return;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [FS_BRIDGE_FILE],
      world: "MAIN"
    }).catch((err) => {
      console.warn("[RTTS] FS bridge injection error:", err.message);
    });
    void openToolbarForTab(tab.id, {
      tabUrl: tab.url,
      sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
      injectContentScript
    }).catch((err) => {
      console.warn("[RTTS] toolbar unavailable:", err.message);
    });
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      console.warn("[RTTS] sidePanel.open error:", err.message);
    });
  });
  chrome.runtime.onInstalled.addListener(async () => {
    try {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: false
        // We handle this manually in onClicked
      });
    } catch {
    }
    const existing = await loadConfig();
    if (!existing || !existing.providers || existing.providers.length === 0) {
      await saveConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    }
  });
}

// src/ext/background/recovery.ts
async function recoverSessions() {
  try {
    const result = await chrome.storage.session.get(SESSION_RECOVERY_KEY);
    if (!result[SESSION_RECOVERY_KEY]) return;
    const recovered = JSON.parse(result[SESSION_RECOVERY_KEY]);
    let liveGenerations = {};
    if (await hasOffscreenDocument()) {
      try {
        const live = await chrome.runtime.sendMessage({
          target: "offscreen",
          type: "GET_CAPTURE_SESSIONS"
        });
        if (live?.ok && live.sessions && typeof live.sessions === "object") {
          liveGenerations = live.sessions;
        }
      } catch {
      }
    }
    for (const [tabIdStr, stored] of Object.entries(recovered)) {
      const tabId = Number(tabIdStr);
      const s = stored;
      const liveGeneration = liveGenerations[String(tabId)];
      if (typeof liveGeneration === "number") {
        s.state = "running";
        s.generation = liveGeneration;
        s.streamId = "";
      } else if (s.state === "running" || s.state === "starting" || s.state === "stopping") {
        s.state = "idle";
        s.streamId = "";
        s.configSnapshot = null;
        s.streamingSubtitle = null;
      }
      sessions.set(tabId, s);
      pushSession(tabId);
    }
  } catch {
  }
}

// src/ext/background/router/offscreen-events.ts
function registerOffscreenEventRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PATH)) {
      return false;
    }
    switch (message.type) {
      case "CAPTURE_AUDIO_STATE": {
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
      case "CAPTURE_KEEPALIVE": {
        const s = sessions.get(message.tabId);
        if (s && s.state === "starting" && s.generation === message.generation) {
          s.state = "running";
          pushSession(message.tabId);
        }
        sendResponse({ ok: true });
        return false;
      }
      case "CAPTURE_ENDED": {
        const s = sessions.get(message.tabId);
        if (s && s.generation === message.generation && (s.state === "running" || s.state === "starting")) {
          s.state = "idle";
          s.streamId = "";
          s.configSnapshot = null;
          s.streamingSubtitle = null;
          s.audioSilent = false;
          if (s.subtitles.length > 0) persistSessionHistory(message.tabId);
          pushSession(message.tabId);
          maybeCloseOffscreen();
        }
        sendResponse({ ok: true });
        return false;
      }
      case "CAPTURE_SUBTITLE_STREAMING": {
        const s = sessions.get(message.tabId);
        if (!s || s.generation !== message.generation) {
          return false;
        }
        if (s.state !== "running" && s.state !== "starting") {
          return false;
        }
        if (!message.source && !message.partialTarget) {
          if (!s.streamingSubtitle || s.streamingSubtitle.at === message.at) {
            s.streamingSubtitle = null;
          }
        } else {
          s.streamingSubtitle = {
            at: message.at || Date.now(),
            source: message.source || "",
            partialTarget: message.partialTarget || "",
            latency: message.latency || 0
          };
        }
        pushStreamingUpdate(message.tabId);
        return false;
      }
      case "CAPTURE_SUBTITLE": {
        const s = sessions.get(message.tabId);
        if (!s || s.generation !== message.generation) {
          return false;
        }
        if (s.streamingSubtitle && s.streamingSubtitle.at === (message.at || Date.now())) {
          s.streamingSubtitle = null;
        }
        s.subtitles.push({
          id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          at: message.at || Date.now(),
          endedAt: message.endedAt || null,
          source: message.source || "",
          target: message.target || "",
          latency: message.latency || 0
        });
        if (s.subtitles.length > 200) {
          s.subtitles = s.subtitles.slice(-150);
        }
        pushSession(message.tabId);
        return false;
      }
      case "CAPTURE_ERROR": {
        const s = sessions.get(message.tabId);
        if (!s || s.generation !== message.generation) return false;
        s.state = "error";
        s.streamingSubtitle = null;
        pushStreamingUpdate(message.tabId);
        pushSession(message.tabId);
        return false;
      }
      case "ASK_RESULT": {
        return false;
      }
    }
    return false;
  });
}

// src/ext/background/router/capture.ts
var captureHandlers = {
  CAPTURE_SCREENSHOT: (_message, { tabId, sender, sendResponse }) => {
    const windowId = sender.tab?.windowId;
    const captureVisible = () => windowId != null ? chrome.tabs.captureVisibleTab(windowId, { format: "png" }) : chrome.tabs.captureVisibleTab({ format: "png" });
    captureVisible().then((dataUrl) => {
      console.log("[RTTS] screenshot source=visible-tab");
      sendResponse({ ok: true, dataUrl, path: "visible-tab" });
    }).catch(async (err) => {
      if (err.message && /active stream/i.test(err.message)) {
        if (!await hasOffscreenDocument()) {
          sendResponse({ ok: false, error: "\u622A\u56FE\u5931\u8D25\uFF1A\u6807\u7B7E\u9875\u6B63\u88AB\u5176\u4ED6\u5F55\u97F3\u5360\u7528\uFF0C\u8BF7\u505C\u6B62\u540E\u91CD\u8BD5" });
          return;
        }
        sendToOffscreen({ type: "CAPTURE_FRAME", tabId }).then((frame) => {
          if (frame && frame.dataUrl) {
            console.log("[RTTS] screenshot source=offscreen-frame");
            sendResponse({ ok: true, dataUrl: frame.dataUrl, path: "offscreen-frame" });
          } else {
            sendResponse({
              ok: false,
              error: frame?.error || "\u622A\u56FE\u5931\u8D25\uFF1A\u5F55\u5236\u4E2D\u7684\u89C6\u9891\u5E27\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5"
            });
          }
        }).catch((e) => {
          sendResponse({ ok: false, error: "\u622A\u56FE\u5931\u8D25\uFF1A" + (e.message || "") });
        });
      } else {
        sendResponse({ ok: false, error: err.message || "\u622A\u56FE\u5931\u8D25" });
      }
    });
    return true;
  }
};

// src/ext/background/router/config.ts
var configHandlers = {
  /* ---------- Config (in-page settings modal + side panel) ---------- */
  // Both surfaces are trusted extension contexts: the content script runs in
  // an isolated world that page scripts cannot reach, and `sender.tab` proves
  // the message came from an injected content script rather than the page.
  GET_CONFIG: (_message, { sendResponse }) => {
    loadConfig().then((config) => {
      sendResponse({ ok: true, config });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  },
  SAVE_CONFIG: (message, { sendResponse }) => {
    saveConfig(message.config).then(() => {
      sendResponse({ ok: true });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  },
  /* ---------- Connection test (in-page settings modal) ---------- */
  TEST_CONNECTION: (message, { sendResponse }) => {
    (async () => {
      try {
        const config = message.config || await loadConfig();
        const provider = Array.isArray(config.providers) ? config.providers[0] : null;
        if (!provider?.baseUrl) throw new Error("\u8BF7\u5148\u586B\u5199 Base URL");
        let origin;
        try {
          origin = new URL(provider.baseUrl).origin;
        } catch {
          throw new Error("Base URL \u683C\u5F0F\u65E0\u6548");
        }
        const res = await fetch(`${origin}${new URL(provider.baseUrl).pathname.replace(/\/+$/, "")}/models`, {
          headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          let detail = "";
          try {
            const parsed = JSON.parse(text);
            detail = parsed.error?.message || "";
          } catch {
            detail = text.slice(0, 160);
          }
          throw new Error(`HTTP ${res.status}${detail ? ` \xB7 ${detail}` : ""}`);
        }
        let ids = [];
        try {
          const payload = JSON.parse(text);
          ids = (payload.data || []).map((item) => item.id).filter(Boolean);
        } catch {
          throw new Error("\u8FD4\u56DE\u5185\u5BB9\u4E0D\u662F\u6709\u6548\u7684\u6A21\u578B\u5217\u8868");
        }
        sendResponse({ ok: true, count: ids.length, models: ids.slice(0, 60) });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || "\u8FDE\u63A5\u5931\u8D25" });
      }
    })();
    return true;
  }
};

// src/ext/background/router/history.ts
var historyHandlers = {
  GET_HISTORY: (_message, { sendResponse }) => {
    readHistory().then((history) => {
      sendResponse({ ok: true, history });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  },
  DELETE_HISTORY: (message, { sendResponse }) => {
    const ids = Array.isArray(message.ids) ? message.ids.map((id) => String(id)) : [String(message.id || "")];
    deleteHistoryEntries(ids).then(() => sendResponse({ ok: true })).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  },
  DELETE_ALL_HISTORY: (_message, { sendResponse }) => {
    clearHistory().then(() => sendResponse({ ok: true })).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }
};

// src/lib/image-material.ts
var MAX_IMAGE_BYTES = 12 * 1024 * 1024;
function planImageFetch(url, baseUrl, apiKey) {
  let target;
  try {
    target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? new URL(url) : new URL(url, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  } catch {
    throw new Error("\u56FE\u7247\u5730\u5740\u65E0\u6548");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error(`\u4E0D\u652F\u6301\u7684\u56FE\u7247\u534F\u8BAE\uFF1A${target.protocol}`);
  }
  const headers = {};
  try {
    if (apiKey && new URL(baseUrl).origin === target.origin) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  } catch {
  }
  return { url: target.toString(), headers };
}
var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
var ascii = (bytes, offset, text) => text.split("").every((char, index) => bytes[offset + index] === char.charCodeAt(0));
function detectImageMime(contentType, bytes) {
  const declared = contentType.split(";")[0].trim().toLowerCase();
  if (declared.startsWith("image/")) return declared;
  if (bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a"))) {
    return "image/gif";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  if (bytes.length >= 2 && ascii(bytes, 0, "BM")) {
    return "image/bmp";
  }
  return null;
}
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
async function materializeImage(url, baseUrl, apiKey, options = {}) {
  if (url.startsWith("data:")) return url;
  const plan = planImageFetch(url, baseUrl, apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15e3);
  try {
    const res = await fetchImpl(plan.url, { headers: plan.headers, signal: controller.signal });
    if (!res.ok) throw new Error(`\u56FE\u7247\u4E0B\u8F7D\u5931\u8D25 HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length") || "0");
    if (declared > maxBytes) throw new Error("\u56FE\u7247\u8D85\u8FC7 12 MB\uFF0C\u5DF2\u8DF3\u8FC7\u7F13\u5B58");
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new Error("\u56FE\u7247\u8D85\u8FC7 12 MB\uFF0C\u5DF2\u8DF3\u8FC7\u7F13\u5B58");
    const mime = detectImageMime(
      res.headers.get("content-type") || "",
      new Uint8Array(buffer)
    );
    if (!mime) throw new Error("\u56FE\u7247\u5730\u5740\u8FD4\u56DE\u7684\u5185\u5BB9\u4E0D\u662F\u56FE\u7247");
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("\u56FE\u7247\u4E0B\u8F7D\u8D85\u65F6");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// src/ext/background/router/image.ts
var imageHandlers = {
  /* ---------- In-page image generation ---------- */
  GENERATE_IMAGE: (message, { sendResponse }) => {
    (async () => {
      try {
        let parseImageResponse = function(text) {
          const payload = JSON.parse(text);
          const images2 = [];
          if (Array.isArray(payload.data)) {
            for (const item of payload.data) {
              if (item.url) images2.push(item.url);
              else if (item.b64_json) images2.push(`data:image/png;base64,${item.b64_json}`);
            }
          }
          if (payload.images && Array.isArray(payload.images)) {
            for (const item of payload.images) {
              if (typeof item === "string" && item.length > 0) images2.push(item);
              else if (item.url) images2.push(item.url);
              else if (item.b64_json) images2.push(`data:image/png;base64,${item.b64_json}`);
            }
          }
          if (images2.length === 0 && payload.output) {
            if (typeof payload.output === "string" && payload.output.length > 0) images2.push(payload.output);
            else if (Array.isArray(payload.output)) {
              for (const o of payload.output) {
                if (typeof o === "string" && o.length > 0) images2.push(o);
                else if (o.url) images2.push(o.url);
                else if (o.b64_json) images2.push(`data:image/png;base64,${o.b64_json}`);
              }
            }
          }
          if (images2.length === 0) throw new Error("\u751F\u56FE\u63A5\u53E3\u54CD\u5E94\u4E2D\u6CA1\u6709\u627E\u5230\u56FE\u7247");
          return images2;
        };
        const config = await loadConfig();
        const route = config.routes.image;
        const provider = config.providers.find((p) => p.id === route?.providerId) || config.providers[0];
        if (!provider?.apiKey) {
          throw new Error("\u5C1A\u672A\u914D\u7F6E API Key\uFF0C\u8BF7\u70B9\u51FB\u9875\u9762\u60AC\u6D6E\u680F\u7684 \u2699 \u5728\u9875\u9762\u5185\u914D\u7F6E");
        }
        const prompt = String(message.prompt || "").trim();
        if (!prompt) throw new Error("\u63D0\u793A\u8BCD\u4E0D\u80FD\u4E3A\u7A7A");
        if (prompt.length > 4e3) throw new Error("\u63D0\u793A\u8BCD\u8FC7\u957F\uFF08\u6700\u591A 4000 \u5B57\uFF09");
        const baseUrl = provider.baseUrl.replace(/\/+$/, "");
        const body = {
          model: route?.model || "moss-image-sft-1.0",
          prompt,
          n: 1,
          size: message.size || "1024x1024",
          prompt_enhance: true,
          output_watermark: { enabled: false }
        };
        const negative = String(message.negativePrompt || "").trim();
        if (negative) body.negative_prompt = negative;
        async function tryGenerate(requestBody) {
          const res = await fetch(`${baseUrl}/images/generations`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${provider.apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
          });
          const text = await res.text().catch(() => "");
          if (!res.ok) {
            let detail = "";
            try {
              const parsed = JSON.parse(text);
              detail = parsed.error?.message || "";
            } catch {
              detail = text.slice(0, 200);
            }
            const errMsg = `HTTP ${res.status}${detail ? ` \xB7 ${detail}` : ""}`;
            if (res.status >= 400 && res.status < 500 && requestBody.prompt_enhance !== void 0) {
              const retryBody = { ...requestBody };
              delete retryBody.prompt_enhance;
              delete retryBody.output_watermark;
              const r2 = await fetch(`${baseUrl}/images/generations`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${provider.apiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify(retryBody)
              });
              const text2 = await r2.text().catch(() => "");
              if (r2.ok) {
                const imgs = parseImageResponse(text2);
                if (imgs.length > 0) return imgs;
              }
              throw new Error(`\u751F\u56FE\u5931\u8D25 ${errMsg}`);
            }
            throw new Error(`\u751F\u56FE\u5931\u8D25 ${errMsg}`);
          }
          return parseImageResponse(text);
        }
        const images = await tryGenerate(body);
        const outcomes = await Promise.all(images.map(async (image) => {
          if (image.startsWith("data:")) {
            return { rendered: image, remote: "", warning: "" };
          }
          try {
            return {
              rendered: await materializeImage(image, baseUrl, provider.apiKey),
              remote: image,
              warning: ""
            };
          } catch (err) {
            return {
              rendered: image,
              remote: image,
              warning: err?.message || "\u56FE\u7247\u4E0B\u8F7D\u5931\u8D25"
            };
          }
        }));
        const renderedImages = outcomes.map((item) => item.rendered);
        const remoteImages = outcomes.map((item) => item.remote).filter(Boolean);
        const warnings = outcomes.map((item) => item.warning).filter(Boolean);
        console.log("[RTTS] image generation", {
          fields: images.length,
          remote: remoteImages.length,
          dataUrls: renderedImages.filter((item) => item.startsWith("data:")).length,
          warnings
        });
        sendResponse({
          ok: true,
          images: renderedImages,
          remoteImages,
          warnings,
          model: route?.model || "moss-image-sft-1.0"
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || "\u751F\u56FE\u5931\u8D25" });
      }
    })();
    return true;
  },
  FETCH_IMAGE: (message, { sendResponse }) => {
    const url = String(message.url || "").trim();
    if (!url) {
      sendResponse({ ok: false, error: "URL \u4E3A\u7A7A" });
      return false;
    }
    (async () => {
      try {
        const config = await loadConfig();
        const route = config.routes.image;
        const provider = config.providers.find((p) => p.id === route?.providerId) || config.providers[0];
        const dataUrl = await materializeImage(
          url,
          provider?.baseUrl || "",
          provider?.apiKey || ""
        );
        sendResponse({ ok: true, dataUrl });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "\u65E0\u6CD5\u4E0B\u8F7D\u56FE\u7247" });
      }
    })();
    return true;
  }
};

// src/lib/export-assets.ts
function decodeExportAsset(asset) {
  if (asset.mimeType === "image/svg+xml" && asset.svgText) {
    return { file: { name: asset.fileName, bytes: new TextEncoder().encode(asset.svgText) } };
  }
  const dataUrl = asset.dataUrl || "";
  const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || "image/png";
  if (mime !== asset.mimeType) return null;
  try {
    const binary = atob(match[2] || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { file: { name: asset.fileName, bytes } };
  } catch {
    return null;
  }
}
var CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

// src/ext/background/obsidian.ts
function normalizeObsidianKey(raw) {
  return String(raw || "").trim().replace(/^Bearer\s+/i, "").trim();
}
function resolveProtocol(oc, port) {
  if (oc.apiProtocol === "https") return "https";
  if (oc.apiProtocol === "http") return "http";
  return port === 27124 ? "https" : "http";
}
function normalizeFolder(raw) {
  return String(raw || "snooper-notes").replace(/^\/+|\/+$/g, "");
}
async function exportToObsidian(message) {
  const content = message.content || "";
  const title = message.title || `snooper-\u7B14\u8BB0-${Date.now()}`;
  if (!content) {
    return { ok: false, error: "\u6CA1\u6709\u5185\u5BB9\u53EF\u5BFC\u51FA" };
  }
  const oc = message.obsidianConfig || {};
  const obsidianPort = Number(oc.apiPort) || 27123;
  const protocol = resolveProtocol(oc, obsidianPort);
  const obsidianApiKey = normalizeObsidianKey(oc.apiKey);
  const noteFolder = normalizeFolder(oc.noteFolder);
  const fileName = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.md`;
  const base = `${protocol}://127.0.0.1:${obsidianPort}`;
  const vaultPath = noteFolder ? `/vault/${noteFolder}/${encodeURIComponent(fileName)}` : `/vault/${encodeURIComponent(fileName)}`;
  try {
    const res = await fetch(base + vaultPath, {
      method: "PUT",
      headers: {
        "Content-Type": "text/markdown",
        ...obsidianApiKey ? { Authorization: `Bearer ${obsidianApiKey}` } : {}
      },
      body: content
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Obsidian \u62D2\u7EDD\u8BBF\u95EE\uFF1AAPI Key \u4E0D\u6B63\u786E\u6216\u672A\u586B\u5199" };
    }
    if (res.status === 404) {
      return { ok: false, error: "Obsidian \u627E\u4E0D\u5230\u5199\u5165\u8DEF\u5F84\uFF0C\u8BF7\u68C0\u67E5\u7B14\u8BB0\u76EE\u5F55\u8BBE\u7F6E" };
    }
    return { ok: false, error: `Obsidian API \u8FD4\u56DE ${res.status}` };
  } catch {
    const hint = protocol === "https" ? "HTTPS 27124 \u4F7F\u7528\u81EA\u7B7E\u540D\u8BC1\u4E66\uFF0CChrome \u4F1A\u62D2\u7EDD\u3002\u8BF7\u5728 Obsidian \u2192 Local REST API \u8BBE\u7F6E\u4E2D\u5F00\u542F\u300CEnable Non-encrypted (HTTP) Server\u300D\uFF0C\u7136\u540E\u5728\u4FA7\u680F\u628A\u534F\u8BAE\u6539\u4E3A HTTP\u3001\u7AEF\u53E3 27123\u3002" : "\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C\u3001Local REST API \u63D2\u4EF6\u5DF2\u542F\u7528\uFF0C\u5E76\u5F00\u542F\u300CEnable Non-encrypted (HTTP) Server\u300D\uFF08\u7AEF\u53E3 27123\uFF09\u3002";
    return { ok: false, error: `\u65E0\u6CD5\u8FDE\u63A5 Obsidian\uFF08${base}\uFF09\u3002${hint}` };
  }
}
async function uploadObsidianAsset(message) {
  const oc = message.obsidianConfig || {};
  const key = normalizeObsidianKey(oc.apiKey);
  const port = Number(oc.apiPort) || 27123;
  const protocol = resolveProtocol(oc, port);
  const folder = normalizeFolder(oc.noteFolder);
  const fileName = String(message.fileName || "").replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!fileName) {
    return { ok: false, error: "\u8D44\u4EA7\u6587\u4EF6\u540D\u4E3A\u7A7A" };
  }
  try {
    let bytes;
    let mime = String(message.mimeType || "image/png");
    const decoded = decodeExportAsset({
      entryId: "obsidian",
      fileName,
      mimeType: mime === "image/svg+xml" ? "image/svg+xml" : mime,
      dataUrl: String(message.dataUrl || ""),
      svgText: String(message.rawText || "")
    });
    if (decoded) {
      bytes = decoded.file.bytes;
      if (mime === "image/svg+xml") mime = "image/svg+xml";
    } else if (/^https?:\/\//i.test(String(message.dataUrl || ""))) {
      const r = await fetch(String(message.dataUrl));
      if (!r.ok) throw new Error(`\u4E0B\u8F7D\u56FE\u7247\u5931\u8D25 HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      bytes = new Uint8Array(buf);
      mime = r.headers.get("content-type") || mime;
    } else {
      throw new Error("\u6CA1\u6709\u53EF\u4E0A\u4F20\u7684\u56FE\u7247\u6570\u636E");
    }
    const base = `${protocol}://127.0.0.1:${port}`;
    const assetPath = folder ? `/vault/${folder}/assets/${encodeURIComponent(fileName)}` : `/vault/assets/${encodeURIComponent(fileName)}`;
    const res = await fetch(base + assetPath, {
      method: "PUT",
      headers: {
        "Content-Type": mime,
        ...key ? { Authorization: `Bearer ${key}` } : {}
      },
      body: bytes
    });
    if (!res.ok) {
      return { ok: false, error: `\u56FE\u7247\u4E0A\u4F20\u5931\u8D25 HTTP ${res.status}` };
    }
    return { ok: true, fileName };
  } catch (err) {
    return { ok: false, error: err.message || "\u56FE\u7247\u4E0A\u4F20\u5931\u8D25" };
  }
}
async function testObsidian(message) {
  const oc = message.obsidianConfig || {};
  const key = normalizeObsidianKey(oc.apiKey);
  const configuredPort = Number(oc.apiPort) || 27123;
  const configuredProtocol = resolveProtocol(oc, configuredPort);
  const seen = /* @__PURE__ */ new Set();
  const candidates = [];
  for (const c of [
    { protocol: configuredProtocol, port: configuredPort },
    { protocol: "http", port: 27123 },
    { protocol: "https", port: 27124 }
  ]) {
    const id = `${c.protocol}:${c.port}`;
    if (!seen.has(id)) {
      seen.add(id);
      candidates.push(c);
    }
  }
  for (const c of candidates) {
    try {
      const res = await fetch(`${c.protocol}://127.0.0.1:${c.port}/vault/`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {}
      });
      if (res.ok) {
        return { ok: true, protocol: c.protocol, port: c.port };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          protocol: c.protocol,
          port: c.port,
          error: `\u5DF2\u8FDE\u4E0A ${c.protocol}://127.0.0.1:${c.port}\uFF0C\u4F46 API Key \u4E0D\u6B63\u786E\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u590D\u5236`
        };
      }
    } catch {
    }
  }
  return {
    ok: false,
    error: "\u65E0\u6CD5\u8FDE\u63A5\u3002\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C\u3001Local REST API \u63D2\u4EF6\u5DF2\u542F\u7528\uFF0C\u5E76\u5F00\u542F\u300CEnable Non-encrypted (HTTP) Server\u300D\uFF08\u7AEF\u53E3 27123\uFF09"
  };
}

// src/ext/background/router/obsidian.ts
var obsidianHandlers = {
  EXPORT_TO_OBSIDIAN: (message, { sendResponse }) => {
    exportToObsidian(message).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message || "\u5BFC\u51FA\u5931\u8D25" });
    });
    return true;
  },
  OBSIDIAN_UPLOAD_ASSET: (message, { sendResponse }) => {
    uploadObsidianAsset(message).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message || "\u56FE\u7247\u4E0A\u4F20\u5931\u8D25" });
    });
    return true;
  },
  TEST_OBSIDIAN: (message, { sendResponse }) => {
    testObsidian(message).then(sendResponse).catch(() => {
      sendResponse({ ok: false, error: "\u65E0\u6CD5\u8FDE\u63A5 Obsidian" });
    });
    return true;
  }
};

// src/lib/models.ts
var MODEL_CATALOG = [
  {
    id: "moss-vl-1.0",
    label: "MOSS VL 1.0",
    kind: "chat",
    blurb: "\u901A\u7528\u591A\u6A21\u6001\u7406\u89E3\uFF0C\u6587\u672C\u5BF9\u8BDD / \u7FFB\u8BD1 / OCR \u5168\u80FD",
    badge: "\u63A8\u8350"
  },
  {
    id: "moss-vl-realtime-1.0",
    label: "MOSS VL Realtime",
    kind: "vision",
    blurb: "\u4F4E\u5EF6\u8FDF\u89C6\u9891\u5E27\u6D41\u5F0F\u7406\u89E3\uFF08WebSocket\uFF09"
  },
  {
    id: "moss-transcribe-1.0",
    label: "MOSS Transcribe",
    kind: "audio",
    blurb: "\u8BED\u97F3\u8F6C\u5199\uFF0C\u5B9E\u65F6\u5B57\u5E55\u7BA1\u7EBF\u6838\u5FC3"
  },
  {
    id: "moss-transcribe-diarize-pro",
    label: "Transcribe Diarize Pro",
    kind: "audio",
    blurb: "\u5E26\u8BF4\u8BDD\u4EBA\u5206\u79BB\u7684\u9AD8\u7CBE\u5EA6\u8F6C\u5199"
  },
  {
    id: "moss-transcribe-diarize-flash-2026-09-02",
    label: "Transcribe Diarize Flash",
    kind: "audio",
    blurb: "\u4F4E\u5EF6\u8FDF\u8BF4\u8BDD\u4EBA\u5206\u79BB\u8F6C\u5199"
  },
  {
    id: "moss-tts-1.5-flash",
    label: "MOSS TTS Flash",
    kind: "speech",
    blurb: "\u4F4E\u5EF6\u8FDF\u8BED\u97F3\u5408\u6210"
  },
  {
    id: "moss-tts-1.0-pro",
    label: "MOSS TTS Pro",
    kind: "speech",
    blurb: "\u9AD8\u81EA\u7136\u5EA6\u8BED\u97F3\u5408\u6210"
  },
  {
    id: "moss-ttsd-1.0",
    label: "MOSS TTSD",
    kind: "speech",
    blurb: "\u5BF9\u8BDD\u5F0F\u8BED\u97F3\u5408\u6210"
  },
  {
    id: "moss-speech",
    label: "MOSS Speech",
    kind: "speech",
    blurb: "\u8BED\u97F3\u7406\u89E3\u4E0E\u589E\u5F3A"
  },
  {
    id: "moss-image-prompt-enhancer-1.0",
    label: "Image Prompt Enhancer",
    kind: "image",
    blurb: "\u56FE\u50CF\u751F\u6210\u63D0\u793A\u8BCD\u589E\u5F3A"
  },
  {
    id: "moss-image-sft-1.0",
    label: "MOSS-Image SFT",
    kind: "image",
    blurb: "\u5B98\u65B9\u6587\u751F\u56FE\uFF0C\u4E2D\u82F1\u6587\u6587\u5B57\u6E32\u67D3/\u5E03\u5C40\u63A7\u5236\uFF0C\u9650\u65F6\u514D\u8D39",
    badge: "\u514D\u8D39 \xB7 \u63A8\u8350"
  },
  {
    id: "moss-image-base-1.0",
    label: "MOSS-Image Base",
    kind: "image",
    blurb: "\u57FA\u7840\u6587\u751F\u56FE\u6A21\u578B\uFF0C\u9002\u5408\u98CE\u683C\u5316\u4E0E\u5FAE\u8C03\uFF0C\u9650\u65F6\u514D\u8D39",
    badge: "\u514D\u8D39"
  },
  {
    id: "moss-image-sft-1.0-2026-10-09",
    label: "MOSS-Image SFT (\u5FEB\u7167)",
    kind: "image",
    blurb: "\u9501\u5B9A\u7248\u672C\u7684 SFT \u5FEB\u7167\uFF0C\u4FDD\u8BC1\u7ED3\u679C\u53EF\u590D\u73B0"
  },
  {
    id: "moss-image-base-1.0-2026-10-09",
    label: "MOSS-Image Base (\u5FEB\u7167)",
    kind: "image",
    blurb: "\u9501\u5B9A\u7248\u672C\u7684 Base \u5FEB\u7167\uFF0C\u4FDD\u8BC1\u7ED3\u679C\u53EF\u590D\u73B0"
  },
  {
    id: "black-forest-labs/FLUX.1-schnell",
    label: "FLUX.1-schnell",
    kind: "image",
    blurb: "\u7B2C\u4E09\u65B9\u4E2D\u8F6C\u6A21\u578B\uFF1A\u6700\u5FEB\u5F00\u6E90\u751F\u56FE\uFF0C1-4\u6B65\u63A8\u7406\uFF08\u975E MOSS \u5B98\u65B9\uFF09"
  },
  {
    id: "stabilityai/stable-diffusion-3.5-medium",
    label: "SD 3.5 Medium",
    kind: "image",
    blurb: "\u7B2C\u4E09\u65B9\u4E2D\u8F6C\u6A21\u578B\uFF1A\u8D28\u91CF\u4E0E\u901F\u5EA6\u5747\u8861\uFF08\u975E MOSS \u5B98\u65B9\uFF09"
  },
  {
    id: "stabilityai/stable-diffusion-xl-base-1.0",
    label: "SDXL 1.0",
    kind: "image",
    blurb: "\u7B2C\u4E09\u65B9\u4E2D\u8F6C\u6A21\u578B\uFF1A\u9AD8\u5206\u8FA8\u7387\u751F\u6210\uFF08\u975E MOSS \u5B98\u65B9\uFF09"
  }
];
var SOURCE_LANGUAGES = [
  { code: "auto", label: "\u81EA\u52A8\u68C0\u6D4B", short: "AUTO" },
  { code: "zh", label: "\u7B80\u4F53\u4E2D\u6587", short: "ZH" },
  { code: "en", label: "English", short: "EN" }
];
var TARGET_LANGUAGES = [
  { code: "zh", label: "\u7B80\u4F53\u4E2D\u6587", short: "ZH" },
  { code: "en", label: "English", short: "EN" },
  { code: "ja", label: "\u65E5\u672C\u8A9E", short: "JA" },
  { code: "ko", label: "\uD55C\uAD6D\uC5B4", short: "KO" },
  { code: "fr", label: "Fran\xE7ais", short: "FR" },
  { code: "de", label: "Deutsch", short: "DE" },
  { code: "es", label: "Espa\xF1ol", short: "ES" },
  { code: "ru", label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", short: "RU" },
  { code: "ar", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629", short: "AR" },
  { code: "pt", label: "Portugu\xEAs", short: "PT" }
];
var LANGUAGES = [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES.filter(
  (target) => !SOURCE_LANGUAGES.some((source) => source.code === target.code)
)];

// src/lib/brand.ts
var STORAGE_KEYS = {
  activeView: "snooper.active-view.v1",
  providerConfig: "snooper.provider-config.v1",
  providerConfigSession: "snooper.provider-config.session.v1"
};

// src/lib/providers.ts
var MODEL_SUGGESTIONS = {
  llm: MODEL_CATALOG.filter((model) => model.kind === "chat" || model.kind === "vision").map(
    (model) => model.id
  ),
  audio: MODEL_CATALOG.filter((model) => model.kind === "audio").map((model) => model.id),
  video: ["moss-vl-realtime-1.0", "moss-vl-1.0"],
  image: [
    "moss-image-sft-1.0",
    "moss-image-base-1.0",
    "moss-image-sft-1.0-2026-10-09",
    "moss-image-base-1.0-2026-10-09",
    "black-forest-labs/FLUX.1-schnell",
    "stabilityai/stable-diffusion-3.5-medium",
    "stabilityai/stable-diffusion-xl-base-1.0"
  ]
};
var CONFIG_KEY2 = STORAGE_KEYS.providerConfig;
var SESSION_CONFIG_KEY = STORAGE_KEYS.providerConfigSession;
var env = import.meta.env;
var envKey = (env.VITE_MOSS_API_KEY ?? "").trim();
var envBaseUrl = (env.VITE_MOSS_BASE_URL ?? "https://api.mosi.cn/v1").trim();

// src/lib/moss.ts
function flattenMessages(messages) {
  const systemText = messages.filter((message) => message.role === "system").map((message) => contentToText(message.content)).filter(Boolean).join("\n\n");
  const turns = messages.filter((message) => message.role !== "system");
  const prefix = systemText ? `\u3010\u7CFB\u7EDF\u6307\u4EE4\u3011
${systemText}

\u3010\u5BF9\u8BDD\u8BB0\u5F55\u3011` : turns.length > 1 ? "\u3010\u5BF9\u8BDD\u8BB0\u5F55\u3011" : "";
  const lines = prefix ? [prefix] : [];
  const images = [];
  for (const message of turns) {
    const label = message.role === "user" ? "\u7528\u6237" : "\u52A9\u624B";
    const text = contentToText(message.content);
    const attached = contentToImages(message.content);
    if (text) lines.push(`${label}\uFF1A${text}`);
    if (attached.length) {
      lines.push(`${label}\u4E0A\u4F20\u4E86 ${attached.length} \u5F20\u56FE\u7247\u3002`);
      images.push(...attached);
    }
  }
  const parts = [];
  if (lines.length) parts.push({ type: "text", text: lines.join("\n") });
  parts.push(...images);
  if (!parts.length) parts.push({ type: "text", text: "\u4F60\u597D" });
  return parts;
}
function contentToText(content) {
  if (typeof content === "string") return content;
  return content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}
function contentToImages(content) {
  if (typeof content === "string") return [];
  return content.filter((part) => part.type === "image_url");
}

// src/ext/background/agent.ts
var STORE_KEY = "snooper.agent.sessions.v1";
var MAX_SESSIONS = 20;
var MAX_TURNS_PER_SESSION = 50;
var HISTORY_TOKEN_BUDGET = 3e3;
var CHARS_PER_TOKEN = 3.2;
var MIN_HISTORY_TURNS = 2;
function emptyStore() {
  return { currentId: null, sessions: [] };
}
function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
function newSession(title) {
  const now = Date.now();
  return { id: `agt_${now}_${Math.random().toString(36).slice(2, 8)}`, title, turns: [], createdAt: now, updatedAt: now };
}
async function loadAgentStore() {
  try {
    const result = await chrome.storage.session.get(STORE_KEY);
    const store = result?.[STORE_KEY];
    if (store && Array.isArray(store.sessions)) return store;
  } catch {
  }
  return emptyStore();
}
async function saveAgentStore(store) {
  await saveAgentStoreInternal(store);
}
async function saveAgentStoreInternal(store) {
  try {
    await chrome.storage.session.set({ [STORE_KEY]: store });
  } catch {
  }
}
async function resolveCurrentSession(store, preferNew = false) {
  if (!preferNew) {
    const current = store.sessions.find((s) => s.id === store.currentId);
    if (current) return current;
  }
  const created = newSession("\u65B0\u5BF9\u8BDD");
  store.sessions.unshift(created);
  store.currentId = created.id;
  while (store.sessions.length > MAX_SESSIONS) {
    const oldestIdx = store.sessions.findIndex((s) => s.id !== store.currentId);
    if (oldestIdx < 0) break;
    store.sessions.splice(oldestIdx, 1);
  }
  return created;
}
function selectHistoryTurns(turns, budgetTokens = HISTORY_TOKEN_BUDGET) {
  const history = turns.slice(0, -1);
  const picked = [];
  let used = 0;
  let keptNewest = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    const cost = estimateTokens(turn.content);
    const minimumNotMet = keptNewest < MIN_HISTORY_TURNS * 2;
    if (minimumNotMet || used + cost <= budgetTokens) {
      picked.unshift(turn);
      used += cost;
      keptNewest++;
    } else {
      break;
    }
  }
  return picked;
}
function buildAskParts({ history, subtitleContext, question, images }) {
  const turns = [];
  for (const turn of history) {
    turns.push({ role: turn.role, content: turn.content });
  }
  const questionText = [
    subtitleContext ? `\u3010\u6700\u8FD1\u7684\u5B57\u5E55\u4E0A\u4E0B\u6587\u3011
${subtitleContext}
` : "",
    question || "\u8BF7\u63CF\u8FF0\u8FD9\u5F20\u56FE\u7247\uFF0C\u5E76\u7ED3\u5408\u89C6\u9891\u4E0A\u4E0B\u6587\u89E3\u91CA\u3002"
  ].filter(Boolean).join("\n");
  turns.push({ role: "user", content: questionText, images: images.length ? images : void 0 });
  const messages = turns.map((turn) => ({
    role: turn.role,
    content: turn.images?.length ? [
      { type: "text", text: turn.content },
      ...turn.images.map((url) => ({ type: "image_url", image_url: { url } }))
    ] : turn.content
  }));
  return flattenMessages(messages);
}
async function recordExchange(store, session, userTurn, assistantTurn) {
  session.turns.push(userTurn, assistantTurn);
  if (session.turns.length > MAX_TURNS_PER_SESSION) {
    session.turns = session.turns.slice(-MAX_TURNS_PER_SESSION);
  }
  if (session.title === "\u65B0\u5BF9\u8BDD" && userTurn.content) {
    session.title = userTurn.content.slice(0, 24) || session.title;
  }
  session.updatedAt = Date.now();
  await saveAgentStore(store);
  return store;
}
function listSessions(store) {
  return [...store.sessions].sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
}
function switchSession(store, id) {
  const target = store.sessions.find((s) => s.id === id);
  if (!target) return null;
  store.currentId = id;
  return target;
}
async function deleteSession(store, id) {
  store.sessions = store.sessions.filter((s) => s.id !== id);
  if (store.currentId === id) store.currentId = store.sessions[0]?.id ?? null;
  await saveAgentStore(store);
}

// src/ext/background/llm.ts
async function askLLM({ parts, config, sourceLang: _sourceLang, targetLang: _targetLang }) {
  void _sourceLang;
  void _targetLang;
  const route = config.routes.llm;
  const provider = config.providers.find((p) => p.id === route.providerId);
  if (!provider || !provider.apiKey) {
    throw new Error("\u5C1A\u672A\u914D\u7F6E LLM \u670D\u52A1\u5546\uFF0C\u8BF7\u70B9\u51FB\u9875\u9762\u60AC\u6D6E\u680F\u7684 \u2699 \u586B\u5165 API Key");
  }
  if (!route.model) {
    throw new Error("\u672A\u9009\u62E9 LLM \u6A21\u578B\uFF0C\u8BF7\u70B9\u51FB\u9875\u9762\u60AC\u6D6E\u680F\u7684 \u2699 \u914D\u7F6E");
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: route.model,
      messages: [{ role: "user", content: parts }],
      temperature: 0.3,
      max_tokens: 2048,
      stream: false
    })
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const text = await res.text();
      if (text) msg = text.slice(0, 240);
    } catch {
    }
    throw new Error(msg);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((p) => p.text || "").join("").trim();
  return String(json.output_text || "").trim();
}

// src/ext/background/router/session.ts
var startAttempts = /* @__PURE__ */ new Map();
var startCancelVersions = /* @__PURE__ */ new Map();
var stopAttempts = /* @__PURE__ */ new Map();
function currentStartVersion(tabId) {
  return startCancelVersions.get(tabId) || 0;
}
function cancelStart(tabId) {
  startCancelVersions.set(tabId, currentStartVersion(tabId) + 1);
}
function requestStreamId(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!id) {
        reject(new Error("\u83B7\u53D6\u97F3\u9891\u6D41 ID \u5931\u8D25"));
      } else {
        resolve(id);
      }
    });
  });
}
async function runStart(message, tabId, startVersion) {
  const s = await reconcileSessionState(tabId);
  if (currentStartVersion(tabId) !== startVersion) return { ok: true, cancelled: true };
  if (s.state === "running" || s.state === "starting") {
    const live = await offscreenHasCapture(tabId);
    if (live) {
      return { ok: true, alreadyRunning: true, session: safeSession(s) };
    }
    s.state = "idle";
    s.streamId = "";
    s.configSnapshot = null;
    s.streamingSubtitle = null;
    pushSession(tabId);
  }
  const config = await loadConfig();
  if (currentStartVersion(tabId) !== startVersion) return { ok: true, cancelled: true };
  const hasKey = config.providers.some((p) => p.apiKey && p.apiKey.trim().length > 0);
  if (!hasKey) {
    console.info("[RTTS] START skipped: \u5C1A\u672A\u914D\u7F6E API Key");
    return {
      ok: false,
      code: "CONFIG_REQUIRED",
      error: "\u5C1A\u672A\u914D\u7F6E API Key\u3002\u8BBE\u7F6E\u9762\u677F\u5DF2\u6253\u5F00\uFF0C\u586B\u5165\u540E\u4FDD\u5B58\u518D\u5F00\u59CB"
    };
  }
  const audioRoute = config.routes.audio;
  const audioProvider = config.providers.find((p) => p.id === audioRoute.providerId);
  if (!audioProvider || !audioProvider.apiKey) {
    console.info("[RTTS] START skipped: \u97F3\u9891\u8F6C\u5199\u670D\u52A1\u5546\u7F3A\u5C11 API Key");
    return {
      ok: false,
      code: "CONFIG_REQUIRED",
      error: `\u97F3\u9891\u8F6C\u5199\u670D\u52A1\u5546\u300C${audioProvider?.name || "\u672A\u914D\u7F6E"}\u300D\u7F3A\u5C11 API Key\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E`
    };
  }
  if (!audioRoute.model) {
    console.info("[RTTS] START skipped: \u97F3\u9891\u8F6C\u5199\u672A\u9009\u62E9\u6A21\u578B");
    return {
      ok: false,
      code: "CONFIG_REQUIRED",
      error: "\u97F3\u9891\u8F6C\u5199\u672A\u9009\u62E9\u6A21\u578B\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u9009\u62E9"
    };
  }
  s.state = "starting";
  s.sourceLang = message.sourceLang || "auto";
  s.targetLang = message.targetLang || "zh";
  s.generation = nextGeneration();
  s.subtitles = [];
  s.streamingSubtitle = null;
  s.audioSilent = false;
  s.configSnapshot = JSON.parse(JSON.stringify(config));
  pushSession(tabId);
  const generation = s.generation;
  const isCurrent = () => currentStartVersion(tabId) === startVersion && s.state === "starting" && s.generation === generation;
  try {
    console.log("[RTTS] START:", tabId, "gen:", generation, "lang:", s.sourceLang, "\u2192", s.targetLang);
    await stopOrphanCapture(tabId);
    if (!isCurrent()) return { ok: true, cancelled: true };
    let streamId;
    try {
      streamId = await requestStreamId(tabId);
    } catch (err) {
      if (!/active stream/i.test(err?.message || "")) throw err;
      await stopOrphanCapture(tabId);
      await forceResetOffscreenCapture();
      try {
        streamId = await requestStreamId(tabId);
      } catch (retryErr) {
        if (/active stream/i.test(retryErr?.message || "")) {
          throw new Error("\u5F55\u97F3\u6D41\u5728\u91CD\u7F6E\u540E\u4ECD\u88AB\u6D4F\u89C8\u5668\u5360\u7528");
        }
        throw retryErr;
      }
    }
    if (!isCurrent()) return { ok: true, cancelled: true };
    s.streamId = streamId;
    console.log("[RTTS] streamId obtained for tab", tabId);
    const started = await sendToOffscreen({
      type: "START_CAPTURE",
      tabId,
      streamId,
      sourceLang: s.sourceLang,
      targetLang: s.targetLang,
      config: s.configSnapshot,
      generation
    });
    if (started && started.ok === false) {
      throw new Error(started.error || "\u542F\u52A8\u5F55\u97F3\u5931\u8D25");
    }
    if (!isCurrent()) {
      await sendToOffscreen({ type: "STOP_CAPTURE", tabId, generation }).catch(() => {
      });
      return { ok: true, cancelled: true };
    }
    s.state = "running";
    pushSession(tabId);
    return { ok: true };
  } catch (err) {
    if (!isCurrent()) {
      console.info("[RTTS] START cancelled during startup");
      return { ok: true, cancelled: true };
    }
    console.warn("[RTTS] START failed:", err.message);
    s.state = "idle";
    s.configSnapshot = null;
    s.streamId = "";
    s.streamingSubtitle = null;
    pushSession(tabId);
    const msg = err && err.message || String(err);
    let friendly = msg;
    if (/重置后仍被浏览器占用/i.test(msg)) {
      friendly = "\u6D4F\u89C8\u5668\u4ECD\u5360\u7528\u672C\u9875\u7684\u5F55\u97F3\u6D41\u3002\u8BF7\u5173\u95ED\u5176\u4ED6\u5F55\u97F3\u6269\u5C55\u6216\u6807\u7B7E\u9875\uFF0C\u5B8C\u5168\u9000\u51FA\u5E76\u91CD\u65B0\u6253\u5F00 Chrome \u540E\u518D\u8BD5";
    } else if (/active stream/i.test(msg)) {
      friendly = "\u8BE5\u6807\u7B7E\u9875\u4ECD\u6709\u6B8B\u7559\u5F55\u97F3\u6D41\uFF08\u6269\u5C55\u540E\u53F0\u91CD\u542F\u6240\u81F4\uFF09\u3002\u5DF2\u81EA\u52A8\u6E05\u7406\uFF0C\u8BF7\u518D\u70B9\u4E00\u6B21\u300C\u5F55\u97F3\u300D\uFF1B\u82E5\u4ECD\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5";
    } else if (/旧录音流释放超时|无法停止旧录音流|无法确认旧录音流状态/i.test(msg)) {
      friendly = "\u65E7\u5F55\u97F3\u6D41\u672A\u80FD\u91CA\u653E\u3002\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5\uFF1B\u82E5\u4ECD\u5931\u8D25\uFF0C\u8BF7\u5728\u6269\u5C55\u7BA1\u7406\u9875\u91CD\u65B0\u52A0\u8F7D snooper \u540E\u518D\u8BD5";
    } else if (/录音组件释放超时|其他标签页仍在录音|无法确认其他录音状态/i.test(msg)) {
      friendly = "\u6D4F\u89C8\u5668\u4ECD\u5360\u7528\u672C\u9875\u7684\u5F55\u97F3\u6D41\u3002\u8BF7\u5148\u505C\u6B62\u5176\u4ED6\u6807\u7B7E\u9875\u7684\u5F55\u97F3\uFF0C\u518D\u5237\u65B0\u672C\u9875\u91CD\u8BD5";
    } else if (/重置后仍被浏览器占用|录音流在重置后仍被/i.test(msg)) {
      const suspects = await describeCaptureSuspects(
        await chrome.management.getAll().then(
          (all) => all.filter((e) => (e.permissions || []).includes("tabCapture")).map((e) => ({ name: e.name, id: e.id }))
        ).catch(() => [])
      );
      friendly = suspects ? `\u6D4F\u89C8\u5668\u4ECD\u5360\u7528\u672C\u9875\u7684\u5F55\u97F3\u6D41\uFF0C\u7591\u4F3C\u6765\u81EA\uFF1A${suspects}\u3002\u8BF7\u505C\u7528\u5BF9\u5E94\u6269\u5C55\u540E\u91CD\u8BD5` : "\u6D4F\u89C8\u5668\u4ECD\u5360\u7528\u672C\u9875\u7684\u5F55\u97F3\u6D41\u3002\u8BF7\u5173\u95ED\u5176\u4ED6\u5F55\u97F3\u6269\u5C55\u6216\u6807\u7B7E\u9875\uFF0C\u5B8C\u5168\u9000\u51FA\u5E76\u91CD\u65B0\u6253\u5F00 Chrome \u540E\u518D\u8BD5";
    } else if (/not been invoked|activeTab/i.test(msg)) {
      friendly = "\u9700\u8981\u5148\u5B8C\u6210\u4E00\u6B21\u6388\u6743\uFF1A\u70B9\u51FB\u6D4F\u89C8\u5668\u5DE5\u5177\u680F\u7684 snooper \u56FE\u6807\uFF08\u5F39\u51FA\u7684\u9762\u677F\u53EF\u7ACB\u5373\u5173\u95ED\uFF09\uFF0C\u4E4B\u540E\u672C\u9875\u53EF\u76F4\u63A5\u4F7F\u7528";
    } else if (/permission|Permission|not allowed|not permitted/i.test(msg)) {
      friendly = "\u7F3A\u5C11\u5F55\u97F3\u6743\u9650\uFF1A\u8BF7\u786E\u8BA4\u6269\u5C55\u5DF2\u83B7\u5F97\u300C\u8BFB\u53D6\u548C\u66F4\u6539\u7F51\u7AD9\u6570\u636E\u300D\u6743\u9650\uFF0C\u7136\u540E\u91CD\u8BD5";
    }
    return { ok: false, error: friendly };
  }
}
var sessionHandlers = {
  /* ---------- Session (content script) ---------- */
  GET_SESSION: (_message, { tabId, sendResponse }) => {
    reconcileSessionState(tabId).then((s) => {
      sendResponse({
        ok: true,
        session: safeSession(s)
      });
    }).catch(() => sendResponse({ ok: false, error: "\u65E0\u6CD5\u540C\u6B65\u5F53\u524D\u8F6C\u5199\u72B6\u6001" }));
    return true;
  },
  SET_LANG: (message, { tabId, sendResponse }) => {
    (async () => {
      const s = await reconcileSessionState(tabId);
      if (message.sourceLang) s.sourceLang = message.sourceLang;
      if (message.targetLang) s.targetLang = message.targetLang;
      pushSession(tabId);
      if (s.state === "running") {
        await sendToOffscreen({
          type: "SET_LANG",
          tabId,
          sourceLang: s.sourceLang,
          targetLang: s.targetLang
        });
      }
      sendResponse({ ok: true, session: safeSession(s) });
    })().catch((err) => sendResponse({ ok: false, error: err.message || "\u8BED\u8A00\u5207\u6362\u5931\u8D25" }));
    return true;
  },
  START: (message, { tabId, sendResponse }) => {
    const startVersion = currentStartVersion(tabId);
    const previous = startAttempts.get(tabId);
    let attempt;
    if (previous?.version === startVersion) {
      attempt = previous;
    } else {
      const pendingStop = stopAttempts.get(tabId);
      const afterPrevious = previous ? previous.promise.catch(() => void 0) : Promise.resolve();
      const afterStop = pendingStop ? pendingStop.catch(() => void 0) : Promise.resolve();
      const run = Promise.all([afterPrevious, afterStop]).then(() => runStart(message, tabId, startVersion));
      attempt = { version: startVersion, promise: run };
      startAttempts.set(tabId, attempt);
      const settle = () => {
        if (startAttempts.get(tabId) !== attempt) return;
        startAttempts.delete(tabId);
        startCancelVersions.delete(tabId);
      };
      run.then(settle, settle);
    }
    attempt.promise.then(
      (result) => sendResponse(result),
      (err) => sendResponse({ ok: false, error: err?.message || "\u542F\u52A8\u5931\u8D25" })
    );
    return true;
  },
  STOP: (_message, { tabId, sendResponse }) => {
    cancelStart(tabId);
    const s = sessions.get(tabId);
    if (!s) {
      const stop2 = stopOrphanCapture(tabId).then(() => void 0).catch(() => void 0);
      stopAttempts.set(tabId, stop2);
      stop2.finally(() => {
        if (stopAttempts.get(tabId) === stop2) stopAttempts.delete(tabId);
      }).catch(() => {
      });
      stop2.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: true }));
      return true;
    }
    if (s.state === "idle" && s.generation !== 0) {
      const stop2 = stopOrphanCapture(tabId).then(() => void 0).catch(() => void 0);
      stopAttempts.set(tabId, stop2);
      stop2.finally(() => {
        if (stopAttempts.get(tabId) === stop2) stopAttempts.delete(tabId);
      }).catch(() => {
      });
      stop2.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: true }));
      return true;
    }
    s.state = "stopping";
    pushSession(tabId);
    const stoppedGeneration = s.generation;
    s.generation = nextGeneration();
    const stop = sendToOffscreen({
      type: "STOP_CAPTURE",
      tabId,
      generation: stoppedGeneration
    }).catch(() => {
    }).finally(() => {
      s.state = "idle";
      s.streamId = "";
      s.configSnapshot = null;
      s.streamingSubtitle = null;
      s.audioSilent = false;
      if (s.subtitles && s.subtitles.length > 0) {
        persistSessionHistory(tabId);
      }
      pushSession(tabId);
      maybeCloseOffscreen();
      sendResponse({ ok: true, session: safeSession(s) });
    });
    stopAttempts.set(tabId, stop);
    stop.finally(() => {
      if (stopAttempts.get(tabId) === stop) stopAttempts.delete(tabId);
    }).catch(() => {
    });
    return true;
  },
  ASK: (message, { tabId, sendResponse }) => {
    const s = getOrCreateSession(tabId);
    const question = (message.question || "").trim();
    const images = Array.isArray(message.images) ? message.images.slice(0, 4) : [];
    if (question.length > 2e3) {
      sendResponse({ ok: false, error: "\u95EE\u9898\u8FC7\u957F\uFF08\u6700\u591A 2000 \u5B57\uFF09" });
      return false;
    }
    const requestId = message.requestId || `ask_${Date.now()}`;
    s.pendingAskRequestId = requestId;
    if (!question && images.length === 0) {
      s.pendingAskRequestId = null;
      sendResponse({ ok: false, error: "\u95EE\u9898\u4E0D\u80FD\u4E3A\u7A7A" });
      return false;
    }
    const recentContext = s.subtitles.slice(-20).map((sub) => `[${sub.source}] \u2192 ${sub.target}`).join("\n");
    void (async () => {
      const config = s.configSnapshot || await loadConfig();
      const store = await loadAgentStore();
      const session = await resolveCurrentSession(store, message.newSession === true);
      const history = selectHistoryTurns([...session.turns, { role: "user", content: question, images, at: Date.now() }]);
      const parts = buildAskParts({ history, subtitleContext: recentContext, question, images });
      const answer = await askLLM({ parts, config, sourceLang: s.sourceLang, targetLang: s.targetLang });
      if (s.pendingAskRequestId !== requestId) return;
      s.pendingAskRequestId = null;
      s.messages.push({ role: "assistant", content: answer });
      pushSession(tabId);
      await recordExchange(
        store,
        session,
        { role: "user", content: question, images, at: Date.now() },
        { role: "assistant", content: answer, at: Date.now() }
      );
      sendResponse({ ok: true, answer, session: safeSession(s) });
    })().catch((err) => {
      if (s.pendingAskRequestId !== requestId) return;
      s.pendingAskRequestId = null;
      sendResponse({ ok: false, error: err.message || "\u83B7\u53D6\u56DE\u7B54\u5931\u8D25" });
    });
    s.messages.push({ role: "user", content: question, images });
    pushSession(tabId);
    return true;
  },
  /* ---------- Agent conversation management ---------- */
  AGENT_LIST_SESSIONS: (_message, { sendResponse }) => {
    void loadAgentStore().then((store) => sendResponse({ ok: true, sessions: listSessions(store), currentId: store.currentId }));
    return true;
  },
  AGENT_SWITCH_SESSION: (message, { sendResponse }) => {
    void loadAgentStore().then(async (store) => {
      const session = switchSession(store, String(message.id || ""));
      if (!session) {
        sendResponse({ ok: false, error: "\u4F1A\u8BDD\u4E0D\u5B58\u5728" });
        return;
      }
      await saveAgentStore(store).catch(() => {
      });
      sendResponse({ ok: true, currentId: store.currentId });
    });
    return true;
  },
  AGENT_NEW_SESSION: (_message, { sendResponse }) => {
    void loadAgentStore().then(async (store) => {
      await resolveCurrentSession(store, true);
      await saveAgentStore(store).catch(() => {
      });
      sendResponse({ ok: true, currentId: store.currentId });
    });
    return true;
  },
  AGENT_DELETE_SESSION: (message, { sendResponse }) => {
    void loadAgentStore().then(async (store) => {
      await deleteSession(store, String(message.id || ""));
      sendResponse({ ok: true, currentId: store.currentId });
    });
    return true;
  },
  OPEN_SETTINGS: (_message, { tabId, sendResponse }) => {
    chrome.sidePanel.open({ tabId }).then(() => {
      sendResponse({ ok: true });
    }).catch(() => {
      sendResponse({ ok: false, error: "\u8BF7\u70B9\u51FB\u6D4F\u89C8\u5668\u5DE5\u5177\u680F\u7684 snooper-browser \u56FE\u6807\u6253\u5F00\u914D\u7F6E\u9762\u677F" });
    });
    return true;
  },
  OPEN_IMAGE_GEN: (message, { tabId, sendResponse }) => {
    chrome.sidePanel.open({ tabId }).then(() => {
      try {
        sessionStorage.setItem("snooper.image-gen-prompt", message.prompt || "");
      } catch {
      }
      sendResponse({ ok: true });
    }).catch(() => {
      sendResponse({ ok: false, error: "\u8BF7\u70B9\u51FB\u6D4F\u89C8\u5668\u5DE5\u5177\u680F\u56FE\u6807\u6253\u5F00\u914D\u7F6E\u9762\u677F" });
    });
    return true;
  }
};

// src/ext/background/router/index.ts
var backgroundHandlers = {
  ...configHandlers,
  ...imageHandlers,
  ...sessionHandlers,
  ...captureHandlers,
  ...obsidianHandlers,
  ...historyHandlers
};
function registerBackgroundRouters() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "background") {
      return false;
    }
    const tabId = sender.tab?.id;
    const isContentScript = !!tabId;
    const isSidePanel = sender.url?.startsWith(chrome.runtime.getURL("sidepanel/"));
    if (isContentScript && !tabId) {
      sendResponse({ ok: false, error: "\u65E0\u6CD5\u786E\u5B9A\u6807\u7B7E\u9875\u4E0A\u4E0B\u6587" });
      return false;
    }
    if (!isContentScript && !isSidePanel) {
      sendResponse({ ok: false, error: "\u672A\u7ECF\u6388\u6743\u7684\u6765\u6E90" });
      return false;
    }
    const handler = backgroundHandlers[message.type];
    if (!handler) {
      sendResponse({ ok: false, error: `\u672A\u77E5\u6D88\u606F\u7C7B\u578B: ${message.type}` });
      return false;
    }
    return handler(message, {
      tabId,
      sender,
      sendResponse
    });
  });
  registerOffscreenEventRouter();
}

// src/ext/background.ts
registerBackgroundRouters();
registerLifecycleListeners();
setRecoveryReady(recoverSessions());
setInterval(persistSessions, 3e4);
console.log("[RTTS] Background service worker (TS) initialized");
