(() => {
  // src/lib/utils.ts
  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  }

  // src/ext/sidepanel/panel.ts
  (() => {
    let currentConfig = {
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
    const noticeBanner = document.getElementById("noticeBanner");
    const providersList = document.getElementById("providersList");
    const addProviderBtn = document.getElementById("addProviderBtn");
    const saveConfigBtn = document.getElementById("saveConfigBtn");
    const routeLlmProvider = document.getElementById("route-llm-provider");
    const routeLlmModel = document.getElementById("route-llm-model");
    const routeAudioProvider = document.getElementById("route-audio-provider");
    const routeAudioModel = document.getElementById("route-audio-model");
    const routeVideoProvider = document.getElementById("route-video-provider");
    const routeVideoModel = document.getElementById("route-video-model");
    function showNotice(text, isError = false) {
      if (!noticeBanner) return;
      noticeBanner.textContent = text;
      noticeBanner.className = `notice-banner ${isError ? "error" : "success"}`;
      noticeBanner.hidden = false;
      setTimeout(() => {
        noticeBanner.hidden = true;
      }, 5e3);
    }
    async function loadConfig() {
      try {
        const res = await chrome.runtime.sendMessage({ target: "background", type: "GET_CONFIG" });
        if (res && res.ok && res.config) {
          currentConfig = res.config;
        }
      } catch (err) {
      }
      renderAll();
    }
    function syncFormToConfig() {
      currentConfig.routes.llm.providerId = routeLlmProvider.value;
      currentConfig.routes.llm.model = routeLlmModel.value.trim();
      currentConfig.routes.audio.providerId = routeAudioProvider.value;
      currentConfig.routes.audio.model = routeAudioModel.value.trim();
      currentConfig.routes.video.providerId = routeVideoProvider.value;
      currentConfig.routes.video.model = routeVideoModel.value.trim();
      const cards = providersList.querySelectorAll(".provider-card");
      cards.forEach((card, idx) => {
        const id = card.getAttribute("data-id");
        const provider = currentConfig.providers.find((p) => p.id === id);
        if (!provider) return;
        const nameInput = card.querySelector(".provider-name");
        const urlInput = card.querySelector(".provider-url");
        const keyInput = card.querySelector(".provider-key");
        const protocolSelect = card.querySelector(".provider-protocol");
        const noteInput = card.querySelector(".provider-note");
        if (nameInput) provider.name = nameInput.value.trim();
        if (urlInput) provider.baseUrl = urlInput.value.trim();
        if (keyInput) provider.apiKey = keyInput.value.trim();
        if (protocolSelect) provider.protocol = protocolSelect.value;
        if (noteInput) provider.note = noteInput.value.trim();
      });
    }
    function renderRoutes() {
      const providers = currentConfig.providers || [];
      const populateSelect = (selectEl, selectedId) => {
        selectEl.textContent = "";
        if (providers.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "\u6682\u65E0\u53EF\u7528\u670D\u52A1\u5546";
          selectEl.appendChild(opt);
          return;
        }
        providers.forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name || "\u672A\u547D\u540D\u670D\u52A1\u5546";
          if (p.id === selectedId) opt.selected = true;
          selectEl.appendChild(opt);
        });
      };
      populateSelect(routeLlmProvider, currentConfig.routes.llm.providerId);
      routeLlmModel.value = currentConfig.routes.llm.model || "";
      populateSelect(routeAudioProvider, currentConfig.routes.audio.providerId);
      routeAudioModel.value = currentConfig.routes.audio.model || "";
      populateSelect(routeVideoProvider, currentConfig.routes.video.providerId);
      routeVideoModel.value = currentConfig.routes.video.model || "";
    }
    function renderProviders() {
      providersList.textContent = "";
      const providers = currentConfig.providers || [];
      providers.forEach((p, index) => {
        const card = document.createElement("div");
        card.className = "provider-card";
        card.setAttribute("data-id", p.id);
        const header = document.createElement("div");
        header.className = "provider-card-header";
        const titleWrap = document.createElement("div");
        titleWrap.className = "provider-title-wrap";
        const idxSpan = document.createElement("span");
        idxSpan.className = "provider-index";
        idxSpan.textContent = `#${index + 1}`;
        const nameDisplay = document.createElement("strong");
        nameDisplay.style.fontSize = "13px";
        nameDisplay.textContent = p.name || "\u65B0\u670D\u52A1\u5546";
        titleWrap.appendChild(idxSpan);
        titleWrap.appendChild(nameDisplay);
        header.appendChild(titleWrap);
        if (providers.length > 1) {
          const deleteBtn = document.createElement("button");
          deleteBtn.type = "button";
          deleteBtn.className = "btn-danger-ghost";
          deleteBtn.title = "\u5220\u9664\u6B64\u670D\u52A1\u5546";
          deleteBtn.setAttribute("aria-label", `\u5220\u9664\u670D\u52A1\u5546 ${p.name}`);
          deleteBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `;
          deleteBtn.addEventListener("click", () => {
            syncFormToConfig();
            currentConfig.providers = currentConfig.providers.filter((item) => item.id !== p.id);
            ["llm", "audio", "video"].forEach((k) => {
              if (!currentConfig.providers.some((item) => item.id === currentConfig.routes[k].providerId)) {
                currentConfig.routes[k].providerId = currentConfig.providers[0].id;
              }
            });
            renderAll();
          });
          header.appendChild(deleteBtn);
        }
        card.appendChild(header);
        const grid = document.createElement("div");
        grid.className = "form-grid";
        const fgName = document.createElement("div");
        fgName.className = "field-group";
        fgName.innerHTML = `
        <label class="field-label">\u670D\u52A1\u5546\u540D\u79F0</label>
        <input type="text" class="field-input provider-name" value="${escapeHtml(p.name)}" placeholder="\u4F8B\u5982 MOSS \u5B98\u65B9" spellcheck="false" autocomplete="off">
      `;
        grid.appendChild(fgName);
        const fgProto = document.createElement("div");
        fgProto.className = "field-group";
        fgProto.innerHTML = `
        <label class="field-label">\u534F\u8BAE\u7C7B\u578B</label>
        <select class="field-select provider-protocol">
          <option value="moss" ${p.protocol === "moss" ? "selected" : ""}>MOSS \u539F\u751F</option>
          <option value="openai" ${p.protocol === "openai" ? "selected" : ""}>OpenAI \u517C\u5BB9\u4E2D\u8F6C</option>
        </select>
      `;
        grid.appendChild(fgProto);
        const fgUrl = document.createElement("div");
        fgUrl.className = "field-group full";
        fgUrl.innerHTML = `
        <label class="field-label">Base URL</label>
        <input type="text" class="field-input provider-url" value="${escapeHtml(p.baseUrl)}" placeholder="https://api.mosi.cn/v1" spellcheck="false" autocomplete="off">
      `;
        grid.appendChild(fgUrl);
        const fgKey = document.createElement("div");
        fgKey.className = "field-group full";
        const keyWrapId = `pw_${p.id}`;
        fgKey.innerHTML = `
        <label class="field-label">API Key (\u5BC6\u94A5)</label>
        <div class="password-wrap">
          <input id="${keyWrapId}" type="password" class="field-input provider-key" value="${escapeHtml(p.apiKey)}" placeholder="sk-..." spellcheck="false" autocomplete="off">
          <button type="button" class="toggle-pw-btn" title="\u663E\u793A/\u9690\u85CF\u5BC6\u94A5" aria-label="\u663E\u793A\u6216\u9690\u85CFAPI Key">
            <svg class="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
        </div>
      `;
        grid.appendChild(fgKey);
        const toggleBtn = fgKey.querySelector(".toggle-pw-btn");
        const keyInput = fgKey.querySelector(".provider-key");
        toggleBtn.addEventListener("click", () => {
          if (keyInput.type === "password") {
            keyInput.type = "text";
            toggleBtn.title = "\u9690\u85CF\u5BC6\u94A5";
          } else {
            keyInput.type = "password";
            toggleBtn.title = "\u663E\u793A\u5BC6\u94A5";
          }
        });
        const fgNote = document.createElement("div");
        fgNote.className = "field-group full";
        fgNote.innerHTML = `
        <label class="field-label">\u5907\u6CE8\u8BF4\u660E (\u53EF\u9009)</label>
        <input type="text" class="field-input provider-note" value="${escapeHtml(p.note || "")}" placeholder="\u4F8B\u5982 \u5907\u7528\u4E2D\u8F6C\u8D26\u53F7" spellcheck="false" autocomplete="off">
      `;
        grid.appendChild(fgNote);
        card.appendChild(grid);
        providersList.appendChild(card);
      });
    }
    function escapeHtml(str) {
      return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    function renderAll() {
      renderProviders();
      renderRoutes();
    }
    addProviderBtn.addEventListener("click", () => {
      syncFormToConfig();
      const newP = {
        id: uid("prov"),
        name: `\u670D\u52A1\u5546 ${currentConfig.providers.length + 1}`,
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        protocol: "openai",
        note: "",
        models: [],
        lastSyncedAt: null,
        status: "unknown",
        lastError: ""
      };
      currentConfig.providers.push(newP);
      renderAll();
    });
    saveConfigBtn.addEventListener("click", async () => {
      syncFormToConfig();
      const originsMap = /* @__PURE__ */ new Set();
      for (const p of currentConfig.providers) {
        const urlStr = p.baseUrl.trim();
        if (!urlStr) continue;
        try {
          const parsed = new URL(urlStr);
          if (parsed.protocol === "https:" || parsed.protocol === "http:") {
            originsMap.add(`${parsed.origin}/*`);
          }
        } catch (e) {
        }
      }
      const origins = Array.from(originsMap);
      if (origins.length === 0) {
        showNotice("\u8BF7\u81F3\u5C11\u914D\u7F6E\u4E00\u4E2A\u6709\u6548\u7684\u670D\u52A1\u5546 Base URL (http/https)", true);
        return;
      }
      try {
        const granted = await chrome.permissions.request({ origins });
        if (!granted) {
          showNotice(`\u5DF2\u53D6\u6D88\u6216\u62D2\u7EDD\u6388\u6743\u7F51\u7EDC\u8BBF\u95EE\u6743\u9650 (${origins.join(", ")})\u3002\u914D\u7F6E\u672A\u4FDD\u5B58\u3002`, true);
          return;
        }
      } catch (permErr) {
        console.warn("chrome.permissions.request warning:", permErr);
      }
      try {
        const res = await chrome.runtime.sendMessage({
          target: "background",
          type: "SAVE_CONFIG",
          config: currentConfig
        });
        if (res && res.ok) {
          showNotice("\u914D\u7F6E\u5DF2\u6210\u529F\u4FDD\u5B58\u5E76\u540C\u6B65\u81F3\u6269\u5C55\u540E\u53F0\u3002");
        } else {
          showNotice("\u4FDD\u5B58\u5931\u8D25: " + (res?.error || "\u672A\u77E5\u9519\u8BEF"), true);
        }
      } catch (err) {
        showNotice("\u901A\u4FE1\u9519\u8BEF: " + err.message, true);
      }
    });
    loadConfig();
  })();
})();
