(() => {
  // src/ext/sidepanel/panel.ts
  (() => {
    const NOTES_KEY = "snooper.notes.v1";
    const OBSIDIAN_KEY = "snooper.obsidian-config.v1";
    function loadNotes() {
      try {
        const raw = localStorage.getItem(NOTES_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    }
    function saveNotes(next) {
      try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(next));
      } catch {
      }
    }
    function loadObsidianConfig() {
      try {
        const raw = localStorage.getItem(OBSIDIAN_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
      }
      return { enabled: false, vaultPath: "", apiPort: 27124, apiKey: "", noteFolder: "snooper-notes" };
    }
    function saveObsidianConfig(config) {
      try {
        localStorage.setItem(OBSIDIAN_KEY, JSON.stringify(config));
      } catch {
      }
    }
    let obsidianCfg = { enabled: false, vaultPath: "", apiPort: 27124, apiKey: "", noteFolder: "snooper-notes" };
    let notes = [];
    const noticeBanner = document.getElementById("noticeBanner");
    const tabNotes = document.getElementById("tab-notes");
    const tabObsidian = document.getElementById("tab-obsidian");
    const notesList = document.getElementById("notes-list");
    const notesRefreshBtn = document.getElementById("notes-refresh-btn");
    const openPageConfigBtn = document.getElementById("open-page-config");
    const obsidianEnabled = document.getElementById("obsidian-enabled");
    const obsidianPort = document.getElementById("obsidian-port");
    const obsidianFolder = document.getElementById("obsidian-folder");
    const obsidianKey = document.getElementById("obsidian-key");
    const saveConfigBtn = document.getElementById("saveConfigBtn");
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
      if (tab === "notes") loadAndRenderNotes();
    }
    tabNotes.addEventListener("click", () => switchTab("notes"));
    tabObsidian.addEventListener("click", () => switchTab("obsidian"));
    openPageConfigBtn?.addEventListener("click", async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("\u6CA1\u6709\u6D3B\u52A8\u6807\u7B7E\u9875");
        await chrome.tabs.sendMessage(tab.id, { type: "OPEN_PAGE_SETTINGS" });
        showNotice("\u5DF2\u6253\u5F00\u9875\u9762\u914D\u7F6E");
      } catch {
        showNotice("\u5F53\u524D\u9875\u9762\u6CA1\u6709 snooper \u60AC\u6D6E\u680F\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u70B9\u51FB\u9875\u9762\u4E0A\u7684 \u2699", true);
      }
    });
    function loadAndRenderNotes() {
      notes = loadNotes();
      notesList.textContent = "";
      if (notes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-hint";
        empty.textContent = "\u6682\u65E0\u7B14\u8BB0\u3002\u5728\u9875\u9762\u6D6E\u5C42\u70B9\u51FB\u300C\u8BB0\u7B14\u8BB0\u300D\u6216\u300C\u751F\u6210\u914D\u56FE\u300D\u5373\u53EF\u6DFB\u52A0\u3002";
        notesList.appendChild(empty);
        return;
      }
      const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
      sorted.forEach((note) => {
        const card = document.createElement("div");
        card.className = "note-card";
        const header = document.createElement("div");
        header.className = "note-card-header";
        const title = document.createElement("span");
        title.className = "note-card-title";
        title.textContent = note.title || "\u672A\u547D\u540D\u7B14\u8BB0";
        const count = document.createElement("span");
        count.className = "note-card-count";
        count.textContent = `${note.entries.length} \u6761`;
        header.appendChild(title);
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
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm("\u786E\u5B9A\u5220\u9664\u8FD9\u7BC7\u7B14\u8BB0\uFF1F")) {
            notes = notes.filter((n) => n.id !== note.id);
            saveNotes(notes);
            loadAndRenderNotes();
            showNotice("\u7B14\u8BB0\u5DF2\u5220\u9664");
          }
        });
        actions.appendChild(delBtn);
        card.appendChild(actions);
        notesList.appendChild(card);
      });
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
    function renderObsidianConfig() {
      obsidianCfg = loadObsidianConfig();
      obsidianEnabled.checked = obsidianCfg.enabled;
      obsidianPort.value = String(obsidianCfg.apiPort);
      obsidianFolder.value = obsidianCfg.noteFolder;
      obsidianKey.value = obsidianCfg.apiKey;
    }
    function syncObsidianForm() {
      obsidianCfg.enabled = obsidianEnabled.checked;
      obsidianCfg.apiPort = parseInt(obsidianPort.value, 10) || 27124;
      obsidianCfg.noteFolder = obsidianFolder.value.trim() || "snooper-notes";
      obsidianCfg.apiKey = obsidianKey.value.trim();
      saveObsidianConfig(obsidianCfg);
    }
    saveConfigBtn.addEventListener("click", () => {
      syncObsidianForm();
      showNotice("Obsidian \u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
    });
    renderObsidianConfig();
    loadAndRenderNotes();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadAndRenderNotes();
    });
  })();
})();
