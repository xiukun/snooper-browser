(() => {
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
  async function sendToPageWithInjection(tabId, message, tabUrl, { sendMessage, injectContentScript }) {
    if (isUnsupportedTabUrl(tabUrl)) throw new UnsupportedPageError();
    try {
      await sendMessage(tabId, message);
      return { ok: true, injected: false };
    } catch (firstError) {
      try {
        await injectContentScript(tabId);
        await sendMessage(tabId, message);
        return { ok: true, injected: true };
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
    const NOTES_KEY = "snooper.notes.v1";
    const OBSIDIAN_KEY = "snooper.obsidian-config.v1";
    function loadNotes() {
      return (async () => {
        try {
          const got = await chrome.storage.local.get(NOTES_KEY);
          const stored = got?.[NOTES_KEY];
          if (Array.isArray(stored)) return stored;
        } catch {
        }
        try {
          const raw = localStorage.getItem(NOTES_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              try {
                await chrome.storage.local.set({ [NOTES_KEY]: parsed });
              } catch {
              }
              return parsed;
            }
          }
        } catch {
        }
        return [];
      })();
    }
    async function saveNotes(next) {
      try {
        await chrome.storage.local.set({ [NOTES_KEY]: next });
      } catch {
      }
      try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(next));
      } catch {
      }
    }
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
          injectContentScript: async (tabId) => {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ["content.js"]
            });
          }
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
    async function loadAndRenderNotes() {
      notes = await loadNotes();
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
          if (!confirm("\u786E\u5B9A\u5220\u9664\u8FD9\u7BC7\u7B14\u8BB0\uFF1F")) return;
          notes = (await loadNotes()).filter((n) => n.id !== note.id);
          await saveNotes(notes);
          await loadAndRenderNotes();
          showNotice("\u7B14\u8BB0\u5DF2\u5220\u9664");
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
          case "subtitle":
            lines.push(`### \u5B57\u5E55 ${time}`);
            if (entry.target) lines.push(`**\u8BD1\u6587**\uFF1A${entry.target}`);
            if (entry.source) lines.push(`**\u539F\u6587**\uFF1A${entry.source}`);
            lines.push("");
            break;
          case "text":
            lines.push(`### \u7B14\u8BB0 ${time}`);
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
      if (!confirm(`\u786E\u5B9A\u5220\u9664\u9009\u4E2D\u7684 ${ids.length} \u7BC7\u7B14\u8BB0\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`)) return;
      notes = (await loadNotes()).filter((note) => !ids.includes(note.id));
      await saveNotes(notes);
      await loadAndRenderNotes();
      showNotice(`\u5DF2\u5220\u9664 ${ids.length} \u7BC7\u7B14\u8BB0`);
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
    function appendHistoryRows(container, subtitles, from, to) {
      for (let index = from; index < to && index < subtitles.length; index += 1) {
        const subtitle = subtitles[index];
        const row = document.createElement("div");
        row.className = "history-subtitle-row";
        const time = document.createElement("time");
        time.textContent = subtitle.at ? new Date(subtitle.at).toLocaleTimeString("zh-CN") : "--:--:--";
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
        title.title = item.pageTitle || "";
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
          if (!confirm(`\u786E\u5B9A\u5220\u9664\u300C${item.pageTitle || "\u8FD9\u6761\u8BB0\u5F55"}\u300D\uFF1F`)) return;
          const res2 = await chrome.runtime.sendMessage({
            target: "background",
            type: "DELETE_HISTORY",
            id: item.id
          });
          if (res2?.skipped) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
          await loadAndRenderHistory();
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
      if (!confirm(`\u786E\u5B9A\u5220\u9664\u9009\u4E2D\u7684 ${ids.length} \u6761\u5386\u53F2\u8BB0\u5F55\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`)) return;
      const res = await chrome.runtime.sendMessage({ target: "background", type: "DELETE_HISTORY", ids });
      if (res?.skipped) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
      await loadAndRenderHistory();
    });
    historyClear.addEventListener("click", async () => {
      if (!confirm("\u786E\u5B9A\u6E05\u7A7A\u5168\u90E8\u5386\u53F2\u8BB0\u5F55\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002")) return;
      const res = await chrome.runtime.sendMessage({ target: "background", type: "DELETE_ALL_HISTORY" });
      if (res?.skipped) showNotice("\u6B63\u5728\u5F55\u5236\u7684\u8BB0\u5F55\u5DF2\u8DF3\u8FC7", true);
      await loadAndRenderHistory();
    });
    function historyMarkdown(item, subtitles) {
      const lines = [
        `# ${item.pageTitle || "\u8F6C\u5199\u5386\u53F2"}`,
        "",
        `- **\u5F00\u59CB**\uFF1A${formatTime(item.startedAt)}`,
        `- **\u7ED3\u675F**\uFF1A${formatTime(item.endedAt ?? item.lastAt)}`,
        `- **\u8BED\u8A00**\uFF1A${item.sourceLang || "auto"} \u2192 ${item.targetLang || "zh"}`,
        `- **\u5B57\u5E55\u6761\u76EE**\uFF1A${subtitles.length} \u6761`,
        "",
        "| \u65F6\u95F4 | \u539F\u6587 | \u8BD1\u6587 |",
        "| :--- | :--- | :--- |"
      ];
      for (const subtitle of subtitles) {
        const time = subtitle.at ? new Date(subtitle.at).toLocaleTimeString("zh-CN") : "";
        const source = (subtitle.source || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
        const target = (subtitle.target || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
        lines.push(`| ${time} | ${source} | ${target} |`);
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
