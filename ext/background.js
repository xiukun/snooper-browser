// src/ext/background.ts
var CONFIG_KEY = "snooper.extension.config.v1";
var SESSION_RECOVERY_KEY = "snooper.extension.sessions.v1";
var OFFSCREEN_PATH = "offscreen.html";
var CONTENT_SCRIPT_FILE = "content.js";
var FS_BRIDGE_FILE = "fullscreen-bridge.js";
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
    video: { providerId: "moss-official", model: "moss-vl-realtime-1.0" }
  }
};
var sessions = /* @__PURE__ */ new Map();
var generationCounter = 0;
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
    configSnapshot: null,
    subtitles: [],
    messages: [],
    streamId: "",
    pendingAskRequestId: null,
    streamingSubtitle: null
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
function removeSession(tabId) {
  sessions.delete(tabId);
  sendToOffscreen({ type: "STOP_CAPTURE", tabId }).catch(() => {
  });
  checkAndCloseOffscreen();
}
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
async function checkAndCloseOffscreen() {
  let hasActive = false;
  for (const s of sessions.values()) {
    if (s.state === "running" || s.state === "starting") {
      hasActive = true;
      break;
    }
  }
  if (hasActive) return;
  try {
    const hasDoc = typeof chrome.offscreen !== "undefined" && typeof chrome.offscreen.hasDocument === "function" && await chrome.offscreen.hasDocument();
    if (hasDoc) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
  }
}
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
function pushSession(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  const safeSession = {
    state: s.state,
    sourceLang: s.sourceLang,
    targetLang: s.targetLang,
    subtitles: s.subtitles,
    messages: s.messages,
    streamingSubtitle: s.streamingSubtitle
  };
  chrome.tabs.sendMessage(tabId, {
    type: "SESSION_UPDATE",
    session: safeSession
  }).catch(() => {
  });
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
  switch (message.type) {
    /* ---------- Config (side panel only) ---------- */
    case "GET_CONFIG": {
      if (!isSidePanel) {
        sendResponse({ ok: false, error: "\u4EC5\u914D\u7F6E\u9762\u677F\u53EF\u8BFB\u53D6\u914D\u7F6E" });
        return false;
      }
      loadConfig().then((config) => {
        sendResponse({ ok: true, config });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
    case "SAVE_CONFIG": {
      if (!isSidePanel) {
        sendResponse({ ok: false, error: "\u4EC5\u914D\u7F6E\u9762\u677F\u53EF\u4FEE\u6539\u914D\u7F6E" });
        return false;
      }
      saveConfig(message.config).then(() => {
        sendResponse({ ok: true });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
    /* ---------- Session (content script) ---------- */
    case "GET_SESSION": {
      const s = getOrCreateSession(tabId);
      sendResponse({
        ok: true,
        session: {
          state: s.state,
          sourceLang: s.sourceLang,
          targetLang: s.targetLang,
          subtitles: s.subtitles,
          messages: s.messages,
          streamingSubtitle: s.streamingSubtitle
        }
      });
      return false;
    }
    case "SET_LANG": {
      const s = getOrCreateSession(tabId);
      if (message.sourceLang) s.sourceLang = message.sourceLang;
      if (message.targetLang) s.targetLang = message.targetLang;
      pushSession(tabId);
      if (s.state === "running") {
        sendToOffscreen({ type: "SET_LANG", tabId, sourceLang: s.sourceLang, targetLang: s.targetLang }).catch(() => {
        });
      }
      sendResponse({ ok: true });
      return false;
    }
    case "START": {
      const s = getOrCreateSession(tabId);
      if (s.state === "running" || s.state === "starting") {
        sendResponse({ ok: false, error: "\u5F53\u524D\u6807\u7B7E\u9875\u5DF2\u5728\u8F6C\u5199\u4E2D" });
        return false;
      }
      s.state = "starting";
      s.sourceLang = message.sourceLang || "auto";
      s.targetLang = message.targetLang || "zh";
      s.generation = nextGeneration();
      s.subtitles = [];
      pushSession(tabId);
      loadConfig().then(async (config) => {
        const hasKey = config.providers.some((p) => p.apiKey && p.apiKey.trim().length > 0);
        if (!hasKey) {
          throw new Error("\u5C1A\u672A\u914D\u7F6E API Key\uFF0C\u8BF7\u5148\u5728\u4FA7\u680F\u300C\u670D\u52A1\u5546\u914D\u7F6E\u300D\u4E2D\u586B\u5165\u6709\u6548\u7684\u5BC6\u94A5");
        }
        const audioRoute = config.routes.audio;
        const audioProvider = config.providers.find((p) => p.id === audioRoute.providerId);
        if (!audioProvider || !audioProvider.apiKey) {
          throw new Error(`\u97F3\u9891\u8F6C\u5199\u670D\u52A1\u5546\u300C${audioProvider?.name || "\u672A\u914D\u7F6E"}\u300D\u7F3A\u5C11 API Key`);
        }
        if (!audioRoute.model) {
          throw new Error("\u97F3\u9891\u8F6C\u5199\u672A\u9009\u62E9\u6A21\u578B");
        }
        s.configSnapshot = JSON.parse(JSON.stringify(config));
        console.log("[RTTS] START:", tabId, "gen:", s.generation, "lang:", s.sourceLang, "\u2192", s.targetLang);
        try {
          const streamId = await new Promise((resolve, reject) => {
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
          s.streamId = streamId;
          console.log("[RTTS] streamId obtained for tab", tabId);
          await sendToOffscreen({
            type: "START_CAPTURE",
            tabId,
            streamId,
            sourceLang: s.sourceLang,
            targetLang: s.targetLang,
            config: s.configSnapshot,
            generation: s.generation
          });
          s.state = "running";
          pushSession(tabId);
          sendResponse({ ok: true });
        } catch (err) {
          console.warn("[RTTS] START failed:", err.message);
          s.state = "idle";
          s.configSnapshot = null;
          s.streamId = "";
          sendResponse({ ok: false, error: err.message });
        }
      }).catch((err) => {
        console.warn("[RTTS] START config error:", err.message);
        s.state = "idle";
        s.configSnapshot = null;
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
    case "STOP": {
      const s = sessions.get(tabId);
      if (!s || s.state !== "running" && s.state !== "starting") {
        sendResponse({ ok: false, error: "\u5F53\u524D\u6807\u7B7E\u9875\u672A\u5728\u8F6C\u5199" });
        return false;
      }
      s.state = "stopping";
      pushSession(tabId);
      sendToOffscreen({
        type: "STOP_CAPTURE",
        tabId,
        generation: s.generation
      }).catch(() => {
      }).finally(() => {
        s.state = "idle";
        s.streamId = "";
        s.configSnapshot = null;
        s.streamingSubtitle = null;
        pushSession(tabId);
        checkAndCloseOffscreen();
      });
      sendResponse({ ok: true });
      return false;
    }
    case "ASK": {
      const s = sessions.get(tabId);
      if (!s || s.state !== "running") {
        sendResponse({ ok: false, error: "\u5F53\u524D\u6807\u7B7E\u9875\u672A\u5728\u8FD0\u884C\uFF0C\u8BF7\u5148\u5F00\u59CB\u8F6C\u5199" });
        return false;
      }
      const question = (message.question || "").trim();
      if (!question) {
        sendResponse({ ok: false, error: "\u95EE\u9898\u4E0D\u80FD\u4E3A\u7A7A" });
        return false;
      }
      if (question.length > 2e3) {
        sendResponse({ ok: false, error: "\u95EE\u9898\u8FC7\u957F\uFF08\u6700\u591A 2000 \u5B57\uFF09" });
        return false;
      }
      const requestId = message.requestId || `ask_${Date.now()}`;
      s.pendingAskRequestId = requestId;
      const recentContext = s.subtitles.slice(-20).map((sub) => `[${sub.source}] \u2192 ${sub.target}`).join("\n");
      sendToOffscreen({
        type: "ASK_QUESTION",
        tabId,
        question,
        requestId,
        generation: s.generation,
        config: s.configSnapshot,
        context: recentContext,
        sourceLang: s.sourceLang,
        targetLang: s.targetLang
      }).then((result) => {
        if (s.pendingAskRequestId !== requestId) return;
        s.pendingAskRequestId = null;
        if (result && result.ok && result.answer) {
          s.messages.push({ role: "assistant", content: result.answer });
          pushSession(tabId);
          sendResponse({ ok: true, answer: result.answer });
        } else {
          sendResponse({ ok: false, error: result?.error || "\u83B7\u53D6\u56DE\u7B54\u5931\u8D25" });
        }
      }).catch((err) => {
        if (s.pendingAskRequestId !== requestId) return;
        s.pendingAskRequestId = null;
        sendResponse({ ok: false, error: err.message });
      });
      s.messages.push({ role: "user", content: question });
      pushSession(tabId);
      return true;
    }
    case "OPEN_SETTINGS": {
      chrome.sidePanel.open({ tabId }).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false, error: "\u8BF7\u70B9\u51FB\u6D4F\u89C8\u5668\u5DE5\u5177\u680F\u7684 RTTS \u56FE\u6807\u6253\u5F00\u914D\u7F6E\u9762\u677F" });
      });
      return true;
    }
    default:
      sendResponse({ ok: false, error: `\u672A\u77E5\u6D88\u606F\u7C7B\u578B: ${message.type}` });
      return false;
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PATH)) {
    return false;
  }
  switch (message.type) {
    case "CAPTURE_SUBTITLE_STREAMING": {
      const s = sessions.get(message.tabId);
      if (!s || s.generation !== message.generation) {
        return false;
      }
      s.streamingSubtitle = {
        at: message.at || Date.now(),
        source: message.source || "",
        partialTarget: message.partialTarget || "",
        latency: message.latency || 0
      };
      pushStreamingUpdate(message.tabId);
      return false;
    }
    case "CAPTURE_SUBTITLE": {
      const s = sessions.get(message.tabId);
      if (!s || s.generation !== message.generation) {
        return false;
      }
      s.streamingSubtitle = null;
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
chrome.tabs.onRemoved.addListener((tabId) => {
  removeSession(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    const s = sessions.get(tabId);
    if (s && (s.state === "running" || s.state === "starting")) {
      sendToOffscreen({ type: "STOP_CAPTURE", tabId, generation: s.generation }).catch(() => {
      });
      s.state = "idle";
      s.streamId = "";
      s.configSnapshot = null;
      s.subtitles = [];
      s.streamingSubtitle = null;
      pushSession(tabId);
      checkAndCloseOffscreen();
    }
  }
});
chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [FS_BRIDGE_FILE],
    world: "MAIN"
  }).catch((err) => {
    console.warn("[RTTS] FS bridge injection error:", err.message);
  });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [CONTENT_SCRIPT_FILE]
  }).catch((err) => {
    console.warn("[RTTS] content script injection error:", err.message);
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
async function recoverSessions() {
  try {
    const result = await chrome.storage.session.get(SESSION_RECOVERY_KEY);
    if (!result[SESSION_RECOVERY_KEY]) return;
    const recovered = JSON.parse(result[SESSION_RECOVERY_KEY]);
    for (const [tabIdStr, s] of Object.entries(recovered)) {
      const tabId = Number(tabIdStr);
      if (s.state === "running" || s.state === "starting") {
        s.state = "idle";
        s.streamId = "";
      }
      sessions.set(tabId, s);
    }
  } catch {
  }
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
      messages: s.messages
    };
  }
  try {
    chrome.storage.session.set({ [SESSION_RECOVERY_KEY]: JSON.stringify(obj) });
  } catch {
  }
}
recoverSessions();
setInterval(persistSessions, 3e4);
var origPushSession = pushSession;
pushSession = function(tabId) {
  origPushSession(tabId);
  persistSessions();
};
console.log("[RTTS] Background service worker (TS) initialized");
