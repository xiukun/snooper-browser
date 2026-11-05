(() => {
  // src/ext/content.ts
  (() => {
    if (window.__rttsContentInstalled) return;
    window.__rttsContentInstalled = true;
    const HOST_ID = "rtts-extension-host";
    let host = document.getElementById(HOST_ID);
    if (host) host.remove();
    host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const LANGUAGES = [
      { code: "auto", label: "\u81EA\u52A8\u68C0\u6D4B" },
      { code: "zh", label: "\u4E2D\u6587" },
      { code: "en", label: "English" },
      { code: "ja", label: "\u65E5\u672C\u8A9E" },
      { code: "ko", label: "\uD55C\uAD6D\uC5B4" },
      { code: "fr", label: "Fran\xE7ais" },
      { code: "de", label: "Deutsch" },
      { code: "es", label: "Espa\xF1ol" },
      { code: "ru", label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439" },
      { code: "ar", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" },
      { code: "pt", label: "Portugu\xEAs" }
    ];
    const LANG_MAP = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.label]));
    let session = {
      state: "idle",
      sourceLang: "auto",
      targetLang: "zh",
      subtitles: [],
      messages: []
    };
    let isDrawerOpen = false;
    let isAskBusy = false;
    let dragState = null;
    let langPickerOpen = false;
    const style = document.createElement("style");
    style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Segoe UI", Roboto, sans-serif; color: #f0f2f5; z-index: 2147483647; }

    /* === Draggable Control Bar === */
    #rtts-bar {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 4px;
      height: 40px; padding: 0 8px;
      background: rgba(10,10,18,0.78); backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 999px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      cursor: grab; user-select: none;
      z-index: 2147483640;
      transition: opacity 0.2s;
    }
    #rtts-bar:active { cursor: grabbing; }
    #rtts-bar.hidden { opacity: 0; pointer-events: none; }

    .rtts-btn {
      width: 28px; height: 28px; border-radius: 50%;
      border: none; background: rgba(255,255,255,0.06);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s; flex-shrink: 0;
      color: rgba(255,255,255,0.75);
    }
    .rtts-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
    .rtts-btn svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 2; fill: none; }

    #rtts-record {
      width: 30px; height: 30px;
      background: rgba(255,255,255,0.08);
      border: 1.5px solid rgba(255,255,255,0.2);
    }
    #rtts-record.running {
      background: #e5484d; border-color: #ff6b6b;
      box-shadow: 0 0 12px rgba(229,72,77,0.5);
      animation: pulse 1.4s infinite;
    }
    #rtts-record .dot { width: 8px; height: 8px; border-radius: 50%; background: #fff; }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(229,72,77,0.6); }
      70% { box-shadow: 0 0 0 10px rgba(229,72,77,0); }
      100% { box-shadow: 0 0 0 0 rgba(229,72,77,0); }
    }

    .rtts-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.1); flex-shrink: 0; }

    /* === Language Picker === */
    #rtts-lang-btn {
      font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.65);
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px; padding: 2px 8px; cursor: pointer;
      height: 24px; display: flex; align-items: center; gap: 4px;
      white-space: nowrap; flex-shrink: 0;
    }
    #rtts-lang-btn:hover { background: rgba(255,255,255,0.1); }

    #rtts-lang-picker {
      position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
      background: rgba(16,16,26,0.94); backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px; padding: 14px 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      z-index: 2147483642;
      display: none; flex-direction: column; gap: 10px;
      min-width: 200px;
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
    .lang-opt.active { background: rgba(99,102,241,0.25); border-color: #6366f1; color: #fff; }

    /* === Subtitle Box (full scrollable history) === */
    #rtts-sub-box {
      position: fixed;
      left: 50%; transform: translateX(-50%);
      bottom: 80px;
      width: min(80vw, 900px);
      max-height: 40vh;
      padding: 10px 16px 8px;
      background: rgba(8,8,16,0.7); backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      text-align: center;
      z-index: 2147483630;
      pointer-events: none;
      transition: opacity 0.2s;
      display: flex; flex-direction: column;
    }
    #rtts-sub-box.hidden { opacity: 0; pointer-events: none; }
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
      content: ''; width: 24px; height: 3px;
      background: rgba(255,255,255,0.15); border-radius: 2px;
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

    .sub-row {
      transition: opacity 0.2s, font-size 0.2s;
    }
    .sub-row.current { font-size: 17px; font-weight: 600; color: #fff; line-height: 1.45; text-shadow: 0 1px 6px rgba(0,0,0,0.8); }
    .sub-row.current .sub-source { font-size: 12px; font-weight: 400; color: rgba(255,255,255,0.45); display: block; margin-top: 1px; }
    .sub-row.history { font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.4); line-height: 1.3; }
    .sub-row.history .sub-source { display: none; }

    .sub-latency {
      font-size: 10px; color: rgba(255,255,255,0.2);
      position: absolute; right: 12px; bottom: 4px;
    }

    /* === Streaming Subtitle (live, in-progress) === */
    #rtts-streaming-row {
      font-size: 17px; font-weight: 600; color: #fff; line-height: 1.45;
      text-shadow: 0 1px 6px rgba(0,0,0,0.8);
      position: relative;
      min-height: 1.45em;
    }
    #rtts-streaming-row .sub-source {
      font-size: 12px; font-weight: 400; color: rgba(255,255,255,0.45);
      display: block; margin-top: 1px;
    }
    #rtts-streaming-row .stream-cursor {
      display: inline-block;
      width: 2px; height: 1em;
      background: #6366f1;
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
      font-size: 10px; color: rgba(99,102,241,0.5);
      position: absolute; right: 12px; bottom: 4px;
      font-weight: 400;
    }

    #rtts-sub-placeholder {
      font-size: 12px; color: rgba(255,255,255,0.3);
      padding: 4px 0;
      flex-shrink: 0;
    }

    #rtts-sub-actions {
      display: flex; gap: 4px; justify-content: center;
      padding: 4px 0 0;
      flex-shrink: 0;
      pointer-events: auto;
    }
    #rtts-sub-actions button {
      background: rgba(255,255,255,0.06); border: none;
      border-radius: 6px; padding: 2px 8px;
      font-size: 12px; cursor: pointer;
      color: rgba(255,255,255,0.5);
      line-height: 1.6;
    }
    #rtts-sub-actions button:hover {
      background: rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.8);
    }

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
    .rtts-msg.user { background: rgba(99,102,241,0.25); border: 1px solid rgba(99,102,241,0.35); align-self: flex-end; color: #fff; }
    .rtts-msg.assistant { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); align-self: flex-start; color: rgba(255,255,255,0.85); }
    .rtts-msg.error { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.25); color: #fca5a5; }
    #rtts-chat-footer {
      padding: 10px 16px; border-top: 1px solid rgba(255,255,255,0.06);
      display: flex; gap: 8px;
    }
    #rtts-chat-input {
      flex: 1; height: 34px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; padding: 0 10px; color: #fff; font-size: 13px;
      outline: none;
    }
    #rtts-chat-input:focus { border-color: #6366f1; }
    #rtts-send {
      height: 34px; padding: 0 14px; border: none; border-radius: 8px;
      background: #6366f1; color: #fff; font-weight: 600; font-size: 12px;
      cursor: pointer;
    }
    #rtts-send:disabled { opacity: 0.4; cursor: not-allowed; }

    /* === Fullscreen hint === */
    #rtts-fs-warn {
      position: fixed; top: 64px; left: 50%; transform: translateX(-50%);
      background: rgba(239,68,68,0.85); color: #fff;
      padding: 6px 14px; border-radius: 6px; font-size: 12px;
      z-index: 2147483645; pointer-events: none;
      max-width: 90%; text-align: center;
    }
    #rtts-fs-warn.hidden { display: none; }

    @media (max-width: 640px) {
      #rtts-drawer { width: 100vw; right: -100vw; }
      #rtts-sub-box { width: 92vw; }
      #rtts-lang-picker { left: 10px; right: 10px; transform: none; }
    }
  `;
    const html = `
    <div id="rtts-bar">
      <button id="rtts-record" class="rtts-btn" title="\u5F00\u59CB\u8F6C\u5199" aria-label="\u5F00\u59CB\u8F6C\u5199">
        <div class="dot"></div>
      </button>
      <div class="rtts-divider"></div>
      <button id="rtts-lang-btn" title="\u5207\u6362\u8BED\u8A00" aria-label="\u5207\u6362\u8BED\u8A00">
        <span id="rtts-lang-label">auto \u2192 zh</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="rtts-divider"></div>
      <button id="rtts-chat-btn" class="rtts-btn" title="AI \u4F34\u5B66" aria-label="AI \u4F34\u5B66">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button id="rtts-settings-btn" class="rtts-btn" title="\u914D\u7F6E" aria-label="\u914D\u7F6E">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button id="rtts-hide-btn" class="rtts-btn" title="\u9690\u85CF" aria-label="\u9690\u85CF">
        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <button id="rtts-show-btn" class="rtts-btn" title="\u663E\u793A" aria-label="\u663E\u793A" style="display:none">
        <svg viewBox="0 0 24 24"><polyline points="1 12 5 8 9 12"/><line x1="5" y1="16" x2="5" y2="8"/></svg>
      </button>
    </div>

    <!-- Language Picker Popup -->
    <div id="rtts-lang-picker">
      <h4>\u6E90\u8BED\u8A00\uFF08\u8BED\u97F3\u8BC6\u522B\uFF09</h4>
      <div class="lang-row" id="rtts-source-langs"></div>
      <h4>\u76EE\u6807\u8BED\u8A00\uFF08\u7FFB\u8BD1\uFF09</h4>
      <div class="lang-row" id="rtts-target-langs"></div>
    </div>

    <!-- Rolling Subtitle Box -->
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
      <div id="rtts-sub-placeholder">\u70B9\u51FB \u25CF \u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199</div>
      <div id="rtts-sub-actions">
        <button id="rtts-copy-btn" title="\u590D\u5236\u5168\u90E8\u5B57\u5E55">\u{1F4CB}</button>
        <button id="rtts-export-btn" title="\u5BFC\u51FA\u5B57\u5E55">\u{1F4BE}</button>
      </div>
    </div>

    <div id="rtts-fs-warn" class="hidden"></div>

    <!-- Q&A Drawer -->
    <div id="rtts-drawer">
      <div id="rtts-drawer-header">
        <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg> AI \u4F34\u5B66</h3>
        <button id="rtts-drawer-close" aria-label="\u5173\u95ED">\u2715</button>
      </div>
      <div id="rtts-chat"></div>
      <div id="rtts-chat-footer">
        <input id="rtts-chat-input" placeholder="\u63D0\u95EE\u89C6\u9891\u5185\u5BB9..." aria-label="\u63D0\u95EE">
        <button id="rtts-send">\u53D1\u9001</button>
      </div>
    </div>
  `;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    shadow.append(style, wrapper);
    (document.body || document.documentElement).appendChild(host);
    const bar = shadow.getElementById("rtts-bar");
    const recordBtn = shadow.getElementById("rtts-record");
    const langBtn = shadow.getElementById("rtts-lang-btn");
    const langLabel = shadow.getElementById("rtts-lang-label");
    const langPicker = shadow.getElementById("rtts-lang-picker");
    const sourceLangsEl = shadow.getElementById("rtts-source-langs");
    const targetLangsEl = shadow.getElementById("rtts-target-langs");
    const subBox = shadow.getElementById("rtts-sub-box");
    const subHandle = shadow.getElementById("rtts-sub-handle");
    const subScroll = shadow.getElementById("rtts-sub-scroll");
    const subRows = shadow.getElementById("rtts-sub-rows");
    const subPlaceholder = shadow.getElementById("rtts-sub-placeholder");
    const copyBtn = shadow.getElementById("rtts-copy-btn");
    const exportBtn = shadow.getElementById("rtts-export-btn");
    const streamingRow = shadow.getElementById("rtts-streaming-row");
    const streamingText = shadow.getElementById("rtts-streaming-text");
    const streamingSource = shadow.getElementById("rtts-streaming-source");
    const streamingLabel = shadow.getElementById("rtts-streaming-label");
    const drawer = shadow.getElementById("rtts-drawer");
    const chatEl = shadow.getElementById("rtts-chat");
    const chatInput = shadow.getElementById("rtts-chat-input");
    const sendBtn = shadow.getElementById("rtts-send");
    const fsWarn = shadow.getElementById("rtts-fs-warn");
    const hideBtn = shadow.getElementById("rtts-hide-btn");
    const showBtn = shadow.getElementById("rtts-show-btn");
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
          session._localSourceLang = l.code;
          refreshLangPicker();
          updateLangLabel();
          bg("SET_LANG", { sourceLang: l.code }).catch(() => {
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
          session._localTargetLang = l.code;
          refreshLangPicker();
          updateLangLabel();
          bg("SET_LANG", { targetLang: l.code }).catch(() => {
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
      langLabel.textContent = `${src} \u2192 ${tgt}`;
    }
    langBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      langPickerOpen = !langPickerOpen;
      langPicker.classList.toggle("open", langPickerOpen);
    });
    document.addEventListener("click", (e) => {
      if (langPickerOpen && !langPicker.contains(e.target) && e.target !== langBtn && !langBtn.contains(e.target)) {
        langPickerOpen = false;
        langPicker.classList.remove("open");
      }
    });
    async function bg(type, payload = {}) {
      try {
        const res = await chrome.runtime.sendMessage({ target: "background", type, ...payload });
        return res && typeof res.ok !== "undefined" ? res : { ok: true, ...res };
      } catch (err) {
        return { ok: false, error: err.message || "\u540E\u53F0\u901A\u4FE1\u5F02\u5E38" };
      }
    }
    function render() {
      const s = session.state;
      recordBtn.className = "rtts-btn" + (s === "running" ? " running" : "");
      recordBtn.title = s === "running" ? "\u505C\u6B62\u8F6C\u5199" : s === "starting" ? "\u542F\u52A8\u4E2D..." : "\u5F00\u59CB\u8F6C\u5199";
      updateLangLabel();
      const subs = session.subtitles || [];
      const streaming = session.streamingSubtitle || _streamingSubtitle;
      if (s === "running" || subs.length > 0 || streaming) {
        subBox.classList.remove("hidden");
        subPlaceholder.textContent = "";
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
          if (sub === subs[subs.length - 1] && sub.latency) {
            const lat = document.createElement("span");
            lat.className = "sub-latency";
            lat.textContent = `${sub.latency}ms`;
            row.style.position = "relative";
            row.appendChild(lat);
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
        subPlaceholder.textContent = "\u70B9\u51FB \u25CF \u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199";
        subRows.textContent = "";
        clearStreaming();
        if (subs.length === 0) subBox.classList.add("hidden");
      }
      positionSubBox();
      updateChat();
    }
    function updateChat() {
      const msgs = session.messages || [];
      chatEl.textContent = "";
      if (msgs.length === 0) {
        const w = document.createElement("div");
        w.className = "rtts-msg assistant";
        w.textContent = "\u4F60\u597D\uFF01\u6211\u662F\u89C6\u9891\u4F34\u5B66\u52A9\u624B\uFF0C\u53EF\u4EE5\u95EE\u6211\u5173\u4E8E\u5F53\u524D\u89C6\u9891\u5185\u5BB9\u7684\u95EE\u9898\u3002";
        chatEl.appendChild(w);
      } else {
        msgs.forEach((m) => {
          const b = document.createElement("div");
          b.className = `rtts-msg ${m.role === "user" ? "user" : "assistant"}`;
          b.textContent = m.content || "";
          chatEl.appendChild(b);
        });
      }
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    let _streamingSubtitle = null;
    function renderStreaming(sub) {
      _streamingSubtitle = sub;
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
      if (sub.latency) {
        streamingLabel.textContent = `${sub.latency}ms \xB7 \u7FFB\u8BD1\u4E2D`;
      } else {
        streamingLabel.textContent = "\u7FFB\u8BD1\u4E2D";
      }
      if (subScroll.scrollHeight - subScroll.scrollTop - subScroll.clientHeight < 100) {
        subScroll.scrollTop = subScroll.scrollHeight;
      }
    }
    function clearStreaming() {
      _streamingSubtitle = null;
      streamingRow.classList.add("hidden");
    }
    let subBoxAutoPosition = true;
    function positionSubBox() {
      if (!subBoxAutoPosition) return;
      const video = document.querySelector("video");
      if (video && video.readyState > 0) {
        const vr = video.getBoundingClientRect();
        const top = vr.top + vr.height * 0.75;
        subBox.style.top = Math.max(top, 80) + "px";
        subBox.style.width = Math.min(vr.width * 0.88, 860) + "px";
        subBox.style.bottom = "auto";
      } else {
        subBox.style.top = "";
        subBox.style.bottom = "80px";
        subBox.style.width = "min(84vw, 900px)";
      }
    }
    const ro = window.ResizeObserver ? new ResizeObserver(() => positionSubBox()) : { observe() {
    }, disconnect() {
    } };
    ro.observe(document.body);
    document.addEventListener("scroll", positionSubBox, { passive: true });
    window.addEventListener("resize", positionSubBox, { passive: true });
    function startDrag(e, el, offsetX, offsetY) {
      dragState = { el, offsetX, offsetY };
      el.style.cursor = "grabbing";
      el.style.transition = "none";
      e.preventDefault();
    }
    bar.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
      const rect = bar.getBoundingClientRect();
      startDrag(e, bar, e.clientX - rect.left, e.clientY - rect.top);
    });
    subHandle.addEventListener("mousedown", (e) => {
      subBoxAutoPosition = false;
      const rect = subBox.getBoundingClientRect();
      startDrag(e, subBox, e.clientX - rect.left, e.clientY - rect.top);
    });
    subBox.addEventListener("dblclick", () => {
      subBoxAutoPosition = true;
      positionSubBox();
    });
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
      el.style.cursor = el === bar ? "grab" : "";
      setTimeout(() => {
        el.style.transition = "";
      }, 50);
    });
    recordBtn.addEventListener("click", async () => {
      const s = session.state;
      if (s === "running" || s === "starting") {
        session.state = "stopping";
        render();
        await bg("STOP");
        session.state = "idle";
        render();
      } else {
        session.state = "starting";
        render();
        const res = await bg("START", {
          sourceLang: session.sourceLang,
          targetLang: session.targetLang
        });
        if (!res.ok) {
          alert("\u274C " + (res.error || "\u542F\u52A8\u5931\u8D25"));
          session.state = "idle";
          render();
        } else {
          session.state = "running";
          render();
        }
      }
    });
    shadow.getElementById("rtts-chat-btn").addEventListener("click", () => {
      isDrawerOpen = !isDrawerOpen;
      drawer.classList.toggle("open", isDrawerOpen);
      if (isDrawerOpen) chatInput.focus();
    });
    shadow.getElementById("rtts-drawer-close").addEventListener("click", () => {
      isDrawerOpen = false;
      drawer.classList.remove("open");
    });
    async function sendQuestion() {
      if (isAskBusy) return;
      const q = chatInput.value.trim();
      if (!q) return;
      isAskBusy = true;
      chatInput.value = "";
      chatInput.disabled = true;
      sendBtn.disabled = true;
      sendBtn.textContent = "...";
      if (!session.messages) session.messages = [];
      session.messages.push({ role: "user", content: q });
      updateChat();
      const rid = "q_" + Date.now();
      const res = await bg("ASK", { question: q, requestId: rid });
      session.messages.push({
        role: "assistant",
        content: res.ok && res.answer ? res.answer : "\u274C " + (res.error || "\u8BF7\u6C42\u5931\u8D25")
      });
      isAskBusy = false;
      chatInput.disabled = false;
      sendBtn.disabled = false;
      sendBtn.textContent = "\u53D1\u9001";
      updateChat();
      chatInput.focus();
    }
    sendBtn.addEventListener("click", sendQuestion);
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendQuestion();
      }
    });
    shadow.getElementById("rtts-settings-btn").addEventListener("click", async () => {
      const res = await bg("OPEN_SETTINGS");
      if (!res.ok) alert(res.error);
    });
    hideBtn.addEventListener("click", () => {
      if (session.state === "running") {
        if (!confirm("\u6B63\u5728\u8F6C\u5199\u4E2D\uFF0C\u9690\u85CF\u540E\u5B57\u5E55\u5C06\u4E0D\u53EF\u89C1\u3002\u786E\u5B9A\u9690\u85CF\uFF1F")) return;
      }
      bar.classList.add("hidden");
      subBox.classList.add("hidden");
      hideBtn.style.display = "none";
      showBtn.style.display = "";
    });
    showBtn.addEventListener("click", () => {
      bar.classList.remove("hidden");
      if (session.state === "running" || session.subtitles.length > 0) {
        subBox.classList.remove("hidden");
      }
      hideBtn.style.display = "";
      showBtn.style.display = "none";
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
    function getSubtitleText() {
      return (session.subtitles || []).map((sub) => {
        const t = sub.target || "";
        const s = sub.source ? ` [${sub.source}]` : "";
        return `${t}${s}`;
      }).join("\n");
    }
    function getSubtitleSRT() {
      return (session.subtitles || []).map((sub, i) => {
        const start = new Date(sub.at || Date.now());
        const end = new Date(sub.endedAt || sub.at || Date.now());
        const fmt = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")},${String(d.getMilliseconds()).padStart(3, "0")}`;
        return `${i + 1}
${fmt(start)} --> ${fmt(end)}
${sub.target || ""}
${sub.source ? sub.source : ""}
`;
      }).join("\n");
    }
    copyBtn.addEventListener("click", async () => {
      const text = getSubtitleText();
      if (!text) {
        alert("\u6CA1\u6709\u5B57\u5E55\u53EF\u590D\u5236");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "\u2705";
        setTimeout(() => {
          copyBtn.textContent = "\u{1F4CB}";
        }, 1500);
      } catch {
        alert("\u590D\u5236\u5931\u8D25");
      }
    });
    exportBtn.addEventListener("click", () => {
      const text = getSubtitleText();
      if (!text) {
        alert("\u6CA1\u6709\u5B57\u5E55\u53EF\u5BFC\u51FA");
        return;
      }
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rtts-subtitles-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      exportBtn.textContent = "\u2705";
      setTimeout(() => {
        exportBtn.textContent = "\u{1F4BE}";
      }, 1500);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        bg("GET_SESSION").then((res) => {
          if (res.ok && res.session) {
            const incoming = res.session;
            const localSourceLang = session._localSourceLang;
            const localTargetLang = session._localTargetLang;
            session = {
              ...incoming,
              sourceLang: localSourceLang || incoming.sourceLang || "auto",
              targetLang: localTargetLang || incoming.targetLang || "zh",
              _localSourceLang: localSourceLang || void 0,
              _localTargetLang: localTargetLang || void 0
            };
            render();
          }
        }).catch(() => {
        });
      }
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "STREAMING_UPDATE") {
        if (msg.streamingSubtitle) {
          renderStreaming(msg.streamingSubtitle);
        } else {
          clearStreaming();
        }
        return;
      }
      if (msg && msg.type === "SESSION_UPDATE" && msg.session) {
        const incoming = msg.session;
        const localSourceLang = session._localSourceLang;
        const localTargetLang = session._localTargetLang;
        session = {
          ...incoming,
          sourceLang: localSourceLang || incoming.sourceLang || "auto",
          targetLang: localTargetLang || incoming.targetLang || "zh",
          _localSourceLang: localSourceLang || void 0,
          _localTargetLang: localTargetLang || void 0
        };
        render();
      }
    });
    buildLangPicker();
    (async () => {
      const res = await bg("GET_SESSION");
      if (res.ok && res.session) {
        session = res.session;
        render();
      }
    })();
    console.log("[RTTS content] v0.5 (TS) loaded");
  })();
})();
