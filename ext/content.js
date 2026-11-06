(() => {
  // src/ext/content.ts
  var NOTES_STORAGE_KEY = "snooper.notes.v1";
  async function loadNotes() {
    try {
      const got = await chrome.storage.local.get(NOTES_STORAGE_KEY);
      const stored = got?.[NOTES_STORAGE_KEY];
      if (Array.isArray(stored)) return stored;
    } catch {
    }
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          try {
            await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: parsed });
          } catch {
          }
          return parsed;
        }
      }
    } catch {
    }
    return [];
  }
  async function saveNotes(notes) {
    try {
      await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes });
    } catch {
    }
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    } catch {
    }
  }
  function createNoteDocument(title, source) {
    const now = Date.now();
    return {
      id: `note_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      createdAt: now,
      updatedAt: now,
      entries: [],
      sessionInfo: source
    };
  }
  var DEMO_SUBTITLES = [
    { source: "Welcome to snooper-browser", target: "\u6B22\u8FCE\u4F7F\u7528 snooper-browser", delay: 2e3 },
    { source: "This is a real-time translation demo", target: "\u8FD9\u662F\u4E00\u4E2A\u5B9E\u65F6\u7FFB\u8BD1\u6F14\u793A", delay: 2500 },
    { source: "You can also take notes and generate images", target: "\u4F60\u53EF\u4EE5\u8BB0\u7B14\u8BB0\u548C\u751F\u6210\u56FE\u7247", delay: 3e3 },
    { source: "Click the record button to start real transcription", target: "\u70B9\u51FB\u5F55\u97F3\u6309\u94AE\u5F00\u59CB\u771F\u5B9E\u8F6C\u5199", delay: 2800 },
    { source: "Configure your API key in the settings panel", target: "\u5728\u8BBE\u7F6E\u9762\u677F\u4E2D\u914D\u7F6E\u4F60\u7684 API \u5BC6\u94A5", delay: 3e3 },
    { source: "Enjoy the seamless multilingual experience", target: "\u4EAB\u53D7\u65E0\u7F1D\u7684\u591A\u8BED\u8A00\u4F53\u9A8C", delay: 2500 }
  ];
  (() => {
    if (window.__rttsContentInstalled) return;
    window.__rttsContentInstalled = true;
    const HOST_ID = "rtts-extension-host";
    let host = document.getElementById(HOST_ID);
    if (host) host.remove();
    host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "closed" });
    const LANGUAGES = [
      { code: "auto", label: "\u81EA\u52A8\u68C0\u6D4B", short: "AUTO" },
      { code: "zh", label: "\u4E2D\u6587", short: "ZH" },
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
    const LANG_MAP = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.label]));
    const LANG_SHORT = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.short]));
    let session = {
      state: "idle",
      sourceLang: "auto",
      targetLang: "zh",
      subtitles: [],
      messages: [],
      notes: [],
      activeNoteId: null,
      isDemoMode: false
    };
    let isDrawerOpen = false;
    let isAskBusy = false;
    let dragState = null;
    let langPickerOpen = false;
    let drawerTab = "chat";
    const UI_HIDDEN_KEY = "snooper.ui-hidden.v1";
    let uiHidden = true;
    let hasBeenShownOnce = false;
    function persistUiHidden() {
      try {
        localStorage.setItem(UI_HIDDEN_KEY, uiHidden ? "1" : "0");
      } catch {
      }
    }
    function applyUiHidden() {
      bar.classList.toggle("hidden", uiHidden);
      showBtn.style.display = uiHidden && hasBeenShownOnce ? "flex" : "none";
      hideBtn.style.display = uiHidden ? "none" : "";
      if (uiHidden) {
        subBox.classList.add("hidden");
        langPicker.classList.remove("open");
        bar.querySelector("#rtts-menu")?.classList.remove("open");
        bar.querySelector("#rtts-more-btn")?.classList.remove("active");
        const more = bar.querySelector("#rtts-more-btn");
        more?.setAttribute("aria-expanded", "false");
      }
    }
    const OBSIDIAN_CONFIG_KEY = "snooper.obsidian-config.v1";
    const DEFAULT_OBSIDIAN_CONFIG = {
      enabled: false,
      apiProtocol: "http",
      apiPort: 27123,
      apiKey: "",
      noteFolder: "snooper-notes"
    };
    function normalizeObsidianConfig(raw) {
      const cfg = raw && typeof raw === "object" ? raw : {};
      const port = Number(cfg.apiPort) || DEFAULT_OBSIDIAN_CONFIG.apiPort;
      const protocol = cfg.apiProtocol === "https" || cfg.apiProtocol === "http" ? cfg.apiProtocol : port === 27124 ? "https" : "http";
      return {
        enabled: !!cfg.enabled,
        apiProtocol: protocol,
        apiPort: port,
        // The Obsidian plugin shows the key as "Bearer <token>"; users copy the
        // whole line. Strip the prefix so callers can safely add their own.
        apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey.trim().replace(/^Bearer\s+/i, "").trim() : "",
        noteFolder: typeof cfg.noteFolder === "string" && cfg.noteFolder.trim() ? cfg.noteFolder.trim() : DEFAULT_OBSIDIAN_CONFIG.noteFolder
      };
    }
    async function loadObsidianConfig() {
      try {
        const got = await chrome.storage.local.get(OBSIDIAN_CONFIG_KEY);
        const stored = got?.[OBSIDIAN_CONFIG_KEY];
        if (stored && typeof stored === "object") return normalizeObsidianConfig(stored);
      } catch {
      }
      try {
        const raw = localStorage.getItem(OBSIDIAN_CONFIG_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const normalized = normalizeObsidianConfig(parsed);
          try {
            await chrome.storage.local.set({ [OBSIDIAN_CONFIG_KEY]: normalized });
          } catch {
          }
          return normalized;
        }
      } catch {
      }
      return { ...DEFAULT_OBSIDIAN_CONFIG };
    }
    async function saveObsidianConfig(config) {
      const normalized = normalizeObsidianConfig(config);
      try {
        await chrome.storage.local.set({ [OBSIDIAN_CONFIG_KEY]: normalized });
      } catch {
      }
      try {
        localStorage.setItem(OBSIDIAN_CONFIG_KEY, JSON.stringify(normalized));
      } catch {
      }
    }
    let demoInterval = null;
    let demoIndex = 0;
    function startDemoSubtitles() {
      if (demoInterval) return;
      session.state = "running";
      render();
      demoInterval = setInterval(() => {
        if (demoIndex >= DEMO_SUBTITLES.length) {
          demoIndex = 0;
        }
        const item = DEMO_SUBTITLES[demoIndex];
        const now = Date.now();
        session.subtitles.push({
          id: `demo_${now}`,
          at: now,
          endedAt: now + 3e3,
          source: item.source,
          target: item.target,
          speaker: "",
          latency: Math.floor(Math.random() * 200 + 50)
        });
        if (session.subtitles.length > 50) session.subtitles = session.subtitles.slice(-40);
        render();
        demoIndex++;
      }, 3e3);
    }
    function stopDemoSubtitles() {
      if (demoInterval) {
        clearInterval(demoInterval);
        demoInterval = null;
      }
      demoIndex = 0;
    }
    const style = document.createElement("style");
    style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Segoe UI", Roboto, sans-serif; color: #f0f2f5; z-index: 2147483647; }

    /* === Draggable Horizontal Toolbar === */
    #rtts-bar {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 3px;
      padding: 6px 8px;
      background: linear-gradient(180deg, rgba(20,20,32,0.46), rgba(10,10,17,0.34));
      backdrop-filter: blur(14px) saturate(160%);
      -webkit-backdrop-filter: blur(14px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      box-shadow: 0 10px 34px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.06);
      z-index: 2147483640;
      width: max-content;
      max-width: calc(100vw - 20px);
      transition: opacity 0.2s ease, background 0.2s ease;
      user-select: none;
    }
    #rtts-bar:hover {
      background: linear-gradient(180deg, rgba(22,22,36,0.58), rgba(10,10,17,0.44));
    }
    #rtts-bar.hidden { opacity: 0; pointer-events: none; }
    #rtts-bar.dragging { transition: none; }

    .rtts-bar-grip {
      width: 16px; height: 30px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      border-radius: 7px; color: rgba(255,255,255,0.28);
      cursor: grab; touch-action: none;
      -webkit-tap-highlight-color: transparent;
    }
    .rtts-bar-grip:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.62); }
    .rtts-bar-grip:active { cursor: grabbing; }
    .rtts-bar-grip svg { width: 10px; height: 16px; fill: currentColor; stroke: none; }

    .rtts-btn {
      position: relative;
      width: 34px; height: 34px; border-radius: 10px;
      border: none; background: transparent;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s ease, color 0.15s ease, transform 0.06s ease;
      flex-shrink: 0;
      color: rgba(255,255,255,0.72);
      -webkit-tap-highlight-color: transparent;
    }
    .rtts-btn:hover { background: rgba(255,255,255,0.09); color: #fff; }
    .rtts-btn:active { transform: scale(0.96); }
    .rtts-btn svg { width: 17px; height: 17px; stroke: currentColor; stroke-width: 1.8; fill: none; }
    .rtts-btn.active { background: rgba(124,92,255,0.22); color: #c9bcff; }
    .rtts-btn.success { background: rgba(62,230,213,0.16); color: #9ff5ea; }

    /* Tooltip: below by default, flips above when the bar is in the lower half */
    #rtts-bar .rtts-btn::after {
      content: attr(data-tip);
      position: absolute; top: calc(100% + 8px); left: 50%; z-index: 2;
      padding: 5px 9px; border-radius: 7px;
      background: rgba(12,12,20,0.96); border: 1px solid rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.86); font-size: 11px; line-height: 1; white-space: nowrap;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      pointer-events: none; opacity: 0;
      transform: translateX(-50%) translateY(-4px);
      transition: opacity 0.14s ease, transform 0.14s ease;
    }
    #rtts-bar.tips-up .rtts-btn::after {
      top: auto; bottom: calc(100% + 8px);
      transform: translateX(-50%) translateY(4px);
    }
    #rtts-bar .rtts-btn:hover::after,
    #rtts-bar .rtts-btn:focus-visible::after {
      opacity: 1; transform: translateX(-50%) translateY(0);
    }
    #rtts-show-btn::after {
      top: 50%; left: auto; right: calc(100% + 10px);
      transform: translateY(-50%) translateX(4px);
    }
    #rtts-show-btn:hover::after,
    #rtts-show-btn:focus-visible::after {
      opacity: 1; transform: translateY(-50%) translateX(0);
    }

    #rtts-record {
      background: rgba(124,92,255,0.16);
      border: 1px solid rgba(124,92,255,0.35);
    }
    #rtts-record.running {
      background: #e5484d; border-color: #ff8b8f;
      box-shadow: 0 0 14px rgba(229,72,77,0.55);
      animation: pulse 1.4s infinite;
    }
    #rtts-record .dot { width: 9px; height: 9px; border-radius: 50%; background: #c9bcff; }
    #rtts-record.running .dot { background: #fff; border-radius: 2px; }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(229,72,77,0.6); }
      70% { box-shadow: 0 0 0 10px rgba(229,72,77,0); }
      100% { box-shadow: 0 0 0 0 rgba(229,72,77,0); }
    }

    .rtts-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.1); flex-shrink: 0; margin: 0 2px; }

    #rtts-show-btn {
      position: fixed; top: 16px; right: 16px;
      z-index: 2147483641;
      width: auto; height: 32px; padding: 0 13px 0 9px; gap: 6px;
      border-radius: 999px;
      background: rgba(14,14,24,0.72);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      display: flex; align-items: center;
      font-size: 12px; color: rgba(255,255,255,0.84);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    #rtts-show-btn:hover { background: rgba(24,24,38,0.86); color: #fff; }
    #rtts-show-btn svg { width: 15px; height: 15px; }
    #rtts-show-btn .rtts-show-label { line-height: 1; white-space: nowrap; }

    /* === Labeled primary controls (Viitor-style clarity) === */
    .rtts-btn-labeled {
      width: auto; gap: 6px; padding: 0 10px;
      font-size: 11.5px; font-weight: 500;
      color: rgba(255,255,255,0.7);
    }
    .rtts-btn-labeled span { line-height: 1; white-space: nowrap; }
    .rtts-btn-labeled svg { width: 15px; height: 15px; }

    #rtts-record.rtts-record-btn {
      width: auto; gap: 8px; padding: 0 13px;
      font-size: 12px; font-weight: 600;
      color: #ded5ff;
    }
    #rtts-record.rtts-record-btn.running { color: #fff; }
    #rtts-record .rtts-btn-label { line-height: 1; white-space: nowrap; }

    #rtts-lang-btn.rtts-lang-chip {
      width: auto; gap: 6px; padding: 0 10px;
      font-size: 10.5px; font-weight: 600; letter-spacing: 0.03em;
      color: rgba(255,255,255,0.6);
    }
    #rtts-lang-btn.rtts-lang-chip:hover { color: #fff; }
    #rtts-lang-label { line-height: 1; white-space: nowrap; }

    /* The hidden attribute must win over display:inline-flex below. */
    .rtts-badge[hidden] { display: none; }
    .rtts-badge {
      min-width: 15px; height: 15px; padding: 0 4px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px;
      background: rgba(124,92,255,0.85); color: #fff;
      font-size: 9px; font-weight: 700; line-height: 1;
      font-variant-numeric: tabular-nums;
    }

    /* === Tools menu (replaces 10 cryptic icon buttons) === */
    #rtts-more-btn.active { background: rgba(124,92,255,0.22); color: #c9bcff; }
    #rtts-menu {
      position: absolute; top: calc(100% + 8px); right: 0;
      width: 248px; max-height: 70vh; overflow-y: auto;
      padding: 6px;
      background: rgba(16,16,26,0.97);
      backdrop-filter: blur(20px) saturate(160%);
      -webkit-backdrop-filter: blur(20px) saturate(160%);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.6);
      z-index: 2147483642;
      opacity: 0; visibility: hidden; transform: translateY(-6px) scale(0.98);
      transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.14) transparent;
    }
    #rtts-menu.open { opacity: 1; visibility: visible; transform: none; }
    #rtts-menu::-webkit-scrollbar { width: 4px; }
    #rtts-menu::-webkit-scrollbar-thumb { border-radius: 2px; background: rgba(255,255,255,0.16); }

    .rtts-menu-head {
      padding: 7px 9px 4px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.34);
    }
    .rtts-menu-sep {
      height: 1px; margin: 5px 7px;
      background: rgba(255,255,255,0.08);
    }
    .rtts-menu-item {
      width: 100%; display: flex; align-items: center; gap: 10px;
      padding: 8px 9px; border: none; border-radius: 8px;
      background: none; color: rgba(255,255,255,0.86);
      font-family: inherit; text-align: left; cursor: pointer;
      transition: background 0.13s ease;
    }
    .rtts-menu-item:hover,
    .rtts-menu-item:focus-visible { background: rgba(255,255,255,0.08); outline: none; }
    .rtts-menu-icon {
      width: 28px; height: 28px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px;
      background: rgba(124,92,255,0.14);
      color: #c3b6ff;
    }
    .rtts-menu-icon svg {
      width: 15px; height: 15px;
      fill: none; stroke: currentColor;
      stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round;
    }
    .rtts-menu-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .rtts-menu-text b { font-size: 12px; font-weight: 500; line-height: 1.2; }
    .rtts-menu-text small {
      font-size: 10px; line-height: 1.2;
      color: rgba(255,255,255,0.4);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rtts-menu-item-danger:hover { background: rgba(239,68,68,0.14); }
    .rtts-menu-item-danger .rtts-menu-icon {
      background: rgba(239,68,68,0.14); color: #ff9a9d;
    }
    .rtts-menu-item-danger:hover .rtts-menu-text b { color: #ffb4b7; }

    /* === Language Picker === */
    #rtts-lang-btn { border-radius: 10px; }

    #rtts-lang-picker {
      position: fixed; top: 50%; left: 64px; transform: translateY(-50%);
      background: rgba(16,16,26,0.94); backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 14px; padding: 14px 16px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.62);
      z-index: 2147483642;
      display: none; flex-direction: column; gap: 10px;
      width: 300px; max-width: calc(100vw - 88px);
      max-height: 74vh; overflow-y: auto;
    }
    #rtts-lang-picker.open { display: flex; }
    #rtts-lang-picker h4 { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.5px; }
    .lang-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .lang-opt {
      font-size: 12px; padding: 3px 10px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.6); cursor: pointer; transition: all 0.15s;
    }
    .lang-opt:hover { background: rgba(255,255,255,0.1); color: #fff; }
    .lang-opt.active { background: rgba(124,92,255,0.25); border-color: #7c5cff; color: #fff; }

    /* === Subtitle Overlay (translucent, video-first) === */
    #rtts-sub-box {
      position: fixed;
      left: 50%; transform: translateX(-50%);
      bottom: 26px;
      width: min(72vw, 840px);
      max-height: 32vh;
      padding: 10px 18px 8px;
      background: linear-gradient(180deg, rgba(6,6,14,0.58), rgba(6,6,12,0.44));
      backdrop-filter: blur(10px) saturate(140%);
      -webkit-backdrop-filter: blur(10px) saturate(140%);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.28);
      text-align: center;
      z-index: 2147483630;
      pointer-events: none;
      transition: opacity 0.25s, transform 0.25s, background 0.2s;
      display: flex; flex-direction: column;
      min-width: 220px; min-height: 72px;
    }
    #rtts-sub-box.hidden { opacity: 0; pointer-events: none; transform: translateX(-50%) translateY(8px); }
    #rtts-sub-box:not(.hidden) { transform: translateX(-50%) translateY(0); }
    #rtts-sub-handle {
      position: absolute; top: 0; left: 0; right: 0;
      height: 20px; cursor: grab;
      pointer-events: auto;
      border-radius: 12px 12px 0 0;
      display: flex; align-items: center; justify-content: center;
      z-index: 1;
    }
    #rtts-sub-handle:active { cursor: grabbing; }
    #rtts-sub-handle::after {
      content: ''; width: 24px; height: 2px;
      background: rgba(255,255,255,0.12); border-radius: 2px;
    }
    #rtts-sub-handle:hover::after { background: rgba(255,255,255,0.3); }
    #rtts-sub-scroll {
      overflow-y: auto; flex: 1;
      pointer-events: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
      padding: 4px 0;
      min-height: 0;
    }
    #rtts-sub-scroll::-webkit-scrollbar { width: 4px; }
    #rtts-sub-scroll::-webkit-scrollbar-thumb { border-radius: 2px; background: rgba(255,255,255,0.15); }
    #rtts-sub-resize {
      position: absolute; right: 2px; bottom: 2px;
      width: 18px; height: 18px; z-index: 2;
      cursor: nwse-resize; pointer-events: auto; touch-action: none;
      border-radius: 0 0 12px 0;
    }
    #rtts-sub-resize::after {
      content: ''; position: absolute; right: 4px; bottom: 4px;
      width: 8px; height: 8px;
      border-right: 2px solid rgba(255,255,255,0.42);
      border-bottom: 2px solid rgba(255,255,255,0.42);
    }
    #rtts-sub-resize:hover::after { border-color: rgba(255,255,255,0.85); }
    #rtts-sub-box.compact { height: 56px !important; min-height: 56px; padding-top: 16px; padding-bottom: 6px; }
    #rtts-sub-box.compact #rtts-sub-scroll { overflow: hidden; }
    #rtts-sub-box.compact .sub-row.history:not(.current) { display: none; }
    #rtts-sub-box.compact .sub-row.current,
    #rtts-sub-box.compact #rtts-streaming-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #rtts-sub-box.compact .sub-source,
    #rtts-sub-box.compact .stream-label { display: none !important; }
    #rtts-sub-box.compact #rtts-sub-status { margin-top: 1px; font-size: 9px; }

    .sub-row {
      transition: opacity 0.25s, font-size 0.25s;
    }
    .sub-row.current {
      font-size: 16px; font-weight: 500; color: rgba(255,255,255,0.97); line-height: 1.5;
      text-shadow: 0 1px 3px rgba(0,0,0,0.85);
      padding: 3px 0;
    }
    .sub-row.current .sub-source {
      font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.74); display: block;
      margin-top: 3px; line-height: 1.45;
    }
    .sub-row.history {
      font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.8); line-height: 1.4;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      padding: 2px 0;
    }
    .sub-row.history .sub-source {
      display: block; font-size: 11.5px; color: rgba(255,255,255,0.52);
      margin-top: 1px; line-height: 1.35;
    }

    /* === Streaming Subtitle (live, in-progress) === */
    #rtts-streaming-row {
      font-size: 16px; font-weight: 500; color: rgba(255,255,255,0.97); line-height: 1.45;
      text-shadow: 0 1px 3px rgba(0,0,0,0.85);
      position: relative;
      min-height: 1.45em;
    }
    #rtts-streaming-row .sub-source {
      font-size: 12.5px; font-weight: 400; color: rgba(255,255,255,0.68);
      display: block; margin-top: 2px;
    }
    #rtts-streaming-row .stream-cursor {
      display: inline-block;
      width: 2px; height: 1em;
      background: #7c5cff;
      margin-left: 2px;
      vertical-align: text-bottom;
      animation: blink 0.8s step-end infinite;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    #rtts-streaming-row.hidden { display: none; }
    #rtts-streaming-row .stream-label {
      font-size: 10px; color: rgba(124,92,255,0.5);
      position: absolute; right: 12px; bottom: 4px;
      font-weight: 400;
    }

    #rtts-sub-placeholder {
      font-size: 12px; color: rgba(255,255,255,0.45); text-shadow: 0 1px 6px rgba(0,0,0,0.7);
      padding: 4px 0;
      flex-shrink: 0;
    }
    /* Shown while the capture is alive but nothing above the gate arrives \u2014
       without it, a paused video looks identical to a frozen extension. */
    #rtts-sub-status {
      flex-shrink: 0;
      margin-top: 4px;
      font-size: 10px; letter-spacing: 0.02em;
      color: rgba(255,212,140,0.72);
      text-shadow: 0 1px 6px rgba(0,0,0,0.7);
    }
    #rtts-sub-status.hidden { display: none; }

    /* === Unified side drawer: chat + notes tabs === */
    #rtts-drawer-tabs {
      display: flex; align-items: center; gap: 4px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 9px; padding: 2px;
    }
    .rtts-drawer-tab {
      display: flex; align-items: center; gap: 5px;
      border: none; background: none; color: rgba(255,255,255,0.5);
      font-size: 12px; font-weight: 500;
      padding: 5px 10px; border-radius: 7px; cursor: pointer;
      transition: background 0.15s, color 0.15s;
      white-space: nowrap;
    }
    .rtts-drawer-tab svg {
      width: 13px; height: 13px;
      fill: none; stroke: currentColor;
      stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }
    .rtts-drawer-tab:hover { color: rgba(255,255,255,0.8); }
    .rtts-drawer-tab.active { background: rgba(124,92,255,0.3); color: #fff; }
    #rtts-notes-count {
      font-size: 10px; background: rgba(255,255,255,0.12);
      padding: 0 5px; border-radius: 8px; line-height: 16px;
      color: rgba(255,255,255,0.65);
    }
    .rtts-pane { display: none; flex: 1; min-height: 0; flex-direction: column; }
    .rtts-pane.active { display: flex; }
    #rtts-pane-notes { padding: 12px; gap: 10px; }
    #rtts-notes-list {
      flex: 1; overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    #rtts-notes-list::-webkit-scrollbar { width: 4px; }
    #rtts-notes-list::-webkit-scrollbar-thumb { border-radius: 2px; background: rgba(255,255,255,0.15); }
    #rtts-notes-empty {
      font-size: 12px; color: rgba(255,255,255,0.35);
      text-align: center; padding: 28px 8px;
    }
    .note-item {
      display: flex; align-items: flex-start; gap: 4px;
      padding: 4px 4px; border-radius: 4px;
      font-size: 11px; color: rgba(255,255,255,0.6);
      line-height: 1.4;
    }
    .note-item:hover { background: rgba(255,255,255,0.04); }
    .note-item .note-text { flex: 1; min-width: 0; }
    .note-item .note-text.truncated { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Markdown notes: keep the rendered formatting, clamp to four lines. */
    .note-item .note-text.note-md {
      white-space: normal; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
      color: rgba(255,255,255,0.72);
    }
    .note-item .note-text.note-md strong { color: #fff; font-weight: 600; }
    .note-item .note-text.note-md em { color: rgba(255,255,255,0.85); }
    .note-item .note-text.note-md code {
      background: rgba(255,255,255,0.1); border-radius: 3px;
      padding: 0 3px; font-size: 10.5px;
    }
    .note-item .note-text.note-md pre {
      margin: 3px 0; padding: 4px 5px; border-radius: 4px;
      background: rgba(0,0,0,0.3); overflow-x: auto;
    }
    .note-item .note-text.note-md pre code { background: none; padding: 0; }
    .note-item .note-text.note-md a { color: #a5b4fc; }
    .note-item .note-type {
      font-size: 9px; color: rgba(255,255,255,0.25);
      flex-shrink: 0; margin-top: 1px;
    }
    .note-item .note-del {
      background: none; border: none; color: rgba(255,255,255,0.2);
      cursor: pointer; font-size: 10px; padding: 0 2px;
      flex-shrink: 0;
    }
    .note-item .note-del:hover { color: #ef4444; }
    /* === Shared Markdown editor shell (chat + notes) === */
    .rtts-md-shell {
      display: flex; flex-direction: column;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 11px;
      background: rgba(255,255,255,0.05);
      overflow: hidden;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .rtts-md-shell:focus-within {
      border-color: rgba(124,92,255,0.65);
      box-shadow: 0 0 0 3px rgba(124,92,255,0.12);
    }
    .rtts-md-toolbar {
      display: flex; align-items: center; gap: 2px;
      padding: 4px 5px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .rtts-md-toolbar button {
      height: 22px; min-width: 25px; padding: 0 6px;
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      border: 1px solid transparent; border-radius: 6px;
      background: none; color: rgba(255,255,255,0.45);
      font-size: 11px; cursor: pointer;
    }
    .rtts-md-toolbar button:hover { background: rgba(255,255,255,0.07); color: #fff; }
    .rtts-md-toolbar button.active { background: rgba(124,92,255,0.25); color: #fff; }
    .rtts-md-toolbar button b, .rtts-md-toolbar button i { font-size: 12px; }
    .rtts-md-toolbar button svg {
      width: 13px; height: 13px;
      fill: none; stroke: currentColor; stroke-width: 1.8;
      stroke-linecap: round; stroke-linejoin: round;
    }
    .rtts-md-toolbar .rtts-md-tail { margin-left: auto; }
    #rtts-cite-btn { color: rgba(160,196,255,0.72); }
    #rtts-cite-btn:hover { color: #fff; }

    /* Attach + input + send share one row. */
    #rtts-chat-input-row,
    #rtts-notes-row {
      display: flex; align-items: flex-end; gap: 6px;
      padding: 6px 7px;
    }
    #rtts-chat-editor,
    #rtts-notes-editor {
      flex: 1; min-width: 0;
      min-height: 26px; max-height: 120px; overflow-y: auto;
      padding: 4px 2px;
      color: #fff; font-size: 13px; line-height: 1.5;
      white-space: pre-wrap; word-break: break-word;
      outline: none;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.14) transparent;
    }
    #rtts-chat-editor::-webkit-scrollbar,
    #rtts-notes-editor::-webkit-scrollbar { width: 4px; }
    #rtts-chat-editor::-webkit-scrollbar-thumb,
    #rtts-notes-editor::-webkit-scrollbar-thumb { border-radius: 2px; background: rgba(255,255,255,0.16); }
    #rtts-chat-editor:empty::before,
    #rtts-notes-editor:empty::before {
      content: attr(data-placeholder);
      color: rgba(255,255,255,0.3);
      pointer-events: none;
    }
    #rtts-chat-editor code,
    #rtts-notes-editor code {
      background: rgba(255,255,255,0.1); border-radius: 3px;
      padding: 0 3px; font-size: 12px;
    }
    .rtts-md-preview {
      flex: 1; min-width: 0;
      min-height: 26px; max-height: 120px; overflow-y: auto;
      padding: 4px 2px;
      color: rgba(255,255,255,0.88); font-size: 13px; line-height: 1.55;
    }
    .rtts-md-preview pre {
      margin: 6px 0; padding: 8px; border-radius: 6px;
      background: rgba(0,0,0,0.35); overflow-x: auto;
    }
    .rtts-md-preview code {
      background: rgba(255,255,255,0.1); border-radius: 3px;
      padding: 0 3px; font-size: 12px;
    }
    .rtts-md-preview pre code { background: none; padding: 0; }
    .rtts-md-preview a { color: #a5b4fc; }
    .rtts-md-empty { color: rgba(255,255,255,0.35); }

    /* === Cite popover (reference note screenshots from chat) === */
    .rtts-cite-popover {
      position: absolute; left: 12px; right: 12px; bottom: 96px;
      max-height: 46vh; overflow-y: auto;
      padding: 8px;
      background: rgba(18,18,28,0.98);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      box-shadow: 0 18px 44px rgba(0,0,0,0.6);
      z-index: 2147483646;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.16) transparent;
    }
    .rtts-cite-popover[hidden] { display: none; }
    .rtts-cite-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 2px 4px 8px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
      color: rgba(255,255,255,0.55);
    }
    .rtts-cite-head button {
      border: none; background: none; color: rgba(255,255,255,0.4);
      font-size: 12px; cursor: pointer; padding: 2px 4px;
    }
    .rtts-cite-head button:hover { color: #fff; }
    .rtts-cite-list {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
    }
    .rtts-cite-item {
      position: relative;
      padding: 0; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.04);
      cursor: pointer; aspect-ratio: 16 / 10;
    }
    .rtts-cite-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .rtts-cite-item span {
      position: absolute; left: 0; right: 0; bottom: 0;
      padding: 3px 5px; font-size: 9px; text-align: left;
      color: rgba(255,255,255,0.85);
      background: linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.75));
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rtts-cite-item:hover { border-color: rgba(124,92,255,0.7); }
    .rtts-cite-item.used { opacity: 0.45; }
    .rtts-cite-empty {
      padding: 14px 8px; text-align: center;
      font-size: 11px; line-height: 1.6; color: rgba(255,255,255,0.4);
    }
    .rtts-cite-empty[hidden] { display: none; }

    .rtts-msg code {
      background: rgba(255,255,255,0.1); border-radius: 3px;
      padding: 0 3px; font-size: 12px;
    }
    .rtts-msg pre {
      margin: 6px 0; padding: 8px; border-radius: 6px;
      background: rgba(0,0,0,0.35); overflow-x: auto;
      white-space: pre-wrap; word-break: break-word;
    }
    .rtts-msg pre code { background: none; padding: 0; }
    .rtts-msg a { color: #a5b4fc; }

    /* === Q&A Drawer === */
    #rtts-drawer {
      position: fixed; top: 0; right: -380px;
      width: 370px; height: 100vh;
      background: rgba(14,14,22,0.92); backdrop-filter: blur(28px);
      border-left: 1px solid rgba(255,255,255,0.1);
      box-shadow: -12px 0 40px rgba(0,0,0,0.5);
      z-index: 2147483645;
      display: flex; flex-direction: column;
      transition: right 0.25s cubic-bezier(0.16,1,0.3,1);
    }
    #rtts-drawer.open { right: 0; }
    #rtts-drawer-header {
      padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex; align-items: center; justify-content: space-between;
    }
    #rtts-drawer-header h3 { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    #rtts-drawer-close { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 18px; padding: 4px; }
    #rtts-chat {
      flex: 1; overflow-y: auto; padding: 12px 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .rtts-msg {
      padding: 8px 12px; border-radius: 10px;
      font-size: 13px; line-height: 1.45; max-width: 88%; word-break: break-word;
    }
    .rtts-msg.user { background: rgba(124,92,255,0.25); border: 1px solid rgba(124,92,255,0.35); align-self: flex-end; color: #fff; }
    .rtts-msg.assistant { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); align-self: flex-start; color: rgba(255,255,255,0.85); }
    .rtts-msg.error { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5; }
    .rtts-msg .rtts-msg-images {
      display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px;
    }
    .rtts-msg .rtts-msg-images img {
      width: 72px; height: 72px; object-fit: cover; border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.14); cursor: zoom-in; display: block;
    }
    #rtts-chat-composer {
      position: relative;
      padding: 10px 12px 12px; border-top: 1px solid rgba(255,255,255,0.06);
      display: flex; flex-direction: column; gap: 8px;
    }
    #rtts-chat-attachments {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    #rtts-chat-attachments:empty { display: none; }
    .rtts-attach {
      position: relative; width: 54px; height: 54px; border-radius: 8px;
      overflow: hidden; border: 1px solid rgba(255,255,255,0.16);
      background: rgba(255,255,255,0.04);
    }
    .rtts-attach img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .rtts-attach button {
      position: absolute; top: 2px; right: 2px; width: 16px; height: 16px;
      border-radius: 50%; border: none; background: rgba(0,0,0,0.72); color: #fff;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      padding: 0;
    }
    .rtts-attach button svg { width: 9px; height: 9px; stroke: currentColor; stroke-width: 2.5; fill: none; }
    #rtts-chat-attach-btn {
      width: 26px; height: 26px; flex-shrink: 0; border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.6); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 1px;
    }
    #rtts-chat-attach-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
    #rtts-chat-attach-btn svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 1.8; fill: none; }
    #rtts-send, #rtts-notes-add {
      height: 26px; padding: 0 13px; border: none; border-radius: 7px;
      background: #7c5cff; color: #fff; font-weight: 600; font-size: 12px;
      cursor: pointer; flex-shrink: 0; margin-bottom: 1px;
    }
    #rtts-send:hover, #rtts-notes-add:hover { background: #6d4cf0; }
    #rtts-send:disabled { opacity: 0.4; cursor: not-allowed; }
    #rtts-chat-composer.dragover { background: rgba(124,92,255,0.1); }

    /* === Fullscreen hint === */
    #rtts-fs-warn {
      position: fixed; top: 64px; left: 50%; transform: translateX(-50%);
      background: rgba(239,68,68,0.85); color: #fff;
      padding: 6px 14px; border-radius: 6px; font-size: 12px;
      z-index: 2147483645; pointer-events: none;
      max-width: 90%; text-align: center;
    }
    #rtts-fs-warn.hidden { display: none; }

    /* === Refined chrome === */
    .sub-row.current { letter-spacing: -0.005em; }
    #rtts-sub-placeholder { font-size: 11.5px; }

    /* === Notes === */
    .note-item { padding: 7px 8px; border-radius: 8px; }
    .note-item .note-text { font-size: 12px; }
    #rtts-notes-add { height: 26px; }

    /* === Modal shell === */
    .rtts-modal-mask {
      position: fixed; inset: 0; z-index: 2147483646;
      display: none; align-items: center; justify-content: center;
      background: rgba(4,4,10,0.62); backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      padding: 16px;
    }
    .rtts-modal-mask.open { display: flex; }
    .rtts-modal {
      width: min(460px, 94vw); max-height: 88vh; overflow: hidden;
      display: flex; flex-direction: column;
      background: linear-gradient(180deg, rgba(22,22,34,0.98), rgba(12,12,19,0.98));
      border: 1px solid rgba(255,255,255,0.11); border-radius: 16px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06);
      color: #f0f2f5;
    }
    .rtts-modal-header {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .rtts-modal-icon {
      width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(124,92,255,0.16); color: #c9bcff;
      border: 1px solid rgba(124,92,255,0.25);
    }
    .rtts-modal-icon svg { width: 15px; height: 15px; }
    .rtts-modal-header h3 { font-size: 14px; font-weight: 600; }
    .rtts-modal-header .sub { font-size: 10.5px; color: rgba(255,255,255,0.35); margin-top: 2px; }
    .rtts-modal-close {
      margin-left: auto; width: 28px; height: 28px; border-radius: 8px;
      border: none; background: transparent; color: rgba(255,255,255,0.45);
      cursor: pointer; font-size: 16px; line-height: 1;
    }
    .rtts-modal-close:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .rtts-modal-body {
      padding: 14px 16px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 12px;
    }
    .rtts-field { display: flex; flex-direction: column; gap: 5px; }
    .rtts-field > label {
      font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
      color: rgba(255,255,255,0.4); font-weight: 600;
    }
    .rtts-field input, .rtts-field textarea, .rtts-field select {
      width: 100%; border-radius: 9px; border: 1px solid rgba(255,255,255,0.1);
      background: rgba(0,0,0,0.3); padding: 0 10px; color: #fff; font-size: 12px;
      outline: none; font-family: inherit;
    }
    .rtts-field input, .rtts-field select { height: 34px; }
    .rtts-field textarea { padding: 8px 10px; resize: vertical; min-height: 78px; line-height: 1.5; }
    .rtts-field input:focus, .rtts-field textarea:focus {
      border-color: rgba(156,133,255,0.6); background: rgba(255,255,255,0.05);
    }
    .rtts-field .hint { font-size: 10px; color: rgba(255,255,255,0.3); }
    .rtts-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .rtts-section-title {
      display: flex; align-items: center; gap: 8px;
      margin-top: 4px; padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,0.07);
      font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase; color: rgba(255,255,255,0.45);
    }
    .rtts-inline-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rtts-inline-actions .rtts-status { flex: 1; min-width: 160px; margin: 0; }
    .rtts-shot-panel { width: min(760px, 94vw); }
    .rtts-shot-body { padding: 12px; align-items: center; }
    .rtts-shot-body img {
      display: block; max-width: 100%; max-height: 64vh; object-fit: contain;
      border-radius: 10px; background: #000;
    }
    .rtts-pw-wrap { position: relative; }
    .rtts-pw-wrap input { padding-right: 34px; }
    .rtts-pw-wrap button {
      position: absolute; right: 4px; top: 4px; width: 26px; height: 26px;
      border-radius: 7px; border: none; background: transparent;
      color: rgba(255,255,255,0.45); cursor: pointer; font-size: 13px;
    }
    .rtts-pw-wrap button:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .rtts-modal-footer {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.07);
    }
    .rtts-btn-primary, .rtts-btn-ghost {
      height: 32px; padding: 0 12px; border-radius: 9px; font-size: 12px;
      font-weight: 500; cursor: pointer; display: inline-flex; align-items: center;
      gap: 6px; font-family: inherit;
    }
    .rtts-btn-primary {
      border: 1px solid rgba(124,92,255,0.45); background: rgba(124,92,255,0.9); color: #fff;
    }
    .rtts-btn-primary:hover { background: #8a6dff; }
    .rtts-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .rtts-btn-ghost {
      border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.65);
    }
    .rtts-btn-ghost:hover { background: rgba(255,255,255,0.1); color: #fff; }
    .rtts-status {
      display: none; font-size: 11px; line-height: 1.5;
      border-radius: 8px; padding: 7px 9px;
    }
    .rtts-status.show { display: block; }
    .rtts-status.ok { background: rgba(62,230,213,0.1); border: 1px solid rgba(62,230,213,0.25); color: #7ef2e4; }
    .rtts-status.err { background: rgba(229,72,77,0.12); border: 1px solid rgba(229,72,77,0.3); color: #ffb4b6; }
    .rtts-status.info { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09); color: rgba(255,255,255,0.55); }

    /* === Toast === */
    #rtts-toasts {
      position: fixed; left: 50%; top: 18px; transform: translateX(-50%);
      z-index: 2147483647; display: flex; flex-direction: column; gap: 8px;
      align-items: center; pointer-events: none;
    }
    .rtts-toast {
      max-width: min(420px, 86vw); padding: 9px 14px; border-radius: 10px;
      background: rgba(18,18,28,0.96); border: 1px solid rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.86); font-size: 12px; line-height: 1.45;
      box-shadow: 0 12px 36px rgba(0,0,0,0.55);
      animation: toast-in 0.18s ease-out;
    }
    .rtts-toast.err { border-color: rgba(229,72,77,0.4); color: #ffb4b6; }
    .rtts-toast.ok { border-color: rgba(62,230,213,0.4); color: #9ff5ea; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

    /* === Image panel === */
    .rtts-image-panel { width: min(500px, 94vw); }
    .rtts-image-result {
      display: none; border-radius: 12px; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.4);
    }
    .rtts-image-result.show { display: block; }
    .rtts-image-result img { display: block; width: 100%; height: auto; }
    .rtts-image-actions { display: none; gap: 8px; margin-left: auto; }
    .rtts-image-actions.show { display: flex; }

    /* === Focus & motion polish === */
    .rtts-btn,
    .rtts-btn-primary,
    .rtts-btn-ghost,
    .action-chip,
    .rtts-modal-close,
    .rtts-pw-wrap button {
      -webkit-tap-highlight-color: transparent;
    }
    .rtts-btn:focus-visible,
    .rtts-btn-primary:focus-visible,
    .rtts-btn-ghost:focus-visible,
    .action-chip:focus-visible,
    .rtts-modal-close:focus-visible,
    .rtts-pw-wrap button:focus-visible,
    .rtts-field input:focus-visible,
    .rtts-field textarea:focus-visible,
    .rtts-field select:focus-visible {
      outline: 2px solid rgba(156, 133, 255, 0.8);
      outline-offset: 2px;
    }
    .rtts-btn:active,
    .rtts-btn-primary:active,
    .rtts-btn-ghost:active,
    .action-chip:active {
      transform: translateY(1px);
    }
    .rtts-btn svg,
    .action-chip svg,
    .rtts-modal-icon svg {
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
      stroke-width: 1.8;
    }
    /* === Inline icon sizing === */
    .rtts-modal-close,
    #rtts-drawer-close,
    #rtts-notes-close,
    #rtts-notes-add,
    .rtts-pw-wrap button {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .rtts-modal-close svg,
    #rtts-drawer-close svg { width: 14px; height: 14px; }
    #rtts-notes-add svg { width: 13px; height: 13px; }
    .rtts-pw-wrap button svg { width: 14px; height: 14px; }
    .rtts-pw-wrap button .eye-off { display: none; }
    .rtts-pw-wrap button.revealed .eye-open { display: none; }
    .rtts-pw-wrap button.revealed .eye-off { display: block; }
    .rtts-btn-primary svg,
    .rtts-btn-ghost svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .rtts-btn-primary.loading svg { animation: breathe 1.2s ease-in-out infinite; }
    .note-item .note-del { display: flex; align-items: center; justify-content: center; }
    .note-item .note-del svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .rtts-modal-close svg,
    #rtts-drawer-close svg,
    #rtts-notes-close svg,
    #rtts-notes-add svg,
    .rtts-pw-wrap button svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }

    @media (max-width: 640px) {
      #rtts-drawer { width: 100vw; right: -100vw; }
      #rtts-sub-box { width: 88vw; bottom: 18px; max-height: 28vh; padding: 8px 14px 6px; }
      #rtts-sub-box.compact { height: 56px !important; padding-top: 16px; padding-bottom: 6px; }
      #rtts-lang-picker {
        left: 50%; right: auto; top: 50%;
        transform: translate(-50%, -50%);
        width: min(88vw, 320px); max-height: 70vh;
      }
      .rtts-image-panel { width: 94vw; }
      #rtts-bar {
        flex-wrap: wrap; justify-content: center;
        max-width: calc(100vw - 16px);
        row-gap: 1px; padding: 5px 6px;
      }
      #rtts-bar .rtts-divider { display: none; }
      .rtts-btn { width: 32px; height: 32px; }
      /* Labeled buttons keep their text: it is what makes them findable. */
      .rtts-btn-labeled { width: auto; padding: 0 9px; font-size: 11px; }
      #rtts-record.rtts-record-btn { width: auto; padding: 0 11px; }
      #rtts-lang-btn.rtts-lang-chip { width: auto; padding: 0 8px; }
      .rtts-bar-grip { height: 26px; }
      #rtts-bar .rtts-btn::after { display: none; }
    }
    @media (max-width: 460px) {
      .rtts-grid-2 { grid-template-columns: 1fr; }
      .rtts-modal-footer { flex-wrap: wrap; }
      #rtts-sub-box { width: 84vw; bottom: 12px; }
    }
    @media (max-height: 560px) {
      #rtts-bar { max-height: 46vh; overflow-y: auto; scrollbar-width: none; }
      #rtts-bar::-webkit-scrollbar { display: none; }
      /* A tall menu inside a scrollable bar would be clipped. */
      #rtts-menu { position: fixed; top: 62px; right: 12px; max-height: 60vh; }
    }
  `;
    const html = `
    <div id="rtts-bar" role="toolbar" aria-label="snooper \u5DE5\u5177\u680F">
      <div id="rtts-bar-grip" class="rtts-bar-grip" role="button" tabindex="0" aria-label="\u62D6\u52A8\u5DE5\u5177\u680F" title="\u62D6\u52A8\u5DE5\u5177\u680F">
        <svg viewBox="0 0 10 16" aria-hidden="true">
          <circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/>
          <circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/>
          <circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/>
        </svg>
      </div>

      <!-- Primary action: always visible, labeled -->
      <button id="rtts-record" class="rtts-btn rtts-record-btn" data-tip="\u5F00\u59CB\u8F6C\u5199" aria-label="\u5F00\u59CB\u8F6C\u5199">
        <div class="dot"></div>
        <span id="rtts-record-label" class="rtts-btn-label">\u5B9E\u65F6\u5B57\u5E55</span>
      </button>

      <button id="rtts-lang-btn" class="rtts-btn rtts-lang-chip" data-tip="\u8BED\u8A00\uFF1A\u81EA\u52A8\u68C0\u6D4B \u2192 \u4E2D\u6587" aria-label="\u5207\u6362\u8BED\u8A00">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 4 5.7 4 9s-1.5 6.4-4 9a14 14 0 0 1 0-18z"/></svg>
        <span id="rtts-lang-label">AUTO\u2192ZH</span>
      </button>

      <div class="rtts-divider"></div>

      <!-- Two daily-use surfaces, labeled -->
      <button id="rtts-chat-btn" class="rtts-btn rtts-btn-labeled" data-tip="AI \u4F34\u5B66" aria-label="AI \u4F34\u5B66">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>AI</span>
      </button>
      <button id="rtts-notes-btn" class="rtts-btn rtts-btn-labeled" data-tip="\u7B14\u8BB0" aria-label="\u6253\u5F00\u7B14\u8BB0">
        <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <span>\u7B14\u8BB0</span>
        <span id="rtts-notes-badge" class="rtts-badge" hidden>0</span>
      </button>

      <button id="rtts-more-btn" class="rtts-btn" data-tip="\u66F4\u591A\u5DE5\u5177" aria-label="\u66F4\u591A\u5DE5\u5177" aria-haspopup="menu" aria-expanded="false">
        <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>
      </button>

      <!-- Advanced tools live in one labeled menu instead of 10 icon buttons -->
      <div id="rtts-menu" role="menu" aria-label="\u66F4\u591A\u5DE5\u5177">
        <div class="rtts-menu-head">\u5DE5\u5177</div>
        <button id="rtts-note-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></span>
          <span class="rtts-menu-text"><b>\u8BB0\u5165\u7B14\u8BB0</b><small>\u4FDD\u5B58\u5F53\u524D\u5B57\u5E55\u5230\u7B14\u8BB0</small></span>
        </button>
        <button id="rtts-screenshot-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></span>
          <span class="rtts-menu-text"><b>\u9875\u9762\u622A\u56FE</b><small>\u5F55\u5236\u4E2D\u4E5F\u80FD\u622A\u53D6\u89C6\u9891\u753B\u9762</small></span>
        </button>
        <button id="rtts-image-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></span>
          <span class="rtts-menu-text"><b>\u751F\u6210\u914D\u56FE</b><small>\u6839\u636E\u63D0\u793A\u8BCD\u751F\u6210\u56FE\u7247</small></span>
        </button>
        <button id="rtts-copy-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>
          <span class="rtts-menu-text"><b>\u590D\u5236\u5B57\u5E55</b><small>\u590D\u5236\u5168\u90E8\u5B57\u5E55\u6587\u672C</small></span>
        </button>

        <div class="rtts-menu-sep"></div>
        <div class="rtts-menu-head">\u5BFC\u51FA\u4E0E\u540C\u6B65</div>
        <button id="rtts-export-txt-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>
          <span class="rtts-menu-text"><b>\u5BFC\u51FA TXT</b><small>\u7EAF\u6587\u672C\u5B57\u5E55</small></span>
        </button>
        <button id="rtts-export-md-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>
          <span class="rtts-menu-text"><b>\u5BFC\u51FA Markdown</b><small>\u8868\u683C + \u7B14\u8BB0</small></span>
        </button>
        <button id="rtts-obsidian-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/></svg></span>
          <span class="rtts-menu-text"><b>\u53D1\u9001\u5230 Obsidian</b><small>\u56FE\u7247\u81EA\u52A8\u4E0A\u4F20\u5230\u4ED3\u5E93</small></span>
        </button>

        <div class="rtts-menu-sep"></div>
        <button id="rtts-settings-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg></span>
          <span class="rtts-menu-text"><b>\u8BBE\u7F6E</b><small>\u6A21\u578B\u3001\u5BC6\u94A5\u4E0E Obsidian</small></span>
        </button>
        <button id="rtts-hide-btn" class="rtts-menu-item rtts-menu-item-danger" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
          <span class="rtts-menu-text"><b>\u5173\u95ED\u5DE5\u5177</b><small>\u70B9\u6269\u5C55\u56FE\u6807\u53EF\u91CD\u65B0\u6253\u5F00</small></span>
        </button>
      </div>
    </div>

    <button id="rtts-show-btn" class="rtts-btn" data-tip="\u91CD\u65B0\u6253\u5F00 snooper \u5DE5\u5177\u680F" aria-label="\u663E\u793A\u5DE5\u5177" style="display:none">
      <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
      <span class="rtts-show-label">\u663E\u793A\u5DE5\u5177</span>
    </button>

    <!-- Language Picker Popup -->
    <div id="rtts-lang-picker">
      <h4>\u6E90\u8BED\u8A00\uFF08\u8BED\u97F3\u8BC6\u522B\uFF09</h4>
      <div class="lang-row" id="rtts-source-langs"></div>
      <h4>\u76EE\u6807\u8BED\u8A00\uFF08\u7FFB\u8BD1\uFF09</h4>
      <div class="lang-row" id="rtts-target-langs"></div>
    </div>

    <!-- Translucent subtitle overlay -->
    <div id="rtts-sub-box" class="hidden">
      <div id="rtts-sub-handle"></div>
      <div id="rtts-sub-scroll">
        <div id="rtts-sub-rows"></div>
        <div id="rtts-streaming-row" class="hidden">
          <div class="sub-trans" id="rtts-streaming-text"></div>
          <div class="sub-source" id="rtts-streaming-source"></div>
          <span class="stream-cursor"></span>
          <span class="stream-label" id="rtts-streaming-label">\u7FFB\u8BD1\u4E2D</span>
        </div>
      </div>
      <div id="rtts-sub-placeholder">\u70B9\u51FB\u300C\u5F55\u97F3\u300D\u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199</div>
      <div id="rtts-sub-status" class="hidden" aria-live="polite">\u89C6\u9891\u5DF2\u6682\u505C\u6216\u9759\u97F3 \xB7 \u7B49\u5F85\u97F3\u9891</div>
      <div id="rtts-sub-resize" role="separator" tabindex="0" aria-label="\u8C03\u6574\u5B57\u5E55\u9762\u677F\u5927\u5C0F\uFF0C\u65B9\u5411\u952E\u5FAE\u8C03" title="\u62D6\u52A8\u8C03\u6574\u5927\u5C0F"></div>
    </div>

    <!-- Unified side drawer: chat + notes tabs -->
    <div id="rtts-drawer" aria-label="AI \u4F34\u5B66\u4E0E\u7B14\u8BB0">
      <div id="rtts-drawer-header">
        <div id="rtts-drawer-tabs" role="tablist" aria-label="\u9762\u677F\u5207\u6362">
          <button id="rtts-tab-chat" class="rtts-drawer-tab active" type="button" role="tab" aria-selected="true">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            \u4F34\u5B66
          </button>
          <button id="rtts-tab-notes" class="rtts-drawer-tab" type="button" role="tab" aria-selected="false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            \u7B14\u8BB0 <span id="rtts-notes-count">0</span>
          </button>
        </div>
        <button id="rtts-drawer-close" aria-label="\u5173\u95ED"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>

      <div id="rtts-pane-chat" class="rtts-pane active" role="tabpanel" aria-label="AI \u4F34\u5B66">
        <div id="rtts-chat"></div>
        <div id="rtts-chat-composer">
          <div id="rtts-chat-attachments" aria-live="polite"></div>

          <div class="rtts-md-shell">
            <div class="rtts-md-toolbar" id="rtts-chat-toolbar" role="toolbar" aria-label="Markdown \u5FEB\u6377\u64CD\u4F5C">
              <button type="button" data-md="bold" title="\u52A0\u7C97\uFF08Ctrl/\u2318+B\uFF09" aria-label="\u52A0\u7C97"><b>B</b></button>
              <button type="button" data-md="italic" title="\u659C\u4F53\uFF08Ctrl/\u2318+I\uFF09" aria-label="\u659C\u4F53"><i>I</i></button>
              <button type="button" data-md="code" title="\u884C\u5185\u4EE3\u7801" aria-label="\u884C\u5185\u4EE3\u7801"><span>&lt;/&gt;</span></button>
              <button type="button" data-md="link" title="\u94FE\u63A5" aria-label="\u63D2\u5165\u94FE\u63A5">\u{1F517}</button>
              <button type="button" id="rtts-cite-btn" class="rtts-md-cite rtts-md-tail" title="\u5F15\u7528\u7B14\u8BB0\u91CC\u7684\u622A\u56FE" aria-label="\u5F15\u7528\u7B14\u8BB0\u91CC\u7684\u622A\u56FE" aria-haspopup="dialog" aria-expanded="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                <span>\u5F15\u7528</span>
              </button>
              <button type="button" id="rtts-md-preview-btn" title="\u9884\u89C8 Markdown">\u9884\u89C8</button>
            </div>

            <!-- Attach, input and send share one row: the upload control is part
                 of the input, not a separate toolbar underneath it. -->
            <div id="rtts-chat-input-row">
              <button id="rtts-chat-attach-btn" type="button" aria-label="\u4E0A\u4F20\u56FE\u7247" title="\u4E0A\u4F20\u56FE\u7247">
                <svg viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <div id="rtts-chat-editor" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="\u63D0\u95EE" data-placeholder="\u95EE\u70B9\u4EC0\u4E48\uFF0C\u652F\u6301 Markdown\u2026"></div>
              <div id="rtts-chat-preview" class="rtts-md-preview" hidden></div>
              <button id="rtts-send" type="button">\u53D1\u9001</button>
            </div>
          </div>

          <div id="rtts-cite-popover" class="rtts-cite-popover" hidden role="dialog" aria-label="\u5F15\u7528\u7B14\u8BB0\u622A\u56FE">
            <div class="rtts-cite-head">
              <span>\u5F15\u7528\u7B14\u8BB0\u622A\u56FE</span>
              <button id="rtts-cite-close" type="button" aria-label="\u5173\u95ED">\u2715</button>
            </div>
            <div id="rtts-cite-list" class="rtts-cite-list"></div>
            <div id="rtts-cite-empty" class="rtts-cite-empty">\u8FD8\u6CA1\u6709\u622A\u56FE\u3002\u5148\u7528\u5DE5\u5177\u680F\u7684\u300C\u9875\u9762\u622A\u56FE\u300D\u6216\u300C\u8BB0\u5165\u7B14\u8BB0\u300D\u5B58\u4E00\u5F20\u3002</div>
          </div>

          <input id="rtts-chat-file" type="file" accept="image/*" multiple hidden>
        </div>
      </div>

      <div id="rtts-pane-notes" class="rtts-pane" role="tabpanel" aria-label="\u7B14\u8BB0">
        <div id="rtts-notes-list"></div>

        <div class="rtts-md-shell" id="rtts-notes-shell">
          <div class="rtts-md-toolbar" id="rtts-notes-toolbar" role="toolbar" aria-label="\u7B14\u8BB0 Markdown \u5FEB\u6377\u64CD\u4F5C">
            <button type="button" data-md="bold" title="\u52A0\u7C97\uFF08Ctrl/\u2318+B\uFF09" aria-label="\u52A0\u7C97"><b>B</b></button>
            <button type="button" data-md="italic" title="\u659C\u4F53\uFF08Ctrl/\u2318+I\uFF09" aria-label="\u659C\u4F53"><i>I</i></button>
            <button type="button" data-md="code" title="\u884C\u5185\u4EE3\u7801" aria-label="\u884C\u5185\u4EE3\u7801"><span>&lt;/&gt;</span></button>
            <button type="button" data-md="link" title="\u94FE\u63A5" aria-label="\u63D2\u5165\u94FE\u63A5">\u{1F517}</button>
            <button type="button" id="rtts-notes-preview-btn" class="rtts-md-tail" title="\u9884\u89C8 Markdown">\u9884\u89C8</button>
          </div>
          <div id="rtts-notes-row">
            <div id="rtts-notes-editor" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="\u65B0\u7B14\u8BB0" data-placeholder="\u8BB0\u4E00\u6761\u7B14\u8BB0\uFF0C\u652F\u6301 Markdown\u2026"></div>
            <div id="rtts-notes-preview" class="rtts-md-preview" hidden></div>
            <button id="rtts-notes-add" type="button" title="\u6DFB\u52A0\u7B14\u8BB0\uFF08Ctrl/\u2318+Enter\uFF09">\u6DFB\u52A0</button>
          </div>
        </div>
      </div>

    </div>

    <div id="rtts-fs-warn" class="hidden"></div>

    <!-- In-page settings modal -->
    <div id="rtts-settings-modal" class="rtts-modal-mask">
      <div class="rtts-modal" role="dialog" aria-modal="true" aria-label="\u914D\u7F6E">
        <div class="rtts-modal-header">
          <div class="rtts-modal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>
          </div>
          <div>
            <h3>\u914D\u7F6E</h3>
            <p class="sub">\u5BC6\u94A5\u53EA\u4FDD\u5B58\u5728\u672C\u673A\uFF0C\u9875\u9762\u4E0A\u7684\u5176\u4ED6\u811A\u672C\u65E0\u6CD5\u8BFB\u53D6</p>
          </div>
          <button id="rtts-settings-close" class="rtts-modal-close" type="button" aria-label="\u5173\u95ED"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="rtts-modal-body">
          <div class="rtts-field">
            <label for="rtts-cfg-baseurl">Base URL</label>
            <input id="rtts-cfg-baseurl" type="text" spellcheck="false" autocomplete="off" placeholder="https://api.mosi.cn/v1">
            <span class="hint">MOSS \u5B98\u65B9\u7F51\u5173\u9ED8\u8BA4\u4F7F\u7528 https://api.mosi.cn/v1</span>
          </div>
          <div class="rtts-field">
            <label for="rtts-cfg-apikey">API Key</label>
            <div class="rtts-pw-wrap">
              <input id="rtts-cfg-apikey" type="password" spellcheck="false" autocomplete="off" placeholder="sk-\u2026">
              <button id="rtts-cfg-toggle-key" type="button" aria-label="\u663E\u793A\u6216\u9690\u85CF\u5BC6\u94A5"><svg class="eye-open" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-off" viewBox="0 0 24 24"><path d="M17.94 17.94A10.4 10.4 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.4 10.4 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="2" y1="2" x2="22" y2="22"/></svg></button>
            </div>
            <span class="hint">\u5728 platform.mosi.cn \u2192 API Keys \u521B\u5EFA</span>
          </div>
          <div class="rtts-field">
            <label for="rtts-cfg-llm">LLM \u6A21\u578B\uFF08\u5BF9\u8BDD / \u7FFB\u8BD1 / \u89C6\u89C9\uFF09</label>
            <input id="rtts-cfg-llm" type="text" spellcheck="false" placeholder="moss-vl-1.0">
          </div>
          <div class="rtts-grid-2">
            <div class="rtts-field">
              <label for="rtts-cfg-audio">\u97F3\u9891\u8F6C\u5199\u6A21\u578B</label>
              <input id="rtts-cfg-audio" type="text" spellcheck="false" placeholder="moss-transcribe-1.0">
            </div>
            <div class="rtts-field">
              <label for="rtts-cfg-image">\u56FE\u50CF\u751F\u6210\u6A21\u578B</label>
              <input id="rtts-cfg-image" type="text" spellcheck="false" placeholder="moss-image-sft-1.0">
            </div>
          </div>
          <div class="rtts-section-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            Obsidian \u540C\u6B65
          </div>
          <div class="rtts-grid-2">
            <div class="rtts-field">
              <label for="rtts-cfg-ob-protocol">\u534F\u8BAE</label>
              <select id="rtts-cfg-ob-protocol">
                <option value="http">HTTP\uFF08\u63A8\u8350\uFF09</option>
                <option value="https">HTTPS\uFF08\u9700\u4FE1\u4EFB\u8BC1\u4E66\uFF09</option>
              </select>
            </div>
            <div class="rtts-field">
              <label for="rtts-cfg-ob-port">\u7AEF\u53E3</label>
              <input id="rtts-cfg-ob-port" type="number" inputmode="numeric" placeholder="27123">
            </div>
          </div>
          <div class="rtts-field">
            <label for="rtts-cfg-ob-key">API Key</label>
            <input id="rtts-cfg-ob-key" type="password" spellcheck="false" autocomplete="off" placeholder="\u5728 Local REST API \u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u590D\u5236">
          </div>
          <div class="rtts-field">
            <label for="rtts-cfg-ob-folder">\u7B14\u8BB0\u76EE\u5F55</label>
            <input id="rtts-cfg-ob-folder" type="text" spellcheck="false" placeholder="snooper-notes">
            <span class="hint">HTTP \u9700\u8981\u63D2\u4EF6\u5F00\u542F\u300CEnable Non-encrypted (HTTP) Server\u300D</span>
          </div>
          <div class="rtts-inline-actions">
            <button id="rtts-cfg-ob-test" class="rtts-btn-ghost" type="button">\u6D4B\u8BD5 Obsidian</button>
            <div id="rtts-cfg-ob-status" class="rtts-status" role="status" aria-live="polite"></div>
          </div>
          <div id="rtts-cfg-status" class="rtts-status" role="status" aria-live="polite"></div>
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-cfg-test" class="rtts-btn-ghost" type="button">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            \u6D4B\u8BD5\u8FDE\u63A5
          </button>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button id="rtts-cfg-cancel" class="rtts-btn-ghost" type="button">\u53D6\u6D88</button>
            <button id="rtts-cfg-save" class="rtts-btn-primary" type="button">\u4FDD\u5B58\u914D\u7F6E</button>
          </div>
        </div>
      </div>
    </div>

    <!-- In-page image generation -->
    <div id="rtts-image-modal" class="rtts-modal-mask">
      <div class="rtts-modal rtts-image-panel" role="dialog" aria-modal="true" aria-label="\u751F\u6210\u914D\u56FE">
        <div class="rtts-modal-header">
          <div class="rtts-modal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          </div>
          <div>
            <h3>\u751F\u6210\u914D\u56FE</h3>
            <p class="sub">MOSS-Image \xB7 \u6587\u751F\u56FE \xB7 \u5F53\u524D\u9650\u65F6\u514D\u8D39</p>
          </div>
          <button id="rtts-img-close" class="rtts-modal-close" type="button" aria-label="\u5173\u95ED"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="rtts-modal-body">
          <div class="rtts-field">
            <label for="rtts-img-prompt">\u63D0\u793A\u8BCD</label>
            <textarea id="rtts-img-prompt" placeholder="\u63CF\u8FF0\u4F60\u60F3\u8981\u7684\u753B\u9762\u2026"></textarea>
          </div>
          <div class="rtts-grid-2">
            <div class="rtts-field">
              <label for="rtts-img-size">\u5C3A\u5BF8</label>
              <select id="rtts-img-size">
                <option value="1024x1024">1024 \xD7 1024\uFF08\u65B9\u5F62\uFF09</option>
                <option value="1024x768">1024 \xD7 768\uFF08\u6A2A\u5411\uFF09</option>
                <option value="768x1024">768 \xD7 1024\uFF08\u7EB5\u5411\uFF09</option>
              </select>
            </div>
            <div class="rtts-field">
              <label for="rtts-img-neg">\u8D1F\u5411\u63D0\u793A\u8BCD</label>
              <input id="rtts-img-neg" type="text" placeholder="\u6A21\u7CCA\u3001\u7578\u5F62\u3001\u6C34\u5370" value="nsfw, worst quality, low quality, watermark">
            </div>
          </div>
          <div id="rtts-img-status" class="rtts-status" role="status" aria-live="polite"></div>
          <div id="rtts-img-result" class="rtts-image-result">
            <img id="rtts-img-result-img" alt="\u751F\u6210\u7684\u914D\u56FE">
          </div>
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-img-generate" class="rtts-btn-primary" type="button">
            <svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>
            <span>\u751F\u6210\u56FE\u7247</span>
          </button>
          <div id="rtts-img-actions" class="rtts-image-actions">
            <button id="rtts-img-save" class="rtts-btn-ghost" type="button">\u5B58\u5165\u7B14\u8BB0</button>
            <button id="rtts-img-download" class="rtts-btn-ghost" type="button">\u4E0B\u8F7D</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Screenshot preview -->
    <div id="rtts-shot-modal" class="rtts-modal-mask">
      <div class="rtts-modal rtts-shot-panel" role="dialog" aria-modal="true" aria-label="\u622A\u56FE\u9884\u89C8">
        <div class="rtts-modal-header">
          <div class="rtts-modal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
          </div>
          <div>
            <h3>\u89C6\u9891\u622A\u56FE</h3>
            <p class="sub">\u53EA\u622A\u53D6\u89C6\u9891\u753B\u9762\uFF0C\u4E0D\u542B\u5B57\u5E55\u4E0E\u5DE5\u5177\u680F</p>
          </div>
          <button id="rtts-shot-close-x" class="rtts-modal-close" type="button" aria-label="\u5173\u95ED"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="rtts-modal-body rtts-shot-body">
          <img id="rtts-shot-img" alt="\u89C6\u9891\u622A\u56FE\u9884\u89C8">
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-shot-download" class="rtts-btn-ghost" type="button">\u4E0B\u8F7D\u56FE\u7247</button>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button id="rtts-shot-close" class="rtts-btn-ghost" type="button">\u5173\u95ED</button>
            <button id="rtts-shot-save" class="rtts-btn-primary" type="button">\u5B58\u5165\u7B14\u8BB0</button>
          </div>
        </div>
      </div>
    </div>

    <div id="rtts-toasts" aria-live="polite"></div>
  `;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    shadow.append(style, wrapper);
    (document.body || document.documentElement).appendChild(host);
    const bar = shadow.getElementById("rtts-bar");
    const barGrip = shadow.getElementById("rtts-bar-grip");
    const recordBtn = shadow.getElementById("rtts-record");
    const recordLabelEl = shadow.getElementById("rtts-record-label");
    const moreBtn = shadow.getElementById("rtts-more-btn");
    const toolsMenu = shadow.getElementById("rtts-menu");
    const langBtn = shadow.getElementById("rtts-lang-btn");
    const langLabel = shadow.getElementById("rtts-lang-label");
    const langPicker = shadow.getElementById("rtts-lang-picker");
    const sourceLangsEl = shadow.getElementById("rtts-source-langs");
    const targetLangsEl = shadow.getElementById("rtts-target-langs");
    const subBox = shadow.getElementById("rtts-sub-box");
    const subHandle = shadow.getElementById("rtts-sub-handle");
    const subResize = shadow.getElementById("rtts-sub-resize");
    const subScroll = shadow.getElementById("rtts-sub-scroll");
    const subRows = shadow.getElementById("rtts-sub-rows");
    const subPlaceholder = shadow.getElementById("rtts-sub-placeholder");
    const subStatus = shadow.getElementById("rtts-sub-status");
    const copyBtn = shadow.getElementById("rtts-copy-btn");
    const exportTxtBtn = shadow.getElementById("rtts-export-txt-btn");
    const exportMdBtn = shadow.getElementById("rtts-export-md-btn");
    const streamingRow = shadow.getElementById("rtts-streaming-row");
    const streamingText = shadow.getElementById("rtts-streaming-text");
    const streamingSource = shadow.getElementById("rtts-streaming-source");
    const streamingLabel = shadow.getElementById("rtts-streaming-label");
    const drawer = shadow.getElementById("rtts-drawer");
    const chatEl = shadow.getElementById("rtts-chat");
    const chatComposer = shadow.getElementById("rtts-chat-composer");
    const chatEditor = shadow.getElementById("rtts-chat-editor");
    const chatPreview = shadow.getElementById("rtts-chat-preview");
    const mdPreviewBtn = shadow.getElementById("rtts-md-preview-btn");
    const citeBtn = shadow.getElementById("rtts-cite-btn");
    const citePopover = shadow.getElementById("rtts-cite-popover");
    const citeList = shadow.getElementById("rtts-cite-list");
    const citeEmpty = shadow.getElementById("rtts-cite-empty");
    const citeClose = shadow.getElementById("rtts-cite-close");
    const notesEditor = shadow.getElementById("rtts-notes-editor");
    const notesPreview = shadow.getElementById("rtts-notes-preview");
    const notesPreviewBtn = shadow.getElementById("rtts-notes-preview-btn");
    const drawerTabChat = shadow.getElementById("rtts-tab-chat");
    const drawerTabNotes = shadow.getElementById("rtts-tab-notes");
    const paneChat = shadow.getElementById("rtts-pane-chat");
    const paneNotes = shadow.getElementById("rtts-pane-notes");
    const chatBtn = shadow.getElementById("rtts-chat-btn");
    const chatAttachBtn = shadow.getElementById("rtts-chat-attach-btn");
    const chatFile = shadow.getElementById("rtts-chat-file");
    const chatAttachments = shadow.getElementById("rtts-chat-attachments");
    const sendBtn = shadow.getElementById("rtts-send");
    const fsWarn = shadow.getElementById("rtts-fs-warn");
    const hideBtn = shadow.getElementById("rtts-hide-btn");
    const showBtn = shadow.getElementById("rtts-show-btn");
    const noteBtn = shadow.getElementById("rtts-note-btn");
    const imageBtn = shadow.getElementById("rtts-image-btn");
    const screenshotBtn = shadow.getElementById("rtts-screenshot-btn");
    const notesCount = shadow.getElementById("rtts-notes-count");
    const notesBadge = shadow.getElementById("rtts-notes-badge");
    const notesBtn = shadow.getElementById("rtts-notes-btn");
    const notesList = shadow.getElementById("rtts-notes-list");
    const notesAdd = shadow.getElementById("rtts-notes-add");
    const obsidianBtn = shadow.getElementById("rtts-obsidian-btn");
    const settingsModal = shadow.getElementById("rtts-settings-modal");
    const settingsClose = shadow.getElementById("rtts-settings-close");
    const cfgBaseUrl = shadow.getElementById("rtts-cfg-baseurl");
    const cfgApiKey = shadow.getElementById("rtts-cfg-apikey");
    const cfgToggleKey = shadow.getElementById("rtts-cfg-toggle-key");
    const cfgLlm = shadow.getElementById("rtts-cfg-llm");
    const cfgAudio = shadow.getElementById("rtts-cfg-audio");
    const cfgImage = shadow.getElementById("rtts-cfg-image");
    const cfgStatus = shadow.getElementById("rtts-cfg-status");
    const cfgTest = shadow.getElementById("rtts-cfg-test");
    const cfgSave = shadow.getElementById("rtts-cfg-save");
    const cfgCancel = shadow.getElementById("rtts-cfg-cancel");
    const cfgObProtocol = shadow.getElementById("rtts-cfg-ob-protocol");
    const cfgObPort = shadow.getElementById("rtts-cfg-ob-port");
    const cfgObKey = shadow.getElementById("rtts-cfg-ob-key");
    const cfgObFolder = shadow.getElementById("rtts-cfg-ob-folder");
    const cfgObTest = shadow.getElementById("rtts-cfg-ob-test");
    const cfgObStatus = shadow.getElementById("rtts-cfg-ob-status");
    const shotModal = shadow.getElementById("rtts-shot-modal");
    const shotImg = shadow.getElementById("rtts-shot-img");
    const shotClose = shadow.getElementById("rtts-shot-close");
    const shotCloseX = shadow.getElementById("rtts-shot-close-x");
    const shotDownload = shadow.getElementById("rtts-shot-download");
    const shotSave = shadow.getElementById("rtts-shot-save");
    const imageModal = shadow.getElementById("rtts-image-modal");
    const imgClose = shadow.getElementById("rtts-img-close");
    const imgPrompt = shadow.getElementById("rtts-img-prompt");
    const imgSize = shadow.getElementById("rtts-img-size");
    const imgNeg = shadow.getElementById("rtts-img-neg");
    const imgGenerate = shadow.getElementById("rtts-img-generate");
    const imgStatus = shadow.getElementById("rtts-img-status");
    const imgResult = shadow.getElementById("rtts-img-result");
    const imgResultImg = shadow.getElementById("rtts-img-result-img");
    const imgActions = shadow.getElementById("rtts-img-actions");
    const imgSave = shadow.getElementById("rtts-img-save");
    const imgDownload = shadow.getElementById("rtts-img-download");
    const toasts = shadow.getElementById("rtts-toasts");
    function buildLangPicker() {
      sourceLangsEl.textContent = "";
      targetLangsEl.textContent = "";
      LANGUAGES.forEach((l) => {
        const src = document.createElement("span");
        src.className = "lang-opt" + (l.code === session.sourceLang ? " active" : "");
        src.textContent = l.label;
        src.dataset.code = l.code;
        src.addEventListener("click", () => {
          session.sourceLang = l.code;
          refreshLangPicker();
          updateLangLabel();
          bg("SET_LANG", { sourceLang: l.code }).then(() => syncSessionFromBackground()).catch(() => {
          });
        });
        sourceLangsEl.appendChild(src);
        if (l.code === "auto") return;
        const tgt = document.createElement("span");
        tgt.className = "lang-opt" + (l.code === session.targetLang ? " active" : "");
        tgt.textContent = l.label;
        tgt.dataset.code = l.code;
        tgt.addEventListener("click", () => {
          session.targetLang = l.code;
          refreshLangPicker();
          updateLangLabel();
          closeLangPicker();
          bg("SET_LANG", { targetLang: l.code }).then(() => syncSessionFromBackground()).catch(() => {
          });
        });
        targetLangsEl.appendChild(tgt);
      });
    }
    function refreshLangPicker() {
      sourceLangsEl.querySelectorAll(".lang-opt").forEach((el) => {
        el.classList.toggle("active", el.dataset.code === session.sourceLang);
      });
      targetLangsEl.querySelectorAll(".lang-opt").forEach((el) => {
        el.classList.toggle("active", el.dataset.code === session.targetLang);
      });
    }
    function updateLangLabel() {
      const src = LANG_MAP[session.sourceLang] || session.sourceLang;
      const tgt = LANG_MAP[session.targetLang] || session.targetLang;
      const srcShort = LANG_SHORT[session.sourceLang] || String(session.sourceLang).toUpperCase();
      const tgtShort = LANG_SHORT[session.targetLang] || String(session.targetLang).toUpperCase();
      langLabel.textContent = `${srcShort}\u2192${tgtShort}`;
      langBtn.setAttribute("data-tip", `\u8BED\u8A00\uFF1A${src} \u2192 ${tgt}`);
    }
    langBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      langPickerOpen = !langPickerOpen;
      langPicker.classList.toggle("open", langPickerOpen);
      if (langPickerOpen) positionLangPicker();
    });
    function closeLangPicker() {
      langPickerOpen = false;
      langPicker.classList.remove("open");
    }
    function positionLangPicker() {
      if (!langPickerOpen) return;
      const br = bar.getBoundingClientRect();
      const pr = langPicker.getBoundingClientRect();
      const width = pr.width || 300;
      const height = pr.height || 280;
      const left = Math.min(
        Math.max(8, br.left + br.width / 2 - width / 2),
        Math.max(8, window.innerWidth - width - 8)
      );
      let top = br.bottom + 10;
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, br.top - height - 10);
      }
      langPicker.style.transform = "none";
      langPicker.style.left = `${Math.round(left)}px`;
      langPicker.style.top = `${Math.round(top)}px`;
    }
    document.addEventListener("click", (e) => {
      if (!langPickerOpen) return;
      const path = e.composedPath();
      if (path.includes(langPicker) || path.includes(langBtn)) return;
      closeLangPicker();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && langPickerOpen) closeLangPicker();
    });
    async function bg(type, payload = {}) {
      try {
        const res = await chrome.runtime.sendMessage({ target: "background", type, ...payload });
        return res && typeof res.ok !== "undefined" ? res : { ok: true, ...res };
      } catch (err) {
        return { ok: false, error: err.message || "\u540E\u53F0\u901A\u4FE1\u5F02\u5E38" };
      }
    }
    function adoptBackgroundSession(incoming) {
      session = {
        ...incoming,
        sourceLang: incoming.sourceLang || "auto",
        targetLang: incoming.targetLang || "zh",
        // Notes are local to the content surface and are not part of the
        // background session snapshot.
        notes: session.notes,
        activeNoteId: session.activeNoteId,
        isDemoMode: session.isDemoMode
      };
      render();
    }
    let sessionSyncSerial = 0;
    async function syncSessionFromBackground() {
      const serial = ++sessionSyncSerial;
      const res = await bg("GET_SESSION");
      if (serial !== sessionSyncSerial || !res.ok || !res.session) return false;
      adoptBackgroundSession(res.session);
      return true;
    }
    async function fetchAsDataUrl(url) {
      try {
        const res = await bg("FETCH_URL", { url });
        if (res.ok && res.dataUrl) return res.dataUrl;
      } catch {
      }
      return url;
    }
    function toast(message, tone = "info") {
      const el = document.createElement("div");
      el.className = "rtts-toast" + (tone === "info" ? "" : ` ${tone}`);
      el.textContent = message;
      toasts.appendChild(el);
      setTimeout(() => {
        el.style.opacity = "0";
        el.style.transition = "opacity 0.2s";
        setTimeout(() => el.remove(), 220);
      }, 3200);
    }
    function flashChip(btn, ms = 1600) {
      btn.classList.add("success");
      setTimeout(() => btn.classList.remove("success"), ms);
    }
    let cfgCache = null;
    function setCfgStatus(text, tone = "") {
      cfgStatus.textContent = text;
      cfgStatus.className = "rtts-status" + (text ? ` show ${tone}` : "");
    }
    function setObStatus(text, tone = "") {
      cfgObStatus.textContent = text;
      cfgObStatus.className = "rtts-status" + (text ? ` show ${tone}` : "");
    }
    function buildObsidianConfig() {
      const protocol = cfgObProtocol.value === "https" ? "https" : "http";
      const fallbackPort = protocol === "https" ? 27124 : 27123;
      return {
        enabled: true,
        apiProtocol: protocol,
        apiPort: Number(cfgObPort.value) || fallbackPort,
        apiKey: cfgObKey.value.trim(),
        noteFolder: cfgObFolder.value.trim() || "snooper-notes"
      };
    }
    async function testObsidian() {
      cfgObTest.disabled = true;
      setObStatus("\u6B63\u5728\u6D4B\u8BD5 Obsidian \u8FDE\u63A5\u2026", "info");
      const res = await bg("TEST_OBSIDIAN", { obsidianConfig: buildObsidianConfig() });
      cfgObTest.disabled = false;
      if (res.ok) {
        cfgObProtocol.value = res.protocol;
        cfgObPort.value = String(res.port);
        await saveObsidianConfig(buildObsidianConfig());
        setObStatus(`\u8FDE\u63A5\u6210\u529F\uFF08${String(res.protocol).toUpperCase()} ${res.port}\uFF09\uFF0C\u5DF2\u81EA\u52A8\u4FDD\u5B58`, "ok");
      } else {
        setObStatus(res.error || "\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C", "err");
      }
    }
    async function openSettings() {
      cfgApiKey.type = "password";
      cfgToggleKey.classList.remove("revealed");
      const [res, ob] = await Promise.all([
        bg("GET_CONFIG"),
        loadObsidianConfig()
      ]);
      cfgObProtocol.value = ob.apiProtocol;
      cfgObPort.value = String(ob.apiPort);
      cfgObKey.value = ob.apiKey;
      cfgObFolder.value = ob.noteFolder;
      setObStatus("");
      if (res.ok && res.config) {
        cfgCache = res.config;
        const first = cfgCache.providers?.[0] ?? {};
        cfgBaseUrl.value = first.baseUrl || "https://api.mosi.cn/v1";
        cfgApiKey.value = first.apiKey || "";
        cfgLlm.value = cfgCache.routes?.llm?.model || "moss-vl-1.0";
        cfgAudio.value = cfgCache.routes?.audio?.model || "moss-transcribe-1.0";
        cfgImage.value = cfgCache.routes?.image?.model || "moss-image-sft-1.0";
      } else {
        cfgCache = null;
        cfgBaseUrl.value = "https://api.mosi.cn/v1";
        cfgApiKey.value = "";
        cfgLlm.value = "moss-vl-1.0";
        cfgAudio.value = "moss-transcribe-1.0";
        cfgImage.value = "moss-image-sft-1.0";
        if (!res.ok) toast("\u8BFB\u53D6\u914D\u7F6E\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF"), "err");
      }
      setCfgStatus("");
      settingsModal.classList.add("open");
    }
    function closeSettings() {
      settingsModal.classList.remove("open");
    }
    function buildConfig() {
      const defaultProvider = () => ({
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
      });
      const base = cfgCache ? JSON.parse(JSON.stringify(cfgCache)) : { providers: [defaultProvider()], routes: {} };
      if (!Array.isArray(base.providers) || base.providers.length === 0) {
        base.providers = [defaultProvider()];
      }
      if (!base.routes || typeof base.routes !== "object") {
        base.routes = {};
      }
      const provider = base.providers[0];
      provider.baseUrl = cfgBaseUrl.value.trim() || "https://api.mosi.cn/v1";
      provider.apiKey = cfgApiKey.value.trim();
      const keepProvider = (current) => current?.providerId && base.providers.some((item) => item.id === current.providerId) ? current.providerId : provider.id;
      base.routes.llm = {
        ...base.routes.llm || {},
        providerId: keepProvider(base.routes.llm),
        model: cfgLlm.value.trim() || "moss-vl-1.0"
      };
      base.routes.audio = {
        ...base.routes.audio || {},
        providerId: keepProvider(base.routes.audio),
        model: cfgAudio.value.trim() || "moss-transcribe-1.0"
      };
      base.routes.image = {
        ...base.routes.image || {},
        providerId: keepProvider(base.routes.image),
        model: cfgImage.value.trim() || "moss-image-sft-1.0"
      };
      if (!base.routes.video) {
        base.routes.video = { providerId: provider.id, model: "moss-vl-realtime-1.0" };
      }
      return base;
    }
    async function saveSettings() {
      const config = buildConfig();
      cfgSave.disabled = true;
      setCfgStatus("\u6B63\u5728\u4FDD\u5B58\u2026", "info");
      await saveObsidianConfig(buildObsidianConfig());
      const res = await bg("SAVE_CONFIG", { config });
      cfgSave.disabled = false;
      if (res.ok) {
        cfgCache = config;
        setCfgStatus("\u5DF2\u4FDD\u5B58\u3002\u5BC6\u94A5\u53EA\u5B58\u50A8\u5728\u672C\u673A\u6D4F\u89C8\u5668\u3002", "ok");
        toast("\u914D\u7F6E\u5DF2\u4FDD\u5B58", "ok");
        setTimeout(closeSettings, 600);
      } else {
        setCfgStatus("\u4FDD\u5B58\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF"), "err");
      }
    }
    async function testConnection() {
      cfgTest.disabled = true;
      setCfgStatus("\u6B63\u5728\u8FDE\u63A5 " + (cfgBaseUrl.value.trim() || "\u2026") + " \u2026", "info");
      const res = await bg("TEST_CONNECTION", { config: buildConfig() });
      cfgTest.disabled = false;
      if (res.ok) {
        const sample = Array.isArray(res.models) && res.models.length ? "\uFF1A" + res.models.slice(0, 4).join("\u3001") : "";
        setCfgStatus(`\u8FDE\u63A5\u6210\u529F\uFF0C\u53D1\u73B0 ${res.count} \u4E2A\u6A21\u578B${sample}`, "ok");
      } else {
        setCfgStatus("\u8FDE\u63A5\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF"), "err");
      }
    }
    settingsClose.addEventListener("click", closeSettings);
    cfgCancel.addEventListener("click", closeSettings);
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) closeSettings();
    });
    cfgSave.addEventListener("click", saveSettings);
    cfgTest.addEventListener("click", testConnection);
    cfgObTest.addEventListener("click", testObsidian);
    cfgObProtocol.addEventListener("change", () => {
      const port = Number(cfgObPort.value);
      if (!port || port === 27123 || port === 27124) {
        cfgObPort.value = cfgObProtocol.value === "https" ? "27124" : "27123";
      }
    });
    cfgToggleKey.addEventListener("click", () => {
      const revealed = cfgApiKey.type === "password";
      cfgApiKey.type = revealed ? "text" : "password";
      cfgToggleKey.classList.toggle("revealed", revealed);
    });
    document.addEventListener("keydown", (e) => {
      const settingsOpen = settingsModal.classList.contains("open");
      const imageOpen = imageModal.classList.contains("open");
      const shotOpen = shotModal.classList.contains("open");
      if (!settingsOpen && !imageOpen && !shotOpen) return;
      if (e.key === "Escape") {
        if (imageOpen) closeImagePanel();
        else if (shotOpen) closeShotPreview();
        else closeSettings();
        return;
      }
      if (e.key === "Enter" && settingsOpen && e.target?.tagName === "INPUT") {
        e.preventDefault();
        saveSettings();
      }
    });
    let lastImageUrl = "";
    function openImagePanel(prompt) {
      imgPrompt.value = prompt || "";
      imgStatus.className = "rtts-status";
      imgStatus.textContent = "";
      imgResult.classList.remove("show");
      imgResultImg.removeAttribute("src");
      imgActions.classList.remove("show");
      lastImageUrl = "";
      imageModal.classList.add("open");
      setTimeout(() => imgPrompt.focus(), 30);
    }
    function closeImagePanel() {
      imageModal.classList.remove("open");
    }
    async function generateImageInPage() {
      const prompt = imgPrompt.value.trim();
      if (!prompt) {
        toast("\u8BF7\u5148\u8F93\u5165\u63D0\u793A\u8BCD", "err");
        return;
      }
      const label = imgGenerate.querySelector("span");
      imgGenerate.disabled = true;
      imgGenerate.classList.add("loading");
      if (label) label.textContent = "\u751F\u6210\u4E2D\u2026";
      imgStatus.className = "rtts-status show info";
      imgStatus.textContent = "\u6B63\u5728\u8BF7\u6C42\u751F\u56FE\u63A5\u53E3\uFF0C\u901A\u5E38\u9700\u8981 20\u201330 \u79D2";
      const res = await bg("GENERATE_IMAGE", {
        prompt,
        size: imgSize.value,
        negativePrompt: imgNeg.value.trim()
      });
      imgGenerate.disabled = false;
      imgGenerate.classList.remove("loading");
      if (label) label.textContent = "\u751F\u6210\u56FE\u7247";
      if (res.ok && Array.isArray(res.images) && res.images.length) {
        lastImageUrl = res.images[0];
        imgResultImg.src = lastImageUrl;
        imgResult.classList.add("show");
        imgActions.classList.add("show");
        imgStatus.className = "rtts-status show ok";
        imgStatus.textContent = "\u751F\u6210\u5B8C\u6210 \xB7 " + (res.model || "MOSS-Image");
      } else {
        imgStatus.className = "rtts-status show err";
        imgStatus.textContent = res.error || "\u751F\u6210\u5931\u8D25";
      }
    }
    async function saveImageToNotes() {
      if (!lastImageUrl) return;
      const dataUrl = lastImageUrl.startsWith("data:") ? lastImageUrl : await fetchAsDataUrl(lastImageUrl);
      addNoteEntry({
        id: `image_${Date.now()}`,
        type: "image",
        at: Date.now(),
        imageUrl: dataUrl,
        text: imgPrompt.value.trim().slice(0, 80) || "\u751F\u6210\u914D\u56FE"
      });
      toast("\u5DF2\u5B58\u5165\u7B14\u8BB0", "ok");
      closeImagePanel();
    }
    function downloadImage() {
      if (!lastImageUrl) return;
      const a = document.createElement("a");
      a.href = lastImageUrl;
      a.download = `snooper-${Date.now()}.png`;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    }
    imgClose.addEventListener("click", closeImagePanel);
    imageModal.addEventListener("click", (e) => {
      if (e.target === imageModal) closeImagePanel();
    });
    imgGenerate.addEventListener("click", generateImageInPage);
    imgSave.addEventListener("click", saveImageToNotes);
    imgDownload.addEventListener("click", downloadImage);
    function render() {
      const s = session.state;
      recordBtn.className = "rtts-btn rtts-record-btn" + (s === "running" ? " running" : "");
      const recordLabel = session.isDemoMode ? s === "running" ? "\u505C\u6B62\u6F14\u793A" : "\u5F00\u59CB\u771F\u5B9E\u8F6C\u5199" : s === "running" ? "\u505C\u6B62\u8F6C\u5199" : s === "starting" ? "\u542F\u52A8\u4E2D" : "\u5F00\u59CB\u8F6C\u5199";
      recordBtn.setAttribute("data-tip", recordLabel);
      recordLabelEl.textContent = session.isDemoMode ? s === "running" ? "\u505C\u6B62\u6F14\u793A" : "\u6F14\u793A" : s === "running" ? "\u505C\u6B62" : s === "starting" ? "\u542F\u52A8\u4E2D" : "\u5B9E\u65F6\u5B57\u5E55";
      recordBtn.setAttribute("aria-label", recordLabel);
      updateLangLabel();
      const subs = session.subtitles || [];
      const streaming = session.streamingSubtitle;
      if (!uiHidden && (s === "running" || subs.length > 0 || streaming)) {
        subBox.classList.remove("hidden");
        const hasContent = subs.length > 0 || !!streaming;
        const silent = s === "running" && !!session.audioSilent;
        subStatus.classList.toggle("hidden", !silent);
        subPlaceholder.style.display = hasContent || silent ? "none" : "";
        subPlaceholder.textContent = session.isDemoMode ? "\u6F14\u793A\u6A21\u5F0F\u542F\u52A8\u4E2D\u2026" : "\u6B63\u5728\u8046\u542C\u2026";
        subRows.textContent = "";
        const wasAtBottom = subScroll.scrollHeight - subScroll.scrollTop - subScroll.clientHeight < 40;
        subs.forEach((sub) => {
          const row = document.createElement("div");
          row.className = "sub-row history";
          const trans = document.createElement("div");
          trans.className = "sub-trans";
          trans.textContent = sub.target || "...";
          row.appendChild(trans);
          if (sub.source) {
            const src = document.createElement("div");
            src.className = "sub-source";
            src.textContent = sub.source;
            row.appendChild(src);
          }
          subRows.appendChild(row);
        });
        const lastRow = subRows.lastElementChild;
        if (lastRow) lastRow.className = "sub-row current";
        if (streaming) {
          renderStreaming(streaming);
        } else {
          clearStreaming();
        }
        if (wasAtBottom || subs.length <= 3) {
          subScroll.scrollTop = subScroll.scrollHeight;
        }
      } else {
        subPlaceholder.style.display = "";
        subPlaceholder.textContent = "\u70B9\u51FB\u300C\u5F55\u97F3\u300D\u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199";
        subRows.textContent = "";
        clearStreaming();
        subBox.classList.add("hidden");
      }
      applyUiHidden();
      positionSubBox();
      updateChat();
      renderNotes();
    }
    function updateChat() {
      const msgs = session.messages || [];
      chatEl.textContent = "";
      if (msgs.length === 0) {
        const w = document.createElement("div");
        w.className = "rtts-msg assistant";
        w.textContent = "\u4F60\u597D\uFF0C\u6211\u662F\u89C6\u9891\u4F34\u5B66\u52A9\u624B\uFF0C\u53EF\u4EE5\u95EE\u6211\u5173\u4E8E\u5F53\u524D\u89C6\u9891\u5185\u5BB9\u7684\u95EE\u9898\u3002";
        chatEl.appendChild(w);
      } else {
        msgs.forEach((m) => {
          const b = document.createElement("div");
          b.className = `rtts-msg ${m.role === "user" ? "user" : "assistant"}`;
          const contentEl = document.createElement("div");
          contentEl.innerHTML = renderMarkdownLite(m.content || "");
          b.appendChild(contentEl);
          if (Array.isArray(m.images) && m.images.length > 0) {
            const imgGrid = document.createElement("div");
            imgGrid.className = "rtts-msg-images";
            for (const url of m.images) {
              const thumb = document.createElement("img");
              thumb.src = url;
              thumb.alt = "\u56FE\u7247";
              thumb.addEventListener("click", () => openShotPreview(url, true));
              imgGrid.appendChild(thumb);
            }
            b.appendChild(imgGrid);
          }
          chatEl.appendChild(b);
        });
      }
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    function renderStreaming(sub) {
      if (!sub || !sub.partialTarget && !sub.source) {
        streamingRow.classList.add("hidden");
        return;
      }
      streamingRow.classList.remove("hidden");
      const displayText = sub.partialTarget || "\u22EF";
      streamingText.textContent = displayText;
      if (sub.source) {
        streamingSource.textContent = sub.source;
        streamingSource.style.display = "block";
      } else {
        streamingSource.style.display = "none";
      }
      streamingLabel.textContent = "\u7FFB\u8BD1\u4E2D";
      if (subScroll.scrollHeight - subScroll.scrollTop - subScroll.clientHeight < 100) {
        subScroll.scrollTop = subScroll.scrollHeight;
      }
    }
    function clearStreaming() {
      streamingRow.classList.add("hidden");
    }
    const SUB_BOX_SIZE_KEY = "snooper.subtitle-box-size.v1";
    const SUB_BOX_COMPACT_KEY = "snooper.subtitle-box-compact.v1";
    let subBoxAutoPosition = true;
    let subBoxCompact = false;
    function persistSubBoxSize(width, height) {
      const size = { width: Math.round(width), height: Math.round(height) };
      try {
        localStorage.setItem(SUB_BOX_SIZE_KEY, JSON.stringify(size));
      } catch {
      }
      try {
        void chrome.storage?.local?.set({ [SUB_BOX_SIZE_KEY]: size });
      } catch {
      }
    }
    async function restoreSubBoxPreferences() {
      try {
        const localSize = JSON.parse(localStorage.getItem(SUB_BOX_SIZE_KEY) || "null");
        let size = localSize;
        if (!size) {
          const stored = await chrome.storage?.local?.get(SUB_BOX_SIZE_KEY);
          size = stored?.[SUB_BOX_SIZE_KEY];
        }
        if (typeof size?.width === "number" && typeof size?.height === "number") {
          subBoxAutoPosition = false;
          applySubBoxSize(size.width, size.height);
        }
        const storedCompact = await chrome.storage?.local?.get(SUB_BOX_COMPACT_KEY);
        subBoxCompact = localStorage.getItem(SUB_BOX_COMPACT_KEY) === "true" || storedCompact?.[SUB_BOX_COMPACT_KEY] === true;
        subBox.classList.toggle("compact", subBoxCompact);
      } catch {
      }
    }
    function applySubBoxSize(width, height) {
      const rect = subBox.getBoundingClientRect();
      const maxWidth = Math.max(220, Math.min(window.innerWidth - 24, window.innerWidth - rect.left - 12));
      const maxHeight = Math.max(100, Math.min(window.innerHeight - 24, window.innerHeight - rect.top - 12));
      subBox.style.width = `${Math.max(220, Math.min(maxWidth, width))}px`;
      subBox.style.height = `${Math.max(72, Math.min(maxHeight, height))}px`;
      subBox.style.maxHeight = "none";
    }
    function positionSubBox() {
      if (!subBoxAutoPosition) return;
      const maxWidth = Math.max(220, window.innerWidth - 32);
      const video = document.querySelector("video");
      if (video && video.readyState > 0) {
        const vr = video.getBoundingClientRect();
        const top = vr.top + vr.height * 0.75;
        const width = Math.min(vr.width * 0.72, 560, maxWidth);
        subBox.style.top = Math.max(top, 80) + "px";
        subBox.style.width = `${Math.max(220, Math.round(width))}px`;
        subBox.style.height = "auto";
        subBox.style.maxHeight = "24vh";
        subBox.style.bottom = "auto";
      } else {
        subBox.style.top = "";
        subBox.style.bottom = "26px";
        subBox.style.width = `${Math.min(Math.round(window.innerWidth * 0.72), 560, maxWidth)}px`;
        subBox.style.height = "auto";
        subBox.style.maxHeight = "24vh";
      }
    }
    const ro = window.ResizeObserver ? new ResizeObserver(() => positionSubBox()) : { observe() {
    }, disconnect() {
    } };
    ro.observe(document.body);
    document.addEventListener("scroll", positionSubBox, { passive: true });
    window.addEventListener("resize", positionSubBox, { passive: true });
    const BAR_POS_KEY = "snooper.toolbar-position.v1";
    function readBarPosition() {
      try {
        const raw = localStorage.getItem(BAR_POS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return parsed;
      } catch {
      }
      return null;
    }
    function clampBarPosition(x, y) {
      const rect = bar.getBoundingClientRect();
      return {
        x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - rect.width - 8)),
        y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - rect.height - 8))
      };
    }
    function applyBarPosition(x, y, persist = false) {
      const pos = clampBarPosition(x, y);
      bar.style.transform = "none";
      bar.style.left = `${pos.x}px`;
      bar.style.top = `${pos.y}px`;
      bar.classList.toggle("tips-up", pos.y > window.innerHeight / 2);
      if (persist) {
        try {
          localStorage.setItem(BAR_POS_KEY, JSON.stringify(pos));
        } catch {
        }
        try {
          chrome.storage?.local?.set({ [BAR_POS_KEY]: pos });
        } catch {
        }
      }
      if (langPickerOpen) positionLangPicker();
    }
    async function initBarPosition() {
      let saved = readBarPosition();
      if (!saved) {
        try {
          const stored = await chrome.storage?.local?.get(BAR_POS_KEY);
          const value = stored?.[BAR_POS_KEY];
          if (typeof value?.x === "number" && typeof value?.y === "number") saved = value;
        } catch {
        }
      }
      if (saved) {
        applyBarPosition(saved.x, saved.y);
        return;
      }
      const rect = bar.getBoundingClientRect();
      applyBarPosition((window.innerWidth - rect.width) / 2, 16);
    }
    let barDrag = null;
    barGrip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const rect = bar.getBoundingClientRect();
      barDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      bar.classList.add("dragging");
      barGrip.setPointerCapture(e.pointerId);
    });
    barGrip.addEventListener("pointermove", (e) => {
      if (!barDrag) return;
      applyBarPosition(e.clientX - barDrag.dx, e.clientY - barDrag.dy);
    });
    function endBarDrag() {
      if (!barDrag) return;
      barDrag = null;
      bar.classList.remove("dragging");
      const rect = bar.getBoundingClientRect();
      applyBarPosition(rect.left, rect.top, true);
    }
    barGrip.addEventListener("pointerup", endBarDrag);
    barGrip.addEventListener("pointercancel", endBarDrag);
    barGrip.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 24 : 8;
      const moves = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      };
      const move = moves[e.key];
      if (!move) return;
      e.preventDefault();
      const rect = bar.getBoundingClientRect();
      applyBarPosition(rect.left + move[0], rect.top + move[1], true);
    });
    window.addEventListener("resize", () => {
      const rect = bar.getBoundingClientRect();
      applyBarPosition(rect.left, rect.top, true);
    });
    function startDrag(e, el, offsetX, offsetY) {
      dragState = { el, offsetX, offsetY };
      el.style.cursor = "grabbing";
      el.style.transition = "none";
      e.preventDefault();
    }
    subHandle.addEventListener("mousedown", (e) => {
      subBoxAutoPosition = false;
      const rect = subBox.getBoundingClientRect();
      startDrag(e, subBox, e.clientX - rect.left, e.clientY - rect.top);
    });
    subBox.addEventListener("dblclick", (event) => {
      if (event.target.closest("#rtts-sub-resize, #rtts-sub-handle")) return;
      subBoxCompact = !subBoxCompact;
      subBox.classList.toggle("compact", subBoxCompact);
      try {
        localStorage.setItem(SUB_BOX_COMPACT_KEY, String(subBoxCompact));
      } catch {
      }
      try {
        void chrome.storage?.local?.set({ [SUB_BOX_COMPACT_KEY]: subBoxCompact });
      } catch {
      }
    });
    let subResizeState = null;
    subResize.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      subBoxAutoPosition = false;
      const rect = subBox.getBoundingClientRect();
      subBox.style.transform = "none";
      subBox.style.left = `${rect.left}px`;
      subBox.style.top = `${rect.top}px`;
      subBox.style.bottom = "auto";
      subResizeState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height };
      subResize.setPointerCapture(event.pointerId);
    });
    subResize.addEventListener("pointermove", (event) => {
      if (!subResizeState || subResizeState.pointerId !== event.pointerId) return;
      const width = subResizeState.width + event.clientX - subResizeState.startX;
      const height = subResizeState.height + event.clientY - subResizeState.startY;
      applySubBoxSize(width, height);
    });
    const endSubResize = (event) => {
      if (!subResizeState || subResizeState.pointerId !== event.pointerId) return;
      subResizeState = null;
      const rect = subBox.getBoundingClientRect();
      persistSubBoxSize(rect.width, rect.height);
    };
    subResize.addEventListener("pointerup", endSubResize);
    subResize.addEventListener("pointercancel", endSubResize);
    subResize.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 48 : 16;
      const delta = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      };
      const move = delta[event.key];
      if (!move) return;
      event.preventDefault();
      const rect = subBox.getBoundingClientRect();
      subBoxAutoPosition = false;
      applySubBoxSize(rect.width + move[0], rect.height + move[1]);
      persistSubBoxSize(subBox.getBoundingClientRect().width, subBox.getBoundingClientRect().height);
    });
    void restoreSubBoxPreferences();
    window.addEventListener("resize", () => {
      if (subBoxAutoPosition) return;
      const rect = subBox.getBoundingClientRect();
      applySubBoxSize(rect.width, rect.height);
    }, { passive: true });
    document.addEventListener("mousemove", (e) => {
      if (!dragState) return;
      const { el, offsetX, offsetY } = dragState;
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, x)) + "px";
      el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, y)) + "px";
      el.style.transform = "none";
    });
    document.addEventListener("mouseup", () => {
      if (!dragState) return;
      const el = dragState.el;
      dragState = null;
      el.style.cursor = el === subBox ? "grab" : "";
      setTimeout(() => {
        el.style.transition = "";
      }, 50);
    });
    recordBtn.addEventListener("click", async () => {
      const s = session.state;
      if (session.isDemoMode && s === "running") {
        stopDemoSubtitles();
        session.isDemoMode = false;
        session.state = "idle";
        render();
        return;
      }
      if (s === "running" || s === "starting") {
        session.state = "stopping";
        render();
        await bg("STOP");
        await syncSessionFromBackground();
      } else {
        if (session.isDemoMode) {
          stopDemoSubtitles();
          session.isDemoMode = false;
          session.subtitles = [];
        }
        session.state = "starting";
        render();
        const res = await bg("START", {
          sourceLang: session.sourceLang,
          targetLang: session.targetLang
        });
        if (!res.ok) {
          const msg = res.error || "\u542F\u52A8\u5931\u8D25";
          toast(msg, "err");
          if (msg.includes("API Key") || msg.includes("\u672A\u9009\u62E9\u6A21\u578B")) openSettings();
          await syncSessionFromBackground();
        } else {
          if (res.session) adoptBackgroundSession(res.session);
          else await syncSessionFromBackground();
        }
      }
    });
    function syncDrawerButtons() {
      chatBtn.classList.toggle("active", isDrawerOpen && drawerTab === "chat");
      notesBtn.classList.toggle("active", isDrawerOpen && drawerTab === "notes");
    }
    function setDrawerTab(tab) {
      drawerTab = tab;
      drawerTabChat.classList.toggle("active", tab === "chat");
      drawerTabNotes.classList.toggle("active", tab === "notes");
      drawerTabChat.setAttribute("aria-selected", String(tab === "chat"));
      drawerTabNotes.setAttribute("aria-selected", String(tab === "notes"));
      paneChat.classList.toggle("active", tab === "chat");
      paneNotes.classList.toggle("active", tab === "notes");
      if (tab === "notes") {
        setCiteOpen(false);
        renderNotes();
      }
      syncDrawerButtons();
    }
    function openDrawer(tab) {
      isDrawerOpen = true;
      drawer.classList.add("open");
      setDrawerTab(tab);
      if (tab === "notes") notesEditor.focus();
      else chatEditor.focus();
    }
    function closeDrawer() {
      isDrawerOpen = false;
      drawer.classList.remove("open");
      setCiteOpen(false);
      syncDrawerButtons();
    }
    chatBtn.addEventListener("click", () => {
      if (isDrawerOpen && drawerTab === "chat") closeDrawer();
      else openDrawer("chat");
    });
    notesBtn.addEventListener("click", () => {
      if (isDrawerOpen && drawerTab === "notes") closeDrawer();
      else openDrawer("notes");
    });
    drawerTabChat.addEventListener("click", () => setDrawerTab("chat"));
    drawerTabNotes.addEventListener("click", () => setDrawerTab("notes"));
    shadow.getElementById("rtts-drawer-close").addEventListener("click", closeDrawer);
    function renderMarkdownLite(text) {
      const escaped = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const codeBlocks = [];
      let html2 = escaped.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
        const body = code.replace(/^\n+|\n+$/g, "");
        codeBlocks.push(`<pre><code>${body}</code></pre>`);
        return `\0CODEBLOCK${codeBlocks.length - 1}\0`;
      });
      const inlineCodes = [];
      html2 = html2.replace(/`([^`\n]+)`/g, (_match, code) => {
        inlineCodes.push(`<code>${code}</code>`);
        return `\0INLINECODE${inlineCodes.length - 1}\0`;
      });
      html2 = html2.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\n/g, "<br>");
      inlineCodes.forEach((code, index) => {
        html2 = html2.replace(`\0INLINECODE${index}\0`, code);
      });
      codeBlocks.forEach((block, index) => {
        html2 = html2.replace(`\0CODEBLOCK${index}\0`, block);
      });
      return html2;
    }
    let pendingImages = [];
    let isPreviewing = false;
    function getEditorText(editor) {
      const raw = (editor.innerText || editor.textContent || "").replace(/\u00a0/g, " ");
      return raw.replace(/\n{3,}/g, "\n\n").trim();
    }
    function getChatText() {
      return getEditorText(chatEditor);
    }
    function clearChatEditor() {
      chatEditor.innerHTML = "";
    }
    function refreshEditorPlaceholder(editor, previewing) {
      if (previewing) return;
      if (!(editor.textContent || "").trim() && !editor.querySelector("img")) {
        editor.innerHTML = "";
      }
    }
    function bindEditorInput(editor, isPreviewingFn) {
      let composing = false;
      editor.addEventListener("compositionstart", () => {
        composing = true;
      });
      editor.addEventListener("compositionend", () => {
        composing = false;
        refreshEditorPlaceholder(editor, isPreviewingFn());
      });
      editor.addEventListener("input", (e) => {
        if (composing || e.isComposing) return;
        refreshEditorPlaceholder(editor, isPreviewingFn());
      });
    }
    bindEditorInput(chatEditor, () => isPreviewing);
    function insertMarkdown(editor, prefix, suffix, placeholder, isPreviewingFn) {
      editor.focus();
      const selection = window.getSelection();
      let selected = "";
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (editor.contains(range.commonAncestorContainer)) {
          selected = range.toString();
        }
      }
      document.execCommand("insertText", false, prefix + (selected || placeholder) + suffix);
      refreshEditorPlaceholder(editor, isPreviewingFn());
    }
    function bindMarkdownToolbar(toolbarId, editor, isPreviewingFn, leavePreview) {
      shadow.querySelectorAll(`#${toolbarId} [data-md]`).forEach((button) => {
        button.addEventListener("click", () => {
          if (isPreviewingFn()) leavePreview();
          const kind = button.dataset.md;
          if (kind === "bold") insertMarkdown(editor, "**", "**", "\u52A0\u7C97\u6587\u5B57", isPreviewingFn);
          else if (kind === "italic") insertMarkdown(editor, "*", "*", "\u659C\u4F53\u6587\u5B57", isPreviewingFn);
          else if (kind === "code") insertMarkdown(editor, "`", "`", "\u4EE3\u7801", isPreviewingFn);
          else if (kind === "link") insertMarkdown(editor, "[", "](https://)", "\u94FE\u63A5\u6587\u5B57", isPreviewingFn);
        });
      });
      editor.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "i")) {
          e.preventDefault();
          if (e.key === "b") insertMarkdown(editor, "**", "**", "\u52A0\u7C97\u6587\u5B57", isPreviewingFn);
          else insertMarkdown(editor, "*", "*", "\u659C\u4F53\u6587\u5B57", isPreviewingFn);
        }
      });
    }
    bindMarkdownToolbar("rtts-chat-toolbar", chatEditor, () => isPreviewing, () => {
      if (isPreviewing) togglePreview();
    });
    function togglePreview() {
      isPreviewing = !isPreviewing;
      mdPreviewBtn.classList.toggle("active", isPreviewing);
      if (isPreviewing) {
        const text = getChatText();
        chatPreview.innerHTML = text ? renderMarkdownLite(text) : '<span class="rtts-md-empty">\u6CA1\u6709\u53EF\u9884\u89C8\u7684\u5185\u5BB9</span>';
        chatPreview.hidden = false;
        chatEditor.hidden = true;
        mdPreviewBtn.textContent = "\u7F16\u8F91";
      } else {
        chatPreview.hidden = true;
        chatEditor.hidden = false;
        mdPreviewBtn.textContent = "\u9884\u89C8";
        chatEditor.focus();
      }
    }
    mdPreviewBtn.addEventListener("click", togglePreview);
    function renderAttachments() {
      chatAttachments.textContent = "";
      if (pendingImages.length === 0) return;
      for (let i = 0; i < pendingImages.length; i++) {
        const url = pendingImages[i];
        const chip = document.createElement("div");
        chip.className = "rtts-attach";
        const img = document.createElement("img");
        img.src = url;
        img.alt = "\u5DF2\u6DFB\u52A0\u56FE\u7247";
        chip.appendChild(img);
        const remove = document.createElement("button");
        remove.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        remove.setAttribute("aria-label", "\u79FB\u9664\u56FE\u7247");
        remove.addEventListener("click", () => {
          pendingImages.splice(i, 1);
          renderAttachments();
        });
        chip.appendChild(remove);
        chatAttachments.appendChild(chip);
      }
    }
    let isNotesPreviewing = false;
    bindEditorInput(notesEditor, () => isNotesPreviewing);
    bindMarkdownToolbar("rtts-notes-toolbar", notesEditor, () => isNotesPreviewing, () => {
      if (isNotesPreviewing) toggleNotesPreview();
    });
    function toggleNotesPreview() {
      isNotesPreviewing = !isNotesPreviewing;
      notesPreviewBtn.classList.toggle("active", isNotesPreviewing);
      if (isNotesPreviewing) {
        const text = getEditorText(notesEditor);
        notesPreview.innerHTML = text ? renderMarkdownLite(text) : '<span class="rtts-md-empty">\u6CA1\u6709\u53EF\u9884\u89C8\u7684\u5185\u5BB9</span>';
        notesPreview.hidden = false;
        notesEditor.hidden = true;
        notesPreviewBtn.textContent = "\u7F16\u8F91";
      } else {
        notesPreview.hidden = true;
        notesEditor.hidden = false;
        notesPreviewBtn.textContent = "\u9884\u89C8";
        notesEditor.focus();
      }
    }
    notesPreviewBtn.addEventListener("click", toggleNotesPreview);
    notesEditor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        addQuickNote();
      }
    });
    function citeCandidates() {
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      const notes = [...session.notes || []].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const note of notes) {
        for (let i = note.entries.length - 1; i >= 0; i--) {
          const entry = note.entries[i];
          if (entry.type !== "screenshot" && entry.type !== "image") continue;
          if (!entry.imageUrl || seen.has(entry.imageUrl)) continue;
          seen.add(entry.imageUrl);
          const time = new Date(entry.at).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit"
          });
          out.push({
            url: entry.imageUrl,
            label: `${entry.type === "screenshot" ? "\u622A\u56FE" : "\u56FE\u7247"} \xB7 ${time}`
          });
        }
      }
      return out.slice(0, 24);
    }
    function renderCiteList() {
      const candidates = citeCandidates();
      citeList.textContent = "";
      citeEmpty.hidden = candidates.length > 0;
      for (const candidate of candidates) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "rtts-cite-item";
        if (pendingImages.includes(candidate.url)) item.classList.add("used");
        item.setAttribute("aria-label", `\u5F15\u7528${candidate.label}`);
        const img = document.createElement("img");
        img.src = candidate.url;
        img.alt = candidate.label;
        item.appendChild(img);
        const caption = document.createElement("span");
        caption.textContent = candidate.label;
        item.appendChild(caption);
        item.addEventListener("click", () => {
          if (pendingImages.includes(candidate.url)) {
            toast("\u8FD9\u5F20\u622A\u56FE\u5DF2\u7ECF\u5F15\u7528\u4E86", "ok");
            return;
          }
          if (pendingImages.length >= 4) {
            toast("\u6700\u591A\u5F15\u7528 4 \u5F20\u56FE\u7247", "err");
            return;
          }
          pendingImages.push(candidate.url);
          renderAttachments();
          positionCitePopover();
          item.classList.add("used");
          toast("\u5DF2\u5F15\u7528\u622A\u56FE\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u63D0\u95EE", "ok");
        });
        citeList.appendChild(item);
      }
    }
    function positionCitePopover() {
      const composer = citePopover.parentElement;
      const shell = composer?.querySelector(".rtts-md-shell");
      if (!composer || !shell) return;
      const shellTop = shell.getBoundingClientRect().top;
      const gap = 6;
      const top = Math.max(8, shellTop - gap);
      citePopover.style.bottom = `${Math.max(8, composer.getBoundingClientRect().bottom - top)}px`;
      citePopover.style.maxHeight = `${Math.max(140, top - 12)}px`;
    }
    function setCiteOpen(open) {
      if (open) renderCiteList();
      if (!open && citePopover.contains(shadow.activeElement)) citeBtn.focus();
      citePopover.hidden = !open;
      citeBtn.setAttribute("aria-expanded", String(open));
      citeBtn.classList.toggle("active", open);
      if (open) {
        positionCitePopover();
        const first = citeList.querySelector(".rtts-cite-item");
        first?.focus();
      }
    }
    window.addEventListener("resize", () => {
      if (!citePopover.hidden) positionCitePopover();
    });
    chatEditor.addEventListener("input", () => {
      if (!citePopover.hidden) positionCitePopover();
    });
    citeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setCiteOpen(citePopover.hidden !== false);
    });
    citeClose.addEventListener("click", () => {
      setCiteOpen(false);
      chatEditor.focus();
    });
    document.addEventListener("click", (e) => {
      if (citePopover.hidden) return;
      if (e.composedPath().includes(citePopover) || e.composedPath().includes(citeBtn)) return;
      setCiteOpen(false);
    });
    async function compressImage(file) {
      return new Promise((resolve, reject) => {
        if (file.size > 10 * 1024 * 1024) {
          reject(new Error("\u56FE\u7247\u8FC7\u5927\uFF08\u8D85\u8FC7 10MB\uFF09"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            let w = img.naturalWidth;
            let h = img.naturalHeight;
            const max = 1280;
            if (w > max || h > max) {
              if (w > h) {
                h = Math.round(h * max / w);
                w = max;
              } else {
                w = Math.round(w * max / h);
                h = max;
              }
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("\u538B\u7F29\u5931\u8D25"));
              return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          };
          img.onerror = () => reject(new Error("\u56FE\u7247\u89E3\u7801\u5931\u8D25"));
          img.src = reader.result;
        };
        reader.onerror = () => reject(new Error("\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25"));
        reader.readAsDataURL(file);
      });
    }
    function addFiles(files) {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        if (pendingImages.length >= 4) {
          toast("\u6700\u591A 4 \u5F20\u56FE\u7247", "err");
          break;
        }
        compressImage(file).then((dataUrl) => {
          pendingImages.push(dataUrl);
          renderAttachments();
        }).catch((err) => {
          toast(err.message, "err");
        });
      }
    }
    chatAttachBtn.addEventListener("click", () => chatFile.click());
    chatFile.addEventListener("change", () => {
      if (chatFile.files) {
        addFiles(chatFile.files);
        chatFile.value = "";
      }
    });
    chatEditor.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type?.startsWith("image/") && item.getAsFile) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        addFiles(imageFiles);
      }
    });
    chatComposer.addEventListener("dragover", (e) => {
      e.preventDefault();
      chatComposer.classList.add("dragover");
    });
    chatComposer.addEventListener("dragleave", () => chatComposer.classList.remove("dragover"));
    chatComposer.addEventListener("drop", (e) => {
      e.preventDefault();
      chatComposer.classList.remove("dragover");
      if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
    });
    async function sendQuestion() {
      if (isAskBusy) return;
      setCiteOpen(false);
      if (isPreviewing) togglePreview();
      const q = getChatText();
      const imgs = pendingImages.slice();
      if (!q && imgs.length === 0) return;
      isAskBusy = true;
      clearChatEditor();
      pendingImages = [];
      renderAttachments();
      chatEditor.setAttribute("contenteditable", "false");
      sendBtn.disabled = true;
      sendBtn.textContent = "...";
      if (!session.messages) session.messages = [];
      session.messages.push({ role: "user", content: q || "\uFF08\u56FE\u7247\uFF09", images: imgs.length > 0 ? imgs : void 0 });
      updateChat();
      const rid = "q_" + Date.now();
      const res = await bg("ASK", { question: q, images: imgs, requestId: rid });
      session.messages.push({
        role: "assistant",
        content: res.ok && res.answer ? res.answer : "\u8BF7\u6C42\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF")
      });
      isAskBusy = false;
      chatEditor.setAttribute("contenteditable", "plaintext-only");
      sendBtn.disabled = false;
      sendBtn.textContent = "\u53D1\u9001";
      updateChat();
      chatEditor.focus();
    }
    sendBtn.addEventListener("click", sendQuestion);
    chatEditor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !isPreviewing) {
        e.preventDefault();
        void sendQuestion();
      }
    });
    function setMenuOpen(open) {
      toolsMenu.classList.toggle("open", open);
      moreBtn.classList.toggle("active", open);
      moreBtn.setAttribute("aria-expanded", String(open));
    }
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMenuOpen(!toolsMenu.classList.contains("open"));
    });
    toolsMenu.addEventListener("click", () => setMenuOpen(false));
    function menuItems() {
      return Array.from(toolsMenu.querySelectorAll(".rtts-menu-item"));
    }
    moreBtn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      setMenuOpen(true);
      const items = menuItems();
      (e.key === "ArrowDown" ? items[0] : items[items.length - 1])?.focus();
    });
    toolsMenu.addEventListener("keydown", (e) => {
      const items = menuItems();
      if (items.length === 0) return;
      const active = shadow.activeElement;
      const index = active ? items.indexOf(active) : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(index + 1) % items.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        moreBtn.focus();
      } else if (e.key === "Tab") {
        setMenuOpen(false);
      }
    });
    shadow.addEventListener("click", (e) => {
      if (!toolsMenu.classList.contains("open")) return;
      const path = e.composedPath?.() || [];
      if (path.includes(moreBtn) || path.includes(toolsMenu)) return;
      setMenuOpen(false);
    });
    shadow.getElementById("rtts-settings-btn").addEventListener("click", () => {
      openSettings();
    });
    hideBtn.addEventListener("click", () => {
      uiHidden = true;
      persistUiHidden();
      applyUiHidden();
      toast("\u5DE5\u5177\u5DF2\u5173\u95ED", "ok");
    });
    showBtn.addEventListener("click", () => {
      uiHidden = false;
      hasBeenShownOnce = true;
      persistUiHidden();
      applyUiHidden();
      render();
    });
    window.addEventListener("message", (e) => {
      if (!e.data || e.data.type !== "rtts:fullscreen") return;
      if (e.data.action === "enter" && (document.fullscreenElement || document.webkitFullscreenElement)) {
        const el = document.fullscreenElement || document.webkitFullscreenElement;
        const tag = (el.tagName || "").toLowerCase();
        if (tag === "video" || tag === "iframe") {
          fsWarn.textContent = "\u89C6\u9891\u786C\u4EF6\u5168\u5C4F\uFF0C\u5B57\u5E55\u5DF2\u79FB\u81F3\u5E95\u90E8\u3002\u5EFA\u8BAE\u9000\u51FA\u5168\u5C4F\u6216\u4F7F\u7528\u7F51\u9875\u5168\u5C4F\u3002";
          fsWarn.classList.remove("hidden");
          subBox.style.bottom = "20px";
          subBox.style.top = "auto";
          subBox.style.width = "min(90vw, 900px)";
        } else {
          fsWarn.classList.add("hidden");
          positionSubBox();
        }
      } else if (e.data.action === "exit") {
        fsWarn.classList.add("hidden");
        setTimeout(positionSubBox, 300);
      }
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) {
        fsWarn.classList.add("hidden");
        setTimeout(positionSubBox, 300);
      }
    });
    function getOrCreateActiveNote() {
      if (session.activeNoteId) {
        const existing = session.notes.find((n) => n.id === session.activeNoteId);
        if (existing) return existing;
      }
      const note = createNoteDocument(
        `\u7FFB\u8BD1\u7B14\u8BB0 ${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
        { source: "translate" }
      );
      session.notes.push(note);
      session.activeNoteId = note.id;
      persistNotes();
      return note;
    }
    function addNoteEntry(entry) {
      const note = getOrCreateActiveNote();
      note.entries.push(entry);
      note.updatedAt = Date.now();
      persistNotes();
      renderNotes();
    }
    function persistNotes() {
      saveNotes(session.notes);
    }
    function renderNotes() {
      const active = session.activeNoteId ? session.notes.find((n) => n.id === session.activeNoteId) : null;
      const noteCount = active?.entries.length ?? 0;
      notesCount.textContent = String(noteCount);
      notesBtn.setAttribute("data-tip", `\u7B14\u8BB0${noteCount ? `\uFF08${noteCount}\uFF09` : ""}`);
      notesBadge.textContent = noteCount > 99 ? "99+" : String(noteCount);
      notesBadge.hidden = noteCount === 0;
      notesList.textContent = "";
      const hasEntries = !!(active && active.entries.length > 0);
      if (!hasEntries) {
        const empty = document.createElement("p");
        empty.id = "rtts-notes-empty";
        empty.textContent = "\u8FD8\u6CA1\u6709\u7B14\u8BB0\uFF0C\u70B9\u51FB\u53F3\u4FA7\u7684\u300C\u8BB0\u5165\u7B14\u8BB0\u300D\u5F00\u59CB\u8BB0\u5F55\u3002";
        notesList.appendChild(empty);
      }
      if (hasEntries && active) {
        active.entries.slice(-10).forEach((entry) => {
          const item = document.createElement("div");
          item.className = "note-item";
          if (entry.type === "image" || entry.type === "svg" || entry.type === "screenshot") {
            item.style.flexDirection = "column";
            item.style.gap = "4px";
          }
          if ((entry.type === "image" || entry.type === "screenshot") && entry.imageUrl) {
            const img = document.createElement("img");
            img.src = entry.imageUrl;
            img.className = "note-img-preview";
            img.alt = "\u7B14\u8BB0\u56FE\u7247";
            img.style.cssText = "max-width:100%;max-height:80px;border-radius:4px;object-fit:cover;cursor:pointer";
            img.addEventListener("click", () => openShotPreview(entry.imageUrl, true));
            item.appendChild(img);
          }
          if (entry.type === "svg" && entry.svg) {
            const svgPreview = document.createElement("div");
            svgPreview.style.cssText = "max-width:100%;max-height:60px;overflow:hidden;border-radius:4px";
            try {
              const parsed = new DOMParser().parseFromString(entry.svg, "image/svg+xml");
              const svgEl = parsed.querySelector("svg");
              if (svgEl) {
                svgEl.setAttribute("width", "100%");
                svgPreview.appendChild(svgEl);
              }
            } catch {
              svgPreview.textContent = "SVG \u9884\u89C8\u4E0D\u53EF\u7528";
            }
            item.appendChild(svgPreview);
          }
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:flex-start;gap:4px;width:100%";
          const text = document.createElement("span");
          const content = entry.text || entry.target || entry.source || "\u7B14\u8BB0";
          if (entry.type === "text") {
            text.className = "note-text note-md";
            text.innerHTML = renderMarkdownLite(content);
          } else {
            text.className = "note-text truncated";
            text.textContent = content;
          }
          row.appendChild(text);
          const typeLabel = document.createElement("span");
          typeLabel.className = "note-type";
          const typeMap = { subtitle: "\u5B57\u5E55", image: "\u914D\u56FE", svg: "\u77E2\u91CF", screenshot: "\u622A\u56FE", text: "\u6587\u672C", summary: "\u6458\u8981" };
          typeLabel.textContent = typeMap[entry.type] || "\u7B14\u8BB0";
          row.appendChild(typeLabel);
          const delBtn = document.createElement("button");
          delBtn.className = "note-del";
          delBtn.setAttribute("aria-label", "\u5220\u9664\u7B14\u8BB0\u6761\u76EE");
          delBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
          delBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            active.entries = active.entries.filter((e2) => e2.id !== entry.id);
            persistNotes();
            renderNotes();
          });
          row.appendChild(delBtn);
          item.appendChild(row);
          notesList.appendChild(item);
        });
        notesList.scrollTop = notesList.scrollHeight;
      }
    }
    function loadImageElement(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("\u622A\u56FE\u89E3\u7801\u5931\u8D25"));
        img.src = src;
      });
    }
    function getVideoContentRect(video) {
      const r = video.getBoundingClientRect();
      let x = r.left;
      let y = r.top;
      let w = r.width;
      let h = r.height;
      if (!w || !h || !video.videoWidth || !video.videoHeight) return null;
      const fit = getComputedStyle(video).objectFit || "contain";
      if (fit === "contain" || fit === "scale-down") {
        const videoAspect = video.videoWidth / video.videoHeight;
        const boxAspect = w / h;
        if (videoAspect > boxAspect) {
          const nh = w / videoAspect;
          y += (h - nh) / 2;
          h = nh;
        } else {
          const nw = h * videoAspect;
          x += (w - nw) / 2;
          w = nw;
        }
      }
      const left = Math.max(0, x);
      const top = Math.max(0, y);
      const right = Math.min(window.innerWidth, x + w);
      const bottom = Math.min(window.innerHeight, y + h);
      if (right - left < 8 || bottom - top < 8) return null;
      return { x: left, y: top, w: right - left, h: bottom - top };
    }
    async function captureVideoFrame() {
      const video = document.querySelector("video");
      if (!video) throw new Error("\u5F53\u524D\u9875\u9762\u6CA1\u6709\u89C6\u9891");
      if (!video.videoWidth || !video.videoHeight) throw new Error("\u89C6\u9891\u8FD8\u6CA1\u6709\u753B\u9762\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
      const rect = getVideoContentRect(video);
      if (!rect) throw new Error("\u89C6\u9891\u4E0D\u5728\u53EF\u89C6\u533A\u57DF\u5185");
      host.style.display = "none";
      try {
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
        const res = await bg("CAPTURE_SCREENSHOT");
        if (!res.ok || !res.dataUrl) throw new Error(res.error || "\u6D4F\u89C8\u5668\u622A\u56FE\u5931\u8D25");
        const img = await loadImageElement(res.dataUrl);
        const scaleX = img.naturalWidth / Math.max(1, window.innerWidth);
        const scaleY = img.naturalHeight / Math.max(1, window.innerHeight);
        const sx = Math.round(rect.x * scaleX);
        const sy = Math.round(rect.y * scaleY);
        const sw = Math.max(1, Math.round(rect.w * scaleX));
        const sh = Math.max(1, Math.round(rect.h * scaleY));
        let outW = sw;
        let outH = sh;
        const maxW = 1600;
        if (outW > maxW) {
          outH = Math.round(outH * maxW / outW);
          outW = maxW;
        }
        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u753B\u5E03");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        return canvas.toDataURL("image/jpeg", 0.9);
      } finally {
        host.style.display = "";
      }
    }
    let shotPreviewUrl = "";
    function openShotPreview(dataUrl, saved) {
      shotPreviewUrl = dataUrl;
      shotImg.src = dataUrl;
      shotSave.disabled = saved;
      shotSave.textContent = saved ? "\u5DF2\u5B58\u5165\u7B14\u8BB0" : "\u5B58\u5165\u7B14\u8BB0";
      shotModal.classList.add("open");
    }
    function closeShotPreview() {
      shotModal.classList.remove("open");
      shotImg.removeAttribute("src");
    }
    function downloadShot() {
      if (!shotPreviewUrl) return;
      const a = document.createElement("a");
      a.href = shotPreviewUrl;
      a.download = `snooper-video-${Date.now()}.jpg`;
      a.click();
    }
    shotClose.addEventListener("click", closeShotPreview);
    shotCloseX.addEventListener("click", closeShotPreview);
    shotDownload.addEventListener("click", downloadShot);
    shotModal.addEventListener("click", (e) => {
      if (e.target === shotModal) closeShotPreview();
    });
    shotSave.addEventListener("click", () => {
      if (!shotPreviewUrl) return;
      addNoteEntry({
        id: `screenshot_${Date.now()}`,
        type: "screenshot",
        at: Date.now(),
        imageUrl: shotPreviewUrl,
        text: "\u89C6\u9891\u622A\u56FE"
      });
      shotSave.disabled = true;
      shotSave.textContent = "\u5DF2\u5B58\u5165\u7B14\u8BB0";
      toast("\u622A\u56FE\u5DF2\u5B58\u5165\u7B14\u8BB0", "ok");
    });
    function getSubtitleText() {
      return (session.subtitles || []).map((sub) => {
        const t = sub.target || "";
        const s = sub.source ? ` [${sub.source}]` : "";
        return `${t}${s}`;
      }).join("\n");
    }
    function collectNoteAssets(notes, messages) {
      const assets = [];
      const stamp = Date.now();
      notes.forEach((note) => note.entries.forEach((entry) => {
        const entryId = `note:${note.id}:${entry.id}`;
        if ((entry.type === "image" || entry.type === "screenshot") && entry.imageUrl?.startsWith("data:")) {
          const mime = /^data:([^;,]+)/.exec(entry.imageUrl)?.[1] || "image/png";
          const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "png";
          assets.push({ entryId, fileName: `snooper-${stamp}-${assets.length + 1}.${ext}`, dataUrl: entry.imageUrl, mimeType: mime });
        } else if (entry.type === "svg" && entry.svg) {
          assets.push({ entryId, fileName: `snooper-${stamp}-${assets.length + 1}.svg`, rawText: entry.svg, mimeType: "image/svg+xml" });
        }
      }));
      messages.forEach((message, messageIndex) => (message.images || []).forEach((image, imageIndex) => {
        if (!image.startsWith("data:")) return;
        const mime = /^data:([^;,]+)/.exec(image)?.[1] || "image/png";
        const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "png";
        assets.push({
          entryId: `chat:${messageIndex}:${imageIndex}`,
          fileName: `snooper-${stamp}-${assets.length + 1}.${ext}`,
          dataUrl: image,
          mimeType: mime
        });
      }));
      return assets;
    }
    function getSubtitleMarkdown(assetNames) {
      const lines = [
        `# snooper-browser \u7FFB\u8BD1\u8BB0\u5F55`,
        ``,
        `- **\u65F6\u95F4**\uFF1A${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}`,
        `- **\u8BED\u8A00\u65B9\u5411**\uFF1A${LANG_MAP[session.sourceLang] || session.sourceLang} \u2192 ${LANG_MAP[session.targetLang] || session.targetLang}`,
        `- **\u5B57\u5E55\u6761\u76EE**\uFF1A${session.subtitles.length} \u6761`,
        ``,
        `---`,
        ``,
        `| \u65F6\u95F4 | \u8BD1\u6587 | \u539F\u6587 |`,
        `| :--- | :--- | :--- |`
      ];
      for (const sub of session.subtitles) {
        const time = sub.at ? new Date(sub.at).toLocaleTimeString("zh-CN") : "";
        const t = (sub.target || "").replace(/\|/g, "\\|");
        const s = (sub.source || "").replace(/\|/g, "\\|");
        lines.push(`| ${time} | ${t} | ${s} |`);
      }
      if (session.messages.length > 0) {
        lines.push("", "---", "", "## \u4F34\u5B66\u5BF9\u8BDD", "");
        session.messages.forEach((message, messageIndex) => {
          lines.push(`### ${message.role === "user" ? "\u63D0\u95EE" : "\u56DE\u7B54"}`, "", message.content || "\uFF08\u56FE\u7247\uFF09", "");
          (message.images || []).forEach((image, imageIndex) => {
            const uploaded = assetNames?.get(`chat:${messageIndex}:${imageIndex}`);
            if (uploaded) lines.push(`![[${uploaded}]]`, "");
            else if (/^https?:\/\//i.test(image)) lines.push(`![\u4F34\u5B66\u56FE\u7247](${image})`, "");
            else lines.push("> [\u4F34\u5B66\u56FE\u7247\u672A\u80FD\u4E0A\u4F20]", "");
          });
        });
      }
      session.notes.forEach((note) => {
        if (note.entries.length === 0) return;
        lines.push("", "---", "", `## \u7B14\u8BB0\uFF1A${note.title || "\u672A\u547D\u540D\u7B14\u8BB0"}`, "");
        note.entries.forEach((entry) => {
          const label = entry.text || entry.target || "\u7B14\u8BB0";
          const isVisual = entry.type === "image" || entry.type === "screenshot" || entry.type === "svg";
          if (isVisual) {
            const uploaded = assetNames?.get(`note:${note.id}:${entry.id}`);
            if (uploaded) lines.push(`![[${uploaded}]]`);
            else if (entry.imageUrl && /^https?:\/\//i.test(entry.imageUrl)) lines.push(`![${label}](${entry.imageUrl})`);
            else if (entry.svg) lines.push("```svg", entry.svg, "```");
            else lines.push(`> [\u56FE\u7247\uFF1A${label} \u2014 \u56FE\u7247\u6570\u636E\u65E0\u6CD5\u76F4\u63A5\u5D4C\u5165 Markdown]`);
            if (entry.text) lines.push("", `*${entry.text}*`);
            lines.push("");
          } else if (entry.target) {
            lines.push(`- ${entry.target} ${entry.source ? `\uFF08${entry.source}\uFF09` : ""}`);
          } else if (entry.text) lines.push(`- ${entry.text}`);
        });
      });
      return lines.join("\n");
    }
    function downloadBlob(filename, content, mimeType = "text/plain;charset=utf-8") {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2e3);
    }
    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          ta.remove();
          return ok;
        } catch {
          return false;
        }
      }
    }
    copyBtn.addEventListener("click", async () => {
      const text = getSubtitleText();
      if (!text) {
        toast("\u6CA1\u6709\u5B57\u5E55\u53EF\u590D\u5236", "err");
        return;
      }
      const ok = await copyText(text);
      if (ok) {
        flashChip(copyBtn);
        toast("\u5DF2\u590D\u5236\u5168\u90E8\u5B57\u5E55", "ok");
      } else {
        toast("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u8BBE\u7F6E\u4E2D\u5141\u8BB8\u526A\u8D34\u677F\u8BBF\u95EE", "err");
      }
    });
    exportTxtBtn.addEventListener("click", () => {
      const text = getSubtitleText();
      if (!text) {
        toast("\u6CA1\u6709\u5B57\u5E55\u53EF\u5BFC\u51FA", "err");
        return;
      }
      downloadBlob(`snooper-subtitles-${Date.now()}.txt`, text);
      flashChip(exportTxtBtn);
      toast("TXT \u5DF2\u5BFC\u51FA", "ok");
    });
    exportMdBtn.addEventListener("click", () => {
      const text = getSubtitleMarkdown();
      if (!text) {
        toast("\u6CA1\u6709\u5185\u5BB9\u53EF\u5BFC\u51FA", "err");
        return;
      }
      downloadBlob(`snooper-notes-${Date.now()}.md`, text);
      flashChip(exportMdBtn);
      toast("Markdown \u5DF2\u5BFC\u51FA", "ok");
    });
    noteBtn.addEventListener("click", () => {
      const subs = session.subtitles;
      if (subs.length === 0) {
        toast("\u6CA1\u6709\u5B57\u5E55\u53EF\u8BB0\u5F55", "err");
        return;
      }
      const last = subs[subs.length - 1];
      addNoteEntry({
        id: `note_${Date.now()}`,
        type: "subtitle",
        at: Date.now(),
        source: last.source,
        target: last.target,
        sourceLang: session.sourceLang,
        targetLang: session.targetLang
      });
      flashChip(noteBtn);
      toast("\u5DF2\u8BB0\u5165\u7B14\u8BB0", "ok");
    });
    imageBtn.addEventListener("click", () => {
      const subs = session.subtitles;
      const last = subs[subs.length - 1];
      openImagePanel(last?.target || last?.source || "");
    });
    screenshotBtn.addEventListener("click", async () => {
      screenshotBtn.classList.add("busy");
      try {
        const dataUrl = await captureVideoFrame();
        addNoteEntry({
          id: `screenshot_${Date.now()}`,
          type: "screenshot",
          at: Date.now(),
          imageUrl: dataUrl,
          text: "\u89C6\u9891\u622A\u56FE"
        });
        openShotPreview(dataUrl, true);
        flashChip(screenshotBtn);
        toast("\u5DF2\u622A\u53D6\u89C6\u9891\u753B\u9762\u5E76\u5B58\u5165\u7B14\u8BB0", "ok");
      } catch (err) {
        toast("\u622A\u56FE\u5931\u8D25\uFF1A" + (err.message || "\u672A\u77E5\u9519\u8BEF"), "err");
      } finally {
        screenshotBtn.classList.remove("busy");
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      if (!citePopover.hidden) {
        setCiteOpen(false);
        return;
      }
      if (isDrawerOpen) closeDrawer();
    });
    function addQuickNote() {
      if (isNotesPreviewing) toggleNotesPreview();
      const text = getEditorText(notesEditor);
      if (!text) return;
      addNoteEntry({
        id: `text_${Date.now()}`,
        type: "text",
        at: Date.now(),
        text
      });
      notesEditor.innerHTML = "";
      notesEditor.focus();
    }
    notesAdd.addEventListener("click", addQuickNote);
    obsidianBtn.addEventListener("click", async () => {
      const obsidianConfig = await loadObsidianConfig();
      if (!obsidianConfig.apiKey) {
        toast("\u8BF7\u5148\u586B\u5199 Obsidian API Key", "err");
        await openSettings();
        cfgObKey.focus();
        return;
      }
      const assets = collectNoteAssets(session.notes, session.messages);
      const uploadedNames = /* @__PURE__ */ new Map();
      let uploadedCount = 0;
      let failedCount = 0;
      if (assets.length > 0) {
        toast(`\u6B63\u5728\u4E0A\u4F20 ${assets.length} \u5F20\u56FE\u7247\u5230 Obsidian\u2026`, "ok");
        for (const asset of assets) {
          try {
            const up = await bg("OBSIDIAN_UPLOAD_ASSET", {
              obsidianConfig,
              fileName: asset.fileName,
              dataUrl: asset.dataUrl || "",
              rawText: asset.rawText || "",
              mimeType: asset.mimeType
            });
            if (up.ok) {
              uploadedNames.set(asset.entryId, asset.fileName);
              uploadedCount += 1;
            } else {
              failedCount += 1;
            }
          } catch {
            failedCount += 1;
          }
        }
      }
      const md = getSubtitleMarkdown(uploadedNames);
      const imageNote = uploadedCount > 0 ? `\uFF0C\u542B ${uploadedCount} \u5F20\u56FE\u7247` : "";
      const failNote = failedCount > 0 ? `\uFF1B${failedCount} \u5F20\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF0C\u5DF2\u7528\u6587\u5B57\u5360\u4F4D` : "";
      try {
        const res = await bg("EXPORT_TO_OBSIDIAN", {
          content: md,
          title: `snooper-\u4F1A\u8BDD-${Date.now()}`,
          obsidianConfig
        });
        if (res.ok) {
          flashChip(obsidianBtn, 2e3);
          toast(`\u5DF2\u53D1\u9001\u5230 Obsidian${imageNote}${failNote}`, failedCount > 0 ? "err" : "ok");
        } else {
          toast("Obsidian \u5BFC\u51FA\u5931\u8D25\uFF1A" + (res.error || "\u8BF7\u786E\u8BA4\u5DF2\u5B89\u88C5 Obsidian Local REST API \u63D2\u4EF6"), "err");
        }
      } catch (err) {
        toast("Obsidian \u901A\u4FE1\u5931\u8D25\uFF1A" + (err.message || "\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C"), "err");
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        syncSessionFromBackground().catch(() => {
        });
      }
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "TOGGLE_TOOLBAR") {
        hasBeenShownOnce = true;
        if (uiHidden) {
          uiHidden = false;
          persistUiHidden();
          applyUiHidden();
          render();
          if (session.state === "idle" && session.subtitles.length === 0) {
            subPlaceholder.textContent = "\u70B9\u51FB\u300C\u5F55\u97F3\u300D\u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199";
          }
        } else {
          uiHidden = true;
          persistUiHidden();
          applyUiHidden();
        }
        return;
      }
      if (msg && msg.type === "OPEN_PAGE_SETTINGS") {
        openSettings();
        return;
      }
      if (msg && msg.type === "STREAMING_UPDATE") {
        session.streamingSubtitle = msg.streamingSubtitle || null;
        if (msg.streamingSubtitle) {
          renderStreaming(msg.streamingSubtitle);
        } else {
          clearStreaming();
        }
        return;
      }
      if (msg && msg.type === "SESSION_UPDATE" && msg.session) {
        adoptBackgroundSession(msg.session);
      }
    });
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local" || !changes?.[NOTES_STORAGE_KEY]) return;
        const next = changes[NOTES_STORAGE_KEY].newValue;
        if (!Array.isArray(next)) return;
        session.notes = next;
        if (session.activeNoteId && !next.some((note) => note.id === session.activeNoteId)) {
          session.activeNoteId = next[0]?.id ?? null;
        }
        renderNotes();
      });
    } catch {
    }
    buildLangPicker();
    initBarPosition();
    (async () => {
      const savedNotes = await loadNotes();
      session.notes = savedNotes;
      if (savedNotes.length > 0) {
        session.activeNoteId = savedNotes[0].id;
      }
      session.isDemoMode = false;
      await syncSessionFromBackground();
      render();
      renderNotes();
    })();
    console.log("[snooper-browser] content script v0.6 loaded");
  })();
})();
