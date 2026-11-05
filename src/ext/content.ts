/**
 * RTTS Content Script v0.5 (TypeScript)
 *
 * MV3 Chrome extension content script.
 * Draggable unified control bar + rolling subtitle history + language selector.
 *
 * Features:
 * - Multi-language source/target selection
 * - Rolling subtitle display (current + history)
 * - Streaming subtitle rendering with blinking cursor
 * - Latency display per subtitle
 * - Draggable control bar
 * - Fullscreen-aware (via MAIN-world bridge)
 * - textContent-only rendering
 * - Q&A drawer for AI companion
 */

import type { SubtitleLine } from '../lib/types'

(() => {
  if ((window as any).__rttsContentInstalled) return;
  (window as any).__rttsContentInstalled = true;

  const HOST_ID = 'rtts-extension-host';
  let host = document.getElementById(HOST_ID);
  if (host) host.remove();

  host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  /* ===== Languages ===== */
  const LANGUAGES = [
    { code: 'auto', label: '自动检测' },
    { code: 'zh', label: '中文' },
    { code: 'en', label: 'English' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'es', label: 'Español' },
    { code: 'ru', label: 'Русский' },
    { code: 'ar', label: 'العربية' },
    { code: 'pt', label: 'Português' },
  ];
  const LANG_MAP = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.label]));

  /* ===== Types ===== */
  interface SubtitleEntry {
    id?: string
    at?: number
    endedAt?: number | null
    source?: string
    target?: string
    latency?: number
  }

  interface StreamingSubtitle {
    at?: number
    source?: string
    partialTarget?: string
    latency?: number
  }

  interface SessionState {
    state: string
    sourceLang: string
    targetLang: string
    subtitles: SubtitleEntry[]
    messages: { role: string; content: string }[]
    streamingSubtitle?: StreamingSubtitle | null
    _localSourceLang?: string
    _localTargetLang?: string
  }

  /* ===== State ===== */
  let session: SessionState = {
    state: 'idle',
    sourceLang: 'auto',
    targetLang: 'zh',
    subtitles: [],
    messages: [],
  };
  let isDrawerOpen = false;
  let isAskBusy = false;
  let dragState: { el: HTMLElement; offsetX: number; offsetY: number } | null = null;
  let langPickerOpen = false;

  /* ===== Styles ===== */
  const style = document.createElement('style');
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

  /* ===== Build DOM ===== */
  const html = `
    <div id="rtts-bar">
      <button id="rtts-record" class="rtts-btn" title="开始转写" aria-label="开始转写">
        <div class="dot"></div>
      </button>
      <div class="rtts-divider"></div>
      <button id="rtts-lang-btn" title="切换语言" aria-label="切换语言">
        <span id="rtts-lang-label">auto → zh</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="rtts-divider"></div>
      <button id="rtts-chat-btn" class="rtts-btn" title="AI 伴学" aria-label="AI 伴学">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button id="rtts-settings-btn" class="rtts-btn" title="配置" aria-label="配置">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button id="rtts-hide-btn" class="rtts-btn" title="隐藏" aria-label="隐藏">
        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <button id="rtts-show-btn" class="rtts-btn" title="显示" aria-label="显示" style="display:none">
        <svg viewBox="0 0 24 24"><polyline points="1 12 5 8 9 12"/><line x1="5" y1="16" x2="5" y2="8"/></svg>
      </button>
    </div>

    <!-- Language Picker Popup -->
    <div id="rtts-lang-picker">
      <h4>源语言（语音识别）</h4>
      <div class="lang-row" id="rtts-source-langs"></div>
      <h4>目标语言（翻译）</h4>
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
          <span class="stream-label" id="rtts-streaming-label">翻译中</span>
        </div>
      </div>
      <div id="rtts-sub-placeholder">点击 ● 开始实时转写</div>
      <div id="rtts-sub-actions">
        <button id="rtts-copy-btn" title="复制全部字幕">📋</button>
        <button id="rtts-export-btn" title="导出字幕">💾</button>
      </div>
    </div>

    <div id="rtts-fs-warn" class="hidden"></div>

    <!-- Q&A Drawer -->
    <div id="rtts-drawer">
      <div id="rtts-drawer-header">
        <h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg> AI 伴学</h3>
        <button id="rtts-drawer-close" aria-label="关闭">✕</button>
      </div>
      <div id="rtts-chat"></div>
      <div id="rtts-chat-footer">
        <input id="rtts-chat-input" placeholder="提问视频内容..." aria-label="提问">
        <button id="rtts-send">发送</button>
      </div>
    </div>
  `;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  shadow.append(style, wrapper);
  (document.body || document.documentElement).appendChild(host);

  /* ===== DOM refs ===== */
  const bar = shadow.getElementById('rtts-bar')!;
  const recordBtn = shadow.getElementById('rtts-record')!;
  const langBtn = shadow.getElementById('rtts-lang-btn')!;
  const langLabel = shadow.getElementById('rtts-lang-label')!;
  const langPicker = shadow.getElementById('rtts-lang-picker')!;
  const sourceLangsEl = shadow.getElementById('rtts-source-langs')!;
  const targetLangsEl = shadow.getElementById('rtts-target-langs')!;
  const subBox = shadow.getElementById('rtts-sub-box')!;
  const subHandle = shadow.getElementById('rtts-sub-handle')!;
  const subScroll = shadow.getElementById('rtts-sub-scroll')!;
  const subRows = shadow.getElementById('rtts-sub-rows')!;
  const subPlaceholder = shadow.getElementById('rtts-sub-placeholder')!;
  const copyBtn = shadow.getElementById('rtts-copy-btn')!;
  const exportBtn = shadow.getElementById('rtts-export-btn')!;
  const streamingRow = shadow.getElementById('rtts-streaming-row')!;
  const streamingText = shadow.getElementById('rtts-streaming-text')!;
  const streamingSource = shadow.getElementById('rtts-streaming-source')!;
  const streamingLabel = shadow.getElementById('rtts-streaming-label')!;
  const drawer = shadow.getElementById('rtts-drawer')!;
  const chatEl = shadow.getElementById('rtts-chat')!;
  const chatInput = shadow.getElementById('rtts-chat-input') as HTMLInputElement;
  const sendBtn = shadow.getElementById('rtts-send')!;
  const fsWarn = shadow.getElementById('rtts-fs-warn')!;
  const hideBtn = shadow.getElementById('rtts-hide-btn')!;
  const showBtn = shadow.getElementById('rtts-show-btn')!;

  /* ===== Language Picker ===== */
  function buildLangPicker() {
    sourceLangsEl.textContent = '';
    targetLangsEl.textContent = '';
    LANGUAGES.forEach((l) => {
      const src = document.createElement('span');
      src.className = 'lang-opt' + (l.code === session.sourceLang ? ' active' : '');
      src.textContent = l.label;
      (src as any).dataset.code = l.code;
      src.addEventListener('click', () => {
        session.sourceLang = l.code;
        (session as any)._localSourceLang = l.code;
        refreshLangPicker();
        updateLangLabel();
        bg('SET_LANG', { sourceLang: l.code }).catch(() => {});
      });
      sourceLangsEl.appendChild(src);

      if (l.code === 'auto') return; // auto not valid for target
      const tgt = document.createElement('span');
      tgt.className = 'lang-opt' + (l.code === session.targetLang ? ' active' : '');
      tgt.textContent = l.label;
      (tgt as any).dataset.code = l.code;
      tgt.addEventListener('click', () => {
        session.targetLang = l.code;
        (session as any)._localTargetLang = l.code;
        refreshLangPicker();
        updateLangLabel();
        bg('SET_LANG', { targetLang: l.code }).catch(() => {});
      });
      targetLangsEl.appendChild(tgt);
    });
  }

  function refreshLangPicker() {
    sourceLangsEl.querySelectorAll('.lang-opt').forEach((el) => {
      el.classList.toggle('active', (el as any).dataset.code === session.sourceLang);
    });
    targetLangsEl.querySelectorAll('.lang-opt').forEach((el) => {
      el.classList.toggle('active', (el as any).dataset.code === session.targetLang);
    });
  }

  function updateLangLabel() {
    const src = (LANG_MAP as any)[session.sourceLang] || session.sourceLang;
    const tgt = (LANG_MAP as any)[session.targetLang] || session.targetLang;
    langLabel.textContent = `${src} → ${tgt}`;
  }

  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    langPickerOpen = !langPickerOpen;
    langPicker.classList.toggle('open', langPickerOpen);
  });

  // Close picker on outside click
  document.addEventListener('click', (e) => {
    if (langPickerOpen && !langPicker.contains(e.target as Node) && e.target !== langBtn && !langBtn.contains(e.target as Node)) {
      langPickerOpen = false;
      langPicker.classList.remove('open');
    }
  });

  /* ===== Messaging ===== */
  async function bg(type: string, payload: Record<string, any> = {}) {
    try {
      const res = await chrome.runtime.sendMessage({ target: 'background', type, ...payload });
      return res && typeof res.ok !== 'undefined' ? res : { ok: true, ...res };
    } catch (err: any) {
      return { ok: false, error: err.message || '后台通信异常' };
    }
  }

  /* ===== Rendering ===== */
  function render() {
    const s = session.state;
    recordBtn.className = 'rtts-btn' + (s === 'running' ? ' running' : '');
    recordBtn.title = s === 'running' ? '停止转写' : s === 'starting' ? '启动中...' : '开始转写';
    updateLangLabel();

    // === Scrollable Subtitle Display (full history) ===
    const subs = session.subtitles || [];
    const streaming = session.streamingSubtitle || _streamingSubtitle;

    if (s === 'running' || subs.length > 0 || streaming) {
      subBox.classList.remove('hidden');
      subPlaceholder.textContent = '';

      // Build subtitle rows (show ALL, auto-scroll to bottom)
      subRows.textContent = '';
      const wasAtBottom = subScroll.scrollHeight - subScroll.scrollTop - subScroll.clientHeight < 40;

      subs.forEach((sub) => {
        const row = document.createElement('div');
        row.className = 'sub-row history';

        const trans = document.createElement('div');
        trans.className = 'sub-trans';
        trans.textContent = sub.target || '...';
        row.appendChild(trans);

        if (sub.source) {
          const src = document.createElement('div');
          src.className = 'sub-source';
          src.textContent = sub.source;
          row.appendChild(src);
        }

        // Latency on last entry
        if (sub === subs[subs.length - 1] && sub.latency) {
          const lat = document.createElement('span');
          lat.className = 'sub-latency';
          lat.textContent = `${sub.latency}ms`;
          (row as HTMLElement).style.position = 'relative';
          row.appendChild(lat);
        }

        subRows.appendChild(row);
      });

      // Highlight the latest entry
      const lastRow = subRows.lastElementChild;
      if (lastRow) lastRow.className = 'sub-row current';

      // Render streaming row (if active)
      if (streaming) {
        renderStreaming(streaming);
      } else {
        clearStreaming();
      }

      // Auto-scroll if user was near bottom
      if (wasAtBottom || subs.length <= 3) {
        subScroll.scrollTop = subScroll.scrollHeight;
      }
    } else {
      subPlaceholder.textContent = '点击 ● 开始实时转写';
      subRows.textContent = '';
      clearStreaming();
      if (subs.length === 0) subBox.classList.add('hidden');
    }

    // Position subtitle box near video
    positionSubBox();

    // Chat
    updateChat();
  }

  function updateChat() {
    const msgs = session.messages || [];
    chatEl.textContent = '';
    if (msgs.length === 0) {
      const w = document.createElement('div');
      w.className = 'rtts-msg assistant';
      w.textContent = '你好！我是视频伴学助手，可以问我关于当前视频内容的问题。';
      chatEl.appendChild(w);
    } else {
      msgs.forEach((m) => {
        const b = document.createElement('div');
        b.className = `rtts-msg ${m.role === 'user' ? 'user' : 'assistant'}`;
        b.textContent = m.content || '';
        chatEl.appendChild(b);
      });
    }
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  /* ===== Streaming Subtitle Rendering ===== */

  let _streamingSubtitle: StreamingSubtitle | null = null;

  function renderStreaming(sub: StreamingSubtitle | null) {
    _streamingSubtitle = sub;
    if (!sub || (!sub.partialTarget && !sub.source)) {
      streamingRow.classList.add('hidden');
      return;
    }

    streamingRow.classList.remove('hidden');

    // Streaming translation text (with cursor)
    const displayText = sub.partialTarget || '⋯';
    streamingText.textContent = displayText;

    // Source text
    if (sub.source) {
      streamingSource.textContent = sub.source;
      streamingSource.style.display = 'block';
    } else {
      streamingSource.style.display = 'none';
    }

    // Latency label
    if (sub.latency) {
      streamingLabel.textContent = `${sub.latency}ms · 翻译中`;
    } else {
      streamingLabel.textContent = '翻译中';
    }

    // Auto-scroll to show streaming row
    if (subScroll.scrollHeight - subScroll.scrollTop - subScroll.clientHeight < 100) {
      subScroll.scrollTop = subScroll.scrollHeight;
    }
  }

  function clearStreaming() {
    _streamingSubtitle = null;
    streamingRow.classList.add('hidden');
  }

  let subBoxAutoPosition = true;

  function positionSubBox() {
    if (!subBoxAutoPosition) return;
    const video = document.querySelector('video');
    if (video && video.readyState > 0) {
      const vr = video.getBoundingClientRect();
      const top = vr.top + vr.height * 0.75;
      (subBox as HTMLElement).style.top = Math.max(top, 80) + 'px';
      (subBox as HTMLElement).style.width = Math.min(vr.width * 0.88, 860) + 'px';
      (subBox as HTMLElement).style.bottom = 'auto';
    } else {
      (subBox as HTMLElement).style.top = '';
      (subBox as HTMLElement).style.bottom = '80px';
      (subBox as HTMLElement).style.width = 'min(84vw, 900px)';
    }
  }

  const ro = (window as any).ResizeObserver
    ? new ResizeObserver(() => positionSubBox())
    : { observe() {}, disconnect() {} };
  ro.observe(document.body);
  document.addEventListener('scroll', positionSubBox, { passive: true });
  window.addEventListener('resize', positionSubBox, { passive: true });

  /* ===== Drag (bar + subtitle box) ===== */

  function startDrag(e: MouseEvent, el: HTMLElement, offsetX: number, offsetY: number) {
    dragState = { el, offsetX, offsetY };
    el.style.cursor = 'grabbing';
    el.style.transition = 'none';
    e.preventDefault();
  }

  bar.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).closest('button')) return;
    const rect = bar.getBoundingClientRect();
    startDrag(e, bar, e.clientX - rect.left, e.clientY - rect.top);
  });

  subHandle.addEventListener('mousedown', (e) => {
    subBoxAutoPosition = false;
    const rect = subBox.getBoundingClientRect();
    startDrag(e, subBox, e.clientX - rect.left, e.clientY - rect.top);
  });

  subBox.addEventListener('dblclick', () => {
    subBoxAutoPosition = true;
    positionSubBox();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    const { el, offsetX, offsetY } = dragState;
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, x)) + 'px';
    el.style.top = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, y)) + 'px';
    el.style.transform = 'none';
  });

  document.addEventListener('mouseup', () => {
    if (!dragState) return;
    const el = dragState.el;
    dragState = null;
    el.style.cursor = el === bar ? 'grab' : '';
    setTimeout(() => { el.style.transition = ''; }, 50);
  });

  /* ===== Record button ===== */
  recordBtn.addEventListener('click', async () => {
    const s = session.state;
    if (s === 'running' || s === 'starting') {
      session.state = 'stopping';
      render();
      await bg('STOP');
      session.state = 'idle';
      render();
    } else {
      session.state = 'starting';
      render();
      const res = await bg('START', {
        sourceLang: session.sourceLang,
        targetLang: session.targetLang,
      });
      if (!res.ok) {
        alert('❌ ' + (res.error || '启动失败'));
        session.state = 'idle';
        render();
      } else {
        session.state = 'running';
        render();
      }
    }
  });

  /* ===== Chat ===== */
  shadow.getElementById('rtts-chat-btn')!.addEventListener('click', () => {
    isDrawerOpen = !isDrawerOpen;
    drawer.classList.toggle('open', isDrawerOpen);
    if (isDrawerOpen) chatInput.focus();
  });
  shadow.getElementById('rtts-drawer-close')!.addEventListener('click', () => {
    isDrawerOpen = false;
    drawer.classList.remove('open');
  });

  async function sendQuestion() {
    if (isAskBusy) return;
    const q = chatInput.value.trim();
    if (!q) return;
    isAskBusy = true;
    chatInput.value = '';
    chatInput.disabled = true;
    (sendBtn as HTMLButtonElement).disabled = true;
    sendBtn.textContent = '...';
    if (!session.messages) session.messages = [];
    session.messages.push({ role: 'user', content: q });
    updateChat();
    const rid = 'q_' + Date.now();
    const res = await bg('ASK', { question: q, requestId: rid });
    session.messages.push({
      role: 'assistant',
      content: res.ok && res.answer ? res.answer : '❌ ' + (res.error || '请求失败'),
    });
    isAskBusy = false;
    chatInput.disabled = false;
    (sendBtn as HTMLButtonElement).disabled = false;
    sendBtn.textContent = '发送';
    updateChat();
    chatInput.focus();
  }

  sendBtn.addEventListener('click', sendQuestion);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
  });

  /* ===== Settings ===== */
  shadow.getElementById('rtts-settings-btn')!.addEventListener('click', async () => {
    const res = await bg('OPEN_SETTINGS');
    if (!res.ok) alert(res.error);
  });

  /* ===== Hide/Show ===== */
  hideBtn.addEventListener('click', () => {
    if (session.state === 'running') {
      if (!confirm('正在转写中，隐藏后字幕将不可见。确定隐藏？')) return;
    }
    bar.classList.add('hidden');
    subBox.classList.add('hidden');
    hideBtn.style.display = 'none';
    showBtn.style.display = '';
  });
  showBtn.addEventListener('click', () => {
    bar.classList.remove('hidden');
    if (session.state === 'running' || session.subtitles.length > 0) {
      subBox.classList.remove('hidden');
    }
    hideBtn.style.display = '';
    showBtn.style.display = 'none';
  });

  /* ===== Fullscreen ===== */
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'rtts:fullscreen') return;
    if (e.data.action === 'enter' && (document.fullscreenElement || (document as any).webkitFullscreenElement)) {
      const el = document.fullscreenElement || (document as any).webkitFullscreenElement;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'video' || tag === 'iframe') {
        fsWarn.textContent = '视频硬件全屏，字幕已移至底部。建议退出全屏或使用网页全屏。';
        fsWarn.classList.remove('hidden');
        (subBox as HTMLElement).style.bottom = '20px';
        (subBox as HTMLElement).style.top = 'auto';
        (subBox as HTMLElement).style.width = 'min(90vw, 900px)';
      } else {
        fsWarn.classList.add('hidden');
        positionSubBox();
      }
    } else if (e.data.action === 'exit') {
      fsWarn.classList.add('hidden');
      setTimeout(positionSubBox, 300);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      fsWarn.classList.add('hidden');
      setTimeout(positionSubBox, 300);
    }
  });

  /* ===== Export / Copy ===== */
  function getSubtitleText(): string {
    return (session.subtitles || [])
      .map((sub) => {
        const t = sub.target || '';
        const s = sub.source ? ` [${sub.source}]` : '';
        return `${t}${s}`;
      })
      .join('\n');
  }

  function getSubtitleSRT(): string {
    return (session.subtitles || [])
      .map((sub, i) => {
        const start = new Date(sub.at || Date.now());
        const end = new Date(sub.endedAt || sub.at || Date.now());
        const fmt = (d: Date) =>
          `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')},${String(d.getMilliseconds()).padStart(3, '0')}`;
        return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${sub.target || ''}\n${sub.source ? sub.source : ''}\n`;
      })
      .join('\n');
  }

  copyBtn.addEventListener('click', async () => {
    const text = getSubtitleText();
    if (!text) { alert('没有字幕可复制'); return; }
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = '✅';
      setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
    } catch {
      alert('复制失败');
    }
  });

  exportBtn.addEventListener('click', () => {
    const text = getSubtitleText();
    if (!text) { alert('没有字幕可导出'); return; }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rtts-subtitles-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    exportBtn.textContent = '✅';
    setTimeout(() => { exportBtn.textContent = '💾'; }, 1500);
  });

  /* ===== Multi-tab: re-fetch session on visibility change ===== */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      bg('GET_SESSION').then((res: any) => {
        if (res.ok && res.session) {
          const incoming = res.session;
          const localSourceLang = (session as any)._localSourceLang;
          const localTargetLang = (session as any)._localTargetLang;
          session = {
            ...incoming,
            sourceLang: localSourceLang || incoming.sourceLang || 'auto',
            targetLang: localTargetLang || incoming.targetLang || 'zh',
            _localSourceLang: localSourceLang || undefined,
            _localTargetLang: localTargetLang || undefined,
          };
          render();
        }
      }).catch(() => {});
    }
  });

  /* ===== Background push ===== */
  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg && msg.type === 'STREAMING_UPDATE') {
      if (msg.streamingSubtitle) {
        renderStreaming(msg.streamingSubtitle);
      } else {
        clearStreaming();
      }
      return;
    }

    if (msg && msg.type === 'SESSION_UPDATE' && msg.session) {
      const incoming = msg.session;
      const localSourceLang = (session as any)._localSourceLang;
      const localTargetLang = (session as any)._localTargetLang;
      session = {
        ...incoming,
        sourceLang: localSourceLang || incoming.sourceLang || 'auto',
        targetLang: localTargetLang || incoming.targetLang || 'zh',
        _localSourceLang: localSourceLang || undefined,
        _localTargetLang: localTargetLang || undefined,
      };
      render();
    }
  });

  /* ===== Init ===== */
  buildLangPicker();
  (async () => {
    const res: any = await bg('GET_SESSION');
    if (res.ok && res.session) {
      session = res.session;
      render();
    }
  })();

  console.log('[RTTS content] v0.5 (TS) loaded');
})();
