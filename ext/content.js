(() => {
  // src/ext/content.ts
  var NOTES_STORAGE_KEY = "snooper.notes.v1";
  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
    }
    return [];
  }
  function saveNotes(notes) {
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
      messages: [],
      notes: [],
      activeNoteId: null,
      isDemoMode: false
    };
    let isDrawerOpen = false;
    let isAskBusy = false;
    let dragState = null;
    let langPickerOpen = false;
    let notesExpanded = false;
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
    #rtts-image-btn { background: rgba(124,92,255,0.12); color: #c9bcff; }
    #rtts-image-btn:hover { background: rgba(124,92,255,0.22); color: #e2dbff; }
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
      background: rgba(14,14,24,0.62);
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
    }

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
      background: linear-gradient(180deg, rgba(6,6,14,0.32), rgba(6,6,12,0.2));
      backdrop-filter: blur(8px) saturate(145%);
      -webkit-backdrop-filter: blur(8px) saturate(145%);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.28);
      text-align: center;
      z-index: 2147483630;
      pointer-events: none;
      transition: opacity 0.25s, transform 0.25s, background 0.2s;
      display: flex; flex-direction: column;
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

    .sub-row {
      transition: opacity 0.25s, font-size 0.25s;
    }
    .sub-row.current {
      font-size: 17px; font-weight: 600; color: #fff; line-height: 1.5;
      text-shadow: 0 1px 10px rgba(0,0,0,0.9), 0 0 26px rgba(0,0,0,0.55);
      padding: 4px 0;
    }
    .sub-row.current .sub-source {
      font-size: 12px; font-weight: 400; color: rgba(255,255,255,0.4); display: block; margin-top: 2px;
    }
    .sub-row.history {
      font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.5); line-height: 1.35;
      text-shadow: 0 1px 6px rgba(0,0,0,0.75);
      padding: 2px 0;
    }
    .sub-row.history .sub-source { display: none; }

    .sub-latency {
      font-size: 10px; color: rgba(255,255,255,0.15);
      position: absolute; right: 12px; bottom: 4px;
    }

    /* === Streaming Subtitle (live, in-progress) === */
    #rtts-streaming-row {
      font-size: 17px; font-weight: 600; color: #fff; line-height: 1.45;
      text-shadow: 0 1px 10px rgba(0,0,0,0.9), 0 0 26px rgba(0,0,0,0.5);
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

    /* === Notes Drawer === */
    #rtts-notes-drawer {
      position: fixed; top: 0; left: -360px;
      width: 340px; height: 100vh;
      background: rgba(14,14,22,0.94); backdrop-filter: blur(28px);
      -webkit-backdrop-filter: blur(28px);
      border-right: 1px solid rgba(255,255,255,0.1);
      box-shadow: 12px 0 40px rgba(0,0,0,0.5);
      z-index: 2147483645;
      display: flex; flex-direction: column;
      transition: left 0.25s cubic-bezier(0.16,1,0.3,1);
    }
    #rtts-notes-drawer.open { left: 0; }
    #rtts-notes-drawer-header {
      padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.07);
      display: flex; align-items: center; gap: 8px;
    }
    #rtts-notes-drawer-header h3 { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    #rtts-notes-count {
      font-size: 10px; background: rgba(255,255,255,0.08);
      padding: 1px 6px; border-radius: 9px;
      color: rgba(255,255,255,0.5);
    }
    #rtts-notes-close {
      margin-left: auto; width: 28px; height: 28px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; color: rgba(255,255,255,0.45); cursor: pointer;
    }
    #rtts-notes-close:hover { background: rgba(255,255,255,0.08); color: #fff; }
    #rtts-notes-close svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    #rtts-notes-body {
      flex: 1; min-height: 0;
      display: flex; flex-direction: column; gap: 10px;
      padding: 12px 12px 14px;
    }
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
      padding: 3px 4px; border-radius: 4px;
      font-size: 11px; color: rgba(255,255,255,0.6);
      line-height: 1.4;
    }
    .note-item:hover { background: rgba(255,255,255,0.04); }
    .note-item .note-text { flex: 1; min-width: 0; }
    .note-item .note-text.truncated { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
    #rtts-notes-input-row {
      display: flex; gap: 4px;
    }
    #rtts-notes-input {
      flex: 1; height: 24px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px; padding: 0 8px; color: #fff; font-size: 11px;
      outline: none;
    }
    #rtts-notes-input:focus { border-color: #7c5cff; }
    #rtts-notes-add {
      width: 24px; height: 24px; border-radius: 6px;
      border: none; background: #7c5cff; color: #fff;
      font-size: 14px; cursor: pointer; display: flex;
      align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #rtts-notes-add:hover { background: #6642f5; }

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
    #rtts-chat-input:focus { border-color: #7c5cff; }
    #rtts-send {
      height: 34px; padding: 0 14px; border: none; border-radius: 8px;
      background: #7c5cff; color: #fff; font-weight: 600; font-size: 12px;
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

    /* === Refined chrome === */
    .sub-row.current { font-size: 18px; letter-spacing: -0.01em; }
    #rtts-sub-placeholder { font-size: 11.5px; }

    /* === Notes === */
    .note-item { padding: 7px 8px; border-radius: 8px; }
    .note-item .note-text { font-size: 12px; }
    #rtts-notes-input { height: 30px; border-radius: 8px; }
    #rtts-notes-add { width: 30px; height: 30px; border-radius: 8px; background: #7c5cff; }

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
      #rtts-notes-drawer { width: 100vw; left: -100vw; }
      #rtts-sub-box { width: 88vw; bottom: 18px; max-height: 28vh; padding: 8px 14px 6px; }
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
      <button id="rtts-record" class="rtts-btn" data-tip="\u5F00\u59CB\u8F6C\u5199" aria-label="\u5F00\u59CB\u8F6C\u5199">
        <div class="dot"></div>
      </button>
      <div class="rtts-divider"></div>
      <button id="rtts-lang-btn" class="rtts-btn" data-tip="\u8BED\u8A00\uFF1A\u81EA\u52A8\u68C0\u6D4B \u2192 \u4E2D\u6587" aria-label="\u5207\u6362\u8BED\u8A00">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 4 5.7 4 9s-1.5 6.4-4 9a14 14 0 0 1 0-18z"/></svg>
        <span id="rtts-lang-label" hidden>auto \u2192 zh</span>
      </button>
      <button id="rtts-notes-btn" class="rtts-btn" data-tip="\u7B14\u8BB0" aria-label="\u6253\u5F00\u7B14\u8BB0">
        <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      </button>
      <button id="rtts-chat-btn" class="rtts-btn" data-tip="AI \u4F34\u5B66" aria-label="AI \u4F34\u5B66">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
      <div class="rtts-divider"></div>
      <button id="rtts-note-btn" class="rtts-btn" data-tip="\u8BB0\u5165\u7B14\u8BB0" aria-label="\u8BB0\u5165\u7B14\u8BB0">
        <svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button id="rtts-image-btn" class="rtts-btn" data-tip="\u751F\u6210\u914D\u56FE" aria-label="\u751F\u6210\u914D\u56FE">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
      </button>
      <button id="rtts-screenshot-btn" class="rtts-btn" data-tip="\u9875\u9762\u622A\u56FE" aria-label="\u9875\u9762\u622A\u56FE">
        <svg viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
      </button>
      <div class="rtts-divider"></div>
      <button id="rtts-copy-btn" class="rtts-btn" data-tip="\u590D\u5236\u5168\u90E8\u5B57\u5E55" aria-label="\u590D\u5236\u5168\u90E8\u5B57\u5E55">
        <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button id="rtts-export-txt-btn" class="rtts-btn" data-tip="\u5BFC\u51FA TXT" aria-label="\u5BFC\u51FA TXT">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      <button id="rtts-export-md-btn" class="rtts-btn" data-tip="\u5BFC\u51FA Markdown" aria-label="\u5BFC\u51FA Markdown">
        <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </button>
      <button id="rtts-obsidian-btn" class="rtts-btn" data-tip="\u53D1\u9001\u5230 Obsidian" aria-label="\u53D1\u9001\u5230 Obsidian">
        <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/></svg>
      </button>
      <div class="rtts-divider"></div>
      <button id="rtts-settings-btn" class="rtts-btn" data-tip="\u914D\u7F6E" aria-label="\u914D\u7F6E">
        <svg viewBox="0 0 24 24"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>
      </button>
      <button id="rtts-hide-btn" class="rtts-btn" data-tip="\u9690\u85CF\u5DE5\u5177" aria-label="\u9690\u85CF\u5DE5\u5177">
        <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
      </button>
    </div>

    <button id="rtts-show-btn" class="rtts-btn" data-tip="\u663E\u793A\u5DE5\u5177" aria-label="\u663E\u793A\u5DE5\u5177" style="display:none">
      <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
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
    </div>

    <!-- Notes Drawer -->
    <div id="rtts-notes-drawer" aria-label="\u7B14\u8BB0">
      <div id="rtts-notes-drawer-header">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          \u7B14\u8BB0
          <span id="rtts-notes-count">0</span>
        </h3>
        <button id="rtts-notes-close" type="button" aria-label="\u5173\u95ED\u7B14\u8BB0">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div id="rtts-notes-body">
        <div id="rtts-notes-list"></div>
        <div id="rtts-notes-input-row">
          <input id="rtts-notes-input" type="text" placeholder="\u8F93\u5165\u5FEB\u901F\u7B14\u8BB0\u2026" aria-label="\u65B0\u7B14\u8BB0">
          <button id="rtts-notes-add" type="button" aria-label="\u6DFB\u52A0\u7B14\u8BB0"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        </div>
      </div>
    </div>

    <div id="rtts-fs-warn" class="hidden"></div>

    <!-- Q&A Drawer -->
    <div id="rtts-drawer">
      <div id="rtts-drawer-header">
        <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c5cff" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg> AI \u4F34\u5B66</h3>
        <button id="rtts-drawer-close" aria-label="\u5173\u95ED"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div id="rtts-chat"></div>
      <div id="rtts-chat-footer">
        <input id="rtts-chat-input" placeholder="\u63D0\u95EE\u89C6\u9891\u5185\u5BB9..." aria-label="\u63D0\u95EE">
        <button id="rtts-send">\u53D1\u9001</button>
      </div>
    </div>

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

    <div id="rtts-toasts" aria-live="polite"></div>
  `;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    shadow.append(style, wrapper);
    (document.body || document.documentElement).appendChild(host);
    const bar = shadow.getElementById("rtts-bar");
    const barGrip = shadow.getElementById("rtts-bar-grip");
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
    const exportTxtBtn = shadow.getElementById("rtts-export-txt-btn");
    const exportMdBtn = shadow.getElementById("rtts-export-md-btn");
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
    const noteBtn = shadow.getElementById("rtts-note-btn");
    const imageBtn = shadow.getElementById("rtts-image-btn");
    const screenshotBtn = shadow.getElementById("rtts-screenshot-btn");
    const notesCount = shadow.getElementById("rtts-notes-count");
    const notesDrawer = shadow.getElementById("rtts-notes-drawer");
    const notesBtn = shadow.getElementById("rtts-notes-btn");
    const notesClose = shadow.getElementById("rtts-notes-close");
    const notesList = shadow.getElementById("rtts-notes-list");
    const notesInput = shadow.getElementById("rtts-notes-input");
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
          closeLangPicker();
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
    async function openSettings() {
      cfgApiKey.type = "password";
      cfgToggleKey.classList.remove("revealed");
      const res = await bg("GET_CONFIG");
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
    cfgToggleKey.addEventListener("click", () => {
      const revealed = cfgApiKey.type === "password";
      cfgApiKey.type = revealed ? "text" : "password";
      cfgToggleKey.classList.toggle("revealed", revealed);
    });
    document.addEventListener("keydown", (e) => {
      const settingsOpen = settingsModal.classList.contains("open");
      const imageOpen = imageModal.classList.contains("open");
      if (!settingsOpen && !imageOpen) return;
      if (e.key === "Escape") {
        if (imageOpen) closeImagePanel();
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
    function saveImageToNotes() {
      if (!lastImageUrl) return;
      addNoteEntry({
        id: `image_${Date.now()}`,
        type: "image",
        at: Date.now(),
        imageUrl: lastImageUrl,
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
      recordBtn.className = "rtts-btn" + (s === "running" ? " running" : "");
      const recordLabel = session.isDemoMode ? s === "running" ? "\u505C\u6B62\u6F14\u793A" : "\u5F00\u59CB\u771F\u5B9E\u8F6C\u5199" : s === "running" ? "\u505C\u6B62\u8F6C\u5199" : s === "starting" ? "\u542F\u52A8\u4E2D" : "\u5F00\u59CB\u8F6C\u5199";
      recordBtn.setAttribute("data-tip", recordLabel);
      updateLangLabel();
      const subs = session.subtitles || [];
      const streaming = session.streamingSubtitle || _streamingSubtitle;
      if (s === "running" || subs.length > 0 || streaming) {
        subBox.classList.remove("hidden");
        const hasContent = subs.length > 0 || !!streaming;
        subPlaceholder.style.display = hasContent ? "none" : "";
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
        subPlaceholder.style.display = "";
        subPlaceholder.textContent = "\u70B9\u51FB\u300C\u5F55\u97F3\u300D\u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199";
        subRows.textContent = "";
        clearStreaming();
        if (subs.length === 0) subBox.classList.add("hidden");
      }
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
      const maxWidth = Math.max(220, window.innerWidth - 32);
      const video = document.querySelector("video");
      if (video && video.readyState > 0) {
        const vr = video.getBoundingClientRect();
        const top = vr.top + vr.height * 0.75;
        const width = Math.min(vr.width * 0.88, 840, maxWidth);
        subBox.style.top = Math.max(top, 80) + "px";
        subBox.style.width = `${Math.round(width)}px`;
        subBox.style.bottom = "auto";
      } else {
        subBox.style.top = "";
        subBox.style.bottom = "26px";
        subBox.style.width = `${Math.min(Math.round(window.innerWidth * 0.82), 840, maxWidth)}px`;
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
        session.state = "idle";
        render();
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
      if (isDrawerOpen) {
        setNotesExpanded(false);
        chatInput.focus();
      }
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
        content: res.ok && res.answer ? res.answer : "\u8BF7\u6C42\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF")
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
    shadow.getElementById("rtts-settings-btn").addEventListener("click", () => {
      openSettings();
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
      notesCount.textContent = String(active?.entries.length ?? 0);
      notesBtn.setAttribute("data-tip", `\u7B14\u8BB0${active?.entries.length ? `\uFF08${active.entries.length}\uFF09` : ""}`);
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
            img.addEventListener("click", () => window.open(entry.imageUrl, "_blank"));
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
          text.className = "note-text truncated";
          text.textContent = entry.text || entry.target || entry.source || "\u7B14\u8BB0";
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
      }
    }
    async function captureScreenshot() {
      try {
        const bgRes = await bg("CAPTURE_SCREENSHOT");
        if (bgRes.ok && bgRes.dataUrl) return bgRes.dataUrl;
      } catch {
      }
      const canvas = document.createElement("canvas");
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not available");
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#7c5cff";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("snooper-browser \u622A\u56FE", canvas.width / 2, canvas.height / 2 - 10);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "12px system-ui";
      ctx.fillText("\u9875\u9762\u622A\u56FE\u9700\u8981\u6269\u5C55\u6743\u9650 \u2014 \u8BF7\u4F7F\u7528\u6269\u5C55 API", canvas.width / 2, canvas.height / 2 + 20);
      return canvas.toDataURL("image/png");
    }
    function getSubtitleText() {
      return (session.subtitles || []).map((sub) => {
        const t = sub.target || "";
        const s = sub.source ? ` [${sub.source}]` : "";
        return `${t}${s}`;
      }).join("\n");
    }
    function getSubtitleMarkdown() {
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
      const active = session.activeNoteId ? session.notes.find((n) => n.id === session.activeNoteId) : null;
      if (active && active.entries.length > 0) {
        lines.push(``, `---`, ``, `## \u7B14\u8BB0`, ``);
        active.entries.forEach((entry) => {
          if (entry.target) lines.push(`- ${entry.target} ${entry.source ? `\uFF08${entry.source}\uFF09` : ""}`);
          else if (entry.text) lines.push(`- ${entry.text}`);
        });
      }
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
      try {
        const dataUrl = await captureScreenshot();
        addNoteEntry({
          id: `screenshot_${Date.now()}`,
          type: "screenshot",
          at: Date.now(),
          imageUrl: dataUrl,
          text: "\u9875\u9762\u622A\u56FE"
        });
        flashChip(screenshotBtn);
        toast("\u622A\u56FE\u5DF2\u5B58\u5165\u7B14\u8BB0", "ok");
      } catch (err) {
        toast("\u622A\u56FE\u5931\u8D25\uFF1A" + (err.message || "\u672A\u77E5\u9519\u8BEF"), "err");
      }
    });
    function setNotesExpanded(expanded) {
      notesExpanded = expanded;
      notesDrawer.classList.toggle("open", expanded);
      notesBtn.classList.toggle("active", expanded);
      if (expanded) {
        isDrawerOpen = false;
        drawer.classList.remove("open");
      }
    }
    notesBtn.addEventListener("click", () => setNotesExpanded(!notesExpanded));
    notesClose.addEventListener("click", () => setNotesExpanded(false));
    notesBtn.setAttribute("data-tip", "\u7B14\u8BB0");
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (notesExpanded) setNotesExpanded(false);
      if (isDrawerOpen) {
        isDrawerOpen = false;
        drawer.classList.remove("open");
      }
    });
    function addQuickNote() {
      const text = notesInput.value.trim();
      if (!text) return;
      addNoteEntry({
        id: `text_${Date.now()}`,
        type: "text",
        at: Date.now(),
        text
      });
      notesInput.value = "";
      if (!notesExpanded) {
        setNotesExpanded(true);
      }
    }
    notesAdd.addEventListener("click", addQuickNote);
    notesInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addQuickNote();
      }
    });
    obsidianBtn.addEventListener("click", async () => {
      const md = getSubtitleMarkdown();
      if (!md) {
        toast("\u6CA1\u6709\u5185\u5BB9\u53EF\u5BFC\u51FA", "err");
        return;
      }
      let obsidianConfig = {};
      try {
        const raw = localStorage.getItem("snooper.obsidian-config.v1");
        if (raw) obsidianConfig = JSON.parse(raw);
      } catch {
      }
      try {
        const res = await bg("EXPORT_TO_OBSIDIAN", { content: md, title: `snooper-\u7B14\u8BB0-${Date.now()}`, obsidianConfig });
        if (res.ok) {
          flashChip(obsidianBtn, 2e3);
          toast("\u5DF2\u53D1\u9001\u5230 Obsidian", "ok");
        } else {
          toast("Obsidian \u5BFC\u51FA\u5931\u8D25\uFF1A" + (res.error || "\u8BF7\u786E\u8BA4\u5DF2\u5B89\u88C5 Obsidian Local REST API \u63D2\u4EF6"), "err");
        }
      } catch (err) {
        toast("Obsidian \u901A\u4FE1\u5931\u8D25\uFF1A" + (err.message || "\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C"), "err");
      }
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
              _localTargetLang: localTargetLang || void 0,
              // Preserve notes across session updates
              notes: session.notes,
              activeNoteId: session.activeNoteId,
              isDemoMode: session.isDemoMode
            };
            render();
          }
        }).catch(() => {
        });
      }
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "OPEN_PAGE_SETTINGS") {
        openSettings();
        return;
      }
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
          _localTargetLang: localTargetLang || void 0,
          // Preserve notes across session updates
          notes: session.notes,
          activeNoteId: session.activeNoteId,
          isDemoMode: session.isDemoMode
        };
        render();
      }
    });
    buildLangPicker();
    initBarPosition();
    const savedNotes = loadNotes();
    session.notes = savedNotes;
    if (savedNotes.length > 0) {
      session.activeNoteId = savedNotes[0].id;
    }
    (async () => {
      const res = await bg("GET_SESSION");
      if (res.ok && res.session) {
        session = {
          ...res.session,
          notes: session.notes,
          activeNoteId: session.activeNoteId,
          isDemoMode: false
        };
        render();
        renderNotes();
      } else {
        session.isDemoMode = true;
        render();
        renderNotes();
        startDemoSubtitles();
      }
    })();
    console.log("[snooper-browser] content script v0.6 loaded");
  })();
})();
