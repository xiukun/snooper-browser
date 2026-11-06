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

import type { SubtitleLine, NoteEntry, NoteDocument } from '../lib/types'

/* ===== Note persistence =====
 * Notes live in chrome.storage.local so the in-page drawer and the side
 * panel share one store. Page localStorage is kept as a legacy mirror and
 * migrated into the shared store on first read.
 */
const NOTES_STORAGE_KEY = 'snooper.notes.v1'

async function loadNotes(): Promise<NoteDocument[]> {
  // 1. Shared store (page + side panel)
  try {
    const got = await (chrome as any).storage.local.get(NOTES_STORAGE_KEY)
    const stored = got?.[NOTES_STORAGE_KEY]
    if (Array.isArray(stored)) return stored as NoteDocument[]
  } catch { /* ignore */ }
  // 2. Legacy page localStorage -> migrate into the shared store
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as NoteDocument[]
      if (Array.isArray(parsed) && parsed.length > 0) {
        try {
          await (chrome as any).storage.local.set({ [NOTES_STORAGE_KEY]: parsed })
        } catch { /* ignore */ }
        return parsed
      }
    }
  } catch { /* ignore */ }
  return []
}

async function saveNotes(notes: NoteDocument[]) {
  try {
    await (chrome as any).storage.local.set({ [NOTES_STORAGE_KEY]: notes })
  } catch { /* ignore */ }
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes))
  } catch { /* ignore */ }
}

function createNoteDocument(title: string, source: NoteDocument['sessionInfo']): NoteDocument {
  const now = Date.now()
  return {
    id: `note_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    createdAt: now,
    updatedAt: now,
    entries: [],
    sessionInfo: source,
  }
}

/* ===== Obsidian config (shared with the side panel) =====
 * Both surfaces read/write chrome.storage.local under one key. The old
 * page-localStorage copy is migrated on first read. Default is the plugin's
 * plain HTTP endpoint (27123) because Chrome rejects its self-signed HTTPS
 * certificate on 27124.
 */
const OBSIDIAN_CONFIG_KEY = 'snooper.obsidian-config.v1'

interface SharedObsidianConfig {
  enabled: boolean
  apiProtocol: 'http' | 'https'
  apiPort: number
  apiKey: string
  noteFolder: string
}

const DEFAULT_OBSIDIAN_CONFIG: SharedObsidianConfig = {
  enabled: false,
  apiProtocol: 'http',
  apiPort: 27123,
  apiKey: '',
  noteFolder: 'snooper-notes',
}

function normalizeObsidianConfig(raw: any): SharedObsidianConfig {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  const port = Number(cfg.apiPort) || DEFAULT_OBSIDIAN_CONFIG.apiPort
  const protocol: 'http' | 'https' =
    cfg.apiProtocol === 'https' || cfg.apiProtocol === 'http'
      ? cfg.apiProtocol
      : port === 27124
        ? 'https'
        : 'http'
  return {
    enabled: !!cfg.enabled,
    apiProtocol: protocol,
    apiPort: port,
    // The Obsidian plugin shows the key as "Bearer <token>"; users copy the
    // whole line. Strip the prefix so callers can safely add their own.
    apiKey: typeof cfg.apiKey === 'string'
      ? cfg.apiKey.trim().replace(/^Bearer\s+/i, '').trim()
      : '',
    noteFolder: typeof cfg.noteFolder === 'string' && cfg.noteFolder.trim()
      ? cfg.noteFolder.trim()
      : DEFAULT_OBSIDIAN_CONFIG.noteFolder,
  }
}

async function loadObsidianConfig(): Promise<SharedObsidianConfig> {
  try {
    const got = await (chrome as any).storage.local.get(OBSIDIAN_CONFIG_KEY)
    const stored = got?.[OBSIDIAN_CONFIG_KEY]
    if (stored && typeof stored === 'object') return normalizeObsidianConfig(stored)
  } catch { /* ignore */ }
  try {
    const raw = localStorage.getItem(OBSIDIAN_CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const normalized = normalizeObsidianConfig(parsed)
      try {
        await (chrome as any).storage.local.set({ [OBSIDIAN_CONFIG_KEY]: normalized })
      } catch { /* ignore */ }
      return normalized
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_OBSIDIAN_CONFIG }
}

async function saveObsidianConfig(config: SharedObsidianConfig) {
  const normalized = normalizeObsidianConfig(config)
  try {
    await (chrome as any).storage.local.set({ [OBSIDIAN_CONFIG_KEY]: normalized })
  } catch { /* ignore */ }
  try {
    localStorage.setItem(OBSIDIAN_CONFIG_KEY, JSON.stringify(normalized))
  } catch { /* ignore */ }
}

/* ===== Demo subtitles ===== */
const DEMO_SUBTITLES: Array<{ source: string; target: string; delay: number }> = [
  { source: 'Welcome to snooper-browser', target: '欢迎使用 snooper-browser', delay: 2000 },
  { source: 'This is a real-time translation demo', target: '这是一个实时翻译演示', delay: 2500 },
  { source: 'You can also take notes and generate images', target: '你可以记笔记和生成图片', delay: 3000 },
  { source: 'Click the record button to start real transcription', target: '点击录音按钮开始真实转写', delay: 2800 },
  { source: 'Configure your API key in the settings panel', target: '在设置面板中配置你的 API 密钥', delay: 3000 },
  { source: 'Enjoy the seamless multilingual experience', target: '享受无缝的多语言体验', delay: 2500 },
];

(() => {
  if ((window as any).__rttsContentInstalled) return;
  (window as any).__rttsContentInstalled = true;

  const HOST_ID = 'rtts-extension-host';
  let host = document.getElementById(HOST_ID);
  if (host) host.remove();

  host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  /* ===== Languages ===== */
  const LANGUAGES = [
    { code: 'auto', label: '自动检测', short: 'AUTO' },
    { code: 'zh', label: '中文', short: 'ZH' },
    { code: 'en', label: 'English', short: 'EN' },
    { code: 'ja', label: '日本語', short: 'JA' },
    { code: 'ko', label: '한국어', short: 'KO' },
    { code: 'fr', label: 'Français', short: 'FR' },
    { code: 'de', label: 'Deutsch', short: 'DE' },
    { code: 'es', label: 'Español', short: 'ES' },
    { code: 'ru', label: 'Русский', short: 'RU' },
    { code: 'ar', label: 'العربية', short: 'AR' },
    { code: 'pt', label: 'Português', short: 'PT' },
  ];
  const LANG_MAP = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.label]));
  const LANG_SHORT = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.short]));

  /* ===== Types ===== */
  interface SubtitleEntry {
    id?: string
    at?: number
    endedAt?: number | null
    source?: string
    target?: string
    speaker?: string
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
    messages: { role: string; content: string; images?: string[] }[]
    streamingSubtitle?: StreamingSubtitle | null
    _localSourceLang?: string
    _localTargetLang?: string
    notes: NoteDocument[]
    activeNoteId: string | null
    isDemoMode: boolean
  }

  /* ===== State ===== */
  let session: SessionState = {
    state: 'idle',
    sourceLang: 'auto',
    targetLang: 'zh',
    subtitles: [],
    messages: [],
    notes: [],
    activeNoteId: null,
    isDemoMode: false,
  };
  let isDrawerOpen = false;
  let isAskBusy = false;
  let dragState: { el: HTMLElement; offsetX: number; offsetY: number } | null = null;
  let langPickerOpen = false;
  let drawerTab: 'chat' | 'notes' = 'chat';

  /* ===== Toolbar visibility (persisted) ===== */
  const UI_HIDDEN_KEY = 'snooper.ui-hidden.v1';
  // Toolbar starts hidden on every page load. Users click the Chrome
  // extension icon to toggle it. The show-pill (reopen affordance) appears
  // only after the toolbar has been opened once and then closed.
  let uiHidden = true;
  let hasBeenShownOnce = false;

  function persistUiHidden() {
    try { localStorage.setItem(UI_HIDDEN_KEY, uiHidden ? '1' : '0'); } catch { /* ignore */ }
  }

  function applyUiHidden() {
    bar.classList.toggle('hidden', uiHidden);
    // Only show pill after toolbar has been opened once (so user knows
    // about it) but not on first page load
    showBtn.style.display = uiHidden && hasBeenShownOnce ? 'flex' : 'none';
    hideBtn.style.display = uiHidden ? 'none' : '';
    if (uiHidden) {
      subBox.classList.add('hidden');
      langPicker.classList.remove('open');
      // Query instead of closing over `toolsMenu`: this runs before the refs
      // block is initialized on the very first render.
      bar.querySelector('#rtts-menu')?.classList.remove('open');
      bar.querySelector('#rtts-more-btn')?.classList.remove('active');
      const more = bar.querySelector('#rtts-more-btn');
      more?.setAttribute('aria-expanded', 'false');
    }
  }

  /* ===== Obsidian config (shared with the side panel) =====
 * Both surfaces read/write chrome.storage.local under one key. The old
 * page-localStorage copy is migrated on first read. Default is the plugin's
 * plain HTTP endpoint (27123) because Chrome rejects its self-signed HTTPS
 * certificate on 27124.
 */
const OBSIDIAN_CONFIG_KEY = 'snooper.obsidian-config.v1'

interface SharedObsidianConfig {
  enabled: boolean
  apiProtocol: 'http' | 'https'
  apiPort: number
  apiKey: string
  noteFolder: string
}

const DEFAULT_OBSIDIAN_CONFIG: SharedObsidianConfig = {
  enabled: false,
  apiProtocol: 'http',
  apiPort: 27123,
  apiKey: '',
  noteFolder: 'snooper-notes',
}

function normalizeObsidianConfig(raw: any): SharedObsidianConfig {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  const port = Number(cfg.apiPort) || DEFAULT_OBSIDIAN_CONFIG.apiPort
  const protocol: 'http' | 'https' =
    cfg.apiProtocol === 'https' || cfg.apiProtocol === 'http'
      ? cfg.apiProtocol
      : port === 27124
        ? 'https'
        : 'http'
  return {
    enabled: !!cfg.enabled,
    apiProtocol: protocol,
    apiPort: port,
    // The Obsidian plugin shows the key as "Bearer <token>"; users copy the
    // whole line. Strip the prefix so callers can safely add their own.
    apiKey: typeof cfg.apiKey === 'string'
      ? cfg.apiKey.trim().replace(/^Bearer\s+/i, '').trim()
      : '',
    noteFolder: typeof cfg.noteFolder === 'string' && cfg.noteFolder.trim()
      ? cfg.noteFolder.trim()
      : DEFAULT_OBSIDIAN_CONFIG.noteFolder,
  }
}

async function loadObsidianConfig(): Promise<SharedObsidianConfig> {
  try {
    const got = await (chrome as any).storage.local.get(OBSIDIAN_CONFIG_KEY)
    const stored = got?.[OBSIDIAN_CONFIG_KEY]
    if (stored && typeof stored === 'object') return normalizeObsidianConfig(stored)
  } catch { /* ignore */ }
  try {
    const raw = localStorage.getItem(OBSIDIAN_CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const normalized = normalizeObsidianConfig(parsed)
      try {
        await (chrome as any).storage.local.set({ [OBSIDIAN_CONFIG_KEY]: normalized })
      } catch { /* ignore */ }
      return normalized
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_OBSIDIAN_CONFIG }
}

async function saveObsidianConfig(config: SharedObsidianConfig) {
  const normalized = normalizeObsidianConfig(config)
  try {
    await (chrome as any).storage.local.set({ [OBSIDIAN_CONFIG_KEY]: normalized })
  } catch { /* ignore */ }
  try {
    localStorage.setItem(OBSIDIAN_CONFIG_KEY, JSON.stringify(normalized))
  } catch { /* ignore */ }
}

/* ===== Demo subtitles ===== */
  let demoInterval: ReturnType<typeof setInterval> | null = null;
  let demoIndex = 0;

  function startDemoSubtitles() {
    if (demoInterval) return;
    session.state = 'running';
    render();

    demoInterval = setInterval(() => {
      if (demoIndex >= DEMO_SUBTITLES.length) {
        demoIndex = 0;
      }
      const item = DEMO_SUBTITLES[demoIndex]!;
      const now = Date.now();
      session.subtitles.push({
        id: `demo_${now}`,
        at: now,
        endedAt: now + 3000,
        source: item.source,
        target: item.target,
        speaker: '',
        latency: Math.floor(Math.random() * 200 + 50),
      });
      if (session.subtitles.length > 50) session.subtitles = session.subtitles.slice(-40);
      render();
      demoIndex++;
    }, 3000);
  }

  function stopDemoSubtitles() {
    if (demoInterval) {
      clearInterval(demoInterval);
      demoInterval = null;
    }
    demoIndex = 0;
  }

  /* ===== Styles ===== */
  const style = document.createElement('style');
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
      display: flex; gap: 6px;
    }
    #rtts-notes-input {
      flex: 1; height: 32px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px; padding: 0 10px; color: #fff; font-size: 12px;
      outline: none;
    }
    #rtts-notes-input:focus { border-color: #7c5cff; }
    #rtts-notes-add {
      width: 32px; height: 32px; border-radius: 8px;
      border: none; background: #7c5cff; color: #fff;
      font-size: 14px; cursor: pointer; display: flex;
      align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #rtts-notes-add:hover { background: #6642f5; }

    /* === Markdown chat editor === */
    #rtts-md-shell {
      display: flex; flex-direction: column;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 11px;
      background: rgba(255,255,255,0.05);
      overflow: hidden;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    #rtts-md-shell:focus-within {
      border-color: rgba(124,92,255,0.65);
      box-shadow: 0 0 0 3px rgba(124,92,255,0.12);
    }
    #rtts-md-toolbar {
      display: flex; align-items: center; gap: 2px;
      padding: 4px 5px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    #rtts-md-toolbar button {
      height: 22px; min-width: 25px; padding: 0 6px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid transparent; border-radius: 6px;
      background: none; color: rgba(255,255,255,0.45);
      font-size: 11px; cursor: pointer;
    }
    #rtts-md-toolbar button:hover { background: rgba(255,255,255,0.07); color: #fff; }
    #rtts-md-toolbar button.active { background: rgba(124,92,255,0.25); color: #fff; }
    #rtts-md-toolbar button b, #rtts-md-toolbar button i { font-size: 12px; }
    #rtts-md-toolbar #rtts-md-preview-btn { margin-left: auto; }
    #rtts-chat-editor {
      min-height: 44px; max-height: 140px; overflow-y: auto;
      background: none; border: none; border-radius: 0;
      padding: 8px 10px;
      color: #fff; font-size: 13px; line-height: 1.5;
      white-space: pre-wrap; word-break: break-word;
      outline: none;
    }
    #rtts-chat-editor:empty::before {
      content: attr(data-placeholder);
      color: rgba(255,255,255,0.3);
      pointer-events: none;
    }
    #rtts-chat-editor code {
      background: rgba(255,255,255,0.1); border-radius: 3px;
      padding: 0 3px; font-size: 12px;
    }
    .rtts-md-preview {
      min-height: 44px; max-height: 140px; overflow-y: auto;
      background: none; border: none; border-radius: 0;
      padding: 8px 10px;
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
    #rtts-composer-hint {
      flex: 1; font-size: 10px; color: rgba(255,255,255,0.28);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
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
      padding: 10px 14px 12px; border-top: 1px solid rgba(255,255,255,0.06);
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
    #rtts-chat-input-row { display: flex; align-items: center; gap: 8px; }
    #rtts-chat-attach-btn {
      width: 30px; height: 30px; flex-shrink: 0; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.6); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    #rtts-chat-attach-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
    #rtts-chat-attach-btn svg { width: 15px; height: 15px; stroke: currentColor; stroke-width: 1.8; fill: none; }
    #rtts-send {
      height: 30px; padding: 0 14px; border: none; border-radius: 8px;
      background: #7c5cff; color: #fff; font-weight: 600; font-size: 12px;
      cursor: pointer; flex-shrink: 0;
    }
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

  /* ===== Build DOM ===== */
  const html = `
    <div id="rtts-bar" role="toolbar" aria-label="snooper 工具栏">
      <div id="rtts-bar-grip" class="rtts-bar-grip" role="button" tabindex="0" aria-label="拖动工具栏" title="拖动工具栏">
        <svg viewBox="0 0 10 16" aria-hidden="true">
          <circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/>
          <circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/>
          <circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/>
        </svg>
      </div>

      <!-- Primary action: always visible, labeled -->
      <button id="rtts-record" class="rtts-btn rtts-record-btn" data-tip="开始转写" aria-label="开始转写">
        <div class="dot"></div>
        <span id="rtts-record-label" class="rtts-btn-label">实时字幕</span>
      </button>

      <button id="rtts-lang-btn" class="rtts-btn rtts-lang-chip" data-tip="语言：自动检测 → 中文" aria-label="切换语言">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 4 5.7 4 9s-1.5 6.4-4 9a14 14 0 0 1 0-18z"/></svg>
        <span id="rtts-lang-label">AUTO→ZH</span>
      </button>

      <div class="rtts-divider"></div>

      <!-- Two daily-use surfaces, labeled -->
      <button id="rtts-chat-btn" class="rtts-btn rtts-btn-labeled" data-tip="AI 伴学" aria-label="AI 伴学">
        <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>AI</span>
      </button>
      <button id="rtts-notes-btn" class="rtts-btn rtts-btn-labeled" data-tip="笔记" aria-label="打开笔记">
        <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <span>笔记</span>
        <span id="rtts-notes-badge" class="rtts-badge" hidden>0</span>
      </button>

      <button id="rtts-more-btn" class="rtts-btn" data-tip="更多工具" aria-label="更多工具" aria-haspopup="menu" aria-expanded="false">
        <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>
      </button>

      <!-- Advanced tools live in one labeled menu instead of 10 icon buttons -->
      <div id="rtts-menu" role="menu" aria-label="更多工具">
        <div class="rtts-menu-head">工具</div>
        <button id="rtts-note-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></span>
          <span class="rtts-menu-text"><b>记入笔记</b><small>保存当前字幕到笔记</small></span>
        </button>
        <button id="rtts-screenshot-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></span>
          <span class="rtts-menu-text"><b>页面截图</b><small>录制中也能截取视频画面</small></span>
        </button>
        <button id="rtts-image-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></span>
          <span class="rtts-menu-text"><b>生成配图</b><small>根据提示词生成图片</small></span>
        </button>
        <button id="rtts-copy-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>
          <span class="rtts-menu-text"><b>复制字幕</b><small>复制全部字幕文本</small></span>
        </button>

        <div class="rtts-menu-sep"></div>
        <div class="rtts-menu-head">导出与同步</div>
        <button id="rtts-export-txt-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span>
          <span class="rtts-menu-text"><b>导出 TXT</b><small>纯文本字幕</small></span>
        </button>
        <button id="rtts-export-md-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>
          <span class="rtts-menu-text"><b>导出 Markdown</b><small>表格 + 笔记</small></span>
        </button>
        <button id="rtts-obsidian-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/></svg></span>
          <span class="rtts-menu-text"><b>发送到 Obsidian</b><small>图片自动上传到仓库</small></span>
        </button>

        <div class="rtts-menu-sep"></div>
        <button id="rtts-settings-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg></span>
          <span class="rtts-menu-text"><b>设置</b><small>模型、密钥与 Obsidian</small></span>
        </button>
        <button id="rtts-hide-btn" class="rtts-menu-item rtts-menu-item-danger" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
          <span class="rtts-menu-text"><b>关闭工具</b><small>点扩展图标可重新打开</small></span>
        </button>
      </div>
    </div>

    <button id="rtts-show-btn" class="rtts-btn" data-tip="重新打开 snooper 工具栏" aria-label="显示工具" style="display:none">
      <svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
      <span class="rtts-show-label">显示工具</span>
    </button>

    <!-- Language Picker Popup -->
    <div id="rtts-lang-picker">
      <h4>源语言（语音识别）</h4>
      <div class="lang-row" id="rtts-source-langs"></div>
      <h4>目标语言（翻译）</h4>
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
          <span class="stream-label" id="rtts-streaming-label">翻译中</span>
        </div>
      </div>
      <div id="rtts-sub-placeholder">点击「录音」开始实时转写</div>
    </div>

    <!-- Unified side drawer: chat + notes tabs -->
    <div id="rtts-drawer" aria-label="AI 伴学与笔记">
      <div id="rtts-drawer-header">
        <div id="rtts-drawer-tabs" role="tablist" aria-label="面板切换">
          <button id="rtts-tab-chat" class="rtts-drawer-tab active" type="button" role="tab" aria-selected="true">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            伴学
          </button>
          <button id="rtts-tab-notes" class="rtts-drawer-tab" type="button" role="tab" aria-selected="false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            笔记 <span id="rtts-notes-count">0</span>
          </button>
        </div>
        <button id="rtts-drawer-close" aria-label="关闭"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>

      <div id="rtts-pane-chat" class="rtts-pane active" role="tabpanel" aria-label="AI 伴学">
        <div id="rtts-chat"></div>
        <div id="rtts-chat-composer">
          <div id="rtts-chat-attachments" aria-live="polite"></div>
          <div id="rtts-md-shell">
            <div id="rtts-md-toolbar" role="toolbar" aria-label="Markdown 快捷操作">
              <button type="button" data-md="bold" title="加粗（Ctrl/⌘+B）" aria-label="加粗"><b>B</b></button>
              <button type="button" data-md="italic" title="斜体（Ctrl/⌘+I）" aria-label="斜体"><i>I</i></button>
              <button type="button" data-md="code" title="行内代码" aria-label="行内代码"><span>&lt;/&gt;</span></button>
              <button type="button" data-md="link" title="链接" aria-label="插入链接">🔗</button>
              <button type="button" id="rtts-md-preview-btn" title="预览 Markdown">预览</button>
            </div>
            <div id="rtts-chat-editor" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="提问" data-placeholder="输入问题，支持 Markdown。Enter 发送，Shift+Enter 换行"></div>
            <div id="rtts-chat-preview" class="rtts-md-preview" hidden></div>
          </div>
          <div id="rtts-chat-input-row">
            <button id="rtts-chat-attach-btn" type="button" aria-label="添加图片" data-tip="添加图片">
              <svg viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <span id="rtts-composer-hint">Markdown · Enter 发送</span>
            <button id="rtts-send" type="button">发送</button>
          </div>
          <input id="rtts-chat-file" type="file" accept="image/*" multiple hidden>
        </div>
      </div>

      <div id="rtts-pane-notes" class="rtts-pane" role="tabpanel" aria-label="笔记">
        <div id="rtts-notes-list"></div>
        <div id="rtts-notes-input-row">
          <input id="rtts-notes-input" type="text" placeholder="输入快速笔记…" aria-label="新笔记">
          <button id="rtts-notes-add" type="button" aria-label="添加笔记"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        </div>
      </div>
    </div>

    <div id="rtts-fs-warn" class="hidden"></div>

    <!-- In-page settings modal -->
    <div id="rtts-settings-modal" class="rtts-modal-mask">
      <div class="rtts-modal" role="dialog" aria-modal="true" aria-label="配置">
        <div class="rtts-modal-header">
          <div class="rtts-modal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>
          </div>
          <div>
            <h3>配置</h3>
            <p class="sub">密钥只保存在本机，页面上的其他脚本无法读取</p>
          </div>
          <button id="rtts-settings-close" class="rtts-modal-close" type="button" aria-label="关闭"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="rtts-modal-body">
          <div class="rtts-field">
            <label for="rtts-cfg-baseurl">Base URL</label>
            <input id="rtts-cfg-baseurl" type="text" spellcheck="false" autocomplete="off" placeholder="https://api.mosi.cn/v1">
            <span class="hint">MOSS 官方网关默认使用 https://api.mosi.cn/v1</span>
          </div>
          <div class="rtts-field">
            <label for="rtts-cfg-apikey">API Key</label>
            <div class="rtts-pw-wrap">
              <input id="rtts-cfg-apikey" type="password" spellcheck="false" autocomplete="off" placeholder="sk-…">
              <button id="rtts-cfg-toggle-key" type="button" aria-label="显示或隐藏密钥"><svg class="eye-open" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-off" viewBox="0 0 24 24"><path d="M17.94 17.94A10.4 10.4 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.4 10.4 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="2" y1="2" x2="22" y2="22"/></svg></button>
            </div>
            <span class="hint">在 platform.mosi.cn → API Keys 创建</span>
          </div>
          <div class="rtts-field">
            <label for="rtts-cfg-llm">LLM 模型（对话 / 翻译 / 视觉）</label>
            <input id="rtts-cfg-llm" type="text" spellcheck="false" placeholder="moss-vl-1.0">
          </div>
          <div class="rtts-grid-2">
            <div class="rtts-field">
              <label for="rtts-cfg-audio">音频转写模型</label>
              <input id="rtts-cfg-audio" type="text" spellcheck="false" placeholder="moss-transcribe-1.0">
            </div>
            <div class="rtts-field">
              <label for="rtts-cfg-image">图像生成模型</label>
              <input id="rtts-cfg-image" type="text" spellcheck="false" placeholder="moss-image-sft-1.0">
            </div>
          </div>
          <div class="rtts-section-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            Obsidian 同步
          </div>
          <div class="rtts-grid-2">
            <div class="rtts-field">
              <label for="rtts-cfg-ob-protocol">协议</label>
              <select id="rtts-cfg-ob-protocol">
                <option value="http">HTTP（推荐）</option>
                <option value="https">HTTPS（需信任证书）</option>
              </select>
            </div>
            <div class="rtts-field">
              <label for="rtts-cfg-ob-port">端口</label>
              <input id="rtts-cfg-ob-port" type="number" inputmode="numeric" placeholder="27123">
            </div>
          </div>
          <div class="rtts-field">
            <label for="rtts-cfg-ob-key">API Key</label>
            <input id="rtts-cfg-ob-key" type="password" spellcheck="false" autocomplete="off" placeholder="在 Local REST API 插件设置中复制">
          </div>
          <div class="rtts-field">
            <label for="rtts-cfg-ob-folder">笔记目录</label>
            <input id="rtts-cfg-ob-folder" type="text" spellcheck="false" placeholder="snooper-notes">
            <span class="hint">HTTP 需要插件开启「Enable Non-encrypted (HTTP) Server」</span>
          </div>
          <div class="rtts-inline-actions">
            <button id="rtts-cfg-ob-test" class="rtts-btn-ghost" type="button">测试 Obsidian</button>
            <div id="rtts-cfg-ob-status" class="rtts-status" role="status" aria-live="polite"></div>
          </div>
          <div id="rtts-cfg-status" class="rtts-status" role="status" aria-live="polite"></div>
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-cfg-test" class="rtts-btn-ghost" type="button">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            测试连接
          </button>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button id="rtts-cfg-cancel" class="rtts-btn-ghost" type="button">取消</button>
            <button id="rtts-cfg-save" class="rtts-btn-primary" type="button">保存配置</button>
          </div>
        </div>
      </div>
    </div>

    <!-- In-page image generation -->
    <div id="rtts-image-modal" class="rtts-modal-mask">
      <div class="rtts-modal rtts-image-panel" role="dialog" aria-modal="true" aria-label="生成配图">
        <div class="rtts-modal-header">
          <div class="rtts-modal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          </div>
          <div>
            <h3>生成配图</h3>
            <p class="sub">MOSS-Image · 文生图 · 当前限时免费</p>
          </div>
          <button id="rtts-img-close" class="rtts-modal-close" type="button" aria-label="关闭"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="rtts-modal-body">
          <div class="rtts-field">
            <label for="rtts-img-prompt">提示词</label>
            <textarea id="rtts-img-prompt" placeholder="描述你想要的画面…"></textarea>
          </div>
          <div class="rtts-grid-2">
            <div class="rtts-field">
              <label for="rtts-img-size">尺寸</label>
              <select id="rtts-img-size">
                <option value="1024x1024">1024 × 1024（方形）</option>
                <option value="1024x768">1024 × 768（横向）</option>
                <option value="768x1024">768 × 1024（纵向）</option>
              </select>
            </div>
            <div class="rtts-field">
              <label for="rtts-img-neg">负向提示词</label>
              <input id="rtts-img-neg" type="text" placeholder="模糊、畸形、水印" value="nsfw, worst quality, low quality, watermark">
            </div>
          </div>
          <div id="rtts-img-status" class="rtts-status" role="status" aria-live="polite"></div>
          <div id="rtts-img-result" class="rtts-image-result">
            <img id="rtts-img-result-img" alt="生成的配图">
          </div>
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-img-generate" class="rtts-btn-primary" type="button">
            <svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>
            <span>生成图片</span>
          </button>
          <div id="rtts-img-actions" class="rtts-image-actions">
            <button id="rtts-img-save" class="rtts-btn-ghost" type="button">存入笔记</button>
            <button id="rtts-img-download" class="rtts-btn-ghost" type="button">下载</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Screenshot preview -->
    <div id="rtts-shot-modal" class="rtts-modal-mask">
      <div class="rtts-modal rtts-shot-panel" role="dialog" aria-modal="true" aria-label="截图预览">
        <div class="rtts-modal-header">
          <div class="rtts-modal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
          </div>
          <div>
            <h3>视频截图</h3>
            <p class="sub">只截取视频画面，不含字幕与工具栏</p>
          </div>
          <button id="rtts-shot-close-x" class="rtts-modal-close" type="button" aria-label="关闭"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="rtts-modal-body rtts-shot-body">
          <img id="rtts-shot-img" alt="视频截图预览">
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-shot-download" class="rtts-btn-ghost" type="button">下载图片</button>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button id="rtts-shot-close" class="rtts-btn-ghost" type="button">关闭</button>
            <button id="rtts-shot-save" class="rtts-btn-primary" type="button">存入笔记</button>
          </div>
        </div>
      </div>
    </div>

    <div id="rtts-toasts" aria-live="polite"></div>
  `;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  shadow.append(style, wrapper);
  (document.body || document.documentElement).appendChild(host);

  /* ===== DOM refs ===== */
  const bar = shadow.getElementById('rtts-bar')!;
  const barGrip = shadow.getElementById('rtts-bar-grip')!;
  const recordBtn = shadow.getElementById('rtts-record')!;
  const recordLabelEl = shadow.getElementById('rtts-record-label')!;
  const moreBtn = shadow.getElementById('rtts-more-btn') as HTMLButtonElement;
  const toolsMenu = shadow.getElementById('rtts-menu')!;
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
  const exportTxtBtn = shadow.getElementById('rtts-export-txt-btn')!;
  const exportMdBtn = shadow.getElementById('rtts-export-md-btn')!;
  const streamingRow = shadow.getElementById('rtts-streaming-row')!;
  const streamingText = shadow.getElementById('rtts-streaming-text')!;
  const streamingSource = shadow.getElementById('rtts-streaming-source')!;
  const streamingLabel = shadow.getElementById('rtts-streaming-label')!;
  const drawer = shadow.getElementById('rtts-drawer')!;
  const chatEl = shadow.getElementById('rtts-chat')!;
  const chatComposer = shadow.getElementById('rtts-chat-composer')!;
  const chatEditor = shadow.getElementById('rtts-chat-editor') as HTMLElement;
  const chatPreview = shadow.getElementById('rtts-chat-preview') as HTMLElement;
  const mdPreviewBtn = shadow.getElementById('rtts-md-preview-btn') as HTMLButtonElement;
  const drawerTabChat = shadow.getElementById('rtts-tab-chat') as HTMLButtonElement;
  const drawerTabNotes = shadow.getElementById('rtts-tab-notes') as HTMLButtonElement;
  const paneChat = shadow.getElementById('rtts-pane-chat')!;
  const paneNotes = shadow.getElementById('rtts-pane-notes')!;
  const chatBtn = shadow.getElementById('rtts-chat-btn')!;
  const chatAttachBtn = shadow.getElementById('rtts-chat-attach-btn') as HTMLButtonElement;
  const chatFile = shadow.getElementById('rtts-chat-file') as HTMLInputElement;
  const chatAttachments = shadow.getElementById('rtts-chat-attachments')!;
  const sendBtn = shadow.getElementById('rtts-send') as HTMLButtonElement;
  const fsWarn = shadow.getElementById('rtts-fs-warn')!;
  const hideBtn = shadow.getElementById('rtts-hide-btn')!;
  const showBtn = shadow.getElementById('rtts-show-btn')!;
  // New elements
  const noteBtn = shadow.getElementById('rtts-note-btn')!;
  const imageBtn = shadow.getElementById('rtts-image-btn')!;
  const screenshotBtn = shadow.getElementById('rtts-screenshot-btn')!;
  const notesCount = shadow.getElementById('rtts-notes-count')!;
  const notesBadge = shadow.getElementById('rtts-notes-badge')!;
  const notesBtn = shadow.getElementById('rtts-notes-btn')!;
  const notesList = shadow.getElementById('rtts-notes-list')!;
  const notesInput = shadow.getElementById('rtts-notes-input') as HTMLInputElement;
  const notesAdd = shadow.getElementById('rtts-notes-add')!;
  const obsidianBtn = shadow.getElementById('rtts-obsidian-btn')!;

  // In-page settings + image panels
  const settingsModal = shadow.getElementById('rtts-settings-modal')!;
  const settingsClose = shadow.getElementById('rtts-settings-close') as HTMLButtonElement;
  const cfgBaseUrl = shadow.getElementById('rtts-cfg-baseurl') as HTMLInputElement;
  const cfgApiKey = shadow.getElementById('rtts-cfg-apikey') as HTMLInputElement;
  const cfgToggleKey = shadow.getElementById('rtts-cfg-toggle-key') as HTMLButtonElement;
  const cfgLlm = shadow.getElementById('rtts-cfg-llm') as HTMLInputElement;
  const cfgAudio = shadow.getElementById('rtts-cfg-audio') as HTMLInputElement;
  const cfgImage = shadow.getElementById('rtts-cfg-image') as HTMLInputElement;
  const cfgStatus = shadow.getElementById('rtts-cfg-status')!;
  const cfgTest = shadow.getElementById('rtts-cfg-test') as HTMLButtonElement;
  const cfgSave = shadow.getElementById('rtts-cfg-save') as HTMLButtonElement;
  const cfgCancel = shadow.getElementById('rtts-cfg-cancel') as HTMLButtonElement;
  const cfgObProtocol = shadow.getElementById('rtts-cfg-ob-protocol') as HTMLSelectElement;
  const cfgObPort = shadow.getElementById('rtts-cfg-ob-port') as HTMLInputElement;
  const cfgObKey = shadow.getElementById('rtts-cfg-ob-key') as HTMLInputElement;
  const cfgObFolder = shadow.getElementById('rtts-cfg-ob-folder') as HTMLInputElement;
  const cfgObTest = shadow.getElementById('rtts-cfg-ob-test') as HTMLButtonElement;
  const cfgObStatus = shadow.getElementById('rtts-cfg-ob-status')!;
  const shotModal = shadow.getElementById('rtts-shot-modal')!;
  const shotImg = shadow.getElementById('rtts-shot-img') as HTMLImageElement;
  const shotClose = shadow.getElementById('rtts-shot-close') as HTMLButtonElement;
  const shotCloseX = shadow.getElementById('rtts-shot-close-x') as HTMLButtonElement;
  const shotDownload = shadow.getElementById('rtts-shot-download') as HTMLButtonElement;
  const shotSave = shadow.getElementById('rtts-shot-save') as HTMLButtonElement;
  const imageModal = shadow.getElementById('rtts-image-modal')!;
  const imgClose = shadow.getElementById('rtts-img-close') as HTMLButtonElement;
  const imgPrompt = shadow.getElementById('rtts-img-prompt') as HTMLTextAreaElement;
  const imgSize = shadow.getElementById('rtts-img-size') as HTMLSelectElement;
  const imgNeg = shadow.getElementById('rtts-img-neg') as HTMLInputElement;
  const imgGenerate = shadow.getElementById('rtts-img-generate') as HTMLButtonElement;
  const imgStatus = shadow.getElementById('rtts-img-status')!;
  const imgResult = shadow.getElementById('rtts-img-result')!;
  const imgResultImg = shadow.getElementById('rtts-img-result-img') as HTMLImageElement;
  const imgActions = shadow.getElementById('rtts-img-actions')!;
  const imgSave = shadow.getElementById('rtts-img-save') as HTMLButtonElement;
  const imgDownload = shadow.getElementById('rtts-img-download') as HTMLButtonElement;
  const toasts = shadow.getElementById('rtts-toasts')!;

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
        closeLangPicker();
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
    // Short codes keep the chip narrow; the tooltip carries the full names.
    const srcShort = (LANG_SHORT as any)[session.sourceLang] || String(session.sourceLang).toUpperCase();
    const tgtShort = (LANG_SHORT as any)[session.targetLang] || String(session.targetLang).toUpperCase();
    langLabel.textContent = `${srcShort}→${tgtShort}`;
    langBtn.setAttribute('data-tip', `语言：${src} → ${tgt}`);
  }

  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    langPickerOpen = !langPickerOpen;
    langPicker.classList.toggle('open', langPickerOpen);
    if (langPickerOpen) positionLangPicker();
  });

  function closeLangPicker() {
    langPickerOpen = false;
    langPicker.classList.remove('open');
  }

  // Anchor the picker under the draggable toolbar, flipping above when needed.
  function positionLangPicker() {
    if (!langPickerOpen) return;
    const br = bar.getBoundingClientRect();
    const pr = langPicker.getBoundingClientRect();
    const width = pr.width || 300;
    const height = pr.height || 280;
    const left = Math.min(
      Math.max(8, br.left + br.width / 2 - width / 2),
      Math.max(8, window.innerWidth - width - 8),
    );
    let top = br.bottom + 10;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, br.top - height - 10);
    }
    langPicker.style.transform = 'none';
    langPicker.style.left = `${Math.round(left)}px`;
    langPicker.style.top = `${Math.round(top)}px`;
  }

  // Close picker on outside click. Shadow DOM retargets events to the host,
  // so detection must use composedPath instead of e.target.
  document.addEventListener('click', (e) => {
    if (!langPickerOpen) return;
    const path = e.composedPath();
    if (path.includes(langPicker) || path.includes(langBtn)) return;
    closeLangPicker();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && langPickerOpen) closeLangPicker();
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

  async function fetchAsDataUrl(url: string): Promise<string> {
    try {
      const res = await bg('FETCH_URL', { url });
      if (res.ok && res.dataUrl) return res.dataUrl;
    } catch { /* fallback */ }
    return url;
  }

  /* ===== Toast ===== */
  function toast(message: string, tone: 'info' | 'ok' | 'err' = 'info') {
    const el = document.createElement('div');
    el.className = 'rtts-toast' + (tone === 'info' ? '' : ` ${tone}`);
    el.textContent = message;
    toasts.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.2s';
      setTimeout(() => el.remove(), 220);
    }, 3200);
  }

  function flashChip(btn: HTMLElement, ms = 1600) {
    btn.classList.add('success');
    setTimeout(() => btn.classList.remove('success'), ms);
  }

  /* ===== In-page settings ===== */
  let cfgCache: any = null;

  function setCfgStatus(text: string, tone: 'ok' | 'err' | 'info' | '' = '') {
    cfgStatus.textContent = text;
    cfgStatus.className = 'rtts-status' + (text ? ` show ${tone}` : '');
  }

  function setObStatus(text: string, tone: 'ok' | 'err' | 'info' | '' = '') {
    cfgObStatus.textContent = text;
    cfgObStatus.className = 'rtts-status' + (text ? ` show ${tone}` : '');
  }

  function buildObsidianConfig(): SharedObsidianConfig {
    const protocol: 'http' | 'https' = cfgObProtocol.value === 'https' ? 'https' : 'http'
    const fallbackPort = protocol === 'https' ? 27124 : 27123
    return {
      enabled: true,
      apiProtocol: protocol,
      apiPort: Number(cfgObPort.value) || fallbackPort,
      apiKey: cfgObKey.value.trim(),
      noteFolder: cfgObFolder.value.trim() || 'snooper-notes',
    }
  }

  async function testObsidian() {
    cfgObTest.disabled = true
    setObStatus('正在测试 Obsidian 连接…', 'info')
    const res: any = await bg('TEST_OBSIDIAN', { obsidianConfig: buildObsidianConfig() })
    cfgObTest.disabled = false
    if (res.ok) {
      cfgObProtocol.value = res.protocol
      cfgObPort.value = String(res.port)
      await saveObsidianConfig(buildObsidianConfig())
      setObStatus(`连接成功（${String(res.protocol).toUpperCase()} ${res.port}），已自动保存`, 'ok')
    } else {
      setObStatus(res.error || '连接失败，请确认 Obsidian 正在运行', 'err')
    }
  }

  async function openSettings() {
    cfgApiKey.type = 'password';
    cfgToggleKey.classList.remove('revealed');
    const [res, ob] = await Promise.all([
      bg('GET_CONFIG'),
      loadObsidianConfig(),
    ]);
    cfgObProtocol.value = ob.apiProtocol;
    cfgObPort.value = String(ob.apiPort);
    cfgObKey.value = ob.apiKey;
    cfgObFolder.value = ob.noteFolder;
    setObStatus('');
    if (res.ok && res.config) {
      cfgCache = res.config;
      const first = cfgCache.providers?.[0] ?? {};
      cfgBaseUrl.value = first.baseUrl || 'https://api.mosi.cn/v1';
      cfgApiKey.value = first.apiKey || '';
      cfgLlm.value = cfgCache.routes?.llm?.model || 'moss-vl-1.0';
      cfgAudio.value = cfgCache.routes?.audio?.model || 'moss-transcribe-1.0';
      cfgImage.value = cfgCache.routes?.image?.model || 'moss-image-sft-1.0';
    } else {
      cfgCache = null;
      cfgBaseUrl.value = 'https://api.mosi.cn/v1';
      cfgApiKey.value = '';
      cfgLlm.value = 'moss-vl-1.0';
      cfgAudio.value = 'moss-transcribe-1.0';
      cfgImage.value = 'moss-image-sft-1.0';
      if (!res.ok) toast('读取配置失败：' + (res.error || '未知错误'), 'err');
    }
    setCfgStatus('');
    settingsModal.classList.add('open');
  }

  function closeSettings() {
    settingsModal.classList.remove('open');
  }

  function buildConfig(): any {
    const defaultProvider = () => ({
      id: 'moss-official',
      name: 'MOSS 官方',
      baseUrl: 'https://api.mosi.cn/v1',
      apiKey: '',
      protocol: 'moss',
      note: '官方 MOSS 网关',
      models: [],
      lastSyncedAt: null,
      status: 'unknown',
      lastError: '',
    });

    const base = cfgCache
      ? JSON.parse(JSON.stringify(cfgCache))
      : { providers: [defaultProvider()], routes: {} };

    if (!Array.isArray(base.providers) || base.providers.length === 0) {
      base.providers = [defaultProvider()];
    }
    if (!base.routes || typeof base.routes !== 'object') {
      base.routes = {};
    }

    const provider = base.providers[0];
    provider.baseUrl = cfgBaseUrl.value.trim() || 'https://api.mosi.cn/v1';
    provider.apiKey = cfgApiKey.value.trim();

    const keepProvider = (current: any) =>
      current?.providerId && base.providers.some((item: any) => item.id === current.providerId)
        ? current.providerId
        : provider.id;

    base.routes.llm = {
      ...(base.routes.llm || {}),
      providerId: keepProvider(base.routes.llm),
      model: cfgLlm.value.trim() || 'moss-vl-1.0',
    };
    base.routes.audio = {
      ...(base.routes.audio || {}),
      providerId: keepProvider(base.routes.audio),
      model: cfgAudio.value.trim() || 'moss-transcribe-1.0',
    };
    base.routes.image = {
      ...(base.routes.image || {}),
      providerId: keepProvider(base.routes.image),
      model: cfgImage.value.trim() || 'moss-image-sft-1.0',
    };
    if (!base.routes.video) {
      base.routes.video = { providerId: provider.id, model: 'moss-vl-realtime-1.0' };
    }
    return base;
  }

  async function saveSettings() {
    const config = buildConfig();
    cfgSave.disabled = true;
    setCfgStatus('正在保存…', 'info');
    await saveObsidianConfig(buildObsidianConfig());
    const res: any = await bg('SAVE_CONFIG', { config });
    cfgSave.disabled = false;
    if (res.ok) {
      cfgCache = config;
      setCfgStatus('已保存。密钥只存储在本机浏览器。', 'ok');
      toast('配置已保存', 'ok');
      setTimeout(closeSettings, 600);
    } else {
      setCfgStatus('保存失败：' + (res.error || '未知错误'), 'err');
    }
  }

  async function testConnection() {
    cfgTest.disabled = true;
    setCfgStatus('正在连接 ' + (cfgBaseUrl.value.trim() || '…') + ' …', 'info');
    const res: any = await bg('TEST_CONNECTION', { config: buildConfig() });
    cfgTest.disabled = false;
    if (res.ok) {
      const sample = Array.isArray(res.models) && res.models.length
        ? '：' + res.models.slice(0, 4).join('、')
        : '';
      setCfgStatus(`连接成功，发现 ${res.count} 个模型${sample}`, 'ok');
    } else {
      setCfgStatus('连接失败：' + (res.error || '未知错误'), 'err');
    }
  }

  settingsClose.addEventListener('click', closeSettings);
  cfgCancel.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });
  cfgSave.addEventListener('click', saveSettings);
  cfgTest.addEventListener('click', testConnection);
  cfgObTest.addEventListener('click', testObsidian);
  cfgObProtocol.addEventListener('change', () => {
    const port = Number(cfgObPort.value);
    if (!port || port === 27123 || port === 27124) {
      cfgObPort.value = cfgObProtocol.value === 'https' ? '27124' : '27123';
    }
  });
  cfgToggleKey.addEventListener('click', () => {
    const revealed = cfgApiKey.type === 'password';
    cfgApiKey.type = revealed ? 'text' : 'password';
    cfgToggleKey.classList.toggle('revealed', revealed);
  });
  document.addEventListener('keydown', (e) => {
    const settingsOpen = settingsModal.classList.contains('open');
    const imageOpen = imageModal.classList.contains('open');
    const shotOpen = shotModal.classList.contains('open');
    if (!settingsOpen && !imageOpen && !shotOpen) return;

    if (e.key === 'Escape') {
      if (imageOpen) closeImagePanel();
      else if (shotOpen) closeShotPreview();
      else closeSettings();
      return;
    }
    if (
      e.key === 'Enter' &&
      settingsOpen &&
      (e.target as HTMLElement | null)?.tagName === 'INPUT'
    ) {
      e.preventDefault();
      saveSettings();
    }
  });

  /* ===== In-page image generation ===== */
  let lastImageUrl = '';

  function openImagePanel(prompt?: string) {
    imgPrompt.value = prompt || '';
    imgStatus.className = 'rtts-status';
    imgStatus.textContent = '';
    imgResult.classList.remove('show');
    imgResultImg.removeAttribute('src');
    imgActions.classList.remove('show');
    lastImageUrl = '';
    imageModal.classList.add('open');
    setTimeout(() => imgPrompt.focus(), 30);
  }

  function closeImagePanel() {
    imageModal.classList.remove('open');
  }

  async function generateImageInPage() {
    const prompt = imgPrompt.value.trim();
    if (!prompt) {
      toast('请先输入提示词', 'err');
      return;
    }
    const label = imgGenerate.querySelector('span');
    imgGenerate.disabled = true;
    imgGenerate.classList.add('loading');
    if (label) label.textContent = '生成中…';
    imgStatus.className = 'rtts-status show info';
    imgStatus.textContent = '正在请求生图接口，通常需要 20–30 秒';
    const res: any = await bg('GENERATE_IMAGE', {
      prompt,
      size: imgSize.value,
      negativePrompt: imgNeg.value.trim(),
    });
    imgGenerate.disabled = false;
    imgGenerate.classList.remove('loading');
    if (label) label.textContent = '生成图片';
    if (res.ok && Array.isArray(res.images) && res.images.length) {
      lastImageUrl = res.images[0];
      imgResultImg.src = lastImageUrl;
      imgResult.classList.add('show');
      imgActions.classList.add('show');
      imgStatus.className = 'rtts-status show ok';
      imgStatus.textContent = '生成完成 · ' + (res.model || 'MOSS-Image');
    } else {
      imgStatus.className = 'rtts-status show err';
      imgStatus.textContent = res.error || '生成失败';
    }
  }

  async function saveImageToNotes() {
    if (!lastImageUrl) return;
    const dataUrl = lastImageUrl.startsWith('data:')
      ? lastImageUrl
      : await fetchAsDataUrl(lastImageUrl);
    addNoteEntry({
      id: `image_${Date.now()}`,
      type: 'image',
      at: Date.now(),
      imageUrl: dataUrl,
      text: imgPrompt.value.trim().slice(0, 80) || '生成配图',
    });
    toast('已存入笔记', 'ok');
    closeImagePanel();
  }

  function downloadImage() {
    if (!lastImageUrl) return;
    const a = document.createElement('a');
    a.href = lastImageUrl;
    a.download = `snooper-${Date.now()}.png`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }

  imgClose.addEventListener('click', closeImagePanel);
  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) closeImagePanel();
  });
  imgGenerate.addEventListener('click', generateImageInPage);
  imgSave.addEventListener('click', saveImageToNotes);
  imgDownload.addEventListener('click', downloadImage);

  /* ===== Rendering ===== */
  function render() {
    const s = session.state;
    recordBtn.className = 'rtts-btn rtts-record-btn' + (s === 'running' ? ' running' : '');
    const recordLabel = session.isDemoMode
      ? s === 'running' ? '停止演示' : '开始真实转写'
      : s === 'running' ? '停止转写' : s === 'starting' ? '启动中' : '开始转写';
    recordBtn.setAttribute('data-tip', recordLabel);
    // The button carries a visible label now, so it must not say
    // "实时字幕" while recording.
    recordLabelEl.textContent = session.isDemoMode
      ? (s === 'running' ? '停止演示' : '演示')
      : s === 'running' ? '停止' : s === 'starting' ? '启动中' : '实时字幕';
    recordBtn.setAttribute('aria-label', recordLabel);
    updateLangLabel();

    // === Scrollable Subtitle Display (full history) ===
    const subs = session.subtitles || [];
    const streaming = session.streamingSubtitle;

    if (!uiHidden && (s === 'running' || subs.length > 0 || streaming)) {
      subBox.classList.remove('hidden');
      const hasContent = subs.length > 0 || !!streaming;
      subPlaceholder.style.display = hasContent ? 'none' : '';
      subPlaceholder.textContent = session.isDemoMode
        ? '演示模式启动中…'
        : '正在聆听…';

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
      subPlaceholder.style.display = '';
      subPlaceholder.textContent = '点击「录音」开始实时转写';
      subRows.textContent = '';
      clearStreaming();
      subBox.classList.add('hidden');
    }
    applyUiHidden();

    // Position subtitle box near video
    positionSubBox();

    // Chat
    updateChat();

    // Notes
    renderNotes();
  }

  function updateChat() {
    const msgs = session.messages || [];
    chatEl.textContent = '';
    if (msgs.length === 0) {
      const w = document.createElement('div');
      w.className = 'rtts-msg assistant';
      w.textContent = '你好，我是视频伴学助手，可以问我关于当前视频内容的问题。';
      chatEl.appendChild(w);
    } else {
      msgs.forEach((m) => {
        const b = document.createElement('div');
        b.className = `rtts-msg ${m.role === 'user' ? 'user' : 'assistant'}`;
        const contentEl = document.createElement('div');
        contentEl.innerHTML = renderMarkdownLite(m.content || '');
        b.appendChild(contentEl);
        // Render attached images
        if (Array.isArray((m as any).images) && (m as any).images.length > 0) {
          const imgGrid = document.createElement('div');
          imgGrid.className = 'rtts-msg-images';
          for (const url of (m as any).images) {
            const thumb = document.createElement('img');
            thumb.src = url;
            thumb.alt = '图片';
            thumb.addEventListener('click', () => openShotPreview(url, true));
            imgGrid.appendChild(thumb);
          }
          b.appendChild(imgGrid);
        }
        chatEl.appendChild(b);
      });
    }
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  /* ===== Streaming Subtitle Rendering ===== */

  function renderStreaming(sub: StreamingSubtitle | null) {
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

    streamingLabel.textContent = '翻译中';

    // Auto-scroll to show streaming row
    if (subScroll.scrollHeight - subScroll.scrollTop - subScroll.clientHeight < 100) {
      subScroll.scrollTop = subScroll.scrollHeight;
    }
  }

  function clearStreaming() {
    streamingRow.classList.add('hidden');
  }

  let subBoxAutoPosition = true;

  function positionSubBox() {
    if (!subBoxAutoPosition) return;
    const maxWidth = Math.max(220, window.innerWidth - 32);
    const video = document.querySelector('video');
    if (video && video.readyState > 0) {
      const vr = video.getBoundingClientRect();
      const top = vr.top + vr.height * 0.75;
      const width = Math.min(vr.width * 0.88, 840, maxWidth);
      (subBox as HTMLElement).style.top = Math.max(top, 80) + 'px';
      (subBox as HTMLElement).style.width = `${Math.round(width)}px`;
      (subBox as HTMLElement).style.bottom = 'auto';
    } else {
      (subBox as HTMLElement).style.top = '';
      (subBox as HTMLElement).style.bottom = '26px';
      (subBox as HTMLElement).style.width = `${Math.min(Math.round(window.innerWidth * 0.82), 840, maxWidth)}px`;
    }
  }

  const ro = (window as any).ResizeObserver
    ? new ResizeObserver(() => positionSubBox())
    : { observe() {}, disconnect() {} };
  ro.observe(document.body);
  document.addEventListener('scroll', positionSubBox, { passive: true });
  window.addEventListener('resize', positionSubBox, { passive: true });

  /* ===== Draggable toolbar ===== */
  const BAR_POS_KEY = 'snooper.toolbar-position.v1';

  function readBarPosition(): { x: number; y: number } | null {
    try {
      const raw = localStorage.getItem(BAR_POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
    } catch { /* ignore */ }
    return null;
  }

  function clampBarPosition(x: number, y: number) {
    const rect = bar.getBoundingClientRect();
    return {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - rect.width - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - rect.height - 8)),
    };
  }

  function applyBarPosition(x: number, y: number, persist = false) {
    const pos = clampBarPosition(x, y);
    bar.style.transform = 'none';
    bar.style.left = `${pos.x}px`;
    bar.style.top = `${pos.y}px`;
    bar.classList.toggle('tips-up', pos.y > window.innerHeight / 2);
    if (persist) {
      try { localStorage.setItem(BAR_POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
      try {
        (chrome as any).storage?.local?.set({ [BAR_POS_KEY]: pos });
      } catch { /* ignore */ }
    }
    if (langPickerOpen) positionLangPicker();
  }

  async function initBarPosition() {
    let saved = readBarPosition();
    if (!saved) {
      try {
        const stored = await (chrome as any).storage?.local?.get(BAR_POS_KEY);
        const value = stored?.[BAR_POS_KEY];
        if (typeof value?.x === 'number' && typeof value?.y === 'number') saved = value;
      } catch { /* ignore */ }
    }
    if (saved) {
      applyBarPosition(saved.x, saved.y);
      return;
    }
    const rect = bar.getBoundingClientRect();
    applyBarPosition((window.innerWidth - rect.width) / 2, 16);
  }

  let barDrag: { dx: number; dy: number } | null = null;

  barGrip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = bar.getBoundingClientRect();
    barDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    bar.classList.add('dragging');
    barGrip.setPointerCapture(e.pointerId);
  });

  barGrip.addEventListener('pointermove', (e) => {
    if (!barDrag) return;
    applyBarPosition(e.clientX - barDrag.dx, e.clientY - barDrag.dy);
  });

  function endBarDrag() {
    if (!barDrag) return;
    barDrag = null;
    bar.classList.remove('dragging');
    const rect = bar.getBoundingClientRect();
    applyBarPosition(rect.left, rect.top, true);
  }

  barGrip.addEventListener('pointerup', endBarDrag);
  barGrip.addEventListener('pointercancel', endBarDrag);

  barGrip.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 24 : 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    const rect = bar.getBoundingClientRect();
    applyBarPosition(rect.left + move[0], rect.top + move[1], true);
  });

  window.addEventListener('resize', () => {
    const rect = bar.getBoundingClientRect();
    applyBarPosition(rect.left, rect.top, true);
  });

  /* ===== Drag (subtitle overlay) ===== */

  function startDrag(e: MouseEvent, el: HTMLElement, offsetX: number, offsetY: number) {
    dragState = { el, offsetX, offsetY };
    el.style.cursor = 'grabbing';
    el.style.transition = 'none';
    e.preventDefault();
  }

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
    el.style.cursor = el === subBox ? 'grab' : '';
    setTimeout(() => { el.style.transition = ''; }, 50);
  });

  /* ===== Record button ===== */
  recordBtn.addEventListener('click', async () => {
    const s = session.state;
    if (session.isDemoMode && s === 'running') {
      stopDemoSubtitles();
      session.isDemoMode = false;
      session.state = 'idle';
      render();
      return;
    }
    if (s === 'running' || s === 'starting') {
      session.state = 'stopping';
      render();
      await bg('STOP');
      session.state = 'idle';
      render();
    } else {
      // Stop demo if running
      if (session.isDemoMode) {
        stopDemoSubtitles();
        session.isDemoMode = false;
        session.subtitles = [];
      }

      session.state = 'starting';
      render();
      const res = await bg('START', {
        sourceLang: session.sourceLang,
        targetLang: session.targetLang,
      });
      if (!res.ok) {
        const msg = res.error || '启动失败';
        toast(msg, 'err');
        if (msg.includes('API Key') || msg.includes('未选择模型')) openSettings();
        session.state = 'idle';
        render();
      } else {
        session.state = 'running';
        render();
      }
    }
  });

  /* ===== Unified drawer: chat + notes tabs ===== */

  function syncDrawerButtons() {
    chatBtn.classList.toggle('active', isDrawerOpen && drawerTab === 'chat');
    notesBtn.classList.toggle('active', isDrawerOpen && drawerTab === 'notes');
  }

  function setDrawerTab(tab: 'chat' | 'notes') {
    drawerTab = tab;
    drawerTabChat.classList.toggle('active', tab === 'chat');
    drawerTabNotes.classList.toggle('active', tab === 'notes');
    drawerTabChat.setAttribute('aria-selected', String(tab === 'chat'));
    drawerTabNotes.setAttribute('aria-selected', String(tab === 'notes'));
    paneChat.classList.toggle('active', tab === 'chat');
    paneNotes.classList.toggle('active', tab === 'notes');
    if (tab === 'notes') renderNotes();
    syncDrawerButtons();
  }

  function openDrawer(tab: 'chat' | 'notes') {
    isDrawerOpen = true;
    drawer.classList.add('open');
    setDrawerTab(tab);
    if (tab === 'notes') notesInput.focus();
    else chatEditor.focus();
  }

  function closeDrawer() {
    isDrawerOpen = false;
    drawer.classList.remove('open');
    syncDrawerButtons();
  }

  chatBtn.addEventListener('click', () => {
    if (isDrawerOpen && drawerTab === 'chat') closeDrawer();
    else openDrawer('chat');
  });
  notesBtn.addEventListener('click', () => {
    if (isDrawerOpen && drawerTab === 'notes') closeDrawer();
    else openDrawer('notes');
  });
  drawerTabChat.addEventListener('click', () => setDrawerTab('chat'));
  drawerTabNotes.addEventListener('click', () => setDrawerTab('notes'));
  shadow.getElementById('rtts-drawer-close')!.addEventListener('click', closeDrawer);

  /* ===== Markdown rendering (safe subset) ===== */

  function renderMarkdownLite(text: string): string {
    const escaped = String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Protect code from bold/italic/link substitutions.
    const codeBlocks: string[] = [];
    let html = escaped.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
      const body = code.replace(/^\n+|\n+$/g, '');
      codeBlocks.push(`<pre><code>${body}</code></pre>`);
      return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
    });

    const inlineCodes: string[] = [];
    html = html.replace(/`([^`\n]+)`/g, (_match, code: string) => {
      inlineCodes.push(`<code>${code}</code>`);
      return `\u0000INLINECODE${inlineCodes.length - 1}\u0000`;
    });

    html = html
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\n/g, '<br>');

    inlineCodes.forEach((code, index) => {
      html = html.replace(`\u0000INLINECODE${index}\u0000`, code);
    });
    codeBlocks.forEach((block, index) => {
      html = html.replace(`\u0000CODEBLOCK${index}\u0000`, block);
    });
    return html;
  }

  /* ===== Chat composer (Markdown editor + images) ===== */

  let pendingImages: string[] = [];
  let isPreviewing = false;

  function getChatText(): string {
    const raw = (chatEditor.innerText || chatEditor.textContent || '').replace(/\u00a0/g, ' ');
    return raw.replace(/\n{3,}/g, '\n\n').trim();
  }

  function clearChatEditor() {
    chatEditor.innerHTML = '';
  }

  // contenteditable="plaintext-only" can leave a lone <br> after the user
  // deletes everything; clear it so the CSS :empty placeholder comes back.
  function refreshEditorPlaceholder() {
    if (isPreviewing) return;
    if (!(chatEditor.textContent || '').trim() && !chatEditor.querySelector('img')) {
      chatEditor.innerHTML = '';
    }
  }

  // Never rewrite the node while an IME composition is active: clearing the
  // DOM mid-composition dismisses the Chinese/Japanese candidate window.
  let editorComposing = false;
  chatEditor.addEventListener('compositionstart', () => { editorComposing = true; });
  chatEditor.addEventListener('compositionend', () => {
    editorComposing = false;
    refreshEditorPlaceholder();
  });
  chatEditor.addEventListener('input', (e) => {
    if (editorComposing || (e as InputEvent).isComposing) return;
    refreshEditorPlaceholder();
  });

  function insertMarkdown(prefix: string, suffix: string, placeholder: string) {
    chatEditor.focus();
    const selection = window.getSelection();
    let selected = '';
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (chatEditor.contains(range.commonAncestorContainer)) {
        selected = range.toString();
      }
    }
    document.execCommand('insertText', false, prefix + (selected || placeholder) + suffix);
    refreshEditorPlaceholder();
  }

  shadow.querySelectorAll('#rtts-md-toolbar [data-md]').forEach((button) => {
    button.addEventListener('click', () => {
      const kind = (button as HTMLElement).dataset.md;
      if (kind === 'bold') insertMarkdown('**', '**', '加粗文字');
      else if (kind === 'italic') insertMarkdown('*', '*', '斜体文字');
      else if (kind === 'code') insertMarkdown('`', '`', '代码');
      else if (kind === 'link') insertMarkdown('[', '](https://)', '链接文字');
    });
  });

  chatEditor.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault();
      if (e.key === 'b') insertMarkdown('**', '**', '加粗文字');
      else insertMarkdown('*', '*', '斜体文字');
    }
  });

  function togglePreview() {
    isPreviewing = !isPreviewing;
    mdPreviewBtn.classList.toggle('active', isPreviewing);
    if (isPreviewing) {
      const text = getChatText();
      chatPreview.innerHTML = text
        ? renderMarkdownLite(text)
        : '<span class="rtts-md-empty">没有可预览的内容</span>';
      chatPreview.hidden = false;
      chatEditor.hidden = true;
      mdPreviewBtn.textContent = '编辑';
    } else {
      chatPreview.hidden = true;
      chatEditor.hidden = false;
      mdPreviewBtn.textContent = '预览';
      chatEditor.focus();
    }
  }

  mdPreviewBtn.addEventListener('click', togglePreview);

  function renderAttachments() {
    chatAttachments.textContent = '';
    if (pendingImages.length === 0) return;
    for (let i = 0; i < pendingImages.length; i++) {
      const url = pendingImages[i]!;
      const chip = document.createElement('div');
      chip.className = 'rtts-attach';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '已添加图片';
      chip.appendChild(img);
      const remove = document.createElement('button');
      remove.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      remove.setAttribute('aria-label', '移除图片');
      remove.addEventListener('click', () => {
        pendingImages.splice(i, 1);
        renderAttachments();
      });
      chip.appendChild(remove);
      chatAttachments.appendChild(chip);
    }
  }

  async function compressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error('图片过大（超过 10MB）'));
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
            if (w > h) { h = Math.round((h * max) / w); w = max; }
            else { w = Math.round((w * max) / h); h = max; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('压缩失败')); return; }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = reader.result as string;
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (pendingImages.length >= 4) { toast('最多 4 张图片', 'err'); break; }
      compressImage(file).then((dataUrl) => {
        pendingImages.push(dataUrl);
        renderAttachments();
      }).catch((err) => {
        toast(err.message, 'err');
      });
    }
  }

  chatAttachBtn.addEventListener('click', () => chatFile.click());
  chatFile.addEventListener('change', () => {
    if (chatFile.files) { addFiles(chatFile.files); chatFile.value = ''; }
  });

  // Paste images
  chatEditor.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type?.startsWith('image/') && item.getAsFile) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  });

  // Drag & drop on the composer area
  chatComposer.addEventListener('dragover', (e) => {
    e.preventDefault();
    chatComposer.classList.add('dragover');
  });
  chatComposer.addEventListener('dragleave', () => chatComposer.classList.remove('dragover'));
  chatComposer.addEventListener('drop', (e) => {
    e.preventDefault();
    chatComposer.classList.remove('dragover');
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  });

  async function sendQuestion() {
    if (isAskBusy) return;
    // Leave preview first: a hidden editor reports '' from innerText.
    if (isPreviewing) togglePreview();
    const q = getChatText();
    const imgs = pendingImages.slice();
    if (!q && imgs.length === 0) return;
    isAskBusy = true;
    clearChatEditor();
    pendingImages = [];
    renderAttachments();
    chatEditor.setAttribute('contenteditable', 'false');
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    if (!session.messages) session.messages = [];
    session.messages.push({ role: 'user', content: q || '（图片）', images: imgs.length > 0 ? imgs : undefined });
    updateChat();

    const rid = 'q_' + Date.now();
    const res = await bg('ASK', { question: q, images: imgs, requestId: rid });
    session.messages.push({
      role: 'assistant',
      content: res.ok && res.answer ? res.answer : '请求失败：' + (res.error || '未知错误'),
    });
    isAskBusy = false;
    chatEditor.setAttribute('contenteditable', 'plaintext-only');
    sendBtn.disabled = false;
    sendBtn.textContent = '发送';
    updateChat();
    chatEditor.focus();
  }

  sendBtn.addEventListener('click', sendQuestion);
  chatEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isPreviewing) {
      e.preventDefault();
      void sendQuestion();
    }
  });

  /* ===== Tools menu ===== */
  function setMenuOpen(open: boolean) {
    toolsMenu.classList.toggle('open', open);
    moreBtn.classList.toggle('active', open);
    moreBtn.setAttribute('aria-expanded', String(open));
  }

  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenuOpen(!toolsMenu.classList.contains('open'));
  });

  // Any item click closes the menu; the individual handlers still run because
  // they are bound to the buttons themselves.
  toolsMenu.addEventListener('click', () => setMenuOpen(false));

  // Keyboard support: the menu is a real menu, not a hover popup.
  function menuItems(): HTMLButtonElement[] {
    return Array.from(toolsMenu.querySelectorAll<HTMLButtonElement>('.rtts-menu-item'));
  }

  moreBtn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    setMenuOpen(true);
    const items = menuItems();
    (e.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus();
  });

  toolsMenu.addEventListener('keydown', (e) => {
    const items = menuItems();
    if (items.length === 0) return;
    const active = shadow.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active as HTMLButtonElement) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]!.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]!.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]!.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]!.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMenuOpen(false);
      moreBtn.focus();
    } else if (e.key === 'Tab') {
      setMenuOpen(false);
    }
  });

  shadow.addEventListener('click', (e) => {
    if (!toolsMenu.classList.contains('open')) return;
    const path = (e as any).composedPath?.() || [];
    if (path.includes(moreBtn) || path.includes(toolsMenu)) return;
    setMenuOpen(false);
  });

  /* ===== Settings ===== */
  shadow.getElementById('rtts-settings-btn')!.addEventListener('click', () => {
    openSettings();
  });

  /* ===== Close / reopen ===== */
  hideBtn.addEventListener('click', () => {
    // Closing is explicit and persists across subtitle updates/reloads: the
    // render loop must not resurrect the bar or the subtitle overlay.
    uiHidden = true;
    persistUiHidden();
    applyUiHidden();
    toast('工具已关闭', 'ok');
  });
  showBtn.addEventListener('click', () => {
    uiHidden = false;
    hasBeenShownOnce = true;
    persistUiHidden();
    applyUiHidden();
    render();
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

  /* ===== Notes Management ===== */

  function getOrCreateActiveNote(): NoteDocument {
    if (session.activeNoteId) {
      const existing = session.notes.find((n) => n.id === session.activeNoteId)
      if (existing) return existing
    }
    // Create a new note
    const note = createNoteDocument(
      `翻译笔记 ${new Date().toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      { source: 'translate' },
    )
    session.notes.push(note)
    session.activeNoteId = note.id
    persistNotes()
    return note
  }

  function addNoteEntry(entry: NoteEntry) {
    const note = getOrCreateActiveNote()
    note.entries.push(entry)
    note.updatedAt = Date.now()
    persistNotes()
    renderNotes()
  }

  function persistNotes() {
    saveNotes(session.notes)
  }

  function renderNotes() {
    const active = session.activeNoteId
      ? session.notes.find((n) => n.id === session.activeNoteId)
      : null

    const noteCount = active?.entries.length ?? 0
    notesCount.textContent = String(noteCount)
    notesBtn.setAttribute('data-tip', `笔记${noteCount ? `（${noteCount}）` : ''}`)
    notesBadge.textContent = noteCount > 99 ? '99+' : String(noteCount)
    notesBadge.hidden = noteCount === 0

    // Render note entries
    notesList.textContent = ''
    const hasEntries = !!(active && active.entries.length > 0)
    if (!hasEntries) {
      const empty = document.createElement('p')
      empty.id = 'rtts-notes-empty'
      empty.textContent = '还没有笔记，点击右侧的「记入笔记」开始记录。'
      notesList.appendChild(empty)
    }
    if (hasEntries && active) {
      active.entries.slice(-10).forEach((entry) => {
        const item = document.createElement('div')
        item.className = 'note-item'
        if (entry.type === 'image' || entry.type === 'svg' || entry.type === 'screenshot') {
          item.style.flexDirection = 'column'
          item.style.gap = '4px'
        }

        // Preview for image/screenshot/svg entries
        if ((entry.type === 'image' || entry.type === 'screenshot') && entry.imageUrl) {
          const img = document.createElement('img')
          img.src = entry.imageUrl
          img.className = 'note-img-preview'
          img.alt = '笔记图片'
          img.style.cssText = 'max-width:100%;max-height:80px;border-radius:4px;object-fit:cover;cursor:pointer'
          img.addEventListener('click', () => openShotPreview(entry.imageUrl!, true))
          item.appendChild(img)
        }
        if (entry.type === 'svg' && entry.svg) {
          const svgPreview = document.createElement('div')
          svgPreview.style.cssText = 'max-width:100%;max-height:60px;overflow:hidden;border-radius:4px'
          try {
            const parsed = new DOMParser().parseFromString(entry.svg, 'image/svg+xml')
            const svgEl = parsed.querySelector('svg')
            if (svgEl) {
              svgEl.setAttribute('width', '100%')
              svgPreview.appendChild(svgEl)
            }
          } catch {
            svgPreview.textContent = 'SVG 预览不可用'
          }
          item.appendChild(svgPreview)
        }

        const row = document.createElement('div')
        row.style.cssText = 'display:flex;align-items:flex-start;gap:4px;width:100%'

        const text = document.createElement('span')
        text.className = 'note-text truncated'
        text.textContent = entry.text || entry.target || entry.source || '笔记'
        row.appendChild(text)

        const typeLabel = document.createElement('span')
        typeLabel.className = 'note-type'
        const typeMap: Record<string, string> = { subtitle: '字幕', image: '配图', svg: '矢量', screenshot: '截图', text: '文本', summary: '摘要' }
        typeLabel.textContent = typeMap[entry.type] || '笔记'
        row.appendChild(typeLabel)

        const delBtn = document.createElement('button')
        delBtn.className = 'note-del'
        delBtn.setAttribute('aria-label', '删除笔记条目')
        delBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          active.entries = active.entries.filter((e2) => e2.id !== entry.id)
          persistNotes()
          renderNotes()
        })
        row.appendChild(delBtn)

        item.appendChild(row)
        notesList.appendChild(item)
      })
    }
  }

  /* ===== Video screenshot ===== */

  function loadImageElement(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('截图解码失败'));
      img.src = src;
    });
  }

  /**
   * Visible content rect of the <video>, accounting for object-fit letterboxing
   * and clipping to the viewport.
   */
  function getVideoContentRect(video: HTMLVideoElement): { x: number; y: number; w: number; h: number } | null {
    const r = video.getBoundingClientRect();
    let x = r.left;
    let y = r.top;
    let w = r.width;
    let h = r.height;
    if (!w || !h || !video.videoWidth || !video.videoHeight) return null;

    const fit = getComputedStyle(video).objectFit || 'contain';
    if (fit === 'contain' || fit === 'scale-down') {
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

  async function captureVideoFrame(): Promise<string> {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    if (!video) throw new Error('当前页面没有视频');
    if (!video.videoWidth || !video.videoHeight) throw new Error('视频还没有画面，请稍后再试');

    const rect = getVideoContentRect(video);
    if (!rect) throw new Error('视频不在可视区域内');

    // Hide the whole injected UI before the browser grabs the viewport so the
    // toolbar and subtitles never end up in the note image.
    host.style.display = 'none';
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await new Promise((resolve) => setTimeout(resolve, 120));

      const res: any = await bg('CAPTURE_SCREENSHOT');
      if (!res.ok || !res.dataUrl) throw new Error(res.error || '浏览器截图失败');

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
        outH = Math.round((outH * maxW) / outW);
        outW = maxW;
      }

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      return canvas.toDataURL('image/jpeg', 0.9);
    } finally {
      host.style.display = '';
    }
  }

  /* ===== Screenshot preview ===== */
  let shotPreviewUrl = '';

  function openShotPreview(dataUrl: string, saved: boolean) {
    shotPreviewUrl = dataUrl;
    shotImg.src = dataUrl;
    shotSave.disabled = saved;
    shotSave.textContent = saved ? '已存入笔记' : '存入笔记';
    shotModal.classList.add('open');
  }

  function closeShotPreview() {
    shotModal.classList.remove('open');
    shotImg.removeAttribute('src');
  }

  function downloadShot() {
    if (!shotPreviewUrl) return;
    const a = document.createElement('a');
    a.href = shotPreviewUrl;
    a.download = `snooper-video-${Date.now()}.jpg`;
    a.click();
  }

  shotClose.addEventListener('click', closeShotPreview);
  shotCloseX.addEventListener('click', closeShotPreview);
  shotDownload.addEventListener('click', downloadShot);
  shotModal.addEventListener('click', (e) => {
    if (e.target === shotModal) closeShotPreview();
  });
  shotSave.addEventListener('click', () => {
    if (!shotPreviewUrl) return;
    addNoteEntry({
      id: `screenshot_${Date.now()}`,
      type: 'screenshot',
      at: Date.now(),
      imageUrl: shotPreviewUrl,
      text: '视频截图',
    });
    shotSave.disabled = true;
    shotSave.textContent = '已存入笔记';
    toast('截图已存入笔记', 'ok');
  });

  /* ===== Export ===== */

  function getSubtitleText(): string {
    return (session.subtitles || [])
      .map((sub) => {
        const t = sub.target || '';
        const s = sub.source ? ` [${sub.source}]` : '';
        return `${t}${s}`;
      })
      .join('\n');
  }

  interface NoteAssetPlan {
    entryId: string
    fileName: string
    dataUrl?: string
    rawText?: string
    mimeType: string
  }

  function collectNoteAssets(note: NoteDocument | null): NoteAssetPlan[] {
    if (!note) return []
    const assets: NoteAssetPlan[] = []
    const stamp = Date.now()
    note.entries.forEach((entry, index) => {
      if ((entry.type === 'image' || entry.type === 'screenshot') && entry.imageUrl) {
        const mime = /^data:([^;,]+)/.exec(entry.imageUrl)?.[1] || 'image/png'
        const ext = mime.includes('jpeg') ? 'jpg'
          : mime.includes('webp') ? 'webp'
            : mime.includes('svg') ? 'svg'
              : mime.includes('gif') ? 'gif' : 'png'
        assets.push({
          entryId: entry.id,
          fileName: `snooper-${stamp}-${index + 1}.${ext}`,
          dataUrl: entry.imageUrl,
          mimeType: mime,
        })
      } else if (entry.type === 'svg' && entry.svg) {
        assets.push({
          entryId: entry.id,
          fileName: `snooper-${stamp}-${index + 1}.svg`,
          rawText: entry.svg,
          mimeType: 'image/svg+xml',
        })
      }
    })
    return assets
  }

  function getSubtitleMarkdown(assetNames?: Map<string, string>): string {
    const lines = [
      `# snooper-browser 翻译记录`,
      ``,
      `- **时间**：${new Date().toLocaleString('zh-CN')}`,
      `- **语言方向**：${LANG_MAP[session.sourceLang as keyof typeof LANG_MAP] || session.sourceLang} → ${LANG_MAP[session.targetLang as keyof typeof LANG_MAP] || session.targetLang}`,
      `- **字幕条目**：${session.subtitles.length} 条`,
      ``,
      `---`,
      ``,
      `| 时间 | 译文 | 原文 |`,
      `| :--- | :--- | :--- |`,
    ]

    for (const sub of session.subtitles) {
      const time = sub.at ? new Date(sub.at).toLocaleTimeString('zh-CN') : ''
      const t = (sub.target || '').replace(/\|/g, '\\|')
      const s = (sub.source || '').replace(/\|/g, '\\|')
      lines.push(`| ${time} | ${t} | ${s} |`)
    }

    // Add notes if any
    const active = session.activeNoteId
      ? session.notes.find((n) => n.id === session.activeNoteId)
      : null
    if (active && active.entries.length > 0) {
      lines.push(``, `---`, ``, `## 笔记`, ``)
      active.entries.forEach((entry) => {
        const label = entry.text || entry.target || '笔记'
        const isVisual = entry.type === 'image' || entry.type === 'screenshot' || entry.type === 'svg'
        if (isVisual) {
          const uploaded = assetNames?.get(entry.id)
          if (uploaded) {
            // Obsidian renders wiki embeds; data: URLs are silently ignored.
            lines.push(`![[${uploaded}]]`)
            if (entry.text) lines.push(``, `*${entry.text}*`, ``)
          } else if (entry.imageUrl && /^https?:\/\//i.test(entry.imageUrl)) {
            lines.push(`![${label}](${entry.imageUrl})`)
            if (entry.text) lines.push(``, `*${entry.text}*`, ``)
          } else {
            lines.push(`> [图片：${label} — 图片数据无法直接嵌入 Markdown，请在 snooper 笔记中查看]`)
          }
        } else if (entry.target) {
          lines.push(`- ${entry.target} ${entry.source ? `（${entry.source}）` : ''}`)
        } else if (entry.text) {
          lines.push(`- ${entry.text}`)
        }
      })
    }

    return lines.join('\n')
  }

  function downloadBlob(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  /* ===== Event Handlers ===== */

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for pages without clipboard permission: hidden textarea + execCommand.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  copyBtn.addEventListener('click', async () => {
    const text = getSubtitleText();
    if (!text) { toast('没有字幕可复制', 'err'); return; }
    const ok = await copyText(text);
    if (ok) {
      flashChip(copyBtn);
      toast('已复制全部字幕', 'ok');
    } else {
      toast('复制失败，请在浏览器设置中允许剪贴板访问', 'err');
    }
  });

  exportTxtBtn.addEventListener('click', () => {
    const text = getSubtitleText();
    if (!text) { toast('没有字幕可导出', 'err'); return; }
    downloadBlob(`snooper-subtitles-${Date.now()}.txt`, text);
    flashChip(exportTxtBtn);
    toast('TXT 已导出', 'ok');
  });

  exportMdBtn.addEventListener('click', () => {
    const text = getSubtitleMarkdown();
    if (!text) { toast('没有内容可导出', 'err'); return; }
    downloadBlob(`snooper-notes-${Date.now()}.md`, text);
    flashChip(exportMdBtn);
    toast('Markdown 已导出', 'ok');
  });

  // Note button: capture current subtitle as note
  noteBtn.addEventListener('click', () => {
    const subs = session.subtitles
    if (subs.length === 0) { toast('没有字幕可记录', 'err'); return; }
    const last = subs[subs.length - 1]
    addNoteEntry({
      id: `note_${Date.now()}`,
      type: 'subtitle',
      at: Date.now(),
      source: last.source,
      target: last.target,
      sourceLang: session.sourceLang,
      targetLang: session.targetLang,
    })
    flashChip(noteBtn);
    toast('已记入笔记', 'ok');
  });

  // Image gen button: open the in-page image panel with the current subtitle
  imageBtn.addEventListener('click', () => {
    const subs = session.subtitles
    const last = subs[subs.length - 1]
    openImagePanel(last?.target || last?.source || '')
  });

  // Screenshot button: capture only the video area, save it, then show a
  // real in-page preview (never window.open on a data URL).
  screenshotBtn.addEventListener('click', async () => {
    screenshotBtn.classList.add('busy');
    try {
      const dataUrl = await captureVideoFrame();
      addNoteEntry({
        id: `screenshot_${Date.now()}`,
        type: 'screenshot',
        at: Date.now(),
        imageUrl: dataUrl,
        text: '视频截图',
      });
      openShotPreview(dataUrl, true);
      flashChip(screenshotBtn);
      toast('已截取视频画面并存入笔记', 'ok');
    } catch (err: any) {
      toast('截图失败：' + (err.message || '未知错误'), 'err');
    } finally {
      screenshotBtn.classList.remove('busy');
    }
  });

  // Notes pane (lives inside the unified drawer)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    setMenuOpen(false)
    if (isDrawerOpen) closeDrawer()
  })

  // Add quick note
  function addQuickNote() {
    const text = notesInput.value.trim()
    if (!text) return
    addNoteEntry({
      id: `text_${Date.now()}`,
      type: 'text',
      at: Date.now(),
      text,
    })
    notesInput.value = ''
  }

  notesAdd.addEventListener('click', addQuickNote)
  notesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addQuickNote(); }
  })

  // Obsidian export
  obsidianBtn.addEventListener('click', async () => {
    // Shared config lives in chrome.storage.local so the side panel and the
    // in-page settings always agree.
    const obsidianConfig = await loadObsidianConfig()
    if (!obsidianConfig.apiKey) {
      toast('请先填写 Obsidian API Key', 'err')
      await openSettings()
      cfgObKey.focus()
      return
    }

    // Upload note images first, then reference the real vault files. Data
    // URLs are ignored by Obsidian's markdown renderer, which is why images
    // used to disappear after export.
    const activeNote = session.activeNoteId
      ? session.notes.find((n) => n.id === session.activeNoteId) || null
      : null
    const assets = collectNoteAssets(activeNote)
    const uploadedNames = new Map<string, string>()
    let uploadedCount = 0
    let failedCount = 0

    if (assets.length > 0) {
      toast(`正在上传 ${assets.length} 张图片到 Obsidian…`, 'ok')
      for (const asset of assets) {
        try {
          const up: any = await bg('OBSIDIAN_UPLOAD_ASSET', {
            obsidianConfig,
            fileName: asset.fileName,
            dataUrl: asset.dataUrl || '',
            rawText: asset.rawText || '',
            mimeType: asset.mimeType,
          })
          if (up.ok) {
            uploadedNames.set(asset.entryId, asset.fileName)
            uploadedCount += 1
          } else {
            failedCount += 1
          }
        } catch {
          failedCount += 1
        }
      }
    }

    const md = getSubtitleMarkdown(uploadedNames)
    const imageNote = uploadedCount > 0 ? `，含 ${uploadedCount} 张图片` : ''
    const failNote = failedCount > 0 ? `；${failedCount} 张图片上传失败，已用文字占位` : ''

    try {
      const res = await bg('EXPORT_TO_OBSIDIAN', {
        content: md,
        title: `snooper-笔记-${Date.now()}`,
        obsidianConfig,
      })
      if (res.ok) {
        flashChip(obsidianBtn, 2000);
        toast(`已发送到 Obsidian${imageNote}${failNote}`, failedCount > 0 ? 'err' : 'ok');
      } else {
        toast('Obsidian 导出失败：' + (res.error || '请确认已安装 Obsidian Local REST API 插件'), 'err')
      }
    } catch (err: any) {
      toast('Obsidian 通信失败：' + (err.message || '请确认 Obsidian 正在运行'), 'err')
    }
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
            // Preserve notes across session updates
            notes: session.notes,
            activeNoteId: session.activeNoteId,
            isDemoMode: session.isDemoMode,
          };
          render();
        }
      }).catch(() => {});
    }
  });

  /* ===== Background push ===== */
  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg && msg.type === 'TOGGLE_TOOLBAR') {
      hasBeenShownOnce = true;
      if (uiHidden) {
        uiHidden = false;
        persistUiHidden();
        applyUiHidden();
        render();
        if (session.state === 'idle' && session.subtitles.length === 0) {
          subPlaceholder.textContent = '点击「录音」开始实时转写';
        }
      } else {
        uiHidden = true;
        persistUiHidden();
        applyUiHidden();
      }
      return;
    }

    if (msg && msg.type === 'OPEN_PAGE_SETTINGS') {
      openSettings();
      return;
    }

    if (msg && msg.type === 'STREAMING_UPDATE') {
      // Keep session as the single source of truth so a later full render()
      // (e.g. from SESSION_UPDATE committing the final subtitle) never
      // resurrects a stale streaming row -> no duplicate, no flash.
      session.streamingSubtitle = msg.streamingSubtitle || null;
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
        // Preserve notes across session updates
        notes: session.notes,
        activeNoteId: session.activeNoteId,
        isDemoMode: session.isDemoMode,
      };
      render();
    }
  });

  /* ===== Init ===== */
  buildLangPicker();
  initBarPosition();

  (async () => {
    // Load notes from shared chrome.storage.local (syncs with side panel)
    const savedNotes = await loadNotes()
    session.notes = savedNotes
    if (savedNotes.length > 0) {
      session.activeNoteId = savedNotes[0]!.id
    }

    const res: any = await bg('GET_SESSION');
    if (res.ok && res.session) {
      session = {
        ...res.session,
        notes: session.notes,
        activeNoteId: session.activeNoteId,
        isDemoMode: false,
      };
    }
    render();
    renderNotes();
  })();

  console.log('[snooper-browser] content script v0.6 loaded');
})();
