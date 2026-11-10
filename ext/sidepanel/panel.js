(() => {
  // src/ext/content/library-client.ts
  async function confirmLibraryDelete(selection) {
    const preview = await chrome.runtime.sendMessage({ target: "background", type: "LIBRARY_PREPARE_DELETE", ...selection });
    if (!preview?.ok) throw new Error(preview?.error || "\u65E0\u6CD5\u9884\u89C8\u5220\u9664\u8303\u56F4\uFF0C\u8BF7\u91CD\u8BD5");
    const count = preview.targets.length;
    if (!count) throw new Error(preview.skipped[0]?.reason || "\u6CA1\u6709\u53EF\u5220\u9664\u7684\u8D44\u6599");
    if (!confirm(`\u786E\u5B9A\u5220\u9664 ${count} \u9879\u8D44\u6599\uFF1F\u5C06\u540C\u65F6\u79FB\u9664 ${preview.favoriteCount} \u6761\u6536\u85CF\u3002\u72EC\u7ACB\u53E6\u5B58\u7684\u7B14\u8BB0\u4F1A\u4FDD\u7559\u3002\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`)) return null;
    const result = await chrome.runtime.sendMessage({ target: "background", type: "LIBRARY_DELETE", token: preview.token });
    if (!result?.ok) throw new Error(result?.error || "\u5220\u9664\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5");
    if (result.pending.length) throw new Error(`\u90E8\u5206\u5220\u9664\u672A\u5B8C\u6210\uFF1A${result.pending[0].error}\u3002\u64CD\u4F5C ID\uFF1A${result.operationId}\uFF0C\u53EF\u5728\u8D44\u6599\u5E93\u91CD\u8BD5`);
    return result;
  }

  // src/ext/content/notes-store.ts
  var NOTES_STORAGE_KEY = "snooper.notes.v1";
  var retainedLegacySnapshot = null;
  async function requestResult(type, fields = {}) {
    const result = await chrome.runtime.sendMessage({ target: "background", type, ...fields });
    if (!result?.ok || !Array.isArray(result.notes)) throw new Error(result?.error || "\u7B14\u8BB0\u4FDD\u5B58\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u8BD5\u6216\u5BFC\u51FA");
    return result;
  }
  async function request(type, fields = {}) {
    return (await requestResult(type, fields)).notes;
  }
  function hasRetainedLegacyNotes() {
    return retainedLegacySnapshot !== null;
  }
  function readRetainedLegacyNotes() {
    try {
      return localStorage.getItem(NOTES_STORAGE_KEY) ?? retainedLegacySnapshot;
    } catch {
      return retainedLegacySnapshot;
    }
  }
  function exportRetainedLegacyNotes() {
    const raw = readRetainedLegacyNotes();
    if (!raw) return;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "snooper-legacy-notes.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  }
  async function loadNotes() {
    let legacy;
    let submitted = null;
    try {
      submitted = localStorage.getItem(NOTES_STORAGE_KEY);
      if (submitted) legacy = JSON.parse(submitted);
    } catch {
    }
    retainedLegacySnapshot = submitted;
    const result = await requestResult("NOTES_LIST", { legacy });
    try {
      const current = localStorage.getItem(NOTES_STORAGE_KEY);
      if (submitted && current === submitted && result.legacyAcknowledged === true) {
        localStorage.removeItem(NOTES_STORAGE_KEY);
        retainedLegacySnapshot = null;
      } else {
        retainedLegacySnapshot = current;
        if (current === submitted && Array.isArray(legacy) && legacy.length === 0) retainedLegacySnapshot = null;
      }
    } catch {
    }
    return result.notes;
  }
  async function deleteNoteDocuments(ids) {
    if (!await confirmLibraryDelete({ noteIds: ids })) return null;
    return request("NOTES_LIST");
  }

  // src/ext/action-flow.ts
  var UnsupportedPageError = class extends Error {
    code = "UNSUPPORTED_PAGE";
    constructor() {
      super("\u6B64\u9875\u9762\u53D7\u6D4F\u89C8\u5668\u9650\u5236\uFF0C\u65E0\u6CD5\u8FD0\u884C snooper\u3002\u8BF7\u5207\u6362\u5230\u666E\u901A\u7F51\u9875\u540E\u91CD\u8BD5\u3002");
      this.name = "UnsupportedPageError";
    }
  };
  var CONTENT_SCRIPT_FILE = "content.js";
  async function injectContentScriptFresh(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: () => {
        delete globalThis.__rttsContentInstalled;
      }
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE]
    });
  }
  function isUnsupportedTabUrl(url) {
    return /^(chrome|chrome-extension|edge|about|devtools|view-source|file):/i.test(url || "") || /^https?:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore)(?:\/|$)/i.test(url || "");
  }
  async function sendToPageWithInjection(tabId, message, tabUrl, { sendMessage, injectContentScript, collectResponse }) {
    if (isUnsupportedTabUrl(tabUrl)) throw new UnsupportedPageError();
    try {
      const raw = await sendMessage(tabId, message);
      return {
        ok: true,
        injected: false,
        ...collectResponse ? { responseOk: collectResponse(raw) } : {}
      };
    } catch (firstError) {
      try {
        await injectContentScript(tabId);
        const raw = await sendMessage(tabId, message);
        return {
          ok: true,
          injected: true,
          ...collectResponse ? { responseOk: collectResponse(raw) } : {}
        };
      } catch (retryError) {
        const error = retryError instanceof Error ? retryError : new Error(String(retryError));
        if (firstError instanceof Error) error.cause ??= firstError;
        throw error;
      }
    }
  }

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
  function crc32(bytes) {
    let c = 4294967295;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }
  function buildZip(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const entries = [];
    let offset = 0;
    const push = (bytes) => {
      chunks.push(bytes);
      offset += bytes.length;
    };
    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const crc = crc32(file.bytes);
      const size = file.bytes.length;
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 67324752, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 2048, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 33, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, size, true);
      view.setUint32(22, size, true);
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true);
      header.set(nameBytes, 30);
      push(header);
      push(file.bytes);
      entries.push({ nameBytes, crc, size, offset: offset - size, bytes: file.bytes });
    }
    const centralStart = offset;
    for (const entry of entries) {
      const central = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(central.buffer);
      view.setUint32(0, 33639248, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 2048, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint16(14, 33, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint16(30, 0, true);
      view.setUint16(32, 0, true);
      view.setUint16(34, 0, true);
      view.setUint16(36, 0, true);
      view.setUint32(38, 0, true);
      view.setUint32(42, entry.offset, true);
      central.set(entry.nameBytes, 46);
      push(central);
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 101010256, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, offset - centralStart, true);
    endView.setUint32(16, centralStart, true);
    push(end);
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) {
      out.set(chunk, position);
      position += chunk.length;
    }
    return out;
  }
  function collectAssets(notes, messages, options = {}) {
    const assets = [];
    const used = options.existingNames || /* @__PURE__ */ new Set();
    const stamp = Date.now();
    const uniqueName = (base, ext) => {
      let index = assets.length + 1;
      let name = `${base}-${stamp}-${index}.${ext}`;
      while (used.has(name)) {
        index += 1;
        name = `${base}-${stamp}-${index}.${ext}`;
      }
      used.add(name);
      return name;
    };
    const extFor = (mime) => mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : mime.includes("svg") ? "svg" : "png";
    notes.forEach((note) => note.entries.forEach((entry) => {
      const entryId = `note:${note.id}:${entry.id}`;
      if ((entry.type === "image" || entry.type === "screenshot") && entry.imageUrl?.startsWith("data:")) {
        const mime = /^data:([^;,]+)/.exec(entry.imageUrl)?.[1] || "image/png";
        assets.push({
          entryId,
          fileName: uniqueName("snooper", extFor(mime)),
          mimeType: mime,
          dataUrl: entry.imageUrl
        });
      } else if (entry.type === "svg" && entry.svg) {
        assets.push({
          entryId,
          fileName: uniqueName("snooper", "svg"),
          mimeType: "image/svg+xml",
          svgText: entry.svg
        });
      }
    }));
    messages.forEach((message, messageIndex) => (message.images || []).forEach((image, imageIndex) => {
      if (!image.startsWith("data:")) return;
      const mime = /^data:([^;,]+)/.exec(image)?.[1] || "image/png";
      assets.push({
        entryId: `chat:${messageIndex}:${imageIndex}`,
        fileName: uniqueName("snooper-chat", extFor(mime)),
        mimeType: mime,
        dataUrl: image
      });
    }));
    return assets;
  }

  // src/lib/video-clock.ts
  function formatVideoTime(seconds) {
    const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const secs = total % 60;
    const mmss = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return hours > 0 ? `${hours}:${mmss}` : mmss;
  }

  // src/lib/video-key.ts
  function stripWww(host) {
    return host.replace(/^www\./, "");
  }
  function youtubeId(url) {
    const host = stripWww(url.hostname);
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
    const direct = url.searchParams.get("v");
    if (direct) return direct;
    const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
    return match?.[1] ?? null;
  }
  function bilibiliKey(url) {
    const host = stripWww(url.hostname);
    if (host !== "bilibili.com" && !host.endsWith(".bilibili.com")) return null;
    const bv = url.pathname.match(/\/(BV[0-9A-Za-z]+)/);
    if (bv?.[1]) return `bilibili:${bv[1]}`;
    const av = url.pathname.match(/\/av(\d+)/i);
    if (av?.[1]) return `bilibili:av${av[1]}`;
    const episode = url.pathname.match(/^\/(bangumi|cheese)\/play\/(ep\d+)(?:\/|$)/);
    if (episode) return `bilibili:${episode[1]}/play/${episode[2]}`;
    return null;
  }
  function bilibiliPart(url) {
    if (!url.searchParams.has("p")) return 1;
    const parts = url.searchParams.getAll("p");
    if (parts.length !== 1 || !/^[1-9]\d*$/.test(parts[0])) return null;
    const n = Number(parts[0]);
    return Number.isSafeInteger(n) ? n : null;
  }

  // src/lib/deep-link.ts
  function floorSeconds(seconds) {
    return Math.max(0, Math.floor(seconds));
  }
  function videoDeepLink(url, seconds) {
    if (!url || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const t = floorSeconds(seconds);
    if (bilibiliKey(parsed)) {
      const part = bilibiliPart(parsed);
      if (part === null) return null;
      return `https://www.bilibili.com${parsed.pathname}?${parsed.searchParams.has("p") ? `p=${part}&` : ""}t=${t}`;
    }
    const yt = youtubeId(parsed);
    if (yt) {
      const host = parsed.hostname.replace(/^www\./, "");
      if (host === "youtu.be") return `https://youtu.be/${yt}?t=${t}s`;
      if (parsed.pathname.startsWith("/shorts/")) return `https://www.youtube.com/shorts/${yt}?t=${t}s`;
      return `https://www.youtube.com/watch?v=${yt}&t=${t}s`;
    }
    return null;
  }

  // src/ext/sidepanel/panel.ts
  (() => {
    const DEFAULT_OBSIDIAN = {
      enabled: false,
      vaultPath: "",
      apiProtocol: "http",
      apiPort: 27123,
      apiKey: "",
      noteFolder: "snooper-notes"
    };
    const OBSIDIAN_KEY = "snooper.obsidian-config.v1";
    function normalizeObsidianConfig(raw) {
      const r = raw && typeof raw === "object" ? raw : {};
      const port = Number(r.apiPort) || DEFAULT_OBSIDIAN.apiPort;
      const protocol = r.apiProtocol === "https" || r.apiProtocol === "http" ? r.apiProtocol : port === 27124 ? "https" : "http";
      return {
        enabled: !!r.enabled,
        vaultPath: typeof r.vaultPath === "string" ? r.vaultPath : "",
        apiProtocol: protocol,
        apiPort: port,
        // Users copy the plugin's "Bearer <token>" line; store only the token.
        apiKey: typeof r.apiKey === "string" ? r.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "",
        noteFolder: typeof r.noteFolder === "string" && r.noteFolder.trim() ? r.noteFolder.trim() : DEFAULT_OBSIDIAN.noteFolder
      };
    }
    async function loadObsidianConfig() {
      try {
        const got = await chrome.storage.local.get(OBSIDIAN_KEY);
        const stored = got?.[OBSIDIAN_KEY];
        if (stored && typeof stored === "object") return normalizeObsidianConfig(stored);
      } catch {
      }
      try {
        const raw = localStorage.getItem(OBSIDIAN_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const config = normalizeObsidianConfig(parsed);
          try {
            await chrome.storage.local.set({ [OBSIDIAN_KEY]: config });
          } catch {
          }
          return config;
        }
      } catch {
      }
      return { ...DEFAULT_OBSIDIAN };
    }
    async function saveObsidianConfig(config) {
      const normalized = normalizeObsidianConfig(config);
      try {
        await chrome.storage.local.set({ [OBSIDIAN_KEY]: normalized });
      } catch {
      }
      try {
        localStorage.setItem(OBSIDIAN_KEY, JSON.stringify(normalized));
      } catch {
      }
    }
    let obsidianCfg = { ...DEFAULT_OBSIDIAN };
    let notes = [];
    let noteAssetNames = /* @__PURE__ */ new Map();
    const noticeBanner = document.getElementById("noticeBanner");
    const tabNotes = document.getElementById("tab-notes");
    const tabObsidian = document.getElementById("tab-obsidian");
    const tabHistory = document.getElementById("tab-history");
    const notesList = document.getElementById("notes-list");
    const notesRefreshBtn = document.getElementById("notes-refresh-btn");
    const notesSelectAll = document.getElementById("notes-select-all");
    const notesDeleteSelected = document.getElementById("notes-delete-selected");
    const openPageConfigBtn = document.getElementById("open-page-config");
    const obsidianEnabled = document.getElementById("obsidian-enabled");
    const obsidianProtocol = document.getElementById("obsidian-protocol");
    const obsidianPort = document.getElementById("obsidian-port");
    const obsidianFolder = document.getElementById("obsidian-folder");
    const obsidianKey = document.getElementById("obsidian-key");
    const obsidianTest = document.getElementById("obsidian-test");
    const obsidianTestStatus = document.getElementById("obsidian-test-status");
    const saveConfigBtn = document.getElementById("saveConfigBtn");
    const historyList = document.getElementById("history-list");
    const historyEmpty = document.getElementById("history-empty");
    const historyCount = document.getElementById("history-count");
    const historySelectAll = document.getElementById("history-select-all");
    const historyDeleteSelected = document.getElementById("history-delete-selected");
    const historyClear = document.getElementById("history-clear");
    function showNotice(text, isError = false) {
      noticeBanner.textContent = text;
      noticeBanner.className = `notice-banner ${isError ? "error" : "success"}`;
      noticeBanner.hidden = false;
      setTimeout(() => {
        noticeBanner.hidden = true;
      }, 4e3);
    }
    function switchTab(tab) {
      document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.remove("active");
        btn.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));
      const nextTab = document.getElementById(`tab-${tab}`);
      nextTab?.classList.add("active");
      nextTab?.setAttribute("aria-selected", "true");
      document.getElementById(`panel-${tab}`)?.classList.add("active");
      if (tab === "notes") void loadAndRenderNotes();
      if (tab === "history") void loadAndRenderHistory();
    }
    tabNotes.addEventListener("click", () => switchTab("notes"));
    tabObsidian.addEventListener("click", () => switchTab("obsidian"));
    tabHistory.addEventListener("click", () => switchTab("history"));
    openPageConfigBtn?.addEventListener("click", async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("\u6CA1\u6709\u6D3B\u52A8\u6807\u7B7E\u9875");
        await sendToPageWithInjection(tab.id, { type: "OPEN_PAGE_SETTINGS" }, tab.url, {
          sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
          injectContentScript: injectContentScriptFresh
        });
        showNotice("\u5DF2\u6253\u5F00\u9875\u9762\u914D\u7F6E");
      } catch (err) {
        showNotice(err instanceof Error ? err.message : "\u6253\u5F00\u914D\u7F6E\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002", true);
      }
    });
    function getSelectedNoteIds() {
      return Array.from(notesList.querySelectorAll("input.note-check:checked")).map((el) => el.dataset.id || "").filter(Boolean);
    }
    function updateNoteSelection() {
      const all = Array.from(notesList.querySelectorAll("input.note-check"));
      const selected = all.filter((el) => el.checked);
      notesDeleteSelected.disabled = selected.length === 0;
      notesDeleteSelected.textContent = selected.length > 0 ? `\u5220\u9664\u6240\u9009 (${selected.length})` : "\u5220\u9664\u6240\u9009";
      notesSelectAll.checked = all.length > 0 && selected.length === all.length;
      notesSelectAll.indeterminate = selected.length > 0 && selected.length < all.length;
      notesSelectAll.disabled = all.length === 0;
    }
    const saveFailures = document.createElement("div");
    saveFailures.setAttribute("role", "status");
    notesList.before(saveFailures);
    async function renderSaveFailures() {
      try {
        const result = await chrome.runtime.sendMessage({ target: "background", type: "GET_SAVE_FAILURES" });
        if (!result?.ok) return;
        saveFailures.textContent = "";
        for (const failure of result.failures || []) {
          const item = document.createElement("p");
          item.className = "empty-hint";
          item.textContent = `\u6709\u5185\u5BB9\u672A\u4FDD\u5B58\uFF08${failure.pendingCount} \u6761\u5F85\u4FDD\u5B58\uFF09\uFF1A${failure.saveState.message}`;
          const retry = document.createElement("button");
          retry.textContent = "\u91CD\u8BD5\u4FDD\u5B58";
          retry.className = "btn btn-sm btn-secondary";
          retry.addEventListener("click", async () => {
            retry.disabled = true;
            try {
              const res = await chrome.runtime.sendMessage({ target: "background", type: "RETRY_TRANSCRIPT", tabId: failure.tabId });
              if (!res?.ok) showNotice(res?.error || "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u5BFC\u51FA");
            } catch (error) {
              showNotice(`\u4FDD\u5B58\u5931\u8D25\uFF1A${String(error)}`);
            }
            await renderSaveFailures();
          });
          const exportBtn = document.createElement("button");
          exportBtn.textContent = "\u5BFC\u51FA\u53EF\u7528\u5185\u5BB9";
          exportBtn.className = "btn btn-sm btn-secondary";
          exportBtn.addEventListener("click", async () => {
            try {
              const res = await chrome.runtime.sendMessage({ target: "background", type: "GET_TRANSCRIPT", tabId: failure.tabId });
              const lines = Array.isArray(res?.subtitles) ? res.subtitles : [];
              if (!lines.length) {
                showNotice(res?.error || "\u6682\u65E0\u53EF\u5BFC\u51FA\u5185\u5BB9\uFF0C\u8BF7\u91CD\u8BD5\u8BFB\u53D6");
                return;
              }
              const text = lines.map((line) => `${line.source}
${line.target}`).join("\n\n");
              const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = "snooper-unsaved-transcript.txt";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 2e3);
              showNotice(res.complete ? "\u5DF2\u5BFC\u51FA\u5F53\u524D\u8F6C\u5199\uFF08\u542B\u672A\u4FDD\u5B58\u5185\u5BB9\uFF09" : "\u4EC5\u5BFC\u51FA\u53EF\u7528\u5185\u5BB9\uFF0C\u90E8\u5206\u6B63\u6587\u8BFB\u53D6\u5931\u8D25");
            } catch (error) {
              showNotice(`\u5BFC\u51FA\u5931\u8D25\uFF1A${String(error)}`);
            }
          });
          item.style.overflowWrap = "anywhere";
          const actions = document.createElement("div");
          actions.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px";
          actions.append(retry, exportBtn);
          item.appendChild(actions);
          saveFailures.appendChild(item);
        }
      } catch (error) {
        showNotice(`\u4FDD\u5B58\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF1A${String(error)}`);
      }
    }
    const legacyWarning = document.createElement("p");
    notesList.before(legacyWarning);
    function renderLegacyWarning() {
      legacyWarning.textContent = "";
      legacyWarning.hidden = !hasRetainedLegacyNotes();
      if (hasRetainedLegacyNotes()) {
        legacyWarning.className = "empty-hint";
        legacyWarning.setAttribute("role", "status");
        legacyWarning.textContent = "\u4FA7\u680F\u65E7\u7248\u7B14\u8BB0\u5C1A\u672A\u786E\u8BA4\u5408\u5E76\uFF0C\u539F\u526F\u672C\u5DF2\u4FDD\u7559\u3002\u8BF7\u5BFC\u51FA\u65E7\u526F\u672C\uFF1B\u68C0\u7D22\u53EA\u5305\u542B\u5DF2\u4FDD\u5B58\u8D44\u6599\u3002";
        const exportLegacy = document.createElement("button");
        exportLegacy.textContent = "\u5BFC\u51FA\u65E7\u7248\u526F\u672C";
        exportLegacy.className = "btn btn-sm btn-secondary";
        exportLegacy.addEventListener("click", exportRetainedLegacyNotes);
        legacyWarning.appendChild(exportLegacy);
      }
    }
    async function loadAndRenderNotes() {
      await renderSaveFailures();
      try {
        notes = await loadNotes();
      } catch (error) {
        showNotice(`\u7B14\u8BB0\u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u70B9\u5237\u65B0\u91CD\u8BD5\uFF1A${String(error)}`);
        return;
      } finally {
        renderLegacyWarning();
      }
      notesList.textContent = "";
      if (notes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-hint";
        empty.textContent = "\u6682\u65E0\u7B14\u8BB0\u3002\u5728\u9875\u9762\u6D6E\u5C42\u70B9\u51FB\u300C\u8BB0\u7B14\u8BB0\u300D\u6216\u300C\u751F\u6210\u914D\u56FE\u300D\u5373\u53EF\u6DFB\u52A0\u3002";
        notesList.appendChild(empty);
        updateNoteSelection();
        return;
      }
      const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
      sorted.forEach((note) => {
        const card = document.createElement("div");
        card.className = "note-card";
        const header = document.createElement("div");
        header.className = "note-card-header";
        const select = document.createElement("input");
        select.type = "checkbox";
        select.className = "note-check";
        select.dataset.id = note.id;
        select.setAttribute("aria-label", `\u9009\u62E9 ${note.title || "\u7B14\u8BB0"}`);
        select.addEventListener("change", updateNoteSelection);
        const title = document.createElement("span");
        title.className = "note-card-title";
        title.textContent = note.title || "\u672A\u547D\u540D\u7B14\u8BB0";
        const count = document.createElement("span");
        count.className = "note-card-count";
        count.textContent = `${note.entries.length} \u6761`;
        const titleWrap = document.createElement("div");
        titleWrap.className = "note-card-title-wrap";
        titleWrap.appendChild(select);
        titleWrap.appendChild(title);
        header.appendChild(titleWrap);
        header.appendChild(count);
        card.appendChild(header);
        const meta = document.createElement("div");
        meta.className = "note-card-meta";
        const date = new Date(note.updatedAt).toLocaleString("zh-CN", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
        meta.textContent = `\u66F4\u65B0\u4E8E ${date}`;
        card.appendChild(meta);
        if (note.entries.length > 0) {
          const preview = document.createElement("div");
          preview.className = "note-card-preview";
          const last = note.entries[note.entries.length - 1];
          preview.textContent = last.text || last.target || last.source || "(\u7A7A)";
          card.appendChild(preview);
        }
        const actions = document.createElement("div");
        actions.className = "note-card-actions";
        const exportBtn = document.createElement("button");
        exportBtn.type = "button";
        exportBtn.className = "btn btn-ghost btn-xs";
        exportBtn.textContent = "\u5BFC\u51FA Markdown";
        exportBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          exportNote(note);
        });
        actions.appendChild(exportBtn);
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "icon-btn icon-btn-danger";
        delBtn.setAttribute("aria-label", `\u5220\u9664${note.title || "\u7B14\u8BB0"}`);
        delBtn.title = "\u5220\u9664\u7B14\u8BB0";
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>';
        delBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            const updated = await deleteNoteDocuments([note.id]);
            if (!updated) return;
            notes = updated;
            await loadAndRenderNotes();
            showNotice("\u7B14\u8BB0\u5DF2\u5220\u9664");
          } catch (error) {
            showNotice(`\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1A${String(error)}`);
          }
        });
        actions.appendChild(delBtn);
        card.appendChild(actions);
        notesList.appendChild(card);
      });
      updateNoteSelection();
    }
    function exportNote(note) {
      const assets = collectAssets([note], []).map((asset) => ({
        ...asset,
        entryId: asset.entryId.replace(/^note:[^:]+:/, `note:${note.id}:`)
      }));
      const decoded = [];
      noteAssetNames = /* @__PURE__ */ new Map();
      for (const asset of assets) {
        const result = decodeExportAsset(asset);
        if (result) {
          noteAssetNames.set(asset.entryId, asset.fileName);
          decoded.push({ name: `assets/${asset.fileName}`, bytes: result.file.bytes });
        }
      }
      const lines = [
        `# ${note.title}`,
        "",
        `- **\u521B\u5EFA\u65F6\u95F4**\uFF1A${new Date(note.createdAt).toLocaleString("zh-CN")}`,
        `- **\u6761\u76EE\u6570**\uFF1A${note.entries.length}`,
        "",
        "---",
        ""
      ];
      for (const entry of note.entries) {
        const time = new Date(entry.at).toLocaleTimeString("zh-CN");
        switch (entry.type) {
          case "subtitle": {
            lines.push(`### \u5B57\u5E55 ${time}`);
            if (entry.target) lines.push(`**\u8BD1\u6587**\uFF1A${entry.target}`);
            if (entry.source) lines.push(`**\u539F\u6587**\uFF1A${entry.source}`);
            const link = entry.sourceRef?.confidence === "exact" && typeof entry.videoTime === "number" && Number.isFinite(entry.videoTime) ? videoDeepLink(entry.sourceRef.url, entry.videoTime) : null;
            if (link) lines.push(`**\u89C6\u9891\u951A\u70B9**\uFF1A[\`${formatVideoTime(entry.videoTime)}\`](${link})`);
            lines.push("");
            break;
          }
          case "text":
            lines.push(`### \u7B14\u8BB0 ${time}`);
            lines.push(entry.text || "");
            lines.push("");
            break;
          case "summary":
            lines.push(`### \u5B66\u4E60\u7EAA\u8981 ${time}`);
            lines.push(entry.text || "");
            lines.push("");
            break;
          case "screenshot":
          case "image": {
            const title = entry.type === "screenshot" ? "\u622A\u56FE" : "\u914D\u56FE";
            lines.push(`### ${title} ${time}`);
            lines.push(entry.text || entry.source || title);
            const assetName = noteAssetNames.get(`note:${note.id}:${entry.id}`);
            if (assetName) lines.push(`![](assets/${assetName})`);
            else lines.push(`> [\u56FE\u7247\uFF1A${entry.text || title} \u2014 \u56FE\u7247\u6570\u636E\u672A\u80FD\u968F\u5BFC\u51FA\u643A\u5E26]`);
            lines.push("");
            break;
          }
          case "svg": {
            lines.push(`### SVG ${time}`);
            lines.push(entry.text || entry.source || "");
            const svgName = noteAssetNames.get(`note:${note.id}:${entry.id}`);
            if (svgName) lines.push(`![](assets/${svgName})`);
            else if (entry.svg) lines.push("```svg\n" + entry.svg + "\n```");
            lines.push("");
            break;
          }
        }
      }
      lines.push("", "---", "*\u7531 snooper-browser \u751F\u6210*");
      const markdown = lines.join("\n");
      if (decoded.length === 0) {
        const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.md`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 2e3);
        showNotice("\u7B14\u8BB0\u5DF2\u5BFC\u51FA");
        return;
      }
      decoded.unshift({ name: "note.md", bytes: new TextEncoder().encode(markdown) });
      const zipBlob = new Blob([buildZip(decoded)], { type: "application/zip" });
      const zipUrl = URL.createObjectURL(zipBlob);
      const zipAnchor = document.createElement("a");
      zipAnchor.href = zipUrl;
      zipAnchor.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.zip`;
      zipAnchor.click();
      setTimeout(() => URL.revokeObjectURL(zipUrl), 2e3);
      showNotice(`\u7B14\u8BB0\u5DF2\u5BFC\u51FA\uFF08ZIP\uFF0C${decoded.length} \u4E2A\u6587\u4EF6\uFF09`);
    }
    notesRefreshBtn.addEventListener("click", loadAndRenderNotes);
    notesSelectAll.addEventListener("change", () => {
      notesList.querySelectorAll("input.note-check").forEach((el) => {
        el.checked = notesSelectAll.checked;
      });
      updateNoteSelection();
    });
    notesDeleteSelected.addEventListener("click", async () => {
      const ids = getSelectedNoteIds();
      if (ids.length === 0) return;
      try {
        const updated = await deleteNoteDocuments(ids);
        if (!updated) return;
        notes = updated;
        await loadAndRenderNotes();
        showNotice(`\u5DF2\u5220\u9664 ${ids.length} \u7BC7\u7B14\u8BB0`);
      } catch (error) {
        showNotice(`\u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1A${String(error)}`);
      }
    });
    const HISTORY_PAGE_SIZE = 300;
    function formatTime(ts) {
      return new Date(ts).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    function getSelectedHistoryIds() {
      return Array.from(historyList.querySelectorAll("input.history-check:checked")).map((el) => el.dataset.id || "").filter(Boolean);
    }
    function updateHistorySelection() {
      const all = Array.from(historyList.querySelectorAll("input.history-check"));
      const selectable = all.filter((el) => !el.disabled);
      const selected = selectable.filter((el) => el.checked);
      historyDeleteSelected.disabled = selected.length === 0;
      historyDeleteSelected.textContent = selected.length > 0 ? `\u5220\u9664\u6240\u9009 (${selected.length})` : "\u5220\u9664\u6240\u9009";
      historySelectAll.checked = selectable.length > 0 && selected.length === selectable.length;
      historySelectAll.indeterminate = selected.length > 0 && selected.length < selectable.length;
      historySelectAll.disabled = selectable.length === 0;
    }
    async function fetchHistoryTranscript(id) {
      const res = await chrome.runtime.sendMessage({
        target: "background",
        type: "GET_HISTORY_TRANSCRIPT",
        id
      });
      return res?.ok && Array.isArray(res.subtitles) ? res.subtitles : [];
    }
    const seekFailureNotice = "\u9875\u9762\u91CC\u6CA1\u6709\u53EF\u5B9A\u4F4D\u7684\u89C6\u9891\uFF0C\u6216\u89C6\u9891\u62D2\u7EDD\u4E86\u8DF3\u8F6C";
    async function seekVideoInPage(subtitle) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const result = await chrome.runtime.sendMessage({ target: "background", type: "OPEN_SOURCE", tabId: tab?.id, sourceRef: subtitle.sourceRef, videoTime: subtitle.videoTime });
        return result?.ok ? result.action : false;
      } catch {
        return false;
      }
    }
    function appendHistoryRows(container, subtitles, from, to) {
      for (let index = from; index < to && index < subtitles.length; index += 1) {
        const subtitle = subtitles[index];
        const row = document.createElement("div");
        row.className = "history-subtitle-row";
        const time = document.createElement("time");
        const anchored = typeof subtitle.videoTime === "number" && Number.isFinite(subtitle.videoTime);
        const wall = subtitle.at ? new Date(subtitle.at).toLocaleTimeString("zh-CN") : "";
        time.textContent = anchored ? formatVideoTime(subtitle.videoTime) : subtitle.sourceRef?.url ? "\u6253\u5F00\u6765\u6E90" : wall || "--:--:--";
        if (anchored && wall) time.title = `\u5F55\u5236\u65F6\u95F4 ${wall}`;
        if (anchored || subtitle.sourceRef?.url) {
          time.classList.add("history-time-chip");
          time.setAttribute("role", "button");
          time.tabIndex = 0;
          time.title = anchored && subtitle.sourceRef?.confidence === "exact" ? `\u70B9\u51FB\u8DF3\u8F6C\u5230\u89C6\u9891 ${formatVideoTime(subtitle.videoTime)}` : "\u6253\u5F00\u6765\u6E90\uFF08\u65F6\u95F4\u6216\u8BFE\u8282\u672A\u6838\u9A8C\uFF09";
          const activate = async () => {
            time.classList.remove("seek-ok", "seek-fail");
            void time.offsetWidth;
            const result = await seekVideoInPage(subtitle);
            time.classList.add(result ? "seek-ok" : "seek-fail");
            showNotice(result === "seeked" ? "\u5DF2\u5B9A\u4F4D" : result === "opened" ? "\u5DF2\u6253\u5F00\u6765\u6E90" : seekFailureNotice, !result);
          };
          time.addEventListener("click", activate);
          time.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void activate();
            }
          });
        }
        const source = document.createElement("span");
        source.className = "history-source";
        source.textContent = subtitle.source || "\uFF08\u65E0\u539F\u6587\uFF09";
        const target = document.createElement("span");
        target.className = "history-target";
        target.textContent = subtitle.target || "\uFF08\u65E0\u8BD1\u6587\uFF09";
        row.append(time, source, target);
        container.appendChild(row);
      }
    }
    function mountHistoryDetail(detail, item) {
      let loaded = false;
      let rows = [];
      let shown = 0;
      const list = document.createElement("div");
      list.className = "history-subtitle-list";
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn btn-sm btn-secondary history-more";
      more.hidden = true;
      detail.append(list, more);
      function paintNextBatch() {
        const next = Math.min(rows.length, shown + HISTORY_PAGE_SIZE);
        appendHistoryRows(list, rows, shown, next);
        shown = next;
        const remaining = rows.length - shown;
        more.hidden = remaining <= 0;
        more.textContent = `\u663E\u793A\u66F4\u591A\uFF08\u5269\u4F59 ${remaining} \u6761\uFF09`;
      }
      more.addEventListener("click", paintNextBatch);
      return async function ensureLoaded() {
        if (loaded) return;
        detail.textContent = "\u6B63\u5728\u8BFB\u53D6\u2026";
        rows = await fetchHistoryTranscript(item.id);
        detail.textContent = "";
        detail.append(list, more);
        loaded = true;
        if (rows.length === 0) {
          detail.textContent = "\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u4FDD\u5B58\u5B57\u5E55\u6B63\u6587\u3002";
          return;
        }
        paintNextBatch();
      };
    }
    async function loadAndRenderHistory() {
      const res = await chrome.runtime.sendMessage({ target: "background", type: "GET_HISTORY" });
      const items = Array.isArray(res?.history) ? res.history : [];
      historyCount.textContent = String(items.length);
      historyList.textContent = "";
      if (items.length === 0) {
        historyList.style.display = "none";
        historyEmpty.style.display = "block";
        updateHistorySelection();
        return;
      }
      historyList.style.display = "flex";
      historyEmpty.style.display = "none";
      items.forEach((item) => {
        const recording = item.status === "recording";
        const el = document.createElement("div");
        el.className = "history-item";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "history-check";
        check.dataset.id = item.id;
        check.disabled = recording;
        check.title = recording ? "\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u4E0D\u80FD\u5220\u9664" : "";
        check.setAttribute("aria-label", `\u9009\u62E9 ${item.pageTitle || "\u8BB0\u5F55"}`);
        check.addEventListener("change", updateHistorySelection);
        el.appendChild(check);
        const main = document.createElement("div");
        main.className = "history-item-main";
        const title = document.createElement("div");
        title.className = "history-item-title";
        if (item.url) {
          title.classList.add("history-item-link");
          title.setAttribute("role", "link");
          title.tabIndex = 0;
          title.title = `\u6253\u5F00\u539F\u89C6\u9891\uFF1A${item.pageTitle || ""}`;
          const open = () => {
            void chrome.tabs.create({ url: item.url, active: true }).catch(() => {
            });
          };
          title.addEventListener("click", open);
          title.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              open();
            }
          });
        } else {
          title.title = item.pageTitle || "";
        }
        title.textContent = item.pageTitle || "\u672A\u77E5\u9875\u9762";
        const meta = document.createElement("div");
        meta.className = "history-item-meta";
        const parts = [
          formatTime(item.startedAt),
          `${item.subtitleCount || 0} \u6761\u5B57\u5E55`,
          `${item.sourceLang || "auto"} \u2192 ${item.targetLang || "zh"}`
        ];
        if (recording) parts.push("\u5F55\u5236\u4E2D");
        meta.textContent = parts.join(" \xB7 ");
        main.append(title, meta);
        el.appendChild(main);
        const detail = document.createElement("div");
        detail.className = "history-item-detail";
        detail.hidden = true;
        el.appendChild(detail);
        const actions = document.createElement("div");
        actions.className = "history-item-actions";
        let ensureDetail = null;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn btn-sm btn-secondary";
        toggle.textContent = "\u67E5\u770B\u5185\u5BB9";
        toggle.addEventListener("click", async () => {
          if (!detail.hidden) {
            detail.hidden = true;
            toggle.textContent = "\u67E5\u770B\u5185\u5BB9";
            return;
          }
          detail.hidden = false;
          toggle.textContent = "\u6536\u8D77\u5185\u5BB9";
          if (!ensureDetail) ensureDetail = mountHistoryDetail(detail, item);
          toggle.disabled = true;
          try {
            await ensureDetail();
          } finally {
            toggle.disabled = false;
          }
        });
        actions.appendChild(toggle);
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "btn btn-sm btn-secondary";
        copy.textContent = "\u590D\u5236";
        copy.addEventListener("click", async () => {
          copy.disabled = true;
          try {
            const rows = await fetchHistoryTranscript(item.id);
            if (rows.length === 0) {
              showNotice("\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u4FDD\u5B58\u5B57\u5E55\u6B63\u6587\uFF0C\u65E0\u6CD5\u590D\u5236", true);
              return;
            }
            const text = rows.map((subtitle) => `${subtitle.source || ""}
${subtitle.target || ""}`).join("\n\n");
            const ok = await copyText(text);
            showNotice(ok ? "\u5DF2\u590D\u5236\u5B8C\u6574\u8F6C\u5199\u5185\u5BB9" : "\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u8BBE\u7F6E\u4E2D\u5141\u8BB8\u526A\u8D34\u677F\u8BBF\u95EE", !ok);
          } finally {
            copy.disabled = false;
          }
        });
        actions.appendChild(copy);
        const exportButton = document.createElement("button");
        exportButton.type = "button";
        exportButton.className = "btn btn-sm btn-secondary";
        exportButton.textContent = "\u5BFC\u51FA Markdown";
        exportButton.addEventListener("click", async () => {
          exportButton.disabled = true;
          try {
            const rows = await fetchHistoryTranscript(item.id);
            if (rows.length === 0) {
              showNotice("\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u4FDD\u5B58\u5B57\u5E55\u6B63\u6587\uFF0C\u65E0\u6CD5\u5BFC\u51FA", true);
              return;
            }
            const blob = new Blob([historyMarkdown(item, rows)], { type: "text/markdown;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `snooper-history-${item.id}.md`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 2e3);
          } finally {
            exportButton.disabled = false;
          }
        });
        actions.appendChild(exportButton);
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-sm btn-secondary";
        del.textContent = "\u5220\u9664";
        del.disabled = recording;
        del.title = recording ? "\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u4E0D\u80FD\u5220\u9664" : "";
        del.addEventListener("click", async () => {
          try {
            const res2 = await confirmLibraryDelete({ transcriptIds: [item.id] });
            if (!res2) return;
            if (res2.skipped.length) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
            await loadAndRenderHistory();
          } catch (error) {
            showNotice(`\u5220\u9664\u672A\u5B8C\u6210\uFF1A${String(error)}`, true);
          }
        });
        actions.appendChild(del);
        el.appendChild(actions);
        historyList.appendChild(el);
      });
      updateHistorySelection();
    }
    historySelectAll.addEventListener("change", () => {
      const checked = historySelectAll.checked;
      historyList.querySelectorAll("input.history-check:not(:disabled)").forEach((el) => {
        el.checked = checked;
      });
      updateHistorySelection();
    });
    historyDeleteSelected.addEventListener("click", async () => {
      const ids = getSelectedHistoryIds();
      if (ids.length === 0) return;
      try {
        const res = await confirmLibraryDelete({ transcriptIds: ids });
        if (!res) return;
        if (res.skipped.length) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
        await loadAndRenderHistory();
      } catch (error) {
        showNotice(`\u5220\u9664\u672A\u5B8C\u6210\uFF1A${String(error)}`, true);
      }
    });
    historyClear.addEventListener("click", async () => {
      try {
        const history = await chrome.runtime.sendMessage({ target: "background", type: "GET_HISTORY" });
        if (!history?.ok) throw new Error(history?.error || "\u65E0\u6CD5\u8BFB\u53D6\u5386\u53F2\u8BB0\u5F55");
        const res = await confirmLibraryDelete({ transcriptIds: history.history.map((item) => item.id) });
        if (!res) return;
        if (res.skipped.length) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
        await loadAndRenderHistory();
      } catch (error) {
        showNotice(`\u5220\u9664\u672A\u5B8C\u6210\uFF1A${String(error)}`, true);
      }
    });
    function historyMarkdown(item, subtitles) {
      const anchored = subtitles.some(
        (subtitle) => typeof subtitle.videoTime === "number" && Number.isFinite(subtitle.videoTime)
      );
      const lines = [
        `# ${item.pageTitle || "\u8F6C\u5199\u5386\u53F2"}`,
        "",
        `- **\u5F00\u59CB**\uFF1A${formatTime(item.startedAt)}`,
        `- **\u7ED3\u675F**\uFF1A${formatTime(item.endedAt ?? item.lastAt)}`,
        `- **\u8BED\u8A00**\uFF1A${item.sourceLang || "auto"} \u2192 ${item.targetLang || "zh"}`,
        `- **\u5B57\u5E55\u6761\u76EE**\uFF1A${subtitles.length} \u6761`,
        "",
        anchored ? "| \u89C6\u9891\u65F6\u95F4 | \u5F55\u5236\u65F6\u95F4 | \u539F\u6587 | \u8BD1\u6587 |" : "| \u65F6\u95F4 | \u539F\u6587 | \u8BD1\u6587 |",
        anchored ? "| :--- | :--- | :--- | :--- |" : "| :--- | :--- | :--- |"
      ];
      for (const subtitle of subtitles) {
        const wall = subtitle.at ? new Date(subtitle.at).toLocaleTimeString("zh-CN") : "";
        const source = (subtitle.source || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
        const target = (subtitle.target || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
        if (anchored) {
          const hasTime = typeof subtitle.videoTime === "number" && Number.isFinite(subtitle.videoTime);
          const video = hasTime ? formatVideoTime(subtitle.videoTime) : "";
          const link = hasTime && subtitle.sourceRef?.confidence === "exact" ? videoDeepLink(subtitle.sourceRef.url, subtitle.videoTime) : null;
          lines.push(`| ${link ? `[\`${video}\`](${link})` : video} | ${wall} | ${source} | ${target} |`);
        } else {
          lines.push(`| ${wall} | ${source} | ${target} |`);
        }
      }
      return lines.join("\n");
    }
    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        textarea.remove();
        return ok;
      }
    }
    async function renderObsidianConfig() {
      obsidianCfg = await loadObsidianConfig();
      obsidianEnabled.checked = obsidianCfg.enabled;
      obsidianProtocol.value = obsidianCfg.apiProtocol;
      obsidianPort.value = String(obsidianCfg.apiPort);
      obsidianFolder.value = obsidianCfg.noteFolder;
      obsidianKey.value = obsidianCfg.apiKey;
      obsidianTestStatus.hidden = true;
    }
    async function syncObsidianForm() {
      obsidianCfg.enabled = obsidianEnabled.checked;
      obsidianCfg.apiProtocol = obsidianProtocol.value === "https" ? "https" : "http";
      obsidianCfg.apiPort = parseInt(obsidianPort.value, 10) || (obsidianCfg.apiProtocol === "https" ? 27124 : 27123);
      obsidianCfg.noteFolder = obsidianFolder.value.trim() || "snooper-notes";
      obsidianCfg.apiKey = obsidianKey.value.trim();
      await saveObsidianConfig(obsidianCfg);
    }
    saveConfigBtn.addEventListener("click", async () => {
      await syncObsidianForm();
      showNotice("Obsidian \u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    });
    obsidianTest.addEventListener("click", async () => {
      await syncObsidianForm();
      obsidianTest.disabled = true;
      obsidianTestStatus.textContent = "\u6B63\u5728\u6D4B\u8BD5\u2026";
      obsidianTestStatus.hidden = false;
      obsidianTestStatus.className = "obsidian-test-status";
      try {
        const res = await chrome.runtime.sendMessage({
          target: "background",
          type: "TEST_OBSIDIAN",
          obsidianConfig: obsidianCfg
        });
        if (res && res.ok) {
          obsidianCfg.apiProtocol = res.protocol;
          obsidianCfg.apiPort = res.port;
          await saveObsidianConfig(obsidianCfg);
          obsidianProtocol.value = res.protocol;
          obsidianPort.value = String(res.port);
          obsidianTestStatus.textContent = `\u8FDE\u63A5\u6210\u529F\uFF08${String(res.protocol).toUpperCase()} ${res.port}\uFF09\uFF0C\u5DF2\u4FDD\u5B58`;
          obsidianTestStatus.className = "obsidian-test-status ok";
        } else {
          obsidianTestStatus.textContent = res?.error || "\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C\u4E14 Local REST API \u63D2\u4EF6\u5DF2\u542F\u7528";
          obsidianTestStatus.className = "obsidian-test-status err";
        }
      } catch (err) {
        obsidianTestStatus.textContent = err.message || "\u901A\u4FE1\u5F02\u5E38";
        obsidianTestStatus.className = "obsidian-test-status err";
      } finally {
        obsidianTest.disabled = false;
      }
    });
    obsidianProtocol.addEventListener("change", () => {
      const port = parseInt(obsidianPort.value, 10);
      if (!port || port === 27123 || port === 27124) {
        obsidianPort.value = obsidianProtocol.value === "https" ? "27124" : "27123";
      }
    });
    void renderObsidianConfig();
    void loadAndRenderNotes();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void loadAndRenderNotes();
    });
  })();
})();
