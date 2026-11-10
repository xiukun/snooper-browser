/**
 * Content script entry point.
 *
 * Hosts the shadow DOM, owns the session object, and wires the feature
 * modules in ./content/ together. Each module receives its dependencies
 * explicitly (factory functions + dependency objects), so nothing closes
 * over a stale `session` reference when the background snapshot replaces
 * the object wholesale.
 */

import type { NoteDocument } from '../lib/types'
import { CONTENT_CSS } from './content/styles'
import { CONTENT_HTML } from './content/template'
import { loadNotes, NOTES_STORAGE_KEY } from './content/notes-store'
import { loadObsidianConfig } from './content/obsidian-config'
import { renderMarkdownLite } from './content/markdown'
import { createAttachments } from './content/attachments'
import { bindEditorInput, bindMarkdownToolbar, createPreviewToggle, getEditorText } from './content/editor'
import { createLangPicker } from './content/lang-picker'
import { createSettingsPanel } from './content/settings'
import { createSubtitleView } from './content/subtitle-view'
import { createToolbarDrag } from './content/toolbar-drag'
import { bindRecorder } from './content/recorder'
import { createDrawer } from './content/drawer'
import { createNotes } from './content/notes'
import { createShotPreview } from './content/shot'
import { createCitePicker } from './content/cite-picker'
import { createAsk } from './content/ask'
import { createCompanionSessions } from './content/history'
import { readVideoContext } from './content/video-context'
import { createVideoClock } from './content/video-clock'
import { onAfterSeek, seekTo } from './content/video-seek'
import { createToolsMenu } from './content/tools-menu'
import { bindScreenCaptionToggle } from './content/screen-caption-toggle'
import { bindActions } from './content/actions'
import { bindObsidianExport } from './content/obsidian-export'
import { createImageGen } from './content/image-gen'
import { collectRefs } from './content/refs'
import { settleAfterCapture, shouldRestoreUiHidden } from './content/visibility-policy'
import { DEMO_SUBTITLES } from './content/demo'
import type { SessionState } from './content/types'
import { createScreenshotCapturer, findBestVideoCandidate } from './screenshot'
import { isPresentableVideo } from '../lib/video-presence'
import { shouldSkipContentInstall, createContentInstallMarker } from '../lib/content-install'

/* ===== Note + Obsidian persistence: see ./content/notes-store, ./content/obsidian-config ===== */

(() => {
  // Reload recovery: a marker left by a content script whose extension context died
  // (extension reload/update) must not block this fresh initialization, or
  // the toolbar stays unreachable until the page is refreshed.
  const INSTALL_MARKER_KEY = '__rttsContentInstalled';
  if (shouldSkipContentInstall((window as any)[INSTALL_MARKER_KEY])) return;

  // Re-injection can happen after an extension reload while an older copy is
  // still in the page. Only the newest copy may act: older copies would
  // otherwise answer the same message and toggle the toolbar twice.
  const INSTANCE_KEY = '__rttsContentInstance';
  const instanceToken = {};
  (window as any)[INSTANCE_KEY] = instanceToken;
  const isLiveInstance = () => (window as any)[INSTANCE_KEY] === instanceToken;

  const HOST_ID = 'rtts-extension-host';
  // Remove every stale host, not just the first: repeated recoveries used to
  // leave stacked toolbars that could not be closed.
  for (let stale = document.getElementById(HOST_ID); stale; stale = document.getElementById(HOST_ID)) {
    stale.remove();
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'closed' });

  /* ===== State ===== */
  let session: SessionState = {
    state: 'idle',
    sourceLang: 'auto',
    targetLang: 'zh',
    subtitles: [],
    messages: [],
    agentSessionId: null,
    notes: [],
    activeNoteId: null,
    isDemoMode: false,
  };

  /* ===== Toolbar visibility (persisted) ===== */
  const UI_HIDDEN_KEY = 'snooper.ui-hidden.v1';
  /**
   * Which page the persisted toolbar choice belongs to.
   *
   * `uiHidden` is persisted in `localStorage`, which is shared by every page of
   * an origin. A capture started on a video site left the toolbar open for
   * every later same-origin page, including pages with no player at all — the
   * user asked "why is this here". The choice now only survives navigation
   * when the old page actually had a real player (ADR-041); on any other page
   * the next document starts hidden and auto-show decides again.
   */
  const UI_SCOPE_KEY = 'snooper.ui-scope.v1';
  const CAPTURE_STARTED_KEY = 'snooper.ui-capture-open.v1';
  // Toolbar starts hidden on every page load. It reveals itself once a real
  // player is detected (ADR-041: hover previews and tiny embeds do not
  // count), and users can always toggle it from the extension icon. The
  // show-pill (reopen affordance) appears only after the toolbar has been
  // opened once and then closed.
  let uiHidden = true;
  let hasBeenShownOnce = false;
  // Closing the toolbar is an explicit "not on this page": auto-show must not
  // resurrect it until the user opens it again from the icon.
  let autoShowDismissed = false;
  let lastVideoProbeAt = 0;
  const AUTO_SHOW_PROBE_GAP_MS = 800;
  /** True while the toolbar is visible only because ADR-041 auto-showed it. */
  let autoShown = false;
  /** A visibility change from a capture start, not from auto-show. */
  let captureShown = false;
  /** URL that triggered the current auto-show (SPA navigation detector). */
  let autoShowUrl = '';
  /** Watches for the auto-shown toolbar's video disappearing (SPA nav). */
  let autoHideTimer: ReturnType<typeof setInterval> | null = null;
  const AUTO_HIDE_PROBE_MS = 1500;

  function persistUiHidden() {
    try { localStorage.setItem(UI_HIDDEN_KEY, uiHidden ? '1' : '0'); } catch { /* ignore */ }
  }

  /**
   * Read the previous document's choice for this tab.
   *
   * `uiHidden` is written to `localStorage`, which every same-origin page
   * shares. Restoring it blindly carried "toolbar open" from a video page onto
   * a page with no player. The choice is restored only when the page that
   * wrote it had a real player, or when a capture is still running in the tab
   * (the toolbar is the only way to stop it).
   */
  function restoreUiHidden(): void {
    let stored: string | null = null;
    let scope: string | null = null;
    try {
      stored = localStorage.getItem(UI_HIDDEN_KEY);
      scope = localStorage.getItem(UI_SCOPE_KEY);
    } catch {
      return;
    }
    const running = session.state === 'running' || session.state === 'starting';
    if (!shouldRestoreUiHidden(stored, scope, running)) return;
    uiHidden = stored === '1';
  }

  /** Mark the persisted choice as belonging to this page's kind. */
  function persistUiScope(): void {
    try {
      localStorage.setItem(UI_SCOPE_KEY, hasPresentableVideo() ? 'video' : 'other');
    } catch { /* ignore */ }
  }

  /**
   * Reveal the toolbar and sync every dependent surface (idempotent).
   *
   * `reason` separates a capture start from an explicit reveal. A capture
   * reveal is temporary: the toolbar goes away again when the capture ends on
   * a page without a player (see `settleToolbarAfterCapture`).
   */
  function ensureToolbarVisible(reason: 'capture' | 'manual' = 'manual') {
    hasBeenShownOnce = true;
    // An explicit reveal (icon click, recording start) owns the toolbar now:
    // the auto-hide watcher must not take it away.
    autoShown = false;
    captureShown = reason === 'capture';
    stopAutoHideWatch();
    if (!uiHidden) return;
    uiHidden = false;
    persistUiHidden();
    persistUiScope();
    applyUiHidden();
    render();
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

  /* ===== Video-gated auto-show (ADR-041) ===== */
  // The toolbar belongs on pages that actually host a player. `loadedmetadata`
  // and `play` fire for SPA navigations (B 站 home → video) without observing
  // the whole DOM; the probe is throttled because pages like YouTube fire
  // `play` for every inline preview.
  function hasPresentableVideo(): boolean {
    try {
      const candidate = findBestVideoCandidate();
      if (!candidate) return false;
      return isPresentableVideo(
        { width: candidate.rect.w, height: candidate.rect.h },
        { width: window.innerWidth, height: window.innerHeight },
      );
    } catch {
      // Hostile pages can make layout queries throw; absence is not an error.
      return false;
    }
  }

  function maybeAutoShowForVideo(): void {
    if (!isLiveInstance()) return;
    if (!uiHidden || autoShowDismissed) return;
    const now = Date.now();
    if (now - lastVideoProbeAt < AUTO_SHOW_PROBE_GAP_MS) return;
    lastVideoProbeAt = now;
    if (!hasPresentableVideo()) return;
    captureShown = false;
    ensureToolbarVisible();
    autoShown = true;
    autoShowUrl = location.href;
    startAutoHideWatch();
  }

  /**
   * An auto-shown toolbar must leave with its video. Without this, an SPA
   * navigation (B 站 watch → home) keeps the same document and the toolbar
   * stayed on a page that no longer has a player. Manual opens never reach
   * here, so closing by hand is always respected.
   */
  function startAutoHideWatch(): void {
    if (autoHideTimer !== null) return;
    autoHideTimer = setInterval(() => {
      if (!isLiveInstance() || uiHidden || !autoShown) {
        stopAutoHideWatch();
        return;
      }
      // Recording is an explicit reason to stay visible.
      if (session.state !== 'idle') return;
      // Only navigation makes an auto-shown toolbar stale. A scroll (player
      // leaves the viewport, mini-player shrinks) must not hide it.
      if (location.href === autoShowUrl) return;
      autoShowUrl = location.href;
      if (hasPresentableVideo()) return;
      uiHidden = true;
      autoShown = false;
      // No reopen pill on a page that merely stopped having a player.
      hasBeenShownOnce = false;
      persistUiHidden();
      applyUiHidden();
      stopAutoHideWatch();
    }, AUTO_HIDE_PROBE_MS);
  }

  function stopAutoHideWatch(): void {
    if (autoHideTimer === null) return;
    clearInterval(autoHideTimer);
    autoHideTimer = null;
  }

  /**
   * A toolbar opened for a capture belongs to that capture only.
   *
   * When a recording ends, the page goes back to its default: a page with a
   * real player may keep the toolbar (auto-show owns it again), every other
   * page hides it. Without this, closing the capture on a site like B 站 left
   * the bar sitting on the home feed and on every later page of the origin.
   */
  function settleToolbarAfterCapture(): void {
    if (!captureShown) return;
    captureShown = false;
    const settle = settleAfterCapture(!uiHidden, hasPresentableVideo());
    if (settle === 'hidden') return;
    if (settle === 'keep') {
      autoShown = true;
      autoShowUrl = location.href;
      startAutoHideWatch();
      return;
    }
    uiHidden = true;
    autoShowDismissed = true;
    persistUiHidden();
    persistUiScope();
    applyUiHidden();
  }

  /* ===== Demo loop (data in ./content/demo) ===== */
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
  style.textContent = CONTENT_CSS;

  /* ===== Build DOM ===== */
  const html = CONTENT_HTML;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  shadow.append(style, wrapper);
  (document.body || document.documentElement).appendChild(host);

  /* ===== DOM refs ===== */
  const {
    bar, barGrip, recordBtn, recordLabelEl, moreBtn, toolsMenu,
    langBtn, langLabel, langPicker, sourceLangsEl, targetLangsEl,
    subBox, subHandle, subResize, subScroll, subRows, subPlaceholder, subStatus, subListening,
    copyBtn, exportTxtBtn, exportMdBtn,
    streamingRow, streamingText, streamingSource, streamingLabel,
    drawer, chatEl, chatComposer, chatEditor, chatPreview, mdPreviewBtn,
    citeBtn, citePopover, citeList, citeEmpty, citeClose,
    notesEditor, notesPreview, notesPreviewBtn,
    drawerTabChat, drawerTabNotes, paneChat, paneNotes,
    chatNewTopic, chatHistoryBtn, chatHistoryPopover, chatHistoryList, chatHistoryEmpty, chatHistoryClose,
    chatBtn, chatAttachBtn, chatFile, chatAttachments, sendBtn,
    fsWarn, hideBtn, showBtn,
    noteBtn, summaryBtn, imageBtn, screenshotBtn, screenBtn,
    notesCount, notesBadge, notesBtn, notesList, notesAdd, obsidianBtn,
    settingsModal, settingsClose,
    cfgBaseUrl, cfgApiKey, cfgToggleKey, cfgLlm, cfgAudio, cfgImage,
    cfgStatus, cfgTest, cfgSave, cfgCancel,
    cfgObProtocol, cfgObPort, cfgObKey, cfgObFolder, cfgObTest, cfgObStatus,
    shotModal, shotImg, shotClose, shotCloseX, shotDownload, shotSave, shotInsert,
    imageModal, imgClose, imgPrompt, imgSize, imgNeg, imgGenerate,
    imgStatus, imgResult, imgResultFrame, imgOpen, imgActions, imgFun,
    imgSave, imgInsert, imgDownload,
    toasts,
  } = collectRefs(shadow);

  /* ===== Language Picker ===== */
  const langPickerCtrl = createLangPicker({
    shadow,
    bar,
    langBtn,
    langLabel,
    langPicker,
    sourceLangsEl,
    targetLangsEl,
    getSession: () => session,
    setSourceLang: (code) => { session.sourceLang = code; },
    setTargetLang: (code) => { session.targetLang = code; },
    onSourceChanged: (code) => {
      bg('SET_LANG', { sourceLang: code }).then(() => syncSessionFromBackground()).catch(() => {});
    },
    onTargetChanged: (code) => {
      bg('SET_LANG', { targetLang: code }).then(() => syncSessionFromBackground()).catch(() => {});
    },
  });
  const buildLangPicker = langPickerCtrl.build;
  const updateLangLabel = langPickerCtrl.updateLabel;
  const closeLangPicker = langPickerCtrl.close;
  const positionLangPicker = langPickerCtrl.position;

  /* ===== Messaging ===== */
  async function bg(type: string, payload: Record<string, any> = {}) {
    try {
      const res = await chrome.runtime.sendMessage({ target: 'background', type, ...payload });
      return res && typeof res.ok !== 'undefined' ? res : { ok: true, ...res };
    } catch (err: any) {
      return { ok: false, error: err.message || '后台通信异常' };
    }
  }

  /* ===== Video clock (ADR-033) ===== */
  // The background maps each subtitle's segment-start wall clock to the page's
  // playback position. Sampling is driven by the adopted session state, so a
  // stop or a tab switch ends it without another listener.
  const videoClock = createVideoClock({
    send: (sample) => { void bg('VIDEO_CLOCK', sample) },
    isActive: () => {
      const state = session.state;
      if (session.isDemoMode) return false;
      return state === 'starting' || state === 'running' || state === 'stopping';
    },
  });

  // ADR-037 (F5): an explicit seek flushes the wall-clock ↔ playback mapping
  // immediately, so a line recorded right after the jump is not interpolated
  // across it. The hook fires from both seek entry points (overlay chip and
  // side-panel message).
  onAfterSeek(() => videoClock.sample(true))

  function adoptBackgroundSession(incoming: any) {
    session = {
      ...incoming,
      sourceLang: incoming.sourceLang || 'auto',
      targetLang: incoming.targetLang || 'zh',
      // Notes are local to the content surface and are not part of the
      // background session snapshot.
      notes: session.notes,
      activeNoteId: session.activeNoteId,
      isDemoMode: session.isDemoMode,
      agentSessionId: incoming.agentSessionId ?? null,
    };
    if (!Array.isArray(session.messages)) session.messages = [];
    render();
    videoClock.sync();
  }

  let sessionSyncSerial = 0;
  async function syncSessionFromBackground(): Promise<boolean> {
    const serial = ++sessionSyncSerial;
    const res: any = await bg('GET_SESSION');
    if (serial !== sessionSyncSerial || !res.ok || !res.session) return false;
    adoptBackgroundSession(res.session);
    return true;
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
  const settingsPanel = createSettingsPanel({
    refs: {
      settingsModal,
      settingsClose,
      cfgBaseUrl,
      cfgApiKey,
      cfgToggleKey,
      cfgLlm,
      cfgAudio,
      cfgImage,
      cfgStatus,
      cfgTest,
      cfgSave,
      cfgCancel,
      cfgObProtocol,
      cfgObPort,
      cfgObKey,
      cfgObFolder,
      cfgObTest,
      cfgObStatus,
      imageModal,
      shotModal,
    },
    bg,
    toast,
    closeImagePanel: () => closeImagePanel(),
    closeShotPreview: () => closeShotPreview(),
  });
  const openSettings = settingsPanel.openSettings;

  /* ===== Screen captions (ADR-043) ===== */
  const screenToggle = bindScreenCaptionToggle({
    button: screenBtn,
    getSession: () => session,
    bg,
    toast,
    adoptSession: (next) => adoptBackgroundSession(next),
    openSettings,
  });

  /* ===== Subtitle overlay ===== */
  const subtitleView = createSubtitleView({
    refs: {
      recordBtn,
      recordLabelEl,
      subBox,
      subHandle,
      subResize,
      subScroll,
      subRows,
      subPlaceholder,
      subStatus,
      subListening,
      streamingRow,
      streamingText,
      streamingSource,
      streamingLabel,
      chatEl,
    },
    getSession: () => session,
    isUiHidden: () => uiHidden,
    applyUiHidden,
    updateLangLabel,
    renderNotes: () => renderNotes(),
    openShotPreview: (url, saved, insertable) => openShotPreview(url, saved, insertable),
  });
  const renderBase = subtitleView.render;
  const render = () => {
    renderBase();
    screenToggle.sync();
    // A capture that ends leaves its toolbar behind on pages with no player;
    // every user-visible state change already goes through render().
    if (session.state !== 'running' && session.state !== 'starting') settleToolbarAfterCapture();
  };
  const updateChat = subtitleView.updateChat;
  const renderStreaming = subtitleView.renderStreaming;
  const clearStreaming = subtitleView.clearStreaming;
  const positionSubBox = subtitleView.positionSubBox;
  const markSubtitleActivity = subtitleView.markSubtitleActivity;
  const wakeSubtitleBox = subtitleView.wakeSubtitleBox;
  const applySubBoxSize = subtitleView.applySubBoxSize;

  /* ===== Draggable toolbar ===== */
  const toolbarDrag = createToolbarDrag({
    bar,
    grip: barGrip,
    isLangPickerOpen: langPickerCtrl.isOpen,
    positionLangPicker: langPickerCtrl.position,
  });
  const initBarPosition = toolbarDrag.initBarPosition;

  /* ===== Record button ===== */
  bindRecorder({
    button: recordBtn,
    getSession: () => session,
    bg,
    render,
    toast,
    openSettings,
    stopDemo: stopDemoSubtitles,
    syncSession: syncSessionFromBackground,
    adoptSession: adoptBackgroundSession,
    ensureToolbarVisible,
  });

  /* ===== Unified drawer: chat + notes tabs ===== */
  const drawerCtrl = createDrawer({
    refs: {
      drawer,
      close: shadow.getElementById('rtts-drawer-close')!,
      chatButton: chatBtn,
      notesButton: notesBtn,
      chatTab: drawerTabChat,
      notesTab: drawerTabNotes,
      chatPane: paneChat,
      notesPane: paneNotes,
      chatEditor,
      notesEditor,
    },
    setCiteOpen: (open) => setCiteOpen(open),
    renderNotes: () => renderNotes(),
  });
  const openDrawer = drawerCtrl.open;
  const closeDrawer = drawerCtrl.close;

  /* ===== Community: copy the QQ group number on click ===== */

  const QQ_GROUP_NUMBER = '545073970';
  const communityBtn = shadow.getElementById('rtts-community-btn') as HTMLButtonElement;
  const communityQr = shadow.getElementById('rtts-community-qr') as HTMLImageElement;
  try {
    communityQr.src = chrome.runtime.getURL('assets/qq-group-qrcode.jpg');
  } catch {
    // The image stays empty if the asset URL cannot be resolved; the group
    // number remains visible in the caption.
  }
  communityBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(QQ_GROUP_NUMBER);
      toast(`群号已复制：${QQ_GROUP_NUMBER}`, 'ok');
    } catch {
      toast(`复制失败，请手动加群：${QQ_GROUP_NUMBER}`, 'err');
    }
  });

  /* ===== Chat + notes composers ===== */

  const chatAttachmentsCtrl = createAttachments({
    container: chatAttachments,
    toast,
  });

  /** True while the composer shows rendered Markdown instead of the editor. */
  let isPreviewingFlag = false;

  const togglePreview = (() => {
    const toggle = createPreviewToggle(chatEditor, chatPreview, mdPreviewBtn, renderMarkdownLite);
    return () => {
      isPreviewingFlag = !isPreviewingFlag;
      toggle();
    };
  })();
  function chatPreviewing(): boolean {
    return isPreviewingFlag;
  }
  bindEditorInput(chatEditor, chatPreviewing);
  bindMarkdownToolbar(shadow.getElementById('rtts-chat-toolbar')!, chatEditor, chatPreviewing, () => {
    if (chatPreviewing()) togglePreview();
  });

  function getChatText(): string {
    return getEditorText(chatEditor);
  }

  function clearChatEditor() {
    chatEditor.innerHTML = '';
  }

  /* ===== Notes composer (Markdown) ===== */

  let isNotesPreviewing = false;
  const notesPreviewing = () => isNotesPreviewing;

  bindEditorInput(notesEditor, notesPreviewing);
  bindMarkdownToolbar(shadow.getElementById('rtts-notes-toolbar')!, notesEditor, notesPreviewing, () => {
    if (isNotesPreviewing) toggleNotesPreview();
  });

  const toggleNotesPreview = createPreviewToggle(notesEditor, notesPreview, notesPreviewBtn, renderMarkdownLite);

  // Enter inserts a newline (Markdown is multi-line). Cmd/Ctrl+Enter adds.
  notesEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addQuickNote();
    }
  });

  /* ===== Cite a note screenshot from the chat composer ===== */
  const citePicker = createCitePicker({
    refs: {
      button: citeBtn,
      popover: citePopover,
      list: citeList,
      empty: citeEmpty,
      close: citeClose,
      editor: chatEditor,
      shadow,
    },
    getNotes: () => session.notes,
    hasImage: (url) => chatAttachmentsCtrl.list().includes(url),
    addImage: (url) => chatAttachmentsCtrl.addUrl(url),
    toast,
  });
  function setCiteOpen(open: boolean) {
    citePicker.setOpen(open);
  }

  const addFiles = chatAttachmentsCtrl.addFiles;

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

  const ask = createAsk({
    refs: { editor: chatEditor, sendButton: sendBtn },
    getSession: () => session,
    adoptSession: adoptBackgroundSession,
    bg,
    toast,
    updateChat,
    beforeSend: () => {
      setCiteOpen(false);
      if (chatPreviewing()) togglePreview();
    },
    getText: getChatText,
    getImages: () => chatAttachmentsCtrl.list(),
    clearComposer: () => {
      clearChatEditor();
      chatAttachmentsCtrl.clear();
    },
    getVideoContext: readVideoContext,
  });
  const submitQuestion = ask.submitQuestion;
  const sendQuestion = ask.sendQuestion;

  /* ===== Companion sessions: new topic + per-video history ===== */
  const companionSessions = createCompanionSessions({
    refs: {
      newTopic: chatNewTopic,
      historyButton: chatHistoryBtn,
      popover: chatHistoryPopover,
      list: chatHistoryList,
      empty: chatHistoryEmpty,
      close: chatHistoryClose,
    },
    getSession: () => session,
    getVideoContext: readVideoContext,
    bg,
    toast,
    updateChat,
    clearComposer: () => {
      setCiteOpen(false);
      clearChatEditor();
      chatAttachmentsCtrl.clear();
    },
    focusComposer: () => {
      chatEditor.focus();
    },
    isBusy: ask.isBusy,
  });
  // The drawer's own close paths are internal; dismissing it must also dismiss
  // the history popover so reopening never shows a stale overlay.
  drawer.addEventListener('transitionend', () => {
    if (!drawer.classList.contains('open')) companionSessions.close();
  });

  /* ===== Tools menu ===== */
  const toolsMenuCtrl = createToolsMenu({ button: moreBtn, menu: toolsMenu, shadow });
  const setMenuOpen = toolsMenuCtrl.setOpen;

  /* ===== Settings ===== */
  shadow.getElementById('rtts-settings-btn')!.addEventListener('click', () => {
    openSettings();
  });

  /* ===== Close / reopen ===== */
  hideBtn.addEventListener('click', () => {
    // Closing is explicit and persists across subtitle updates/reloads: the
    // render loop must not resurrect the bar or the subtitle overlay.
    // ADR-041: it also silences video auto-show for the rest of this page.
    uiHidden = true;
    autoShowDismissed = true;
    autoShown = false;
    captureShown = false;
    stopAutoHideWatch();
    persistUiHidden();
    applyUiHidden();
    toast('工具已关闭', 'ok');
  });
  showBtn.addEventListener('click', () => {
    uiHidden = false;
    autoShowDismissed = false;
    autoShown = false;
    captureShown = false;
    stopAutoHideWatch();
    hasBeenShownOnce = true;
    persistUiHidden();
    persistUiScope();
    applyUiHidden();
    render();
  });

  /* ===== Fullscreen ===== */
  window.addEventListener('message', (e) => {
    if (!isLiveInstance()) return;
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
    if (!isLiveInstance()) return;
    if (!document.fullscreenElement) {
      fsWarn.classList.add('hidden');
      setTimeout(positionSubBox, 300);
    }
  });

  /* ===== Notes Management ===== */
  const notesCtrl = createNotes({
    refs: {
      count: notesCount,
      badge: notesBadge,
      button: notesBtn,
      list: notesList,
    },
    getSession: () => session,
    openShotPreview: (url, saved, insertable) => openShotPreview(url, saved, insertable),
  });
  const addNoteEntry = notesCtrl.addEntry;
  function renderNotes() {
    notesCtrl.render();
  }

  /* ===== In-page image generation ===== */
  const imageGen = createImageGen({
    refs: {
      modal: imageModal,
      close: imgClose,
      prompt: imgPrompt,
      size: imgSize,
      negative: imgNeg,
      status: imgStatus,
      result: imgResult,
      resultFrame: imgResultFrame,
      actions: imgActions,
      generate: imgGenerate,
      save: imgSave,
      insert: imgInsert,
      download: imgDownload,
      fun: imgFun,
      openOriginal: imgOpen,
    },
    getSession: () => session,
    bg,
    addNoteEntry,
    addImage: (url) => chatAttachmentsCtrl.addUrl(url),
    openDrawer,
    submitQuestion,
    toast,
  });
  function openImagePanel(prompt?: string) {
    imageGen.open(prompt);
  }
  function closeImagePanel() {
    imageGen.close();
  }

  /* ===== Video screenshot ===== */

  const { captureVideoFrame } = createScreenshotCapturer({
    host,
    capture: () => bg('CAPTURE_SCREENSHOT'),
  });

  /* ===== Screenshot preview ===== */
  const shotPreview = createShotPreview({
    refs: {
      modal: shotModal,
      image: shotImg,
      close: shotClose,
      closeX: shotCloseX,
      download: shotDownload,
      save: shotSave,
      insert: shotInsert,
    },
    addNoteEntry,
    addImage: (url) => chatAttachmentsCtrl.addUrl(url),
    openDrawer,
    toast,
  });
  function openShotPreview(dataUrl: string, saved: boolean, insertable = false) {
    shotPreview.open(dataUrl, saved, insertable);
  }
  function closeShotPreview() {
    shotPreview.close();
  }

  /* ===== Export ===== */
  bindActions({
    refs: {
      copy: copyBtn,
      exportTxt: exportTxtBtn,
      exportMd: exportMdBtn,
      note: noteBtn,
      summary: summaryBtn,
      image: imageBtn,
      screenshot: screenshotBtn,
    },
    getSession: () => session,
    getTranscript: async () => {
      const res = await bg('GET_TRANSCRIPT')
      return Array.isArray(res?.subtitles) ? res.subtitles : []
    },
    toast,
    flashChip,
    addNoteEntry,
    openImagePanel,
    captureVideoFrame,
    openShotPreview,
    summarize: () => {
      // ADR-037: the evidence lives in the background session; the page only
      // supplies the video identity for the prompt header.
      const video = readVideoContext()
      return bg('SUMMARIZE', {
        videoKey: video.videoKey,
        videoTitle: video.videoTitle,
        videoUrl: video.videoUrl,
      })
    },
    openNotes: () => openDrawer('notes'),
  });

  // Notes pane (lives inside the unified drawer)
  document.addEventListener('keydown', (e) => {
    if (!isLiveInstance()) return
    if (e.key !== 'Escape') return
    setMenuOpen(false)
    if (!citePopover.hidden) { setCiteOpen(false); return }
    if (companionSessions.isOpen()) { companionSessions.close(); return }
    if (drawerCtrl.isOpen()) closeDrawer()
  })

  // History belongs to the chat pane; hide it when the notes tab takes over.
  shadow.getElementById('rtts-tab-notes')!.addEventListener('click', () => {
    companionSessions.close()
  })

  // Add a Markdown note
  function addQuickNote() {
    // A hidden editor reports '' from innerText, so leave preview first.
    if (isNotesPreviewing) toggleNotesPreview()
    const text = getEditorText(notesEditor)
    if (!text) return
    addNoteEntry({
      id: `text_${Date.now()}`,
      type: 'text',
      at: Date.now(),
      text,
    })
    notesEditor.innerHTML = ''
    notesEditor.focus()
  }

  notesAdd.addEventListener('click', addQuickNote)

  // Obsidian export
  bindObsidianExport({
    button: obsidianBtn,
    getSession: () => session,
    bg,
    toast,
    flashChip,
    openSettings,
    focusObsidianKey: () => settingsPanel.focusObsidianKey(),
  });

  /* ===== Multi-tab: re-fetch session on visibility change ===== */
  document.addEventListener('visibilitychange', () => {
    if (!isLiveInstance()) return;
    if (document.visibilityState === 'visible') {
      syncSessionFromBackground().catch(() => {});
    }
  });

  /* ===== Background push ===== */
  chrome.runtime.onMessage.addListener((msg: any, _sender: any, sendResponse: any) => {
    if (!isLiveInstance()) return;
    if (msg && msg.type === 'TOGGLE_TOOLBAR') {
      hasBeenShownOnce = true;
      if (uiHidden) {
        uiHidden = false;
        autoShowDismissed = false;
        autoShown = false;
        // An explicit toggle is the user's own choice, not a capture reveal.
        captureShown = false;
        stopAutoHideWatch();
        persistUiHidden();
        persistUiScope();
        applyUiHidden();
        render();
        wakeSubtitleBox();
        if (session.state === 'idle' && session.subtitles.length === 0) {
          subPlaceholder.textContent = '点击「录音」开始实时转写';
        }
      } else {
        uiHidden = true;
        autoShowDismissed = true;
        autoShown = false;
        captureShown = false;
        stopAutoHideWatch();
        persistUiHidden();
        applyUiHidden();
      }
      // Acknowledge the toggle. sendToPageWithInjection treats a rejected
      // sendMessage as "content script missing" and re-injects + re-sends,
      // which would immediately hide the bar it just revealed.
      sendResponse?.({ ok: true });
      return;
    }

    if (msg && msg.type === 'OPEN_PAGE_SETTINGS') {
      openSettings();
      // Acknowledge so the side panel's injection retry does not mistake a
      // missing response for a missing content script (reload recovery).
      sendResponse?.({ ok: true });
      return;
    }

    if (msg && msg.type === 'SEEK_VIDEO') {
      // ADR-034/036: side-panel rows seek through the page, which owns the
      // video. `seek` is the verdict; the outer `ok` only means "handled".
      const result = seekTo(msg.seconds);
      sendResponse?.({ ok: true, seek: result });
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
      adoptBackgroundSession(msg.session);
    }
  });

  // Mark the page as served only after the message listener exists: a script
  // that threw during construction stays retryable, and `alive()` lets a
  // post-reload injection replace an orphaned instance (reload recovery).
  (window as any)[INSTALL_MARKER_KEY] = createContentInstallMarker();

  // The side panel owns the same notes array. Adopt external edits and
  // deletions so a later in-page note write cannot resurrect deleted notes.
  try {
    (chrome as any).storage?.onChanged?.addListener((changes: any, area: string) => {
      if (!isLiveInstance()) return;
      if (area !== 'local' || !changes?.[NOTES_STORAGE_KEY]) return;
      const next = changes[NOTES_STORAGE_KEY].newValue;
      if (!Array.isArray(next)) return;
      session.notes = next;
      if (session.activeNoteId && !next.some((note: NoteDocument) => note.id === session.activeNoteId)) {
        session.activeNoteId = next[0]?.id ?? null;
      }
      renderNotes();
    });
  } catch { /* ignore */ }

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

    session.isDemoMode = false;
    await syncSessionFromBackground();
    // Restore the previous page's choice only when it belongs to this kind of
    // page (or a capture in this tab is still running).
    restoreUiHidden();
    applyUiHidden();
    render();
    renderNotes();
    // ADR-041: a video page reveals the toolbar without an icon click; pages
    // without a presenter stay clean. Media events cover SPA navigations.
    for (const type of ['loadedmetadata', 'canplay', 'play'] as const) {
      document.addEventListener(type, () => {
        if (!isLiveInstance()) return;
        maybeAutoShowForVideo();
      }, true);
    }
    maybeAutoShowForVideo();
  })();

  try {
    console.log(`[snooper-browser] content script v${chrome.runtime.getManifest().version} loaded`);
  } catch {
    console.log('[snooper-browser] content script loaded (extension context unavailable)');
  }
})();
