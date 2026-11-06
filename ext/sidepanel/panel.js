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
        delBtn.className = "btn btn-danger-ghost btn-xs";
        delBtn.textContent = "\u5220\u9664";
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
            lines.push(`### \u622A\u56FE ${time}`);
            lines.push(entry.text || "\u622A\u56FE");
            if (entry.imageUrl) lines.push(`![](${entry.imageUrl})`);
            lines.push("");
            break;
          case "image":
            lines.push(`### \u914D\u56FE ${time}`);
            lines.push(entry.text || entry.source || "");
            if (entry.imageUrl) lines.push(`![](${entry.imageUrl})`);
            lines.push("");
            break;
          case "svg":
            lines.push(`### SVG ${time}`);
            lines.push(entry.text || entry.source || "");
            if (entry.svg) lines.push("```svg\n" + entry.svg + "\n```");
            lines.push("");
            break;
        }
      }
      lines.push("", "---", "*\u7531 snooper-browser \u751F\u6210*");
      const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2e3);
      showNotice("\u7B14\u8BB0\u5DF2\u5BFC\u51FA");
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
    function formatTime(ts) {
      return new Date(ts).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    function getSelectedHistoryIds() {
      return Array.from(historyList.querySelectorAll("input.history-check:checked")).map((el) => el.dataset.id || "").filter(Boolean);
    }
    function updateHistorySelection() {
      const all = Array.from(historyList.querySelectorAll("input.history-check"));
      const selected = all.filter((el) => el.checked);
      historyDeleteSelected.disabled = selected.length === 0;
      historyDeleteSelected.textContent = selected.length > 0 ? `\u5220\u9664\u6240\u9009 (${selected.length})` : "\u5220\u9664\u6240\u9009";
      historySelectAll.checked = all.length > 0 && selected.length === all.length;
      historySelectAll.indeterminate = selected.length > 0 && selected.length < all.length;
      historySelectAll.disabled = all.length === 0;
    }
    async function loadAndRenderHistory() {
      const res = await chrome.runtime.sendMessage({ target: "background", type: "GET_HISTORY" });
      const items = res?.history || [];
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
        const el = document.createElement("div");
        el.className = "history-item";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.className = "history-check";
        check.dataset.id = item.id;
        check.setAttribute("aria-label", `\u9009\u62E9 ${item.pageTitle || "\u8BB0\u5F55"}`);
        check.addEventListener("change", updateHistorySelection);
        el.appendChild(check);
        const main = document.createElement("div");
        main.className = "history-item-main";
        main.innerHTML = `
        <div class="history-item-title" title="${escapeHtml(item.pageTitle || "")}">${escapeHtml(item.pageTitle || "\u672A\u77E5\u9875\u9762")}</div>
        <div class="history-item-meta">
          <span>&#x1F550; ${formatTime(item.startedAt)}</span>
          <span>&#x1F3AF; ${item.subtitleCount || 0} \u6761\u5B57\u5E55</span>
          <span>${escapeHtml(item.sourceLang || "")} \u2192 ${escapeHtml(item.targetLang || "")}</span>
        </div>
      `;
        el.appendChild(main);
        const actions = document.createElement("div");
        actions.className = "history-item-actions";
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn-sm btn-secondary";
        del.textContent = "\u5220\u9664";
        del.addEventListener("click", () => {
          if (!confirm(`\u786E\u5B9A\u5220\u9664\u300C${item.pageTitle || "\u8FD9\u6761\u8BB0\u5F55"}\u300D\uFF1F`)) return;
          chrome.runtime.sendMessage({ target: "background", type: "DELETE_HISTORY", id: item.id }).then(() => loadAndRenderHistory());
        });
        actions.appendChild(del);
        el.appendChild(actions);
        historyList.appendChild(el);
      });
      updateHistorySelection();
    }
    historySelectAll.addEventListener("change", () => {
      const checked = historySelectAll.checked;
      historyList.querySelectorAll("input.history-check").forEach((el) => {
        el.checked = checked;
      });
      updateHistorySelection();
    });
    historyDeleteSelected.addEventListener("click", () => {
      const ids = getSelectedHistoryIds();
      if (ids.length === 0) return;
      if (!confirm(`\u786E\u5B9A\u5220\u9664\u9009\u4E2D\u7684 ${ids.length} \u6761\u5386\u53F2\u8BB0\u5F55\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002`)) return;
      chrome.runtime.sendMessage({ target: "background", type: "DELETE_HISTORY", ids }).then(() => loadAndRenderHistory());
    });
    historyClear.addEventListener("click", () => {
      if (!confirm("\u786E\u5B9A\u6E05\u7A7A\u5168\u90E8\u5386\u53F2\u8BB0\u5F55\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002")) return;
      chrome.runtime.sendMessage({ target: "background", type: "DELETE_ALL_HISTORY" }).then(() => loadAndRenderHistory());
    });
    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
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
