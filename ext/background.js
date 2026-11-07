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

// src/ext/capture-recovery.ts
async function waitForCaptureRelease(isCaptureAlive, options = {}) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 8);
  const delayMs = Math.max(0, options.delayMs ?? 100);
  const sleep = options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!await isCaptureAlive()) return true;
    if (attempt < maxAttempts - 1) await sleep(delayMs);
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

// src/ext/background.ts
var CONFIG_KEY = "snooper.extension.config.v1";
var SESSION_RECOVERY_KEY = "snooper.extension.sessions.v1";
var HISTORY_KEY = "snooper.extension.history.v1";
var MAX_HISTORY = 100;
var OFFSCREEN_PATH = "offscreen.html";
function normalizeObsidianKey(raw) {
  return String(raw || "").trim().replace(/^Bearer\s+/i, "").trim();
}
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
    video: { providerId: "moss-official", model: "moss-vl-realtime-1.0" },
    image: { providerId: "moss-official", model: "moss-image-sft-1.0" }
  }
};
var sessions = /* @__PURE__ */ new Map();
var recoveryReady = Promise.resolve();
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
async function hasOffscreenDocument() {
  try {
    return typeof chrome.offscreen !== "undefined" && typeof chrome.offscreen.hasDocument === "function" && await chrome.offscreen.hasDocument();
  } catch {
    return false;
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
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE]
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
async function askLLM({ question, images, context, config, sourceLang, targetLang }) {
  const route = config.routes.llm;
  const provider = config.providers.find((p) => p.id === route.providerId);
  if (!provider || !provider.apiKey) {
    throw new Error("\u5C1A\u672A\u914D\u7F6E LLM \u670D\u52A1\u5546\uFF0C\u8BF7\u70B9\u51FB\u9875\u9762\u60AC\u6D6E\u680F\u7684 \u2699 \u586B\u5165 API Key");
  }
  if (!route.model) {
    throw new Error("\u672A\u9009\u62E9 LLM \u6A21\u578B\uFF0C\u8BF7\u70B9\u51FB\u9875\u9762\u60AC\u6D6E\u680F\u7684 \u2699 \u914D\u7F6E");
  }
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const parts = [{
    type: "text",
    text: [
      "\u4F60\u662F\u4E00\u4E2A\u89C6\u9891\u4F34\u5B66\u52A9\u624B\u3002",
      context ? `\u3010\u6700\u8FD1\u7684\u5B57\u5E55\u4E0A\u4E0B\u6587\u3011
${context}
` : "",
      "\u8BF7\u57FA\u4E8E\u5B57\u5E55\u4E0A\u4E0B\u6587\u548C\u7528\u6237\u63D0\u4F9B\u7684\u5185\u5BB9\u56DE\u7B54\u3002\u7528\u7B80\u4F53\u4E2D\u6587\u56DE\u7B54\uFF0C\u4FDD\u6301\u7B80\u6D01\u51C6\u786E\u3002",
      "",
      `\u3010\u7528\u6237\u63D0\u95EE\u3011
${question || "\u8BF7\u63CF\u8FF0\u8FD9\u5F20\u56FE\u7247\uFF0C\u5E76\u7ED3\u5408\u89C6\u9891\u4E0A\u4E0B\u6587\u89E3\u91CA\u3002"}`
    ].filter(Boolean).join("\n")
  }];
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: img } });
  }
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
    /* ---------- Config (in-page settings modal + side panel) ---------- */
    // Both surfaces are trusted extension contexts: the content script runs in
    // an isolated world that page scripts cannot reach, and `sender.tab` proves
    // the message came from an injected content script rather than the page.
    case "GET_CONFIG": {
      loadConfig().then((config) => {
        sendResponse({ ok: true, config });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
    case "SAVE_CONFIG": {
      saveConfig(message.config).then(() => {
        sendResponse({ ok: true });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
    /* ---------- Connection test (in-page settings modal) ---------- */
    case "TEST_CONNECTION": {
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
    /* ---------- In-page image generation ---------- */
    case "GENERATE_IMAGE": {
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
          async function tryGenerate(body2) {
            const res = await fetch(`${baseUrl}/images/generations`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${provider.apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(body2)
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
              if (res.status >= 400 && res.status < 500 && body2.prompt_enhance !== void 0) {
                const retryBody = { ...body2 };
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
          sendResponse({ ok: true, images, model: route?.model || "moss-image-sft-1.0" });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || "\u751F\u56FE\u5931\u8D25" });
        }
      })();
      return true;
    }
    /* ---------- Session (content script) ---------- */
    case "GET_SESSION": {
      reconcileSessionState(tabId).then((s) => {
        sendResponse({
          ok: true,
          session: safeSession(s)
        });
      }).catch(() => sendResponse({ ok: false, error: "\u65E0\u6CD5\u540C\u6B65\u5F53\u524D\u8F6C\u5199\u72B6\u6001" }));
      return true;
    }
    case "SET_LANG": {
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
    }
    case "START": {
      (async () => {
        const s = await reconcileSessionState(tabId);
        if (s.state === "running" || s.state === "starting") {
          const live = await offscreenHasCapture(tabId);
          if (live) {
            sendResponse({ ok: true, alreadyRunning: true, session: safeSession(s) });
            return;
          }
          s.state = "idle";
          s.streamId = "";
          s.configSnapshot = null;
          s.streamingSubtitle = null;
        }
        s.state = "starting";
        s.sourceLang = message.sourceLang || "auto";
        s.targetLang = message.targetLang || "zh";
        s.generation = nextGeneration();
        s.subtitles = [];
        s.streamingSubtitle = null;
        s.audioSilent = false;
        pushSession(tabId);
        try {
          const config = await loadConfig();
          const hasKey = config.providers.some((p) => p.apiKey && p.apiKey.trim().length > 0);
          if (!hasKey) {
            throw new Error("\u5C1A\u672A\u914D\u7F6E API Key\u3002\u8BF7\u70B9\u51FB\u9875\u9762\u60AC\u6D6E\u680F\u7684 \u2699 \u6309\u94AE\uFF0C\u5728\u9875\u9762\u5185\u586B\u5165\u5BC6\u94A5\u540E\u91CD\u8BD5");
          }
          const audioRoute = config.routes.audio;
          const audioProvider = config.providers.find((p) => p.id === audioRoute.providerId);
          if (!audioProvider || !audioProvider.apiKey) {
            throw new Error(`\u97F3\u9891\u8F6C\u5199\u670D\u52A1\u5546\u300C${audioProvider?.name || "\u672A\u914D\u7F6E"}\u300D\u7F3A\u5C11 API Key\uFF0C\u8BF7\u70B9\u51FB \u2699 \u5728\u9875\u9762\u5185\u914D\u7F6E`);
          }
          if (!audioRoute.model) {
            throw new Error("\u97F3\u9891\u8F6C\u5199\u672A\u9009\u62E9\u6A21\u578B\uFF0C\u8BF7\u70B9\u51FB\u60AC\u6D6E\u680F\u7684 \u2699 \u5728\u9875\u9762\u5185\u914D\u7F6E");
          }
          s.configSnapshot = JSON.parse(JSON.stringify(config));
          console.log("[RTTS] START:", tabId, "gen:", s.generation, "lang:", s.sourceLang, "\u2192", s.targetLang);
          await stopOrphanCapture(tabId);
          const requestStreamId = () => new Promise((resolve, reject) => {
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
          let streamId;
          try {
            streamId = await requestStreamId();
          } catch (err) {
            if (!/active stream/i.test(err?.message || "")) throw err;
            await stopOrphanCapture(tabId);
            await forceResetOffscreenCapture();
            try {
              streamId = await requestStreamId();
            } catch (retryErr) {
              if (/active stream/i.test(retryErr?.message || "")) {
                throw new Error("\u5F55\u97F3\u6D41\u5728\u91CD\u7F6E\u540E\u4ECD\u88AB\u6D4F\u89C8\u5668\u5360\u7528");
              }
              throw retryErr;
            }
          }
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
          sendResponse({ ok: false, error: friendly });
        }
      })();
      return true;
    }
    case "STOP": {
      const s = sessions.get(tabId);
      if (!s) {
        stopOrphanCapture(tabId).catch(() => {
        });
        sendResponse({ ok: true });
        return false;
      }
      if (s.state === "idle" && s.generation !== 0) {
        stopOrphanCapture(tabId).catch(() => {
        });
        sendResponse({ ok: true });
        return false;
      }
      s.state = "stopping";
      pushSession(tabId);
      const stoppedGeneration = s.generation;
      s.generation = nextGeneration();
      sendToOffscreen({
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
        checkAndCloseOffscreen();
        sendResponse({ ok: true, session: safeSession(s) });
      });
      return true;
    }
    case "ASK": {
      const s = getOrCreateSession(tabId);
      const question = (message.question || "").trim();
      const images = Array.isArray(message.images) ? message.images.slice(0, 4) : [];
      if (!question && images.length === 0) {
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
      (async () => {
        const config = s.configSnapshot || await loadConfig();
        const answer = await askLLM({
          question,
          images,
          context: recentContext,
          config,
          sourceLang: s.sourceLang,
          targetLang: s.targetLang
        });
        if (s.pendingAskRequestId !== requestId) return;
        s.pendingAskRequestId = null;
        s.messages.push({ role: "assistant", content: answer });
        pushSession(tabId);
        sendResponse({ ok: true, answer });
      })().catch((err) => {
        if (s.pendingAskRequestId !== requestId) return;
        s.pendingAskRequestId = null;
        sendResponse({ ok: false, error: err.message || "\u83B7\u53D6\u56DE\u7B54\u5931\u8D25" });
      });
      s.messages.push({ role: "user", content: question, images });
      pushSession(tabId);
      return true;
    }
    case "OPEN_SETTINGS": {
      chrome.sidePanel.open({ tabId }).then(() => {
        sendResponse({ ok: true });
      }).catch(() => {
        sendResponse({ ok: false, error: "\u8BF7\u70B9\u51FB\u6D4F\u89C8\u5668\u5DE5\u5177\u680F\u7684 snooper-browser \u56FE\u6807\u6253\u5F00\u914D\u7F6E\u9762\u677F" });
      });
      return true;
    }
    case "OPEN_IMAGE_GEN": {
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
    case "CAPTURE_SCREENSHOT": {
      chrome.tabs.captureVisibleTab({ format: "png" }).then((dataUrl) => {
        sendResponse({ ok: true, dataUrl });
      }).catch(async (err) => {
        if (err.message && /active stream/i.test(err.message)) {
          if (!await hasOffscreenDocument()) {
            sendResponse({ ok: false, error: "\u622A\u56FE\u5931\u8D25\uFF1A\u6807\u7B7E\u9875\u6B63\u88AB\u5176\u4ED6\u5F55\u97F3\u5360\u7528\uFF0C\u8BF7\u505C\u6B62\u540E\u91CD\u8BD5" });
            return;
          }
          sendToOffscreen({ type: "CAPTURE_FRAME", tabId }).then((frame) => {
            if (frame && frame.dataUrl) {
              sendResponse({ ok: true, dataUrl: frame.dataUrl });
            } else {
              sendResponse({ ok: false, error: frame?.error || "\u622A\u56FE\u5931\u8D25\uFF1A\u65E0\u6CD5\u83B7\u53D6\u89C6\u9891\u5E27" });
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
    case "FETCH_URL": {
      const url = String(message.url || "").trim();
      if (!url) {
        sendResponse({ ok: false, error: "URL \u4E3A\u7A7A" });
        return false;
      }
      (async () => {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onload = () => sendResponse({ ok: true, dataUrl: reader.result });
          reader.onerror = () => sendResponse({ ok: false, error: "\u65E0\u6CD5\u8BFB\u53D6\u56FE\u7247" });
          reader.readAsDataURL(blob);
        } catch (err) {
          sendResponse({ ok: false, error: "\u65E0\u6CD5\u4E0B\u8F7D\u56FE\u7247\uFF1A" + (err.message || "") });
        }
      })();
      return true;
    }
    case "EXPORT_TO_OBSIDIAN": {
      const content = message.content || "";
      const title = message.title || `snooper-\u7B14\u8BB0-${Date.now()}`;
      if (!content) {
        sendResponse({ ok: false, error: "\u6CA1\u6709\u5185\u5BB9\u53EF\u5BFC\u51FA" });
        return false;
      }
      const oc = message.obsidianConfig || {};
      const obsidianPort = Number(oc.apiPort) || 27123;
      const protocol = oc.apiProtocol === "https" ? "https" : oc.apiProtocol === "http" ? "http" : obsidianPort === 27124 ? "https" : "http";
      const obsidianApiKey = normalizeObsidianKey(oc.apiKey);
      const noteFolder = String(oc.noteFolder || "snooper-notes").replace(/^\/+|\/+$/g, "");
      const fileName = `${title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.md`;
      const base = `${protocol}://127.0.0.1:${obsidianPort}`;
      const vaultPath = noteFolder ? `/vault/${noteFolder}/${encodeURIComponent(fileName)}` : `/vault/${encodeURIComponent(fileName)}`;
      (async () => {
        try {
          const res = await fetch(base + vaultPath, {
            method: "PUT",
            headers: {
              "Content-Type": "text/markdown",
              ...obsidianApiKey ? { Authorization: `Bearer ${obsidianApiKey}` } : {}
            },
            body: content
          });
          if (res.ok) {
            sendResponse({ ok: true });
            return;
          }
          if (res.status === 401 || res.status === 403) {
            sendResponse({ ok: false, error: "Obsidian \u62D2\u7EDD\u8BBF\u95EE\uFF1AAPI Key \u4E0D\u6B63\u786E\u6216\u672A\u586B\u5199" });
            return;
          }
          if (res.status === 404) {
            sendResponse({ ok: false, error: "Obsidian \u627E\u4E0D\u5230\u5199\u5165\u8DEF\u5F84\uFF0C\u8BF7\u68C0\u67E5\u7B14\u8BB0\u76EE\u5F55\u8BBE\u7F6E" });
            return;
          }
          sendResponse({ ok: false, error: `Obsidian API \u8FD4\u56DE ${res.status}` });
        } catch (err) {
          const hint = protocol === "https" ? "HTTPS 27124 \u4F7F\u7528\u81EA\u7B7E\u540D\u8BC1\u4E66\uFF0CChrome \u4F1A\u62D2\u7EDD\u3002\u8BF7\u5728 Obsidian \u2192 Local REST API \u8BBE\u7F6E\u4E2D\u5F00\u542F\u300CEnable Non-encrypted (HTTP) Server\u300D\uFF0C\u7136\u540E\u5728\u4FA7\u680F\u628A\u534F\u8BAE\u6539\u4E3A HTTP\u3001\u7AEF\u53E3 27123\u3002" : "\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C\u3001Local REST API \u63D2\u4EF6\u5DF2\u542F\u7528\uFF0C\u5E76\u5F00\u542F\u300CEnable Non-encrypted (HTTP) Server\u300D\uFF08\u7AEF\u53E3 27123\uFF09\u3002";
          sendResponse({ ok: false, error: `\u65E0\u6CD5\u8FDE\u63A5 Obsidian\uFF08${base}\uFF09\u3002${hint}` });
        }
      })();
      return true;
    }
    case "OBSIDIAN_UPLOAD_ASSET": {
      const oc = message.obsidianConfig || {};
      const key = normalizeObsidianKey(oc.apiKey);
      const port = Number(oc.apiPort) || 27123;
      const protocol = oc.apiProtocol === "https" ? "https" : oc.apiProtocol === "http" ? "http" : port === 27124 ? "https" : "http";
      const folder = String(oc.noteFolder || "snooper-notes").replace(/^\/+|\/+$/g, "");
      const fileName = String(message.fileName || "").replace(/[^a-zA-Z0-9._-]/g, "-");
      if (!fileName) {
        sendResponse({ ok: false, error: "\u8D44\u4EA7\u6587\u4EF6\u540D\u4E3A\u7A7A" });
        return false;
      }
      (async () => {
        try {
          let bytes;
          let mime = String(message.mimeType || "image/png");
          const dataUrl = String(message.dataUrl || "");
          if (dataUrl.startsWith("data:")) {
            const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
            if (!match) throw new Error("\u56FE\u7247\u6570\u636E\u683C\u5F0F\u65E0\u6CD5\u8BC6\u522B");
            if (match[1]) mime = match[1];
            const isBase64 = /;base64,/.test(dataUrl);
            if (isBase64) {
              const binary = atob(match[2] || "");
              bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            } else {
              bytes = new TextEncoder().encode(decodeURIComponent(match[2] || ""));
            }
          } else if (/^https?:\/\//i.test(dataUrl)) {
            const r = await fetch(dataUrl);
            if (!r.ok) throw new Error(`\u4E0B\u8F7D\u56FE\u7247\u5931\u8D25 HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            bytes = new Uint8Array(buf);
            mime = r.headers.get("content-type") || mime;
          } else if (String(message.rawText || "")) {
            bytes = new TextEncoder().encode(String(message.rawText));
            mime = "image/svg+xml";
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
            sendResponse({ ok: false, error: `\u56FE\u7247\u4E0A\u4F20\u5931\u8D25 HTTP ${res.status}` });
            return;
          }
          sendResponse({ ok: true, fileName });
        } catch (err) {
          sendResponse({ ok: false, error: err.message || "\u56FE\u7247\u4E0A\u4F20\u5931\u8D25" });
        }
      })();
      return true;
    }
    case "TEST_OBSIDIAN": {
      const oc = message.obsidianConfig || {};
      const key = normalizeObsidianKey(oc.apiKey);
      const configuredPort = Number(oc.apiPort) || 27123;
      const configuredProtocol = oc.apiProtocol === "https" ? "https" : oc.apiProtocol === "http" ? "http" : configuredPort === 27124 ? "https" : "http";
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
      (async () => {
        for (const c of candidates) {
          try {
            const res = await fetch(`${c.protocol}://127.0.0.1:${c.port}/vault/`, {
              headers: key ? { Authorization: `Bearer ${key}` } : {}
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
                error: `\u5DF2\u8FDE\u4E0A ${c.protocol}://127.0.0.1:${c.port}\uFF0C\u4F46 API Key \u4E0D\u6B63\u786E\uFF0C\u8BF7\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u590D\u5236`
              });
              return;
            }
          } catch {
          }
        }
        sendResponse({
          ok: false,
          error: "\u65E0\u6CD5\u8FDE\u63A5\u3002\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C\u3001Local REST API \u63D2\u4EF6\u5DF2\u542F\u7528\uFF0C\u5E76\u5F00\u542F\u300CEnable Non-encrypted (HTTP) Server\u300D\uFF08\u7AEF\u53E3 27123\uFF09"
        });
      })();
      return true;
    }
    case "GET_HISTORY": {
      readHistory().then((history) => {
        sendResponse({ ok: true, history });
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }
    case "DELETE_HISTORY": {
      const ids = Array.isArray(message.ids) ? message.ids.map((id) => String(id)) : [String(message.id || "")];
      deleteHistoryEntries(ids).then(() => sendResponse({ ok: true })).catch(() => {
        sendResponse({ ok: false });
      });
      return true;
    }
    case "DELETE_ALL_HISTORY": {
      clearHistory().then(() => sendResponse({ ok: true })).catch(() => {
        sendResponse({ ok: false });
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
      if (s && (s.state === "running" || s.state === "starting")) {
        s.state = "idle";
        s.streamId = "";
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
chrome.tabs.onRemoved.addListener((tabId) => {
  removeSession(tabId);
});
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
  checkAndCloseOffscreen();
}
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
  checkAndCloseOffscreen();
});
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await recoveryReady;
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
      subtitleCount: s.subtitles.length
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
recoveryReady = recoverSessions();
setInterval(persistSessions, 3e4);
console.log("[RTTS] Background service worker (TS) initialized");
