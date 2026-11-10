(() => {
  // src/ext/content/styles/panels.ts
  var PANELS_CSS = `/* === Unified side drawer: chat + notes tabs === */
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
    /* Drawer actions: history and new-topic sit next to the close button. */
    #rtts-drawer-actions {
      display: flex; align-items: center; gap: 2px; margin-left: auto;
    }
    .rtts-drawer-newtopic {
      display: flex; align-items: center; gap: 4px;
      border: none; background: none; color: rgba(255,255,255,0.5);
      font-size: 11px; font-weight: 500;
      padding: 4px 8px; border-radius: 7px; cursor: pointer;
      transition: background 0.15s, color 0.15s;
      white-space: nowrap;
    }
    .rtts-drawer-newtopic svg {
      width: 12px; height: 12px;
      fill: none; stroke: currentColor;
      stroke-width: 2; stroke-linecap: round;
    }
    .rtts-drawer-newtopic:hover { background: rgba(124,92,255,0.22); color: #fff; }
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
    }
    #rtts-notes-list::-webkit-scrollbar { width: 4px; }
    #rtts-notes-list::-webkit-scrollbar-thumb { border: 0; border-radius: 2px; background: rgba(255,255,255,0.15); }
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
      min-height: 68px; max-height: 160px; overflow-y: auto;
      padding: 4px 2px;
      color: #fff; font-size: 13px; line-height: 1.5;
      white-space: pre-wrap; word-break: break-word;
      outline: none;
    }
    #rtts-chat-editor::-webkit-scrollbar,
    #rtts-notes-editor::-webkit-scrollbar { width: 4px; }
    #rtts-chat-editor::-webkit-scrollbar-thumb,
    #rtts-notes-editor::-webkit-scrollbar-thumb { border: 0; border-radius: 2px; background: rgba(255,255,255,0.16); }
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
      min-height: 68px; max-height: 160px; overflow-y: auto;
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
      gap: 8px;
    }
    #rtts-drawer-header h3 { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    #rtts-drawer-close { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 18px; padding: 4px; }
    #rtts-pane-chat { position: relative; }

    /* === History popover: per-video companion sessions === */
    .rtts-history-popover {
      position: absolute; left: 12px; right: 12px; top: 10px;
      max-height: min(320px, 56vh);
      display: flex; flex-direction: column;
      background: rgba(18,18,28,0.98);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      box-shadow: 0 18px 44px rgba(0,0,0,0.6);
      z-index: 2147483646;
      overflow: hidden;
    }
    .rtts-history-popover[hidden] { display: none; }
    .rtts-history-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px 8px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
      color: rgba(255,255,255,0.55);
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .rtts-history-head button {
      border: none; background: none; color: rgba(255,255,255,0.4);
      font-size: 12px; cursor: pointer; padding: 2px 4px;
    }
    .rtts-history-head button:hover { color: #fff; }
    .rtts-history-list {
      overflow-y: auto; padding: 6px;
    }
    .rtts-history-item {
      display: flex; align-items: stretch; gap: 4px;
      border-radius: 8px;
    }
    .rtts-history-item:hover { background: rgba(255,255,255,0.05); }
    .rtts-history-item.active { background: rgba(124,92,255,0.18); }
    .rtts-history-main {
      flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
      text-align: left; border: none; background: none; color: inherit;
      padding: 8px; border-radius: 8px; cursor: pointer;
    }
    .rtts-history-title {
      font-size: 12px; color: rgba(255,255,255,0.86);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .rtts-history-meta { font-size: 10px; color: rgba(255,255,255,0.42); }
    .rtts-history-del {
      flex-shrink: 0; width: 28px; border: none; background: none;
      color: rgba(255,255,255,0.3); cursor: pointer; font-size: 11px;
      border-radius: 8px;
    }
    .rtts-history-del:hover { background: rgba(239,68,68,0.16); color: #fca5a5; }
    .rtts-history-empty {
      padding: 22px 12px; text-align: center;
      font-size: 12px; color: rgba(255,255,255,0.35);
    }
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
    .rtts-msg-image-note {
      margin-top: 6px; font-size: 10px;
      color: rgba(255,255,255,0.35);
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
    /* Mask-free floating layer for panels that must not block the video.
       The layer itself is transparent; clicking anywhere outside the panel
       closes it. The panel keeps .rtts-modal styling. */
    .rtts-float-layer {
      position: fixed; inset: 0; z-index: 2147483646;
      display: none; align-items: flex-start; justify-content: flex-end;
      padding: 20px;
      background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none;
    }
    .rtts-float-layer.open { display: flex; }
    .rtts-float-layer .rtts-modal {
      width: min(420px, 92vw);
      max-height: min(86vh, 860px);
      box-shadow: 0 18px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08);
    }
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
    /* The generated image renders in an extension-origin iframe (CSP-safe
       on any host page). aspect-ratio keeps the panel stable while loading;
       the viewer letterboxes the image inside. */
    .rtts-image-frame { width: 100%; aspect-ratio: 1 / 1; max-height: 420px; }
    .rtts-image-frame-element {
      display: block; width: 100%; height: 100%;
      border: none; background: rgba(255,255,255,0.04);
    }
    .rtts-image-open {
      display: block; padding: 8px 10px; font-size: 11px; text-align: center;
      color: #b9a6ff; text-decoration: none; border-top: 1px solid rgba(255,255,255,0.08);
    }
    .rtts-image-open:hover { color: #d8ccff; background: rgba(124,92,255,0.08); }
    .rtts-image-open[hidden] { display: none; }
    .rtts-image-fun { display: none; gap: 8px; flex-wrap: wrap; }
    .rtts-image-fun.show { display: flex; }
    .rtts-image-fun button {
      height: 28px; padding: 0 11px; border-radius: 14px; cursor: pointer;
      border: 1px solid rgba(124,92,255,0.28); background: rgba(124,92,255,0.1);
      color: #c9baff; font-size: 11px; font-family: inherit;
    }
    .rtts-image-fun button:hover { background: rgba(124,92,255,0.2); color: #fff; }
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

  // src/ext/content/styles/toolbar.ts
  var TOOLBAR_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Segoe UI", Roboto, sans-serif; color: #f0f2f5; z-index: 2147483647; }

    /* Scrollbars live inside the closed shadow root, so the host page's CSS
       cannot theme them. Without these rules the UA paints the page's light
       scrollbar through the dark drawer. Keep WebKit pseudo-elements only:
       scrollbar-width/scrollbar-color take precedence on Chrome 121+ and
       would replace the 8px rail with the platform "thin" width. */
    *::-webkit-scrollbar { width: 8px; height: 8px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.14);
      border-radius: 999px;
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    *::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.24);
      background-clip: padding-box;
    }

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

    /* ===== Community (QQ group) ===== */
    .rtts-community { position: relative; display: flex; }
    .rtts-community-pop {
      position: absolute; top: calc(100% + 10px); right: 0; z-index: 3;
      width: 216px; padding: 10px;
      background: rgba(14,14,22,0.98); border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px; box-shadow: 0 14px 38px rgba(0,0,0,0.55);
      opacity: 0; pointer-events: none;
      transform: translateY(-4px);
      transition: opacity 0.15s ease, transform 0.15s ease;
    }
    #rtts-bar.tips-up .rtts-community-pop {
      top: auto; bottom: calc(100% + 10px);
      transform: translateY(4px);
    }
    .rtts-community:hover .rtts-community-pop,
    .rtts-community:focus-within .rtts-community-pop {
      opacity: 1; pointer-events: auto; transform: translateY(0);
    }
    /* While the QR popover is up, the button's own tooltip would overlap it. */
    #rtts-bar .rtts-community:hover .rtts-btn::after,
    #rtts-bar .rtts-community:focus-within .rtts-btn::after {
      opacity: 0;
    }
    .rtts-community-pop img {
      width: 100%; border-radius: 8px; display: block;
      background: #fff; outline: 1px solid rgba(0,0,0,0.1); outline-offset: -1px;
    }
    .rtts-community-pop figcaption {
      margin-top: 7px; text-align: center;
      font-size: 11px; line-height: 1.5; color: rgba(255,255,255,0.78);
    }
    .rtts-community-pop small { display: block; margin-top: 2px; font-size: 10px; color: rgba(255,255,255,0.45); }

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
    }
    #rtts-menu.open { opacity: 1; visibility: visible; transform: none; }
    #rtts-menu::-webkit-scrollbar { width: 4px; }
    #rtts-menu::-webkit-scrollbar-thumb { border: 0; border-radius: 2px; background: rgba(255,255,255,0.16); }

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
      padding: 4px 0;
      min-height: 0;
    }
    #rtts-sub-scroll::-webkit-scrollbar { width: 4px; }
    #rtts-sub-scroll::-webkit-scrollbar-thumb { border: 0; border-radius: 2px; background: rgba(255,255,255,0.15); }
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
    #rtts-sub-box.compact,
    #rtts-sub-box.auto-idle { height: 56px !important; min-height: 56px; padding-top: 16px; padding-bottom: 6px; }
    #rtts-sub-box.auto-idle { opacity: 0.55; }
    #rtts-sub-box.compact #rtts-sub-scroll,
    #rtts-sub-box.auto-idle #rtts-sub-scroll { overflow: hidden; }
    #rtts-sub-box.compact .sub-row.history:not(.current),
    #rtts-sub-box.auto-idle .sub-row.history:not(.current) { display: none; }
    #rtts-sub-box.compact .sub-row.current,
    #rtts-sub-box.compact #rtts-streaming-row,
    #rtts-sub-box.auto-idle .sub-row.current,
    #rtts-sub-box.auto-idle #rtts-streaming-row { white-space: nowrap; overflow: hidden; }
    /* text-overflow must live on the grid item, not the grid container. */
    #rtts-sub-box.compact .sub-row.current .sub-trans,
    #rtts-sub-box.auto-idle .sub-row.current .sub-trans { overflow: hidden; text-overflow: ellipsis; }
    #rtts-sub-box.compact .sub-source,
    #rtts-sub-box.compact .stream-label,
    #rtts-sub-box.auto-idle .sub-source,
    #rtts-sub-box.auto-idle .stream-label { display: none !important; }
    #rtts-sub-box.compact #rtts-sub-status,
    #rtts-sub-box.auto-idle #rtts-sub-status { margin-top: 1px; font-size: 9px; }

    .sub-row {
      transition: opacity 0.25s, font-size 0.25s;
    }
    /* ADR-038: the panel can be dragged arbitrarily wide; the reading column
       stays capped and centered instead of stretching into a three-column
       table. */
    #rtts-sub-rows { max-width: 760px; margin: 0 auto; }
    #rtts-streaming-row { max-width: 760px; margin: 0 auto; }

    .sub-row.history {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      column-gap: 8px;
      align-items: start;
      font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.8); line-height: 1.4;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      padding: 3px 8px;
      border-radius: 8px;
      transition: background 0.15s ease;
    }
    .sub-row.history:not(.has-time) { grid-template-columns: minmax(0, 1fr); }
    .sub-row.history:hover { background: rgba(255,255,255,0.04); }
    .sub-row.history .sub-trans {
      grid-column: 2;
      width: 100%; max-width: 66ch; min-width: 0;
      margin: 0 auto; text-align: center;
    }
    .sub-row.history:not(.has-time) .sub-trans { grid-column: 1; }
    .sub-row.history .sub-source {
      grid-column: 2;
      display: block; width: 100%; max-width: 66ch;
      margin: 2px auto 0; text-align: center;
      font-size: 11.5px; color: rgba(255,255,255,0.52);
      line-height: 1.35;
    }
    .sub-row.history:not(.has-time) .sub-source { grid-column: 1; }

    /* ADR-043: a screen line is read from the picture, so it is marked. */
    .sub-screen-badge {
      grid-column: 1;
      justify-self: start;
      align-self: start;
      font-size: 9px; line-height: 1.5;
      letter-spacing: 0.04em;
      padding: 0 4px;
      border-radius: 4px;
      color: #c3b6ff;
      background: rgba(124,92,255,0.22);
      user-select: none;
    }
    .sub-row.history:not(.has-time) .sub-screen-badge { grid-column: 1; grid-row: 1; margin-bottom: 1px; }

    .sub-row.current {
      font-size: 16px; font-weight: 500; color: rgba(255,255,255,0.97); line-height: 1.5;
      text-shadow: 0 1px 3px rgba(0,0,0,0.85);
      padding: 4px 8px;
    }
    .sub-row.current .sub-source {
      font-size: 13px; font-weight: 400; color: rgba(255,255,255,0.74); display: block;
      margin-top: 3px; line-height: 1.45;
    }

    /* === Seek time gutter (ADR-034, restyled by ADR-038) === */
    .sub-time-chip {
      grid-column: 1;
      justify-self: end;
      align-self: start;
      appearance: none;
      font: inherit; font-size: 10.5px; line-height: 1.6;
      font-variant-numeric: tabular-nums;
      color: rgba(255,255,255,0.38);
      background: none;
      border: 0;
      border-radius: 4px;
      padding: 0 2px;
      margin: 0;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      transition: color 0.15s ease;
    }
    .sub-row:hover .sub-time-chip { color: rgba(255,255,255,0.78); }
    .sub-row.current .sub-time-chip { color: rgba(255,255,255,0.6); }
    .sub-time-chip:focus-visible { color: #fff; outline: 1px solid rgba(124,92,255,0.7); outline-offset: 2px; }
    .sub-row.seek-ok .sub-time-chip { color: #9ff5ea; }
    .sub-row.seek-fail .sub-time-chip { color: #ffb3ad; }

    /* ADR-039: fillers stay in the record but stop competing with content. */
    .sub-row.filler .sub-trans { color: rgba(255,255,255,0.5); }
    .sub-row.filler .sub-source { color: rgba(255,255,255,0.34); }

    /* === ADR-036: [mm:ss] evidence stamps inside chat answers === */
    .chat-time-ref {
      font: inherit; font-size: 11px; line-height: 1.2;
      font-variant-numeric: tabular-nums;
      color: rgba(255,255,255,0.72);
      background: rgba(124,92,255,0.14);
      border: 1px solid rgba(124,92,255,0.35);
      border-radius: 6px;
      padding: 0 6px;
      margin: 0 1px;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      vertical-align: baseline;
      transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    }
    .chat-time-ref:hover { color: #fff; background: rgba(124,92,255,0.3); border-color: rgba(124,92,255,0.6); }
    .rtts-msg.seek-ok .chat-time-ref { color: #9ff5ea; background: rgba(62,230,213,0.16); border-color: rgba(62,230,213,0.4); }
    .rtts-msg.seek-fail .chat-time-ref { color: #ffb3ad; background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.4); }

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

    /* === ADR-040: listening affordance during audio accumulation === */
    #rtts-sub-listening {
      max-width: 760px; margin: 2px auto 0;
      font-size: 11px; letter-spacing: 0.02em;
      color: rgba(255,255,255,0.4);
      text-shadow: 0 1px 6px rgba(0,0,0,0.7);
      text-align: center;
      animation: listening-pulse 2.2s ease-in-out infinite;
    }
    #rtts-sub-listening.hidden { display: none; }
    #rtts-sub-listening .listening-dots { letter-spacing: 0.15em; }
    @keyframes listening-pulse {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 0.8; }
    }
    /* Compact/auto-idle collapse shows at most the current line. */
    #rtts-sub-box.compact #rtts-sub-listening,
    #rtts-sub-box.auto-idle #rtts-sub-listening { display: none; }

    `;

  // src/ext/content/styles/index.ts
  var CONTENT_CSS = TOOLBAR_CSS + PANELS_CSS;

  // src/ext/content/template.ts
  var CONTENT_HTML = `
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

      <!-- Community: hover shows the QQ group QR code for scanning -->
      <div class="rtts-community">
        <button id="rtts-community-btn" class="rtts-btn" data-tip="\u52A0\u5165\u4EA4\u6D41\u7FA4" aria-label="\u52A0\u5165 QQ \u4EA4\u6D41\u7FA4" aria-haspopup="true">
          <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </button>
        <figure class="rtts-community-pop" role="img" aria-label="QQ \u7FA4\u4E8C\u7EF4\u7801\uFF1Asnooper \u5B9E\u65F6\u7FFB\u8BD1\u4EA4\u6D41\u7FA4\uFF0C\u7FA4\u53F7 545073970">
          <img id="rtts-community-qr" alt="" />
          <figcaption>QQ \u7FA4\uFF1A545073970<small>\u9F20\u6807\u505C\u7559\u626B\u7801\uFF0C\u70B9\u51FB\u590D\u5236\u7FA4\u53F7</small></figcaption>
        </figure>
      </div>

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
        <button id="rtts-summary-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h14"/><path d="M17 12l2 2 3-3"/></svg></span>
          <span class="rtts-menu-text"><b>\u751F\u6210\u7EAA\u8981</b><small>\u628A\u5F53\u524D\u5B57\u5E55\u603B\u7ED3\u6210\u7B14\u8BB0</small></span>
        </button>
        <button id="rtts-screenshot-btn" class="rtts-menu-item" type="button" role="menuitem">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg></span>
          <span class="rtts-menu-text"><b>\u9875\u9762\u622A\u56FE</b><small>\u5F55\u5236\u4E2D\u4E5F\u80FD\u622A\u53D6\u89C6\u9891\u753B\u9762</small></span>
        </button>
        <button id="rtts-screen-btn" class="rtts-menu-item" type="button" role="menuitem" aria-pressed="false">
          <span class="rtts-menu-icon"><svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M6 12h5M13 12h5M8 21h8"/></svg></span>
          <span class="rtts-menu-text"><b>\u753B\u9762\u5B57\u5E55</b><small>\u8BFB\u53D6\u753B\u9762\u91CC\u7684\u786C\u5B57\u5E55\u5E76\u7FFB\u8BD1</small></span>
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
        <!-- ADR-040: shown while audio accumulates and the panel already has
             content; the empty-panel case is covered by subPlaceholder. -->
        <div id="rtts-sub-listening" class="hidden" aria-live="off">\u8046\u542C\u4E2D<span class="listening-dots">\u2026</span></div>
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
        <div id="rtts-drawer-actions">
          <button id="rtts-chat-history" class="rtts-drawer-newtopic" type="button" title="\u67E5\u770B\u8FD9\u4E2A\u89C6\u9891\u7684\u5386\u53F2\u4F1A\u8BDD" aria-label="\u67E5\u770B\u5386\u53F2\u4F1A\u8BDD" aria-haspopup="dialog" aria-expanded="false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            \u5386\u53F2
          </button>
          <button id="rtts-chat-new-topic" class="rtts-drawer-newtopic" type="button" title="\u5F00\u59CB\u65B0\u8BDD\u9898\uFF08\u65B0\u5EFA\u7A7A\u767D\u4F1A\u8BDD\uFF09" aria-label="\u5F00\u59CB\u65B0\u8BDD\u9898">
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            \u65B0\u8BDD\u9898
          </button>
          <button id="rtts-drawer-close" aria-label="\u5173\u95ED"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>

      <div id="rtts-pane-chat" class="rtts-pane active" role="tabpanel" aria-label="AI \u4F34\u5B66">
        <div id="rtts-chat"></div>

        <div id="rtts-history-popover" class="rtts-history-popover" hidden role="dialog" aria-label="\u5386\u53F2\u4F1A\u8BDD">
          <div class="rtts-history-head">
            <span>\u5386\u53F2\u4F1A\u8BDD</span>
            <button id="rtts-history-close" type="button" aria-label="\u5173\u95ED">\u2715</button>
          </div>
          <div id="rtts-history-list" class="rtts-history-list"></div>
          <div id="rtts-history-empty" class="rtts-history-empty" hidden>\u8FD9\u4E2A\u89C6\u9891\u8FD8\u6CA1\u6709\u5386\u53F2\u4F1A\u8BDD</div>
        </div>

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

    <!-- In-page image generation.
         No fullscreen mask: the user is watching a video, so the panel is a
         corner overlay (top-right) that must never darken or blur the page.
         Clicks outside the panel close it. -->
    <div id="rtts-image-modal" class="rtts-float-layer">
      <div class="rtts-modal rtts-image-panel" role="dialog" aria-label="\u751F\u6210\u914D\u56FE">
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
            <!-- Generated images render inside an extension-origin iframe
                 (image-viewer.html): the host page's CSP img-src can forbid
                 data: and third-party CDN images, which left the panel blank
                 even though generation succeeded. -->
            <div id="rtts-img-result-frame" class="rtts-image-frame"></div>
            <a id="rtts-img-open" class="rtts-image-open" target="_blank" rel="noopener noreferrer" hidden>\u5F53\u524D\u9875\u9762\u65E0\u6CD5\u52A0\u8F7D\uFF0C\u6253\u5F00\u539F\u56FE</a>
          </div>
          <div id="rtts-img-fun" class="rtts-image-fun" role="group" aria-label="\u56FE\u7247\u5A31\u4E50\u4E92\u52A8">
            <button type="button" data-fun="roast">\u5410\u69FD\u8FD9\u5F20\u56FE</button>
            <button type="button" data-fun="continue">\u7EED\u5199\u5267\u60C5</button>
            <button type="button" data-fun="line">\u914D\u4E00\u53E5\u53F0\u8BCD</button>
          </div>
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-img-generate" class="rtts-btn-primary" type="button">
            <svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>
            <span>\u751F\u6210\u56FE\u7247</span>
          </button>
          <div id="rtts-img-actions" class="rtts-image-actions">
            <button id="rtts-img-insert" class="rtts-btn-ghost" type="button">\u63D2\u5165\u4F34\u5B66</button>
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
            <h3>\u622A\u56FE\u9884\u89C8</h3>
            <p class="sub">\u4F18\u5148\u88C1\u5230\u89C6\u9891\u533A\u57DF\uFF1B\u627E\u4E0D\u5230\u89C6\u9891\u65F6\u4FDD\u7559\u6574\u9875\uFF0C\u53EF\u5B58\u5165\u7B14\u8BB0\u6216\u63D2\u5165\u4F34\u5B66</p>
          </div>
          <button id="rtts-shot-close-x" class="rtts-modal-close" type="button" aria-label="\u5173\u95ED"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="rtts-modal-body rtts-shot-body">
          <img id="rtts-shot-img" alt="\u89C6\u9891\u622A\u56FE\u9884\u89C8">
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-shot-download" class="rtts-btn-ghost" type="button">\u4E0B\u8F7D\u56FE\u7247</button>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button id="rtts-shot-insert" class="rtts-btn-ghost" type="button">\u63D2\u5165\u4F34\u5B66</button>
            <button id="rtts-shot-close" class="rtts-btn-ghost" type="button">\u5173\u95ED</button>
            <button id="rtts-shot-save" class="rtts-btn-primary" type="button">\u5B58\u5165\u7B14\u8BB0</button>
          </div>
        </div>
      </div>
    </div>

    <div id="rtts-toasts" aria-live="polite"></div>
  `;

  // src/ext/content/notes-store.ts
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

  // src/ext/content/markdown.ts
  function renderMarkdownLite(text) {
    const escaped = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const codeBlocks = [];
    let html = escaped.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
      const body = code.replace(/^\n+|\n+$/g, "");
      codeBlocks.push(`<pre><code>${body}</code></pre>`);
      return `\0CODEBLOCK${codeBlocks.length - 1}\0`;
    });
    const inlineCodes = [];
    html = html.replace(/`([^`\n]+)`/g, (_match, code) => {
      inlineCodes.push(`<code>${code}</code>`);
      return `\0INLINECODE${inlineCodes.length - 1}\0`;
    });
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\[([+]?)(\d{1,2}(:\d{1,2}){0,2})\]/g, (match, plus, stamp) => {
      if (plus) return match;
      const parts = stamp.split(":").map(Number);
      if (parts.some((n) => !Number.isFinite(n))) return match;
      const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
      return `<button type="button" class="chat-time-ref" data-t="${seconds}">${stamp}</button>`;
    }).replace(/\n/g, "<br>");
    inlineCodes.forEach((code, index) => {
      html = html.replace(`\0INLINECODE${index}\0`, code);
    });
    codeBlocks.forEach((block, index) => {
      html = html.replace(`\0CODEBLOCK${index}\0`, block);
    });
    return html;
  }

  // src/ext/content/attachments.ts
  var MAX_IMAGES = 4;
  function compressImage(file) {
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
  function createAttachments(ui) {
    let pendingImages = [];
    function render() {
      ui.container.textContent = "";
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
          render();
        });
        chip.appendChild(remove);
        ui.container.appendChild(chip);
      }
    }
    function addFiles(files) {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        if (pendingImages.length >= MAX_IMAGES) {
          ui.toast("\u6700\u591A 4 \u5F20\u56FE\u7247", "err");
          break;
        }
        compressImage(file).then((dataUrl) => {
          pendingImages.push(dataUrl);
          render();
        }).catch((err) => {
          ui.toast(err.message, "err");
        });
      }
    }
    function addUrl(url) {
      if (pendingImages.includes(url)) return "duplicate";
      if (pendingImages.length >= MAX_IMAGES) return "full";
      pendingImages.push(url);
      render();
      return "ok";
    }
    return {
      render,
      addFiles,
      addUrl,
      list: () => pendingImages.slice(),
      clear: () => {
        pendingImages = [];
        render();
      },
      count: () => pendingImages.length
    };
  }

  // src/ext/content/editor.ts
  function getEditorText(editor) {
    const raw = (editor.innerText || editor.textContent || "").replace(/\u00a0/g, " ");
    return raw.replace(/\n{3,}/g, "\n\n").trim();
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
  function bindMarkdownToolbar(toolbar, editor, isPreviewingFn, leavePreview) {
    toolbar.querySelectorAll("[data-md]").forEach((button) => {
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
  function createPreviewToggle(editor, preview, button, render) {
    let previewing = false;
    const toggle = () => {
      previewing = !previewing;
      button.classList.toggle("active", previewing);
      if (previewing) {
        const text = getEditorText(editor);
        preview.innerHTML = text ? render(text) : '<span class="rtts-md-empty">\u6CA1\u6709\u53EF\u9884\u89C8\u7684\u5185\u5BB9</span>';
        preview.hidden = false;
        editor.hidden = true;
        button.textContent = "\u7F16\u8F91";
      } else {
        preview.hidden = true;
        editor.hidden = false;
        button.textContent = "\u9884\u89C8";
        editor.focus();
      }
    };
    button.addEventListener("click", toggle);
    return () => previewing;
  }

  // src/lib/models.ts
  var SOURCE_LANGUAGES = [
    { code: "auto", label: "\u81EA\u52A8\u68C0\u6D4B", short: "AUTO" },
    { code: "zh", label: "\u7B80\u4F53\u4E2D\u6587", short: "ZH" },
    { code: "en", label: "English", short: "EN" }
  ];
  var TARGET_LANGUAGES = [
    { code: "zh", label: "\u7B80\u4F53\u4E2D\u6587", short: "ZH" },
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
  var LANGUAGES = [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES.filter(
    (target) => !SOURCE_LANGUAGES.some((source) => source.code === target.code)
  )];

  // src/ext/content/lang-picker.ts
  var LANG_MAP = Object.fromEntries(
    [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES].map((l) => [l.code, l.label])
  );
  var LANG_SHORT = Object.fromEntries(
    [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES].map((l) => [l.code, l.short])
  );
  function createLangPicker(deps) {
    let langPickerOpen = false;
    function build() {
      deps.sourceLangsEl.textContent = "";
      deps.targetLangsEl.textContent = "";
      SOURCE_LANGUAGES.forEach((l) => {
        const src = document.createElement("span");
        src.className = "lang-opt" + (l.code === deps.getSession().sourceLang ? " active" : "");
        src.textContent = l.label;
        src.dataset.code = l.code;
        src.addEventListener("click", () => {
          deps.setSourceLang(l.code);
          refresh();
          updateLabel();
          deps.onSourceChanged(l.code);
        });
        deps.sourceLangsEl.appendChild(src);
      });
      TARGET_LANGUAGES.forEach((l) => {
        const tgt = document.createElement("span");
        tgt.className = "lang-opt" + (l.code === deps.getSession().targetLang ? " active" : "");
        tgt.textContent = l.label;
        tgt.dataset.code = l.code;
        tgt.addEventListener("click", () => {
          deps.setTargetLang(l.code);
          refresh();
          updateLabel();
          close();
          deps.onTargetChanged(l.code);
        });
        deps.targetLangsEl.appendChild(tgt);
      });
    }
    function refresh() {
      deps.sourceLangsEl.querySelectorAll(".lang-opt").forEach((el) => {
        el.classList.toggle("active", el.dataset.code === deps.getSession().sourceLang);
      });
      deps.targetLangsEl.querySelectorAll(".lang-opt").forEach((el) => {
        el.classList.toggle("active", el.dataset.code === deps.getSession().targetLang);
      });
    }
    function updateLabel() {
      const session = deps.getSession();
      const src = LANG_MAP[session.sourceLang] || session.sourceLang;
      const tgt = LANG_MAP[session.targetLang] || session.targetLang;
      const srcShort = LANG_SHORT[session.sourceLang] || String(session.sourceLang).toUpperCase();
      const tgtShort = LANG_SHORT[session.targetLang] || String(session.targetLang).toUpperCase();
      deps.langLabel.textContent = `${srcShort}\u2192${tgtShort}`;
      deps.langBtn.setAttribute("data-tip", `\u8BED\u8A00\uFF1A${src} \u2192 ${tgt}`);
    }
    deps.langBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      langPickerOpen = !langPickerOpen;
      deps.langPicker.classList.toggle("open", langPickerOpen);
      if (langPickerOpen) position();
    });
    function close() {
      langPickerOpen = false;
      deps.langPicker.classList.remove("open");
    }
    function position() {
      if (!langPickerOpen) return;
      const br = deps.bar.getBoundingClientRect();
      const pr = deps.langPicker.getBoundingClientRect();
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
      deps.langPicker.style.transform = "none";
      deps.langPicker.style.left = `${Math.round(left)}px`;
      deps.langPicker.style.top = `${Math.round(top)}px`;
    }
    document.addEventListener("click", (e) => {
      if (!langPickerOpen) return;
      const path = e.composedPath();
      if (path.includes(deps.langPicker) || path.includes(deps.langBtn)) return;
      close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && langPickerOpen) close();
    });
    return { build, refresh, updateLabel, close, position, isOpen: () => langPickerOpen };
  }

  // src/ext/content/obsidian-config.ts
  var OBSIDIAN_CONFIG_KEY = "snooper.obsidian-config.v1";
  var DEFAULT_OBSIDIAN_CONFIG = {
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

  // src/ext/content/settings.ts
  function createSettingsPanel(deps) {
    const r = deps.refs;
    let cfgCache = null;
    function setCfgStatus(text, tone = "") {
      r.cfgStatus.textContent = text;
      r.cfgStatus.className = "rtts-status" + (text ? ` show ${tone}` : "");
    }
    function setObStatus(text, tone = "") {
      r.cfgObStatus.textContent = text;
      r.cfgObStatus.className = "rtts-status" + (text ? ` show ${tone}` : "");
    }
    function buildObsidianConfig() {
      const protocol = r.cfgObProtocol.value === "https" ? "https" : "http";
      const fallbackPort = protocol === "https" ? 27124 : 27123;
      return {
        enabled: true,
        apiProtocol: protocol,
        apiPort: Number(r.cfgObPort.value) || fallbackPort,
        apiKey: r.cfgObKey.value.trim(),
        noteFolder: r.cfgObFolder.value.trim() || "snooper-notes"
      };
    }
    async function testObsidian() {
      r.cfgObTest.disabled = true;
      setObStatus("\u6B63\u5728\u6D4B\u8BD5 Obsidian \u8FDE\u63A5\u2026", "info");
      const res = await deps.bg("TEST_OBSIDIAN", { obsidianConfig: buildObsidianConfig() });
      r.cfgObTest.disabled = false;
      if (res.ok) {
        r.cfgObProtocol.value = res.protocol;
        r.cfgObPort.value = String(res.port);
        await saveObsidianConfig(buildObsidianConfig());
        setObStatus(`\u8FDE\u63A5\u6210\u529F\uFF08${String(res.protocol).toUpperCase()} ${res.port}\uFF09\uFF0C\u5DF2\u81EA\u52A8\u4FDD\u5B58`, "ok");
      } else {
        setObStatus(res.error || "\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C", "err");
      }
    }
    async function openSettings() {
      r.cfgApiKey.type = "password";
      r.cfgToggleKey.classList.remove("revealed");
      const [res, ob] = await Promise.all([
        deps.bg("GET_CONFIG"),
        loadObsidianConfig()
      ]);
      r.cfgObProtocol.value = ob.apiProtocol;
      r.cfgObPort.value = String(ob.apiPort);
      r.cfgObKey.value = ob.apiKey;
      r.cfgObFolder.value = ob.noteFolder;
      setObStatus("");
      if (res.ok && res.config) {
        cfgCache = res.config;
        const first = cfgCache.providers?.[0] ?? {};
        r.cfgBaseUrl.value = first.baseUrl || "https://api.mosi.cn/v1";
        r.cfgApiKey.value = first.apiKey || "";
        r.cfgLlm.value = cfgCache.routes?.llm?.model || "moss-vl-1.0";
        r.cfgAudio.value = cfgCache.routes?.audio?.model || "moss-transcribe-1.0";
        r.cfgImage.value = cfgCache.routes?.image?.model || "moss-image-sft-1.0";
      } else {
        cfgCache = null;
        r.cfgBaseUrl.value = "https://api.mosi.cn/v1";
        r.cfgApiKey.value = "";
        r.cfgLlm.value = "moss-vl-1.0";
        r.cfgAudio.value = "moss-transcribe-1.0";
        r.cfgImage.value = "moss-image-sft-1.0";
        if (!res.ok) deps.toast("\u8BFB\u53D6\u914D\u7F6E\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF"), "err");
      }
      setCfgStatus("");
      r.settingsModal.classList.add("open");
    }
    function closeSettings() {
      r.settingsModal.classList.remove("open");
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
      provider.baseUrl = r.cfgBaseUrl.value.trim() || "https://api.mosi.cn/v1";
      provider.apiKey = r.cfgApiKey.value.trim();
      const keepProvider = (current) => current?.providerId && base.providers.some((item) => item.id === current.providerId) ? current.providerId : provider.id;
      base.routes.llm = {
        ...base.routes.llm || {},
        providerId: keepProvider(base.routes.llm),
        model: r.cfgLlm.value.trim() || "moss-vl-1.0"
      };
      base.routes.audio = {
        ...base.routes.audio || {},
        providerId: keepProvider(base.routes.audio),
        model: r.cfgAudio.value.trim() || "moss-transcribe-1.0"
      };
      base.routes.image = {
        ...base.routes.image || {},
        providerId: keepProvider(base.routes.image),
        model: r.cfgImage.value.trim() || "moss-image-sft-1.0"
      };
      if (!base.routes.video) {
        base.routes.video = { providerId: provider.id, model: "moss-vl-realtime-1.0" };
      }
      return base;
    }
    async function saveSettings() {
      const config = buildConfig();
      r.cfgSave.disabled = true;
      setCfgStatus("\u6B63\u5728\u4FDD\u5B58\u2026", "info");
      await saveObsidianConfig(buildObsidianConfig());
      const res = await deps.bg("SAVE_CONFIG", { config });
      r.cfgSave.disabled = false;
      if (res.ok) {
        cfgCache = config;
        setCfgStatus("\u5DF2\u4FDD\u5B58\u3002\u5BC6\u94A5\u53EA\u5B58\u50A8\u5728\u672C\u673A\u6D4F\u89C8\u5668\u3002", "ok");
        deps.toast("\u914D\u7F6E\u5DF2\u4FDD\u5B58", "ok");
        setTimeout(closeSettings, 600);
      } else {
        setCfgStatus("\u4FDD\u5B58\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF"), "err");
      }
    }
    async function testConnection() {
      r.cfgTest.disabled = true;
      setCfgStatus("\u6B63\u5728\u8FDE\u63A5 " + (r.cfgBaseUrl.value.trim() || "\u2026") + " \u2026", "info");
      const res = await deps.bg("TEST_CONNECTION", { config: buildConfig() });
      r.cfgTest.disabled = false;
      if (res.ok) {
        const sample = Array.isArray(res.models) && res.models.length ? "\uFF1A" + res.models.slice(0, 4).join("\u3001") : "";
        setCfgStatus(`\u8FDE\u63A5\u6210\u529F\uFF0C\u53D1\u73B0 ${res.count} \u4E2A\u6A21\u578B${sample}`, "ok");
      } else {
        setCfgStatus("\u8FDE\u63A5\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF"), "err");
      }
    }
    r.settingsClose.addEventListener("click", closeSettings);
    r.cfgCancel.addEventListener("click", closeSettings);
    r.settingsModal.addEventListener("click", (e) => {
      if (e.target === r.settingsModal) closeSettings();
    });
    r.cfgSave.addEventListener("click", saveSettings);
    r.cfgTest.addEventListener("click", testConnection);
    r.cfgObTest.addEventListener("click", testObsidian);
    r.cfgObProtocol.addEventListener("change", () => {
      const port = Number(r.cfgObPort.value);
      if (!port || port === 27123 || port === 27124) {
        r.cfgObPort.value = r.cfgObProtocol.value === "https" ? "27124" : "27123";
      }
    });
    r.cfgToggleKey.addEventListener("click", () => {
      const revealed = r.cfgApiKey.type === "password";
      r.cfgApiKey.type = revealed ? "text" : "password";
      r.cfgToggleKey.classList.toggle("revealed", revealed);
    });
    document.addEventListener("keydown", (e) => {
      const settingsOpen = r.settingsModal.classList.contains("open");
      const imageOpen = r.imageModal.classList.contains("open");
      const shotOpen = r.shotModal.classList.contains("open");
      if (!settingsOpen && !imageOpen && !shotOpen) return;
      if (e.key === "Escape") {
        if (imageOpen) deps.closeImagePanel();
        else if (shotOpen) deps.closeShotPreview();
        else closeSettings();
        return;
      }
      if (e.key === "Enter" && settingsOpen && e.target?.tagName === "INPUT") {
        e.preventDefault();
        saveSettings();
      }
    });
    return {
      openSettings,
      closeSettings,
      buildObsidianConfig,
      focusObsidianKey: () => r.cfgObKey.focus()
    };
  }

  // src/ext/chat-state.ts
  function isLatestAssistantReply(messages, answer) {
    const last = messages[messages.length - 1];
    return !!last && last.role === "assistant" && last.content === answer;
  }
  function hasAssistantTail(messages) {
    const last = messages[messages.length - 1];
    return !!last && last.role === "assistant";
  }
  function messagesFromTurns(turns) {
    return turns.map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content,
      ...turn.hasImages ? { hasImages: true } : {}
    }));
  }
  function chatRenderSignature(messages) {
    return JSON.stringify(messages.map((message) => [
      message.role,
      message.content,
      message.images?.length || 0,
      message.hasImages ? 1 : 0
    ]));
  }

  // src/lib/video-clock.ts
  function formatVideoTime(seconds) {
    const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const secs = total % 60;
    const mmss = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return hours > 0 ? `${hours}:${mmss}` : mmss;
  }

  // src/lib/asr-guard.ts
  function normalize(text) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  var FILLER_ONLY = new RegExp(
    "^(?:" + [
      "ah+",
      "oh+",
      "uh+",
      "um+",
      "hmm+",
      "mm+",
      "eh+",
      "hey",
      "hi",
      "hello",
      "well",
      "okay",
      "ok",
      "yeah",
      "yep",
      "yes",
      "no",
      "right",
      "alright",
      "wow",
      "ouch",
      "huh+",
      "aha+",
      "ha+",
      "bye",
      "thanks?",
      "sorry",
      "please",
      "\u55EF+",
      "\u554A+",
      "\u54E6+",
      "\u5662+",
      "\u5443+",
      "\u5509+",
      "\u54CE+",
      "\u5440+",
      "\u54C8+",
      "\u563F+",
      "\u5582+",
      "\u597D+",
      "\u5BF9+",
      "\u662F+",
      "\u884C+",
      "\u53EF\u4EE5",
      "\u597D\u5427",
      "\u8C22\u8C22",
      "\u62B1\u6B49",
      "\u4E0D\u597D\u610F\u601D"
    ].join("|") + ")[\\s.\u3002!\uFF01?\uFF1F\u2026,\uFF0C\u3001~\uFF5E]*$",
    "i"
  );
  function isFillerOnly(text) {
    const t = normalize(text);
    if (!t) return false;
    return FILLER_ONLY.test(t);
  }

  // src/lib/subtitle-order.ts
  function startOf(item) {
    return typeof item.at === "number" && Number.isFinite(item.at) && item.at > 0 ? item.at : 0;
  }
  function compareStart(a, b) {
    return startOf(a) - startOf(b);
  }
  function sortByStart(items) {
    return items.slice().sort(compareStart);
  }

  // src/ext/screenshot.ts
  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("\u622A\u56FE\u89E3\u7801\u5931\u8D25"));
      img.src = src;
    });
  }
  function collectVideos(root, out, depth) {
    if (depth > 3) return;
    root.querySelectorAll("video").forEach((video) => out.push(video));
    root.querySelectorAll("iframe").forEach((frame) => {
      try {
        const doc = frame.contentDocument;
        if (doc) collectVideos(doc, out, depth + 1);
      } catch {
      }
    });
    root.querySelectorAll("*").forEach((el) => {
      const shadowRoot = el.shadowRoot;
      if (shadowRoot) collectVideos(shadowRoot, out, depth + 1);
    });
  }
  function getFrameGeometry(win) {
    const frames = [];
    let current = win;
    for (let depth = 0; current && current !== window && depth < 5; depth++) {
      let frame = null;
      try {
        frame = current.frameElement;
      } catch {
        break;
      }
      if (!frame) break;
      frames.unshift(frame);
      current = frame.ownerDocument.defaultView;
    }
    let x = 0;
    let y = 0;
    let clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (const frame of frames) {
      const rect = frame.getBoundingClientRect();
      const left = x + rect.left;
      const top = y + rect.top;
      clip = {
        left: Math.max(clip.left, left),
        top: Math.max(clip.top, top),
        right: Math.min(clip.right, left + rect.width),
        bottom: Math.min(clip.bottom, top + rect.height)
      };
      x = left;
      y = top;
    }
    return { x, y, clip };
  }
  function getVideoContentRect(video) {
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return null;
    const win = video.ownerDocument.defaultView;
    if (!win) return null;
    const style = win.getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden") return null;
    if (Number(style.opacity) < 0.05) return null;
    const r = video.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const frame = getFrameGeometry(win);
    let x = r.left + frame.x;
    let y = r.top + frame.y;
    let w = r.width;
    let h = r.height;
    const fit = style.objectFit || "contain";
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
    const left = Math.max(frame.clip.left, x);
    const top = Math.max(frame.clip.top, y);
    const right = Math.min(frame.clip.right, x + w);
    const bottom = Math.min(frame.clip.bottom, y + h);
    if (right - left < 64 || bottom - top < 64) return null;
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  function findBestVideoCandidate() {
    const videos = [];
    collectVideos(document, videos, 0);
    let best = null;
    for (const video of videos) {
      const rect = getVideoContentRect(video);
      if (!rect) continue;
      const score = rect.w * rect.h * (video.paused ? 0.6 : 1);
      if (!best || score > best.score) best = { video, rect, score };
    }
    return best ? { video: best.video, rect: best.rect, count: videos.length } : null;
  }
  function createScreenshotCapturer(deps) {
    const maxWidth = deps.maxWidth ?? 1600;
    const quality = deps.jpegQuality ?? 0.9;
    const hideDelayMs = deps.hideDelayMs ?? 120;
    async function render(dataUrl, rect) {
      const img = await loadImageElement(dataUrl);
      const scaleX = img.naturalWidth / Math.max(1, window.innerWidth);
      const scaleY = img.naturalHeight / Math.max(1, window.innerHeight);
      let sx = 0;
      let sy = 0;
      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      if (rect) {
        sx = Math.min(img.naturalWidth - 1, Math.max(0, Math.round(rect.x * scaleX)));
        sy = Math.min(img.naturalHeight - 1, Math.max(0, Math.round(rect.y * scaleY)));
        sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round(rect.w * scaleX)));
        sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round(rect.h * scaleY)));
        if (sw < 32 || sh < 32) throw new Error("\u89C6\u9891\u88C1\u526A\u533A\u57DF\u8FC7\u5C0F");
      }
      let outW = sw;
      let outH = sh;
      if (outW > maxWidth) {
        outH = Math.round(outH * maxWidth / outW);
        outW = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u753B\u5E03");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      return canvas.toDataURL("image/jpeg", quality);
    }
    async function captureVideoFrame() {
      const candidate = findBestVideoCandidate();
      console.log("[RTTS] screenshot candidates", {
        count: candidate?.count ?? 0,
        chosen: candidate ? { width: candidate.video.videoWidth, height: candidate.video.videoHeight, area: Math.round(candidate.rect.w * candidate.rect.h) } : null
      });
      deps.host.style.display = "none";
      try {
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        await new Promise((resolve) => setTimeout(resolve, hideDelayMs));
        const res = await deps.capture();
        if (!res.ok || !res.dataUrl) throw new Error(res.error || "\u6D4F\u89C8\u5668\u622A\u56FE\u5931\u8D25");
        let dataUrl = res.dataUrl;
        let cropped = false;
        if (candidate) {
          try {
            dataUrl = await render(res.dataUrl, candidate.rect);
            cropped = true;
          } catch (err) {
            console.warn("[RTTS] screenshot crop failed, using the full frame:", err);
          }
        }
        if (!cropped) dataUrl = await render(res.dataUrl, null);
        console.log("[RTTS] screenshot", {
          path: res.path || "unknown",
          cropped,
          bytes: dataUrl.length
        });
        return { dataUrl, cropped };
      } finally {
        deps.host.style.display = "";
      }
    }
    return { captureVideoFrame, findBestVideoCandidate };
  }

  // src/ext/content/video-seek.ts
  var SEEK_LEAD_SECONDS = 0.25;
  var afterSeekHook = null;
  function onAfterSeek(hook) {
    afterSeekHook = hook;
  }
  function seekTo(seconds) {
    let video = null;
    try {
      video = findBestVideoCandidate()?.video ?? null;
    } catch {
      video = null;
    }
    if (!video) return { ok: false, reason: "no-video" };
    const target = Math.max(0, (Number.isFinite(seconds) ? seconds : 0) - SEEK_LEAD_SECONDS);
    const before = video.currentTime;
    try {
      video.currentTime = target;
    } catch {
      return { ok: false, reason: "no-progress" };
    }
    if (Math.abs(video.currentTime - before) < 1e-6 && Math.abs(target - before) > 1e-6) {
      return { ok: false, reason: "no-progress" };
    }
    video.pause();
    afterSeekHook?.();
    return { ok: true, time: video.currentTime };
  }

  // src/ext/content/subtitle-view.ts
  var SUB_BOX_SIZE_KEY = "snooper.subtitle-box-size.v1";
  var SUB_BOX_COMPACT_KEY = "snooper.subtitle-box-compact.v1";
  var SUB_BOX_IDLE_MS = 6500;
  function createSubtitleView(deps) {
    const r = deps.refs;
    let subBoxAutoPosition = true;
    let subBoxCompact = false;
    let subIdleTimer = null;
    let lastSubtitleSignal = "";
    let lastRowsSignature = "";
    let lastChatSignature = null;
    let streamingScrollRaf = 0;
    let dragState = null;
    let subResizeState = null;
    function render() {
      const session = deps.getSession();
      const s = session.state;
      r.recordBtn.className = "rtts-btn rtts-record-btn" + (s === "running" ? " running" : "");
      const recordLabel = session.isDemoMode ? s === "running" ? "\u505C\u6B62\u6F14\u793A" : "\u5F00\u59CB\u771F\u5B9E\u8F6C\u5199" : s === "running" ? "\u505C\u6B62\u8F6C\u5199" : s === "starting" ? "\u542F\u52A8\u4E2D" : "\u5F00\u59CB\u8F6C\u5199";
      r.recordBtn.setAttribute("data-tip", recordLabel);
      r.recordLabelEl.textContent = session.isDemoMode ? s === "running" ? "\u505C\u6B62\u6F14\u793A" : "\u6F14\u793A" : s === "running" ? "\u505C\u6B62" : s === "starting" ? "\u542F\u52A8\u4E2D" : "\u5B9E\u65F6\u5B57\u5E55";
      r.recordBtn.setAttribute("aria-label", recordLabel);
      deps.updateLangLabel();
      const subs = sortByStart(session.subtitles || []);
      const streaming = session.streamingSubtitle;
      const last = subs[subs.length - 1];
      const subtitleSignal = `${subs.length}:${last?.id || ""}:${streaming?.at || ""}`;
      if (subtitleSignal !== lastSubtitleSignal) {
        lastSubtitleSignal = subtitleSignal;
        if (last || streaming) markSubtitleActivity();
      }
      if (!deps.isUiHidden() && (s === "running" || subs.length > 0 || streaming)) {
        r.subBox.classList.remove("hidden");
        const hasContent = subs.length > 0 || !!streaming;
        const silent = s === "running" && !!session.audioSilent;
        r.subStatus.classList.toggle("hidden", !silent);
        r.subPlaceholder.style.display = hasContent || silent ? "none" : "";
        r.subPlaceholder.textContent = session.isDemoMode ? "\u6F14\u793A\u6A21\u5F0F\u542F\u52A8\u4E2D\u2026" : "\u6B63\u5728\u8046\u542C\u2026";
        const listening = s === "running" && !session.isDemoMode && !silent && hasContent && !streaming;
        r.subListening.classList.toggle("hidden", !listening);
        if (s !== "running" && s !== "starting") {
          markSubtitleActivity();
        }
        const rowsSignature = subs.map((sub) => `${sub.id ?? ""}${sub.at ?? ""}${sub.videoTime ?? ""}${sub.target ?? ""}${sub.source ?? ""}${sub.kind ?? ""}`).join("");
        const rowsChanged = rowsSignature !== lastRowsSignature;
        const wasAtBottom = r.subScroll.scrollHeight - r.subScroll.scrollTop - r.subScroll.clientHeight < 40;
        if (rowsChanged) {
          lastRowsSignature = rowsSignature;
          r.subRows.textContent = "";
          subs.forEach((sub) => {
            const row = document.createElement("div");
            row.className = "sub-row history";
            const anchored = typeof sub.videoTime === "number" && Number.isFinite(sub.videoTime) && sub.videoTime >= 0;
            if (anchored) {
              row.classList.add("has-time");
              const chip = document.createElement("button");
              chip.type = "button";
              chip.className = "sub-time-chip";
              chip.textContent = formatVideoTime(sub.videoTime);
              chip.setAttribute("aria-label", `\u8DF3\u8F6C\u5230 ${formatVideoTime(sub.videoTime)}`);
              chip.title = "\u70B9\u51FB\u8DF3\u8F6C\u5230\u89C6\u9891\u5BF9\u5E94\u4F4D\u7F6E";
              const activate = () => {
                const result = seekTo(sub.videoTime);
                row.classList.remove("seek-ok", "seek-fail");
                void row.offsetWidth;
                row.classList.add(result.ok ? "seek-ok" : "seek-fail");
              };
              chip.addEventListener("click", (event) => {
                event.stopPropagation();
                activate();
              });
              chip.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  activate();
                }
              });
              row.appendChild(chip);
            }
            if (sub.kind === "screen") {
              row.classList.add("screen");
              const badge = document.createElement("span");
              badge.className = "sub-screen-badge";
              badge.textContent = "\u753B\u9762";
              badge.title = "\u6765\u81EA\u753B\u9762\u786C\u5B57\u5E55\uFF0C\u4E0D\u662F\u8BED\u97F3\u8BC6\u522B";
              row.appendChild(badge);
            }
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
            if (isFillerOnly(sub.target || sub.source || "")) {
              row.classList.add("filler");
            }
            r.subRows.appendChild(row);
          });
          const lastRow = r.subRows.lastElementChild;
          if (lastRow) lastRow.classList.add("current");
        }
        if (streaming) {
          renderStreaming(streaming);
        } else {
          clearStreaming();
        }
        if (rowsChanged && (wasAtBottom || subs.length <= 3)) {
          r.subScroll.scrollTop = r.subScroll.scrollHeight;
        }
      } else {
        r.subPlaceholder.style.display = "";
        r.subPlaceholder.textContent = "\u70B9\u51FB\u300C\u5F55\u97F3\u300D\u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199";
        r.subRows.textContent = "";
        lastRowsSignature = "";
        clearStreaming();
        r.subListening.classList.add("hidden");
        r.subBox.classList.add("hidden");
        r.subBox.classList.remove("auto-idle");
      }
      deps.applyUiHidden();
      positionSubBox();
      updateChat();
      deps.renderNotes();
    }
    function updateChat() {
      const msgs = deps.getSession().messages || [];
      const signature = chatRenderSignature(msgs);
      if (signature === lastChatSignature) return;
      lastChatSignature = signature;
      r.chatEl.textContent = "";
      if (msgs.length === 0) {
        const w = document.createElement("div");
        w.className = "rtts-msg assistant";
        w.textContent = "\u4F60\u597D\uFF0C\u6211\u662F\u89C6\u9891\u4F34\u5B66\u52A9\u624B\uFF0C\u53EF\u4EE5\u95EE\u6211\u5173\u4E8E\u5F53\u524D\u89C6\u9891\u5185\u5BB9\u7684\u95EE\u9898\u3002";
        r.chatEl.appendChild(w);
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
              thumb.addEventListener("click", () => deps.openShotPreview(url, true));
              imgGrid.appendChild(thumb);
            }
            b.appendChild(imgGrid);
          } else if (m.hasImages) {
            const note = document.createElement("div");
            note.className = "rtts-msg-image-note";
            note.textContent = "\u542B\u56FE\u7247 \xB7 \u5386\u53F2\u8BB0\u5F55\u4E0D\u4FDD\u7559\u56FE\u7247";
            b.appendChild(note);
          }
          r.chatEl.appendChild(b);
        });
      }
      r.chatEl.scrollTop = r.chatEl.scrollHeight;
    }
    r.chatEl.addEventListener("click", (event) => {
      const target = event.target?.closest?.(".chat-time-ref");
      if (!target) return;
      const seconds = Number(target.dataset.t);
      if (!Number.isFinite(seconds)) return;
      const result = seekTo(seconds);
      const bubble = target.closest(".rtts-msg");
      if (bubble) {
        bubble.classList.remove("seek-ok", "seek-fail");
        void bubble.offsetWidth;
        bubble.classList.add(result.ok ? "seek-ok" : "seek-fail");
      }
    });
    function renderStreaming(sub) {
      if (!sub || !sub.partialTarget && !sub.source) {
        r.streamingRow.classList.add("hidden");
        return;
      }
      r.streamingRow.classList.remove("hidden");
      markSubtitleActivity();
      const displayText = sub.partialTarget || "\u22EF";
      r.streamingText.textContent = displayText;
      if (sub.source) {
        r.streamingSource.textContent = sub.source;
        r.streamingSource.style.display = "block";
      } else {
        r.streamingSource.style.display = "none";
      }
      r.streamingLabel.textContent = "\u7FFB\u8BD1\u4E2D";
      if (!streamingScrollRaf) {
        streamingScrollRaf = requestAnimationFrame(() => {
          streamingScrollRaf = 0;
          if (r.subScroll.scrollHeight - r.subScroll.scrollTop - r.subScroll.clientHeight < 120) {
            r.subScroll.scrollTop = r.subScroll.scrollHeight;
          }
        });
      }
    }
    function clearStreaming() {
      r.streamingRow.classList.add("hidden");
    }
    function markSubtitleActivity() {
      r.subBox.classList.remove("auto-idle");
      if (subIdleTimer) window.clearTimeout(subIdleTimer);
      subIdleTimer = window.setTimeout(() => {
        const session = deps.getSession();
        const hasContent = session.subtitles.length > 0 || !!session.streamingSubtitle;
        if (!subBoxCompact && hasContent && !r.subBox.matches(":hover") && !r.subBox.classList.contains("hidden")) {
          r.subBox.classList.add("auto-idle");
        }
      }, SUB_BOX_IDLE_MS);
    }
    function wakeSubtitleBox() {
      r.subBox.classList.remove("auto-idle");
      markSubtitleActivity();
    }
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
        r.subBox.classList.toggle("compact", subBoxCompact);
      } catch {
      }
    }
    function applySubBoxSize(width, height) {
      const rect = r.subBox.getBoundingClientRect();
      const maxWidth = Math.max(220, Math.min(window.innerWidth - 24, window.innerWidth - rect.left - 12));
      const maxHeight = Math.max(100, Math.min(window.innerHeight - 24, window.innerHeight - rect.top - 12));
      r.subBox.style.width = `${Math.max(220, Math.min(maxWidth, width))}px`;
      r.subBox.style.height = `${Math.max(72, Math.min(maxHeight, height))}px`;
      r.subBox.style.maxHeight = "none";
    }
    function positionSubBox() {
      if (r.subBox.classList.contains("hidden")) return;
      if (!subBoxAutoPosition) return;
      const maxWidth = Math.max(220, window.innerWidth - 32);
      const video = document.querySelector("video");
      if (video && video.readyState > 0) {
        const vr = video.getBoundingClientRect();
        const top = vr.top + vr.height * 0.75;
        const width = Math.min(vr.width * 0.72, 560, maxWidth);
        r.subBox.style.top = Math.max(top, 80) + "px";
        r.subBox.style.width = `${Math.max(220, Math.round(width))}px`;
        r.subBox.style.height = "auto";
        r.subBox.style.maxHeight = "24vh";
        r.subBox.style.bottom = "auto";
      } else {
        r.subBox.style.top = "";
        r.subBox.style.bottom = "26px";
        r.subBox.style.width = `${Math.min(Math.round(window.innerWidth * 0.72), 560, maxWidth)}px`;
        r.subBox.style.height = "auto";
        r.subBox.style.maxHeight = "24vh";
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
    r.subHandle.addEventListener("mousedown", (e) => {
      subBoxAutoPosition = false;
      const rect = r.subBox.getBoundingClientRect();
      startDrag(e, r.subBox, e.clientX - rect.left, e.clientY - rect.top);
    });
    r.subBox.addEventListener("dblclick", (event) => {
      if (event.target.closest("#rtts-sub-resize, #rtts-sub-handle")) return;
      subBoxCompact = !subBoxCompact;
      r.subBox.classList.remove("auto-idle");
      r.subBox.classList.toggle("compact", subBoxCompact);
      try {
        localStorage.setItem(SUB_BOX_COMPACT_KEY, String(subBoxCompact));
      } catch {
      }
      try {
        void chrome.storage?.local?.set({ [SUB_BOX_COMPACT_KEY]: subBoxCompact });
      } catch {
      }
    });
    r.subBox.addEventListener("pointerenter", wakeSubtitleBox);
    r.subBox.addEventListener("pointerleave", markSubtitleActivity);
    r.subBox.addEventListener("focusin", wakeSubtitleBox);
    r.subResize.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      subBoxAutoPosition = false;
      const rect = r.subBox.getBoundingClientRect();
      r.subBox.style.transform = "none";
      r.subBox.style.left = `${rect.left}px`;
      r.subBox.style.top = `${rect.top}px`;
      r.subBox.style.bottom = "auto";
      subResizeState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height };
      r.subResize.setPointerCapture(event.pointerId);
    });
    r.subResize.addEventListener("pointermove", (event) => {
      if (!subResizeState || subResizeState.pointerId !== event.pointerId) return;
      const width = subResizeState.width + event.clientX - subResizeState.startX;
      const height = subResizeState.height + event.clientY - subResizeState.startY;
      applySubBoxSize(width, height);
    });
    const endSubResize = (event) => {
      if (!subResizeState || subResizeState.pointerId !== event.pointerId) return;
      subResizeState = null;
      const rect = r.subBox.getBoundingClientRect();
      persistSubBoxSize(rect.width, rect.height);
    };
    r.subResize.addEventListener("pointerup", endSubResize);
    r.subResize.addEventListener("pointercancel", endSubResize);
    r.subResize.addEventListener("keydown", (event) => {
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
      const rect = r.subBox.getBoundingClientRect();
      subBoxAutoPosition = false;
      applySubBoxSize(rect.width + move[0], rect.height + move[1]);
      persistSubBoxSize(r.subBox.getBoundingClientRect().width, r.subBox.getBoundingClientRect().height);
    });
    void restoreSubBoxPreferences();
    window.addEventListener("resize", () => {
      if (subBoxAutoPosition) return;
      const rect = r.subBox.getBoundingClientRect();
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
      el.style.cursor = el === r.subBox ? "grab" : "";
      setTimeout(() => {
        el.style.transition = "";
      }, 50);
    });
    return {
      render,
      updateChat,
      renderStreaming,
      clearStreaming,
      positionSubBox,
      markSubtitleActivity,
      wakeSubtitleBox,
      persistSubBoxSize,
      applySubBoxSize,
      restoreSubBoxPreferences
    };
  }

  // src/ext/content/toolbar-drag.ts
  var BAR_POS_KEY = "snooper.toolbar-position.v1";
  function createToolbarDrag(deps) {
    const { bar, grip } = deps;
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
    function clamp(x, y) {
      const rect = bar.getBoundingClientRect();
      return {
        x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - rect.width - 8)),
        y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - rect.height - 8))
      };
    }
    function applyBarPosition(x, y, persist = false) {
      const pos = clamp(x, y);
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
          void chrome.storage?.local?.set({ [BAR_POS_KEY]: pos });
        } catch {
        }
      }
      if (deps.isLangPickerOpen()) deps.positionLangPicker();
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
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const rect = bar.getBoundingClientRect();
      barDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      bar.classList.add("dragging");
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener("pointermove", (e) => {
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
    grip.addEventListener("pointerup", endBarDrag);
    grip.addEventListener("pointercancel", endBarDrag);
    grip.addEventListener("keydown", (e) => {
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
    return { initBarPosition, applyBarPosition };
  }

  // src/ext/content/recorder.ts
  function bindRecorder(deps) {
    deps.button.addEventListener("click", async () => {
      const session = deps.getSession();
      const state = session.state;
      if (session.isDemoMode && state === "running") {
        deps.stopDemo();
        session.isDemoMode = false;
        session.state = "idle";
        deps.render();
        return;
      }
      if (state === "running" || state === "starting") {
        session.state = "stopping";
        deps.render();
        await deps.bg("STOP");
        await deps.syncSession();
        return;
      }
      if (session.isDemoMode) {
        deps.stopDemo();
        session.isDemoMode = false;
        session.subtitles = [];
      }
      deps.ensureToolbarVisible();
      session.state = "starting";
      deps.render();
      const res = await deps.bg("START", {
        sourceLang: session.sourceLang,
        targetLang: session.targetLang
      });
      if (!res.ok) {
        const message = res.error || "\u542F\u52A8\u5931\u8D25";
        const needsSetup = res.code === "CONFIG_REQUIRED" || message.includes("API Key") || message.includes("\u672A\u9009\u62E9\u6A21\u578B");
        deps.toast(message, needsSetup ? "info" : "err");
        if (needsSetup) deps.openSettings();
        await deps.syncSession();
        deps.ensureToolbarVisible();
        return;
      }
      if (res.session) deps.adoptSession(res.session);
      else await deps.syncSession();
      deps.ensureToolbarVisible();
    });
  }

  // src/ext/content/host-scrollbar.ts
  var STYLE_ID = "rtts-host-scrollbar";
  function setHostScrollbarTheme(active) {
    const existing = document.getElementById(STYLE_ID);
    if (!active) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    if (gutter <= 0) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    html::-webkit-scrollbar { background: rgba(10,10,16,0.9); }
    html::-webkit-scrollbar-track { background: rgba(10,10,16,0.9); }
    /* The thumb stays invisible so the strip reads as part of the drawer
       instead of a second scrollbar directly beside the drawer's own rail.
       Hovering the strip still reveals it, so dragging keeps working. */
    html::-webkit-scrollbar-thumb {
      background: transparent;
      border: 2px solid transparent;
      border-radius: 999px;
      background-clip: padding-box;
    }
    html::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.22);
      background-clip: padding-box;
    }
  `;
    (document.head ?? document.documentElement).appendChild(style);
  }

  // src/ext/content/drawer.ts
  function createDrawer(deps) {
    const r = deps.refs;
    let isOpen = false;
    let tab = "chat";
    setHostScrollbarTheme(false);
    function syncButtons() {
      r.chatButton.classList.toggle("active", isOpen && tab === "chat");
      r.notesButton.classList.toggle("active", isOpen && tab === "notes");
    }
    function setTab(next) {
      tab = next;
      r.chatTab.classList.toggle("active", next === "chat");
      r.notesTab.classList.toggle("active", next === "notes");
      r.chatTab.setAttribute("aria-selected", String(next === "chat"));
      r.notesTab.setAttribute("aria-selected", String(next === "notes"));
      r.chatPane.classList.toggle("active", next === "chat");
      r.notesPane.classList.toggle("active", next === "notes");
      if (next === "notes") {
        deps.setCiteOpen(false);
        deps.renderNotes();
      }
      syncButtons();
    }
    function open(next) {
      isOpen = true;
      r.drawer.classList.add("open");
      setHostScrollbarTheme(true);
      setTab(next);
      if (next === "notes") r.notesEditor.focus();
      else r.chatEditor.focus();
    }
    function close() {
      isOpen = false;
      r.drawer.classList.remove("open");
      setHostScrollbarTheme(false);
      deps.setCiteOpen(false);
      syncButtons();
    }
    r.chatButton.addEventListener("click", () => {
      if (isOpen && tab === "chat") close();
      else open("chat");
    });
    r.notesButton.addEventListener("click", () => {
      if (isOpen && tab === "notes") close();
      else open("notes");
    });
    r.chatTab.addEventListener("click", () => setTab("chat"));
    r.notesTab.addEventListener("click", () => setTab("notes"));
    r.close.addEventListener("click", close);
    return {
      isOpen: () => isOpen,
      activeTab: () => tab,
      open,
      close,
      setTab
    };
  }

  // src/ext/content/notes.ts
  function createNotes(deps) {
    const r = deps.refs;
    r.list.addEventListener("click", (event) => {
      const target = event.target?.closest?.(".chat-time-ref");
      if (!target) return;
      const seconds = Number(target.dataset.t);
      if (Number.isFinite(seconds)) seekTo(seconds);
    });
    function persistNotes() {
      saveNotes(deps.getSession().notes);
    }
    function getOrCreateActiveNote() {
      const session = deps.getSession();
      if (session.activeNoteId) {
        const existing = session.notes.find((note2) => note2.id === session.activeNoteId);
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
    function addEntry(entry) {
      const note = getOrCreateActiveNote();
      note.entries.push(entry);
      note.updatedAt = Date.now();
      persistNotes();
      render();
    }
    function render() {
      const session = deps.getSession();
      const active = session.activeNoteId ? session.notes.find((note) => note.id === session.activeNoteId) : null;
      const count = active?.entries.length ?? 0;
      r.count.textContent = String(count);
      r.button.setAttribute("data-tip", `\u7B14\u8BB0${count ? `\uFF08${count}\uFF09` : ""}`);
      r.badge.textContent = count > 99 ? "99+" : String(count);
      r.badge.hidden = count === 0;
      r.list.textContent = "";
      const hasEntries = !!(active && active.entries.length > 0);
      if (!hasEntries) {
        const empty = document.createElement("p");
        empty.id = "rtts-notes-empty";
        empty.textContent = "\u8FD8\u6CA1\u6709\u7B14\u8BB0\uFF0C\u70B9\u51FB\u53F3\u4FA7\u7684\u300C\u8BB0\u5165\u7B14\u8BB0\u300D\u5F00\u59CB\u8BB0\u5F55\u3002";
        r.list.appendChild(empty);
      }
      if (!hasEntries || !active) return;
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
          img.addEventListener("click", () => deps.openShotPreview(entry.imageUrl, true, true));
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
        if (entry.type === "text" || entry.type === "summary") {
          text.className = "note-text note-md";
          text.innerHTML = renderMarkdownLite(content);
        } else {
          text.className = "note-text truncated";
          text.textContent = content;
        }
        row.appendChild(text);
        const typeLabel = document.createElement("span");
        typeLabel.className = "note-type";
        const typeMap = {
          subtitle: "\u5B57\u5E55",
          image: "\u914D\u56FE",
          svg: "\u77E2\u91CF",
          screenshot: "\u622A\u56FE",
          text: "\u6587\u672C",
          summary: "\u6458\u8981"
        };
        typeLabel.textContent = typeMap[entry.type] || "\u7B14\u8BB0";
        row.appendChild(typeLabel);
        const delBtn = document.createElement("button");
        delBtn.className = "note-del";
        delBtn.setAttribute("aria-label", "\u5220\u9664\u7B14\u8BB0\u6761\u76EE");
        delBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        delBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          active.entries = active.entries.filter((candidate) => candidate.id !== entry.id);
          persistNotes();
          render();
        });
        row.appendChild(delBtn);
        item.appendChild(row);
        r.list.appendChild(item);
      });
      r.list.scrollTop = r.list.scrollHeight;
    }
    return { addEntry, render, persistNotes };
  }

  // src/ext/content/shot.ts
  function createShotPreview(deps) {
    const r = deps.refs;
    let previewUrl = "";
    function open(dataUrl, saved, insertable = false) {
      previewUrl = dataUrl;
      r.image.src = dataUrl;
      r.save.disabled = saved;
      r.save.textContent = saved ? "\u5DF2\u5B58\u5165\u7B14\u8BB0" : "\u5B58\u5165\u7B14\u8BB0";
      r.insert.style.display = insertable ? "" : "none";
      r.modal.classList.add("open");
    }
    function close() {
      r.modal.classList.remove("open");
      r.image.removeAttribute("src");
    }
    function download() {
      if (!previewUrl) return;
      const anchor = document.createElement("a");
      anchor.href = previewUrl;
      anchor.download = `snooper-video-${Date.now()}.jpg`;
      anchor.click();
    }
    r.close.addEventListener("click", close);
    r.closeX.addEventListener("click", close);
    r.download.addEventListener("click", download);
    r.modal.addEventListener("click", (event) => {
      if (event.target === r.modal) close();
    });
    r.save.addEventListener("click", () => {
      if (!previewUrl) return;
      deps.addNoteEntry({
        id: `screenshot_${Date.now()}`,
        type: "screenshot",
        at: Date.now(),
        imageUrl: previewUrl,
        text: "\u89C6\u9891\u622A\u56FE"
      });
      r.save.disabled = true;
      r.save.textContent = "\u5DF2\u5B58\u5165\u7B14\u8BB0";
      deps.toast("\u622A\u56FE\u5DF2\u5B58\u5165\u7B14\u8BB0", "ok");
    });
    r.insert.addEventListener("click", () => {
      if (!previewUrl) return;
      const outcome = deps.addImage(previewUrl);
      if (outcome === "duplicate") {
        deps.toast("\u8FD9\u5F20\u622A\u56FE\u5DF2\u7ECF\u5F15\u7528\u4E86", "ok");
      } else if (outcome === "full") {
        deps.toast("\u6700\u591A 4 \u5F20\u56FE\u7247", "err");
        return;
      }
      close();
      deps.openDrawer("chat");
      deps.toast("\u5DF2\u63D2\u5165\u4F34\u5B66\u5BF9\u8BDD", "ok");
    });
    return { open, close };
  }

  // src/ext/content/cite-picker.ts
  function createCitePicker(deps) {
    const r = deps.refs;
    function candidates() {
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      const notes = [...deps.getNotes()].sort((a, b) => b.updatedAt - a.updatedAt);
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
    function renderList() {
      const items = candidates();
      r.list.textContent = "";
      r.empty.hidden = items.length > 0;
      for (const candidate of items) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "rtts-cite-item";
        if (deps.hasImage(candidate.url)) item.classList.add("used");
        item.setAttribute("aria-label", `\u5F15\u7528${candidate.label}`);
        const img = document.createElement("img");
        img.src = candidate.url;
        img.alt = candidate.label;
        item.appendChild(img);
        const caption = document.createElement("span");
        caption.textContent = candidate.label;
        item.appendChild(caption);
        item.addEventListener("click", () => {
          const outcome = deps.addImage(candidate.url);
          if (outcome === "duplicate") {
            deps.toast("\u8FD9\u5F20\u622A\u56FE\u5DF2\u7ECF\u5F15\u7528\u4E86", "ok");
            return;
          }
          if (outcome === "full") {
            deps.toast("\u6700\u591A\u5F15\u7528 4 \u5F20\u56FE\u7247", "err");
            return;
          }
          position();
          item.classList.add("used");
          deps.toast("\u5DF2\u5F15\u7528\u622A\u56FE\uFF0C\u53EF\u4EE5\u7EE7\u7EED\u63D0\u95EE", "ok");
        });
        r.list.appendChild(item);
      }
    }
    function position() {
      const composer = r.popover.parentElement;
      const shell = composer?.querySelector(".rtts-md-shell");
      if (!composer || !shell) return;
      const shellTop = shell.getBoundingClientRect().top;
      const gap = 6;
      const top = Math.max(8, shellTop - gap);
      r.popover.style.bottom = `${Math.max(8, composer.getBoundingClientRect().bottom - top)}px`;
      r.popover.style.maxHeight = `${Math.max(140, top - 12)}px`;
    }
    function setOpen(open) {
      if (open) renderList();
      if (!open && r.popover.contains(r.shadow.activeElement)) r.button.focus();
      r.popover.hidden = !open;
      r.button.setAttribute("aria-expanded", String(open));
      r.button.classList.toggle("active", open);
      if (open) {
        position();
        const first = r.list.querySelector(".rtts-cite-item");
        first?.focus();
      }
    }
    window.addEventListener("resize", () => {
      if (!r.popover.hidden) position();
    });
    r.editor.addEventListener("input", () => {
      if (!r.popover.hidden) position();
    });
    r.button.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(r.popover.hidden !== false);
    });
    r.close.addEventListener("click", () => {
      setOpen(false);
      r.editor.focus();
    });
    document.addEventListener("click", (event) => {
      if (r.popover.hidden) return;
      if (event.composedPath().includes(r.popover) || event.composedPath().includes(r.button)) return;
      setOpen(false);
    });
    return { setOpen, position };
  }

  // src/ext/content/ask.ts
  function createAsk(deps) {
    let busy = false;
    async function submitQuestion(question, images) {
      if (busy) {
        deps.toast("\u6B63\u5728\u56DE\u7B54\u4E0A\u4E00\u9898\uFF0C\u8BF7\u7A0D\u5019", "info");
        return;
      }
      busy = true;
      deps.refs.editor.setAttribute("contenteditable", "false");
      deps.refs.sendButton.disabled = true;
      deps.refs.sendButton.textContent = "...";
      const session = deps.getSession();
      if (!session.messages) session.messages = [];
      session.messages.push({
        role: "user",
        content: question || "\uFF08\u56FE\u7247\uFF09",
        images: images.length > 0 ? images : void 0
      });
      deps.updateChat();
      const requestId = "q_" + Date.now();
      const video = deps.getVideoContext();
      const res = await deps.bg("ASK", {
        question,
        images,
        requestId,
        videoKey: video.videoKey,
        videoTitle: video.videoTitle,
        videoUrl: video.videoUrl,
        videoTime: video.videoTime
      });
      const current = deps.getSession();
      if (res.ok && res.answer) {
        if (!isLatestAssistantReply(current.messages || [], res.answer)) {
          if (res.session) {
            deps.adoptSession(res.session);
            const adopted = deps.getSession();
            if (!hasAssistantTail(adopted.messages || [])) {
              if (!Array.isArray(adopted.messages)) adopted.messages = [];
              adopted.messages.push({ role: "assistant", content: res.answer });
            }
          } else {
            if (!Array.isArray(current.messages)) current.messages = [];
            current.messages.push({ role: "assistant", content: res.answer });
          }
        }
      } else {
        if (!Array.isArray(current.messages)) current.messages = [];
        current.messages.push({
          role: "assistant",
          content: "\u8BF7\u6C42\u5931\u8D25\uFF1A" + (res.error || "\u672A\u77E5\u9519\u8BEF")
        });
      }
      if (res.persistWarning) {
        deps.toast("\u56DE\u7B54\u5DF2\u751F\u6210\uFF0C\u4F46\u5BF9\u8BDD\u5386\u53F2\u5199\u5165\u5931\u8D25\uFF1A" + res.persistWarning, "err");
      }
      busy = false;
      deps.refs.editor.setAttribute("contenteditable", "plaintext-only");
      deps.refs.sendButton.disabled = false;
      deps.refs.sendButton.textContent = "\u53D1\u9001";
      deps.updateChat();
      deps.refs.editor.focus();
    }
    async function sendQuestion() {
      if (busy) return;
      deps.beforeSend();
      const text = deps.getText();
      const images = deps.getImages();
      if (!text && images.length === 0) return;
      deps.clearComposer();
      await submitQuestion(text, images);
    }
    deps.refs.sendButton.addEventListener("click", sendQuestion);
    deps.refs.editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void sendQuestion();
      }
    });
    return { submitQuestion, sendQuestion, isBusy: () => busy };
  }

  // src/ext/content/history.ts
  function relativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    if (!Number.isFinite(diff) || diff < 6e4) return "\u521A\u521A";
    if (diff < 36e5) return `${Math.floor(diff / 6e4)} \u5206\u949F\u524D`;
    if (diff < 864e5) return `${Math.floor(diff / 36e5)} \u5C0F\u65F6\u524D`;
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  function createCompanionSessions(deps) {
    const r = deps.refs;
    let isOpen = false;
    function setOpen(next) {
      isOpen = next;
      r.popover.hidden = !next;
      r.historyButton.setAttribute("aria-expanded", String(next));
      if (next) void refresh();
    }
    function close() {
      setOpen(false);
    }
    function renderList(sessions, currentId) {
      r.list.textContent = "";
      const visible = sessions.filter((session) => session.turnCount > 0);
      r.empty.hidden = visible.length > 0;
      for (const session of visible) {
        const row = document.createElement("div");
        row.className = "rtts-history-item" + (session.id === currentId ? " active" : "");
        const main = document.createElement("button");
        main.type = "button";
        main.className = "rtts-history-main";
        main.dataset.id = session.id;
        main.title = session.title || "\u672A\u547D\u540D\u5BF9\u8BDD";
        const title = document.createElement("span");
        title.className = "rtts-history-title";
        title.textContent = session.title || "\u672A\u547D\u540D\u5BF9\u8BDD";
        main.appendChild(title);
        const meta = document.createElement("span");
        meta.className = "rtts-history-meta";
        const rounds = Math.max(1, Math.ceil(session.turnCount / 2));
        meta.textContent = `${rounds} \u8F6E \xB7 ${relativeTime(session.updatedAt)}`;
        main.appendChild(meta);
        const remove2 = document.createElement("button");
        remove2.type = "button";
        remove2.className = "rtts-history-del";
        remove2.dataset.del = session.id;
        remove2.title = "\u5220\u9664\u8FD9\u4E2A\u4F1A\u8BDD";
        remove2.setAttribute("aria-label", `\u5220\u9664\u4F1A\u8BDD ${session.title || "\u672A\u547D\u540D\u5BF9\u8BDD"}`);
        remove2.textContent = "\u2715";
        row.append(main, remove2);
        r.list.appendChild(row);
      }
    }
    async function refresh() {
      const video = deps.getVideoContext();
      const res = await deps.bg("AGENT_LIST_SESSIONS", { videoKey: video.videoKey });
      if (!res.ok) {
        deps.toast(res.error || "\u8BFB\u53D6\u5386\u53F2\u5931\u8D25", "err");
        return;
      }
      const currentId = res.currentId ?? deps.getSession().agentSessionId ?? null;
      renderList(Array.isArray(res.sessions) ? res.sessions : [], currentId);
    }
    function applySession(currentId, turns) {
      const session = deps.getSession();
      session.agentSessionId = currentId;
      session.messages = messagesFromTurns(Array.isArray(turns) ? turns : []);
      deps.updateChat();
    }
    async function startNewTopic() {
      if (deps.isBusy()) {
        deps.toast("\u6B63\u5728\u56DE\u7B54\u4E0A\u4E00\u9898\uFF0C\u8BF7\u7A0D\u5019", "info");
        return;
      }
      const res = await deps.bg("AGENT_NEW_SESSION", { ...deps.getVideoContext() });
      if (!res.ok) {
        deps.toast(res.error || "\u65B0\u5EFA\u4F1A\u8BDD\u5931\u8D25", "err");
        return;
      }
      applySession(res.currentId ?? null, []);
      deps.clearComposer();
      deps.focusComposer();
      setOpen(false);
      deps.toast("\u5DF2\u5F00\u59CB\u65B0\u8BDD\u9898", "ok");
    }
    async function switchTo(id) {
      if (deps.isBusy()) {
        deps.toast("\u6B63\u5728\u56DE\u7B54\u4E0A\u4E00\u9898\uFF0C\u8BF7\u7A0D\u5019", "info");
        return;
      }
      const video = deps.getVideoContext();
      const res = await deps.bg("AGENT_SWITCH_SESSION", { id, videoKey: video.videoKey });
      if (!res.ok) {
        deps.toast(res.error || "\u5207\u6362\u4F1A\u8BDD\u5931\u8D25", "err");
        return;
      }
      applySession(res.currentId ?? null, res.turns);
      setOpen(false);
      deps.focusComposer();
    }
    async function remove(id) {
      if (deps.isBusy()) {
        deps.toast("\u6B63\u5728\u56DE\u7B54\u4E0A\u4E00\u9898\uFF0C\u8BF7\u7A0D\u5019", "info");
        return;
      }
      const video = deps.getVideoContext();
      const res = await deps.bg("AGENT_DELETE_SESSION", { id, videoKey: video.videoKey });
      if (!res.ok) {
        deps.toast(res.error || "\u5220\u9664\u4F1A\u8BDD\u5931\u8D25", "err");
        return;
      }
      applySession(res.currentId ?? null, res.turns);
      await refresh();
    }
    r.historyButton.addEventListener("click", () => {
      setOpen(!isOpen);
    });
    r.close.addEventListener("click", () => setOpen(false));
    r.newTopic.addEventListener("click", () => {
      void startNewTopic();
    });
    r.list.addEventListener("click", (event) => {
      const target = event.target;
      const removeButton = target.closest(".rtts-history-del");
      if (removeButton?.dataset.del) {
        event.stopPropagation();
        void remove(removeButton.dataset.del);
        return;
      }
      const main = target.closest(".rtts-history-main");
      if (main?.dataset.id) void switchTo(main.dataset.id);
    });
    return {
      isOpen: () => isOpen,
      open: () => setOpen(true),
      close,
      refresh,
      startNewTopic
    };
  }

  // src/lib/video-key.ts
  var TRACKING_PARAMS = /* @__PURE__ */ new Set([
    "t",
    "si",
    "feature",
    "index",
    "list",
    "start_radio",
    "spm_id_from",
    "vd_source",
    "share_source",
    "share_medium",
    "share_plat",
    "share_session_id",
    "share_tag",
    "timestamp",
    "unique_k",
    "from",
    "ref",
    "ref_src",
    "fbclid",
    "gclid"
  ]);
  function stripWww(host) {
    return host.replace(/^www\./, "");
  }
  function youtubeId(url) {
    const host = stripWww(url.hostname);
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
    const direct = url.searchParams.get("v");
    if (direct) return direct;
    const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
    return match?.[1] ?? null;
  }
  function bilibiliKey(url) {
    const host = stripWww(url.hostname);
    if (host !== "bilibili.com" && !host.endsWith(".bilibili.com")) return null;
    const bv = url.pathname.match(/\/(BV[0-9A-Za-z]+)/);
    if (bv?.[1]) return `bilibili:${bv[1]}`;
    const av = url.pathname.match(/\/av(\d+)/i);
    if (av?.[1]) return `bilibili:av${av[1]}`;
    const parts = url.pathname.split("/").filter(Boolean).slice(0, 3);
    if (parts.length > 0) return `bilibili:${parts.join("/")}`;
    return null;
  }
  function videoKeyForUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return `page:${(rawUrl || "unknown").slice(0, 160)}`;
    }
    const yt = youtubeId(url);
    if (yt) return `youtube:${yt}`;
    const bili = bilibiliKey(url);
    if (bili) return bili;
    const normalized = new URL(url.toString());
    normalized.hash = "";
    for (const key of [...normalized.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key) || key.startsWith("utm_")) {
        normalized.searchParams.delete(key);
      }
    }
    return `page:${normalized.toString()}`;
  }
  function videoTitleFromDocumentTitle(rawTitle) {
    const title = (rawTitle || "").trim();
    if (!title) return "";
    const stripped = title.replace(/\s*[-–—_|]\s*YouTube\s*$/i, "").replace(/[_\-–—|]\s*哔哩哔哩.*$/i, "").replace(/\s*[-–—|]\s*Bilibili\s*$/i, "").trim();
    return (stripped || title).slice(0, 120);
  }

  // src/ext/content/video-context.ts
  function readVideoContext() {
    const videoUrl = location.href;
    let videoTime = 0;
    try {
      const candidate = findBestVideoCandidate();
      const time = candidate?.video?.currentTime;
      if (typeof time === "number" && Number.isFinite(time) && time > 0) videoTime = time;
    } catch {
    }
    return {
      videoKey: videoKeyForUrl(videoUrl),
      videoTitle: videoTitleFromDocumentTitle(document.title),
      videoUrl,
      videoTime
    };
  }

  // src/ext/content/video-clock.ts
  var SAMPLE_INTERVAL_MS = 1e3;
  var EVENT_MIN_GAP_MS = 500;
  var RESOLVE_RETRY_MS = 1e4;
  var MEDIA_EVENTS = ["play", "pause", "seeked", "ratechange", "loadedmetadata", "emptied"];
  function createVideoClock(deps) {
    let timer = null;
    let video = null;
    let lastSentAt = 0;
    let nextResolveAt = 0;
    function resolveVideo(force = false) {
      if (video && video.isConnected) return video;
      video = null;
      const now = Date.now();
      if (!force && now < nextResolveAt) return null;
      nextResolveAt = now + RESOLVE_RETRY_MS;
      try {
        video = findBestVideoCandidate()?.video ?? null;
      } catch {
        video = null;
      }
      return video;
    }
    function sample(force = false) {
      if (!deps.isActive()) return;
      const el = resolveVideo(force);
      if (!el) return;
      const time = el.currentTime;
      if (!Number.isFinite(time) || time < 0) return;
      const now = Date.now();
      deps.send({
        at: now,
        videoTime: time,
        paused: el.paused === true,
        rate: Number.isFinite(el.playbackRate) && el.playbackRate > 0 ? el.playbackRate : 1
      });
      lastSentAt = now;
    }
    function onMediaEvent(event) {
      if (!deps.isActive()) return;
      const target = event.target;
      if (target && target.tagName === "VIDEO" && event.type === "play" && target !== video) {
        video = null;
        nextResolveAt = 0;
      }
      if (Date.now() - lastSentAt < EVENT_MIN_GAP_MS) return;
      sample();
    }
    function start() {
      if (timer !== null) {
        sample();
        return;
      }
      sample(true);
      timer = window.setInterval(() => sample(), SAMPLE_INTERVAL_MS);
    }
    function stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }
    function sync() {
      if (deps.isActive()) start();
      else stop();
    }
    for (const type of MEDIA_EVENTS) {
      document.addEventListener(type, onMediaEvent, true);
    }
    return { sync, start, stop, sample };
  }

  // src/ext/content/tools-menu.ts
  function createToolsMenu(refs) {
    const { button, menu, shadow } = refs;
    function setOpen(open) {
      menu.classList.toggle("open", open);
      button.classList.toggle("active", open);
      button.setAttribute("aria-expanded", String(open));
    }
    function items() {
      return Array.from(menu.querySelectorAll(".rtts-menu-item"));
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(!menu.classList.contains("open"));
    });
    menu.addEventListener("click", () => setOpen(false));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      setOpen(true);
      const all = items();
      (event.key === "ArrowDown" ? all[0] : all[all.length - 1])?.focus();
    });
    menu.addEventListener("keydown", (event) => {
      const all = items();
      if (all.length === 0) return;
      const active = shadow.activeElement;
      const index = active ? all.indexOf(active) : -1;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        all[(index + 1) % all.length].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        all[(index - 1 + all.length) % all.length].focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        all[0].focus();
      } else if (event.key === "End") {
        event.preventDefault();
        all[all.length - 1].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        button.focus();
      } else if (event.key === "Tab") {
        setOpen(false);
      }
    });
    shadow.addEventListener("click", (event) => {
      if (!menu.classList.contains("open")) return;
      const path = event.composedPath?.() || [];
      if (path.includes(button) || path.includes(menu)) return;
      setOpen(false);
    });
    return { setOpen };
  }

  // src/ext/content/screen-caption-toggle.ts
  function bindScreenCaptionToggle(deps) {
    const label = deps.button.querySelector("b");
    const hint = deps.button.querySelector("small");
    let lastStatus = "";
    function sync() {
      const session = deps.getSession();
      const status = session.screenCaption || "off";
      const active = status === "on";
      deps.button.classList.toggle("active", active);
      deps.button.setAttribute("aria-pressed", active ? "true" : "false");
      if (label) label.textContent = active ? "\u753B\u9762\u5B57\u5E55 \xB7 \u5F00" : "\u753B\u9762\u5B57\u5E55";
      if (hint) {
        hint.textContent = status === "error" ? session.screenCaptionError || "\u753B\u9762\u5B57\u5E55\u5DF2\u505C\u6B62" : active ? "\u6B63\u5728\u8BFB\u53D6\u753B\u9762\u91CC\u7684\u786C\u5B57\u5E55" : "\u8BFB\u53D6\u753B\u9762\u91CC\u7684\u786C\u5B57\u5E55\u5E76\u7FFB\u8BD1";
      }
      if (status === "error" && lastStatus !== "error") {
        deps.toast(session.screenCaptionError || "\u753B\u9762\u5B57\u5E55\u5DF2\u505C\u6B62\uFF0C\u8BF7\u91CD\u8BD5", "err");
      }
      lastStatus = status;
    }
    async function toggle() {
      const session = deps.getSession();
      if (session.state !== "running" && session.state !== "starting") {
        deps.toast("\u8BF7\u5148\u5F00\u59CB\u5F55\u97F3\uFF1A\u753B\u9762\u5B57\u5E55\u9700\u8981\u5F55\u5236\u4E2D\u7684\u89C6\u9891\u753B\u9762", "info");
        return;
      }
      const active = session.screenCaption === "on";
      deps.button.classList.add("busy");
      try {
        const result = active ? await deps.bg("STOP_SCREEN_CAPTION") : await deps.bg("START_SCREEN_CAPTION", { targetLang: session.targetLang });
        if (result?.session) deps.adoptSession(result.session);
        if (!result?.ok) {
          const message = result?.error || "\u753B\u9762\u5B57\u5E55\u5207\u6362\u5931\u8D25";
          deps.toast(message, "err");
          if (/API Key|服务商|Base URL|模型/.test(message)) deps.openSettings();
          return;
        }
        deps.toast(
          active ? "\u753B\u9762\u5B57\u5E55\u5DF2\u5173\u95ED\uFF0C\u6062\u590D\u8BED\u97F3\u5B57\u5E55" : "\u753B\u9762\u5B57\u5E55\u5DF2\u5F00\u542F\uFF1A\u753B\u9762\u6709\u786C\u5B57\u5E55\u65F6\u4F18\u5148\u663E\u793A",
          active ? "info" : "ok"
        );
        sync();
      } finally {
        deps.button.classList.remove("busy");
      }
    }
    deps.button.addEventListener("click", () => {
      void toggle();
    });
    return { sync };
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
  function formatBytes(total) {
    if (total >= 1024 * 1024) return `${(total / (1024 * 1024)).toFixed(1)} MB`;
    if (total >= 1024) return `${Math.round(total / 1024)} KB`;
    return `${total} B`;
  }

  // src/lib/deep-link.ts
  function floorSeconds(seconds) {
    return Math.max(0, Math.floor(seconds));
  }
  function videoDeepLink(url, seconds) {
    if (!url || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const t = floorSeconds(seconds);
    if (bilibiliKey(parsed)) {
      return `https://www.bilibili.com${parsed.pathname}?t=${t}`;
    }
    const yt = youtubeId(parsed);
    if (yt) {
      const host = parsed.hostname.replace(/^www\./, "");
      if (host === "youtu.be") return `https://youtu.be/${yt}?t=${t}s`;
      if (parsed.pathname.startsWith("/shorts/")) return `https://www.youtube.com/shorts/${yt}?t=${t}s`;
      return `https://www.youtube.com/watch?v=${yt}&t=${t}s`;
    }
    return null;
  }

  // src/ext/content/exporter.ts
  function getSubtitleText(subtitles) {
    return subtitles.map((sub) => {
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
  function getSubtitleMarkdown(session, assetNames) {
    const label = (code) => {
      const lang = LANGUAGES.find((l) => l.code === code);
      return lang ? lang.label : code;
    };
    const anchored = session.subtitles.some(
      (sub) => typeof sub.videoTime === "number" && Number.isFinite(sub.videoTime)
    );
    const lines = [
      `# snooper-browser \u7FFB\u8BD1\u8BB0\u5F55`,
      ``,
      ...session.pageTitle ? [`- **\u9875\u9762**\uFF1A${session.pageTitle}`] : [],
      `- **\u65F6\u95F4**\uFF1A${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}`,
      `- **\u8BED\u8A00\u65B9\u5411**\uFF1A${label(session.sourceLang)} \u2192 ${label(session.targetLang)}`,
      `- **\u5B57\u5E55\u6761\u76EE**\uFF1A${session.subtitles.length} \u6761`,
      ``,
      `---`,
      ``,
      anchored ? `| \u89C6\u9891\u65F6\u95F4 | \u5F55\u5236\u65F6\u95F4 | \u8BD1\u6587 | \u539F\u6587 |` : `| \u65F6\u95F4 | \u8BD1\u6587 | \u539F\u6587 |`,
      anchored ? `| :--- | :--- | :--- | :--- |` : `| :--- | :--- | :--- |`
    ];
    for (const sub of session.subtitles) {
      const wall = sub.at ? new Date(sub.at).toLocaleTimeString("zh-CN") : "";
      const t = (sub.target || "").replace(/\|/g, "\\|");
      const s = (sub.source || "").replace(/\|/g, "\\|");
      if (anchored) {
        const video = typeof sub.videoTime === "number" && Number.isFinite(sub.videoTime) ? formatVideoTime(sub.videoTime) : "";
        const link = typeof sub.videoTime === "number" && Number.isFinite(sub.videoTime) ? videoDeepLink(session.pageUrl, sub.videoTime) : null;
        const cell = link ? `[\`${video}\`](${link})` : video;
        lines.push(`| ${cell} | ${wall} | ${t} | ${s} |`);
      } else {
        lines.push(`| ${wall} | ${t} | ${s} |`);
      }
    }
    if (session.messages.length > 0) {
      lines.push("", "---", "", "## \u4F34\u5B66\u5BF9\u8BDD", "");
      session.messages.forEach((message, messageIndex) => {
        lines.push(`### ${message.role === "user" ? "\u63D0\u95EE" : "\u56DE\u7B54"}`, "", message.content || "\uFF08\u56FE\u7247\uFF09", "");
        (message.images || []).forEach((image, imageIndex) => {
          const uploaded = assetNames?.get(`chat:${messageIndex}:${imageIndex}`);
          if (uploaded) lines.push(`![[${uploaded}]]`, "");
          else if (/^https?:\/\//i.test(image)) lines.push(`![\u4F34\u5B66\u56FE\u7247](${image})`, "");
          else lines.push("> [\u4F34\u5B66\u56FE\u7247\u672A\u80FD\u5BFC\u51FA\uFF1A\u56FE\u7247\u6570\u636E\u4EC5\u4FDD\u5B58\u5728\u6269\u5C55\u5B58\u50A8\u4E2D]", "");
        });
      });
    }
    session.notes.forEach((note) => {
      if (note.entries.length === 0) return;
      lines.push("", "---", "", `## \u7B14\u8BB0\uFF1A${note.title || "\u672A\u547D\u540D\u7B14\u8BB0"}`, "");
      note.entries.forEach((entry) => {
        const label2 = entry.text || entry.target || "\u7B14\u8BB0";
        const isVisual = entry.type === "image" || entry.type === "screenshot" || entry.type === "svg";
        if (isVisual) {
          const uploaded = assetNames?.get(`note:${note.id}:${entry.id}`);
          if (uploaded) lines.push(`![[${uploaded}]]`);
          else if (entry.imageUrl && /^https?:\/\//i.test(entry.imageUrl)) lines.push(`![${label2}](${entry.imageUrl})`);
          else if (entry.svg) lines.push("```svg", entry.svg, "```");
          else lines.push(`> [\u56FE\u7247\uFF1A${label2} \u2014 \u56FE\u7247\u6570\u636E\u4EC5\u4FDD\u5B58\u5728\u6269\u5C55\u5B58\u50A8\u4E2D\uFF0C\u672A\u968F\u672C\u6B21\u5BFC\u51FA\u643A\u5E26]`);
          if (entry.text) lines.push("", `*${entry.text}*`);
          lines.push("");
        } else if (entry.type === "summary") {
          lines.push("", `### \u5B66\u4E60\u7EAA\u8981`, "", entry.text || "", "");
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

  // src/ext/content/actions.ts
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        textarea.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }
  function sessionHasAssets(session) {
    return collectAssets(session.notes, session.messages).length > 0;
  }
  async function resolveSubtitles(deps) {
    try {
      const rows = await deps.getTranscript();
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch {
    }
    return deps.getSession().subtitles;
  }
  function downloadZip(filename, files) {
    const blob = new Blob([buildZip(files)], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
  }
  function bindActions(deps) {
    const r = deps.refs;
    r.copy.addEventListener("click", async () => {
      const text = getSubtitleText(await resolveSubtitles(deps));
      if (!text) {
        deps.toast("\u6CA1\u6709\u5B57\u5E55\u53EF\u590D\u5236", "err");
        return;
      }
      const ok = await copyText(text);
      if (ok) {
        deps.flashChip(r.copy);
        deps.toast("\u5DF2\u590D\u5236\u5168\u90E8\u5B57\u5E55", "ok");
      } else {
        deps.toast("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u5728\u6D4F\u89C8\u5668\u8BBE\u7F6E\u4E2D\u5141\u8BB8\u526A\u8D34\u677F\u8BBF\u95EE", "err");
      }
    });
    r.exportTxt.addEventListener("click", async () => {
      const text = getSubtitleText(await resolveSubtitles(deps));
      if (!text) {
        deps.toast("\u6CA1\u6709\u5B57\u5E55\u53EF\u5BFC\u51FA", "err");
        return;
      }
      downloadBlob(`snooper-subtitles-${Date.now()}.txt`, text);
      deps.flashChip(r.exportTxt);
      deps.toast("TXT \u5DF2\u5BFC\u51FA", "ok");
    });
    r.exportMd.addEventListener("click", async () => {
      const session = deps.getSession();
      const subtitles = await resolveSubtitles(deps);
      const text = getSubtitleMarkdown({ ...session, subtitles, pageUrl: location.href, pageTitle: document.title });
      if (!text) {
        deps.toast("\u6CA1\u6709\u5185\u5BB9\u53EF\u5BFC\u51FA", "err");
        return;
      }
      deps.flashChip(r.exportMd);
      if (!sessionHasAssets(session)) {
        downloadBlob(`snooper-notes-${Date.now()}.md`, text);
        deps.toast("Markdown \u5DF2\u5BFC\u51FA", "ok");
        return;
      }
      const assets = collectAssets(session.notes, session.messages);
      const names = /* @__PURE__ */ new Map();
      const files = [];
      let failed = 0;
      for (const asset of assets) {
        const decoded = decodeExportAsset(asset);
        if (decoded) {
          names.set(asset.entryId, `assets/${asset.fileName}`);
          files.push({ name: `assets/${asset.fileName}`, bytes: decoded.file.bytes });
        } else {
          failed += 1;
        }
      }
      const markdown = getSubtitleMarkdown(
        { ...session, pageUrl: location.href, pageTitle: document.title },
        new Map([...names].map(([entryId, name]) => [entryId, name]))
      );
      files.unshift({ name: "record.md", bytes: new TextEncoder().encode(markdown) });
      downloadZip(`snooper-notes-${Date.now()}.zip`, files);
      const note = failed > 0 ? `\uFF0C${failed} \u5F20\u56FE\u7247\u65E0\u6CD5\u8BFB\u53D6\u5DF2\u7528\u5360\u4F4D\u8BF4\u660E` : "";
      deps.toast(`\u5DF2\u5BFC\u51FA ZIP\uFF08${files.length} \u4E2A\u6587\u4EF6\uFF0C${formatBytes(files.reduce((sum, file) => sum + file.bytes.length, 0))}\uFF09${note}`, failed > 0 ? "err" : "ok");
    });
    r.note.addEventListener("click", () => {
      const session = deps.getSession();
      const subs = session.subtitles;
      if (subs.length === 0) {
        deps.toast("\u6CA1\u6709\u5B57\u5E55\u53EF\u8BB0\u5F55", "err");
        return;
      }
      const last = subs[subs.length - 1];
      deps.addNoteEntry({
        id: `note_${Date.now()}`,
        type: "subtitle",
        at: Date.now(),
        source: last.source,
        target: last.target,
        sourceLang: session.sourceLang,
        targetLang: session.targetLang,
        // ADR-035: carry the anchor so exports can deep-link back to the video.
        videoTime: typeof last.videoTime === "number" ? last.videoTime : null,
        videoUrl: location.href
      });
      deps.flashChip(r.note);
      deps.toast("\u5DF2\u8BB0\u5165\u7B14\u8BB0", "ok");
    });
    let summaryBusy = false;
    r.summary.addEventListener("click", async () => {
      if (summaryBusy) return;
      const session = deps.getSession();
      if (!session.subtitles || session.subtitles.length === 0) {
        deps.toast("\u8FD8\u6CA1\u6709\u5B57\u5E55\u53EF\u603B\u7ED3\uFF0C\u5148\u5F00\u542F\u5B9E\u65F6\u7FFB\u8BD1", "err");
        return;
      }
      summaryBusy = true;
      r.summary.setAttribute("aria-disabled", "true");
      deps.toast("\u6B63\u5728\u751F\u6210\u7EAA\u8981\u2026", "info");
      try {
        const res = await deps.summarize();
        if (!res.ok || !res.summary) {
          deps.toast(res.error || "\u751F\u6210\u7EAA\u8981\u5931\u8D25", "err");
          return;
        }
        deps.addNoteEntry({
          id: `summary_${Date.now()}`,
          type: "summary",
          at: Date.now(),
          text: res.summary,
          videoTime: typeof res.videoTime === "number" ? res.videoTime : null,
          videoUrl: location.href
        });
        deps.openNotes();
        deps.flashChip(r.summary);
        deps.toast("\u7EAA\u8981\u5DF2\u8BB0\u5165\u7B14\u8BB0", "ok");
      } finally {
        summaryBusy = false;
        r.summary.removeAttribute("aria-disabled");
      }
    });
    r.image.addEventListener("click", () => {
      const subs = deps.getSession().subtitles;
      const last = subs[subs.length - 1];
      deps.openImagePanel(last?.target || last?.source || "");
    });
    r.screenshot.addEventListener("click", async () => {
      r.screenshot.classList.add("busy");
      try {
        const shot = await deps.captureVideoFrame();
        deps.addNoteEntry({
          id: `screenshot_${Date.now()}`,
          type: "screenshot",
          at: Date.now(),
          imageUrl: shot.dataUrl,
          text: shot.cropped ? "\u89C6\u9891\u622A\u56FE" : "\u9875\u9762\u622A\u56FE"
        });
        deps.openShotPreview(shot.dataUrl, true, true);
        deps.flashChip(r.screenshot);
        deps.toast(
          shot.cropped ? "\u5DF2\u622A\u53D6\u89C6\u9891\u753B\u9762\u5E76\u5B58\u5165\u7B14\u8BB0" : "\u5DF2\u622A\u53D6\u5F53\u524D\u753B\u9762\uFF08\u672A\u8BC6\u522B\u5230\u89C6\u9891\u533A\u57DF\uFF09\u5E76\u5B58\u5165\u7B14\u8BB0",
          "ok"
        );
      } catch (err) {
        deps.toast("\u622A\u56FE\u5931\u8D25\uFF1A" + (err.message || "\u672A\u77E5\u9519\u8BEF"), "err");
      } finally {
        r.screenshot.classList.remove("busy");
      }
    });
  }

  // src/ext/content/obsidian-export.ts
  function bindObsidianExport(deps) {
    deps.button.addEventListener("click", async () => {
      const obsidianConfig = await loadObsidianConfig();
      if (!obsidianConfig.apiKey) {
        deps.toast("\u8BF7\u5148\u586B\u5199 Obsidian API Key", "err");
        await deps.openSettings();
        deps.focusObsidianKey();
        return;
      }
      const session = deps.getSession();
      const assets = collectNoteAssets(session.notes, session.messages);
      const uploadedNames = /* @__PURE__ */ new Map();
      let uploadedCount = 0;
      let failedCount = 0;
      if (assets.length > 0) {
        deps.toast(`\u6B63\u5728\u4E0A\u4F20 ${assets.length} \u5F20\u56FE\u7247\u5230 Obsidian\u2026`, "ok");
        for (const asset of assets) {
          try {
            const up = await deps.bg("OBSIDIAN_UPLOAD_ASSET", {
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
      const markdown = getSubtitleMarkdown(
        { ...deps.getSession(), pageUrl: location.href, pageTitle: document.title },
        uploadedNames
      );
      const imageNote = uploadedCount > 0 ? `\uFF0C\u542B ${uploadedCount} \u5F20\u56FE\u7247` : "";
      const failNote = failedCount > 0 ? `\uFF1B${failedCount} \u5F20\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF0C\u5DF2\u7528\u6587\u5B57\u5360\u4F4D` : "";
      try {
        const res = await deps.bg("EXPORT_TO_OBSIDIAN", {
          content: markdown,
          title: `snooper-\u4F1A\u8BDD-${Date.now()}`,
          obsidianConfig
        });
        if (res.ok) {
          deps.flashChip(deps.button, 2e3);
          deps.toast(`\u5DF2\u53D1\u9001\u5230 Obsidian${imageNote}${failNote}`, failedCount > 0 ? "err" : "ok");
        } else {
          deps.toast("Obsidian \u5BFC\u51FA\u5931\u8D25\uFF1A" + (res.error || "\u8BF7\u786E\u8BA4\u5DF2\u5B89\u88C5 Obsidian Local REST API \u63D2\u4EF6"), "err");
        }
      } catch (err) {
        deps.toast("Obsidian \u901A\u4FE1\u5931\u8D25\uFF1A" + (err.message || "\u8BF7\u786E\u8BA4 Obsidian \u6B63\u5728\u8FD0\u884C"), "err");
      }
    });
  }

  // src/ext/image-panel.ts
  function createImagePanel(deps) {
    const { refs } = deps;
    let lastImageUrl = "";
    let lastRemoteUrl = "";
    let lastPrompt = "";
    function resetResult() {
      lastImageUrl = "";
      lastRemoteUrl = "";
      refs.result.classList.remove("show");
      refs.actions.classList.remove("show");
      refs.fun.classList.remove("show");
      destroyViewer();
      refs.openOriginal.hidden = true;
      refs.openOriginal.removeAttribute("href");
    }
    function setStatus(message, tone = "info") {
      refs.status.className = "rtts-status show" + (tone === "info" ? " info" : ` ${tone}`);
      refs.status.textContent = message;
    }
    function safeExternalUrl(url) {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
      } catch {
        return "";
      }
    }
    function clearStatus() {
      refs.status.className = "rtts-status";
      refs.status.textContent = "";
    }
    let viewerFrame = null;
    let viewerReport = null;
    let viewerToken = 0;
    function destroyViewer() {
      viewerToken++;
      if (viewerReport) window.removeEventListener("message", viewerReport);
      viewerReport = null;
      viewerFrame?.remove();
      viewerFrame = null;
    }
    function showImage(url, remote) {
      lastImageUrl = url;
      lastRemoteUrl = remote;
      refs.result.classList.add("show");
      refs.actions.classList.add("show");
      refs.fun.classList.add("show");
      destroyViewer();
      const token = viewerToken;
      const frame = document.createElement("iframe");
      frame.className = "rtts-image-frame-element";
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("title", "\u751F\u6210\u7684\u914D\u56FE");
      frame.setAttribute("referrerpolicy", "no-referrer");
      viewerFrame = frame;
      refs.resultFrame.textContent = "";
      refs.resultFrame.appendChild(frame);
      const report = (event) => {
        const data = event.data;
        if (!data || event.source !== frame.contentWindow) return;
        if (data.type === "rtts-image-viewer:ready") {
          if (token !== viewerToken) return;
          setStatus(`\u751F\u6210\u5B8C\u6210${data.width ? ` \xB7 ${data.width} \xD7 ${data.height}` : ""}`, "ok");
          refs.openOriginal.hidden = true;
        } else if (data.type === "rtts-image-viewer:error") {
          if (token !== viewerToken) return;
          setStatus("\u56FE\u7247\u5DF2\u751F\u6210\uFF0C\u4F46\u5F53\u524D\u9875\u9762\u65E0\u6CD5\u52A0\u8F7D\u3002\u53EF\u6253\u5F00\u539F\u56FE\u6216\u91CD\u65B0\u751F\u6210\u3002", "err");
          const safeRemote = remote ? safeExternalUrl(remote) : "";
          if (safeRemote) {
            refs.openOriginal.href = safeRemote;
            refs.openOriginal.hidden = false;
          }
        }
      };
      viewerReport = report;
      window.addEventListener("message", report);
      frame.addEventListener("load", () => {
        if (token !== viewerToken || viewerFrame !== frame) return;
        frame.contentWindow?.postMessage({ type: "rtts-image-viewer:show", src: url, id: String(token) }, "*");
      });
      frame.src = chrome.runtime.getURL("image-viewer.html");
    }
    async function ensureDataUrl() {
      if (lastImageUrl.startsWith("data:")) return lastImageUrl;
      if (lastRemoteUrl) {
        const dataUrl = await deps.materialize(lastRemoteUrl);
        if (dataUrl.startsWith("data:")) {
          lastImageUrl = dataUrl;
          return dataUrl;
        }
      }
      throw new Error("\u56FE\u7247\u8FD8\u6CA1\u6709\u7F13\u5B58\u5230\u672C\u5730\uFF0C\u8BF7\u5148\u4E0B\u8F7D\u6216\u91CD\u65B0\u751F\u6210");
    }
    function open(prompt = "") {
      resetResult();
      clearStatus();
      lastPrompt = prompt;
      refs.prompt.value = prompt;
      refs.modal.classList.add("open");
      setTimeout(() => refs.prompt.focus(), 30);
    }
    function close() {
      refs.modal.classList.remove("open");
    }
    refs.modal.addEventListener("click", (event) => {
      if (event.target === refs.modal) close();
    });
    async function generate() {
      const prompt = refs.prompt.value.trim();
      if (!prompt) {
        deps.toast("\u8BF7\u5148\u8F93\u5165\u63D0\u793A\u8BCD", "err");
        return;
      }
      lastPrompt = prompt;
      refs.generate.disabled = true;
      refs.generate.classList.add("loading");
      const label = refs.generate.querySelector("span");
      if (label) label.textContent = "\u751F\u6210\u4E2D\u2026";
      resetResult();
      setStatus("\u6B63\u5728\u8BF7\u6C42\u751F\u56FE\u63A5\u53E3\uFF0C\u901A\u5E38\u9700\u8981 20\u201330 \u79D2", "info");
      try {
        const res = await deps.generate({
          prompt,
          size: refs.size.value,
          negativePrompt: refs.negative.value.trim()
        });
        if (!res.ok || !Array.isArray(res.images) || res.images.length === 0) {
          setStatus(res.error || "\u751F\u6210\u5931\u8D25", "err");
          return;
        }
        const remote = res.remoteImages?.[0] || "";
        showImage(res.images[0], remote);
        if (res.warnings?.length) {
          console.warn("[RTTS] image generation warnings", res.warnings);
        }
      } catch (err) {
        setStatus(err?.message || "\u751F\u6210\u5931\u8D25", "err");
      } finally {
        refs.generate.disabled = false;
        refs.generate.classList.remove("loading");
        if (label) label.textContent = "\u751F\u6210\u56FE\u7247";
      }
    }
    async function saveToNotes() {
      try {
        const dataUrl = await ensureDataUrl();
        deps.addNote(dataUrl, lastPrompt.slice(0, 80) || "\u751F\u6210\u914D\u56FE");
        deps.toast("\u5DF2\u5B58\u5165\u7B14\u8BB0", "ok");
        close();
      } catch (err) {
        deps.toast(err?.message || "\u5B58\u5165\u7B14\u8BB0\u5931\u8D25", "err");
      }
    }
    async function insertToChat() {
      try {
        const dataUrl = await ensureDataUrl();
        deps.insertChat(dataUrl, lastPrompt);
        deps.toast("\u5DF2\u63D2\u5165\u4F34\u5B66\u5BF9\u8BDD", "ok");
        close();
      } catch (err) {
        deps.toast(err?.message || "\u63D2\u5165\u5931\u8D25", "err");
      }
    }
    function download() {
      if (!lastImageUrl) return;
      const extension = lastImageUrl.startsWith("data:image/jpeg") ? "jpg" : lastImageUrl.startsWith("data:image/webp") ? "webp" : lastImageUrl.startsWith("data:image/gif") ? "gif" : "png";
      const a = document.createElement("a");
      a.href = lastImageUrl;
      a.download = `snooper-${Date.now()}.${extension}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    }
    async function play(kind) {
      try {
        const dataUrl = await ensureDataUrl();
        deps.play(kind, dataUrl, lastPrompt);
        close();
      } catch (err) {
        deps.toast(err?.message || "\u64CD\u4F5C\u5931\u8D25", "err");
      }
    }
    refs.close.addEventListener("click", close);
    refs.modal.addEventListener("click", (event) => {
      if (event.target === refs.modal) close();
    });
    refs.generate.addEventListener("click", () => {
      void generate();
    });
    refs.save.addEventListener("click", () => {
      void saveToNotes();
    });
    refs.insert.addEventListener("click", () => {
      void insertToChat();
    });
    refs.download.addEventListener("click", download);
    refs.fun.querySelectorAll("[data-fun]").forEach((button) => {
      button.addEventListener("click", () => {
        void play(button.dataset.fun);
      });
    });
    return { open, close, generate, saveToNotes, insertToChat, download, play };
  }

  // src/ext/content/image-gen.ts
  function subtitleDigest(session, limit = 6) {
    const text = session.subtitles.slice(-limit).map((line) => line.target && line.target !== line.source ? `${line.source} / ${line.target}` : line.source).filter(Boolean).join("\uFF1B");
    return text || "\uFF08\u5F53\u524D\u8FD8\u6CA1\u6709\u5B57\u5E55\uFF0C\u53EF\u4EE5\u6309\u753B\u9762\u81EA\u7531\u53D1\u6325\uFF09";
  }
  function funQuestion(session, kind) {
    const context = subtitleDigest(session);
    if (kind === "roast") {
      return `\u8BF7\u7528\u4E00\u53E5\u7280\u5229\u4F46\u4E0D\u5192\u72AF\u7684\u5410\u69FD\u70B9\u8BC4\u8FD9\u5F20\u56FE\uFF0C\u7ED3\u5408\u5F53\u524D\u5267\u60C5\uFF1A
${context}`;
    }
    if (kind === "continue") {
      return `\u6839\u636E\u8FD9\u5F20\u56FE\u548C\u5F53\u524D\u5B57\u5E55\uFF0C\u7EED\u5199\u63A5\u4E0B\u6765 3 \u53E5\u5267\u60C5\uFF0C\u4FDD\u6301\u4EBA\u7269\u548C\u8BED\u6C14\u4E00\u81F4\uFF1A
${context}`;
    }
    return `\u4E3A\u8FD9\u5F20\u56FE\u914D\u4E00\u53E5\u6709\u51B2\u51FB\u529B\u7684\u53F0\u8BCD\uFF0C\u8D34\u5408\u5F53\u524D\u5267\u60C5\uFF1A
${context}`;
  }
  function createImageGen(deps) {
    const panel = createImagePanel({
      refs: deps.refs,
      generate: (input) => deps.bg("GENERATE_IMAGE", input),
      materialize: async (url) => {
        const res = await deps.bg("FETCH_IMAGE", { url });
        if (!res.ok || !res.dataUrl) throw new Error(res.error || "\u65E0\u6CD5\u7F13\u5B58\u56FE\u7247");
        return res.dataUrl;
      },
      addNote: (imageUrl, text) => {
        deps.addNoteEntry({
          id: `image_${Date.now()}`,
          type: "image",
          at: Date.now(),
          imageUrl,
          text
        });
      },
      insertChat: (imageUrl) => {
        const outcome = deps.addImage(imageUrl);
        if (outcome === "full") {
          throw new Error("\u6700\u591A 4 \u5F20\u56FE\u7247");
        }
        deps.openDrawer("chat");
      },
      play: (kind, imageUrl) => {
        deps.openDrawer("chat");
        void deps.submitQuestion(funQuestion(deps.getSession(), kind), [imageUrl]);
      },
      toast: deps.toast
    });
    return {
      open: (prompt) => panel.open(prompt),
      close: () => panel.close()
    };
  }

  // src/ext/content/refs.ts
  function collectRefs(shadow) {
    return {
      bar: shadow.getElementById("rtts-bar"),
      barGrip: shadow.getElementById("rtts-bar-grip"),
      recordBtn: shadow.getElementById("rtts-record"),
      recordLabelEl: shadow.getElementById("rtts-record-label"),
      moreBtn: shadow.getElementById("rtts-more-btn"),
      toolsMenu: shadow.getElementById("rtts-menu"),
      langBtn: shadow.getElementById("rtts-lang-btn"),
      langLabel: shadow.getElementById("rtts-lang-label"),
      langPicker: shadow.getElementById("rtts-lang-picker"),
      sourceLangsEl: shadow.getElementById("rtts-source-langs"),
      targetLangsEl: shadow.getElementById("rtts-target-langs"),
      subBox: shadow.getElementById("rtts-sub-box"),
      subHandle: shadow.getElementById("rtts-sub-handle"),
      subResize: shadow.getElementById("rtts-sub-resize"),
      subScroll: shadow.getElementById("rtts-sub-scroll"),
      subRows: shadow.getElementById("rtts-sub-rows"),
      subPlaceholder: shadow.getElementById("rtts-sub-placeholder"),
      subStatus: shadow.getElementById("rtts-sub-status"),
      subListening: shadow.getElementById("rtts-sub-listening"),
      copyBtn: shadow.getElementById("rtts-copy-btn"),
      exportTxtBtn: shadow.getElementById("rtts-export-txt-btn"),
      exportMdBtn: shadow.getElementById("rtts-export-md-btn"),
      streamingRow: shadow.getElementById("rtts-streaming-row"),
      streamingText: shadow.getElementById("rtts-streaming-text"),
      streamingSource: shadow.getElementById("rtts-streaming-source"),
      streamingLabel: shadow.getElementById("rtts-streaming-label"),
      drawer: shadow.getElementById("rtts-drawer"),
      chatEl: shadow.getElementById("rtts-chat"),
      chatComposer: shadow.getElementById("rtts-chat-composer"),
      chatEditor: shadow.getElementById("rtts-chat-editor"),
      chatPreview: shadow.getElementById("rtts-chat-preview"),
      mdPreviewBtn: shadow.getElementById("rtts-md-preview-btn"),
      citeBtn: shadow.getElementById("rtts-cite-btn"),
      citePopover: shadow.getElementById("rtts-cite-popover"),
      citeList: shadow.getElementById("rtts-cite-list"),
      citeEmpty: shadow.getElementById("rtts-cite-empty"),
      citeClose: shadow.getElementById("rtts-cite-close"),
      notesEditor: shadow.getElementById("rtts-notes-editor"),
      notesPreview: shadow.getElementById("rtts-notes-preview"),
      notesPreviewBtn: shadow.getElementById("rtts-notes-preview-btn"),
      drawerTabChat: shadow.getElementById("rtts-tab-chat"),
      drawerTabNotes: shadow.getElementById("rtts-tab-notes"),
      chatNewTopic: shadow.getElementById("rtts-chat-new-topic"),
      chatHistoryBtn: shadow.getElementById("rtts-chat-history"),
      chatHistoryPopover: shadow.getElementById("rtts-history-popover"),
      chatHistoryList: shadow.getElementById("rtts-history-list"),
      chatHistoryEmpty: shadow.getElementById("rtts-history-empty"),
      chatHistoryClose: shadow.getElementById("rtts-history-close"),
      paneChat: shadow.getElementById("rtts-pane-chat"),
      paneNotes: shadow.getElementById("rtts-pane-notes"),
      chatBtn: shadow.getElementById("rtts-chat-btn"),
      chatAttachBtn: shadow.getElementById("rtts-chat-attach-btn"),
      chatFile: shadow.getElementById("rtts-chat-file"),
      chatAttachments: shadow.getElementById("rtts-chat-attachments"),
      sendBtn: shadow.getElementById("rtts-send"),
      fsWarn: shadow.getElementById("rtts-fs-warn"),
      hideBtn: shadow.getElementById("rtts-hide-btn"),
      showBtn: shadow.getElementById("rtts-show-btn"),
      noteBtn: shadow.getElementById("rtts-note-btn"),
      summaryBtn: shadow.getElementById("rtts-summary-btn"),
      imageBtn: shadow.getElementById("rtts-image-btn"),
      screenshotBtn: shadow.getElementById("rtts-screenshot-btn"),
      notesCount: shadow.getElementById("rtts-notes-count"),
      notesBadge: shadow.getElementById("rtts-notes-badge"),
      notesBtn: shadow.getElementById("rtts-notes-btn"),
      notesList: shadow.getElementById("rtts-notes-list"),
      notesAdd: shadow.getElementById("rtts-notes-add"),
      obsidianBtn: shadow.getElementById("rtts-obsidian-btn"),
      settingsModal: shadow.getElementById("rtts-settings-modal"),
      settingsClose: shadow.getElementById("rtts-settings-close"),
      cfgBaseUrl: shadow.getElementById("rtts-cfg-baseurl"),
      cfgApiKey: shadow.getElementById("rtts-cfg-apikey"),
      cfgToggleKey: shadow.getElementById("rtts-cfg-toggle-key"),
      cfgLlm: shadow.getElementById("rtts-cfg-llm"),
      cfgAudio: shadow.getElementById("rtts-cfg-audio"),
      cfgImage: shadow.getElementById("rtts-cfg-image"),
      cfgStatus: shadow.getElementById("rtts-cfg-status"),
      cfgTest: shadow.getElementById("rtts-cfg-test"),
      cfgSave: shadow.getElementById("rtts-cfg-save"),
      cfgCancel: shadow.getElementById("rtts-cfg-cancel"),
      cfgObProtocol: shadow.getElementById("rtts-cfg-ob-protocol"),
      cfgObPort: shadow.getElementById("rtts-cfg-ob-port"),
      cfgObKey: shadow.getElementById("rtts-cfg-ob-key"),
      cfgObFolder: shadow.getElementById("rtts-cfg-ob-folder"),
      cfgObTest: shadow.getElementById("rtts-cfg-ob-test"),
      cfgObStatus: shadow.getElementById("rtts-cfg-ob-status"),
      shotModal: shadow.getElementById("rtts-shot-modal"),
      shotImg: shadow.getElementById("rtts-shot-img"),
      shotClose: shadow.getElementById("rtts-shot-close"),
      shotCloseX: shadow.getElementById("rtts-shot-close-x"),
      shotDownload: shadow.getElementById("rtts-shot-download"),
      shotSave: shadow.getElementById("rtts-shot-save"),
      shotInsert: shadow.getElementById("rtts-shot-insert"),
      imageModal: shadow.getElementById("rtts-image-modal"),
      imgClose: shadow.getElementById("rtts-img-close"),
      imgPrompt: shadow.getElementById("rtts-img-prompt"),
      imgSize: shadow.getElementById("rtts-img-size"),
      imgNeg: shadow.getElementById("rtts-img-neg"),
      imgGenerate: shadow.getElementById("rtts-img-generate"),
      imgStatus: shadow.getElementById("rtts-img-status"),
      imgResult: shadow.getElementById("rtts-img-result"),
      imgResultFrame: shadow.getElementById("rtts-img-result-frame"),
      imgOpen: shadow.getElementById("rtts-img-open"),
      imgActions: shadow.getElementById("rtts-img-actions"),
      imgFun: shadow.getElementById("rtts-img-fun"),
      imgSave: shadow.getElementById("rtts-img-save"),
      imgInsert: shadow.getElementById("rtts-img-insert"),
      imgDownload: shadow.getElementById("rtts-img-download"),
      toasts: shadow.getElementById("rtts-toasts")
    };
  }

  // src/ext/content/demo.ts
  var DEMO_SUBTITLES = [
    { source: "Welcome to snooper-browser", target: "\u6B22\u8FCE\u4F7F\u7528 snooper-browser", delay: 2e3 },
    { source: "This is a real-time translation demo", target: "\u8FD9\u662F\u4E00\u4E2A\u5B9E\u65F6\u7FFB\u8BD1\u6F14\u793A", delay: 2500 },
    { source: "You can also take notes and generate images", target: "\u4F60\u53EF\u4EE5\u8BB0\u7B14\u8BB0\u548C\u751F\u6210\u56FE\u7247", delay: 3e3 },
    { source: "Click the record button to start real transcription", target: "\u70B9\u51FB\u5F55\u97F3\u6309\u94AE\u5F00\u59CB\u771F\u5B9E\u8F6C\u5199", delay: 2800 },
    { source: "Configure your API key in the settings panel", target: "\u5728\u8BBE\u7F6E\u9762\u677F\u4E2D\u914D\u7F6E\u4F60\u7684 API \u5BC6\u94A5", delay: 3e3 },
    { source: "Enjoy the seamless multilingual experience", target: "\u4EAB\u53D7\u65E0\u7F1D\u7684\u591A\u8BED\u8A00\u4F53\u9A8C", delay: 2500 }
  ];

  // src/lib/video-presence.ts
  var AUTO_SHOW_MIN_WIDTH = 320;
  var AUTO_SHOW_MIN_HEIGHT = 180;
  var AUTO_SHOW_MIN_VIEWPORT_RATIO = 0.12;
  function isPresentableVideo(rect, viewport) {
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false;
    if (rect.width < AUTO_SHOW_MIN_WIDTH || rect.height < AUTO_SHOW_MIN_HEIGHT) return false;
    const viewportArea = viewport.width * viewport.height;
    if (!Number.isFinite(viewportArea) || viewportArea <= 0) return false;
    return rect.width * rect.height / viewportArea >= AUTO_SHOW_MIN_VIEWPORT_RATIO;
  }

  // src/lib/content-install.ts
  function shouldSkipContentInstall(marker) {
    if (!marker) return false;
    if (typeof marker !== "object") return false;
    const alive = marker.alive;
    if (typeof alive !== "function") return false;
    try {
      return alive() === true;
    } catch {
      return false;
    }
  }
  function createContentInstallMarker() {
    return {
      alive: () => {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime || typeof runtime.getManifest !== "function") return false;
        try {
          runtime.getManifest();
          return true;
        } catch {
          return false;
        }
      }
    };
  }

  // src/ext/content.ts
  (() => {
    const INSTALL_MARKER_KEY = "__rttsContentInstalled";
    if (shouldSkipContentInstall(window[INSTALL_MARKER_KEY])) return;
    const INSTANCE_KEY = "__rttsContentInstance";
    const instanceToken = {};
    window[INSTANCE_KEY] = instanceToken;
    const isLiveInstance = () => window[INSTANCE_KEY] === instanceToken;
    const HOST_ID = "rtts-extension-host";
    for (let stale = document.getElementById(HOST_ID); stale; stale = document.getElementById(HOST_ID)) {
      stale.remove();
    }
    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "closed" });
    let session = {
      state: "idle",
      sourceLang: "auto",
      targetLang: "zh",
      subtitles: [],
      messages: [],
      agentSessionId: null,
      notes: [],
      activeNoteId: null,
      isDemoMode: false
    };
    const UI_HIDDEN_KEY = "snooper.ui-hidden.v1";
    let uiHidden = true;
    let hasBeenShownOnce = false;
    let autoShowDismissed = false;
    let lastVideoProbeAt = 0;
    const AUTO_SHOW_PROBE_GAP_MS = 800;
    let autoShown = false;
    let autoShowUrl = "";
    let autoHideTimer = null;
    const AUTO_HIDE_PROBE_MS = 1500;
    function persistUiHidden() {
      try {
        localStorage.setItem(UI_HIDDEN_KEY, uiHidden ? "1" : "0");
      } catch {
      }
    }
    function ensureToolbarVisible() {
      hasBeenShownOnce = true;
      autoShown = false;
      stopAutoHideWatch();
      if (!uiHidden) return;
      uiHidden = false;
      persistUiHidden();
      applyUiHidden();
      render();
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
    function hasPresentableVideo() {
      try {
        const candidate = findBestVideoCandidate();
        if (!candidate) return false;
        return isPresentableVideo(
          { width: candidate.rect.w, height: candidate.rect.h },
          { width: window.innerWidth, height: window.innerHeight }
        );
      } catch {
        return false;
      }
    }
    function maybeAutoShowForVideo() {
      if (!isLiveInstance()) return;
      if (!uiHidden || autoShowDismissed) return;
      const now = Date.now();
      if (now - lastVideoProbeAt < AUTO_SHOW_PROBE_GAP_MS) return;
      lastVideoProbeAt = now;
      if (!hasPresentableVideo()) return;
      ensureToolbarVisible();
      autoShown = true;
      autoShowUrl = location.href;
      startAutoHideWatch();
    }
    function startAutoHideWatch() {
      if (autoHideTimer !== null) return;
      autoHideTimer = setInterval(() => {
        if (!isLiveInstance() || uiHidden || !autoShown) {
          stopAutoHideWatch();
          return;
        }
        if (session.state !== "idle") return;
        if (location.href === autoShowUrl) return;
        autoShowUrl = location.href;
        if (hasPresentableVideo()) return;
        uiHidden = true;
        autoShown = false;
        hasBeenShownOnce = false;
        persistUiHidden();
        applyUiHidden();
        stopAutoHideWatch();
      }, AUTO_HIDE_PROBE_MS);
    }
    function stopAutoHideWatch() {
      if (autoHideTimer === null) return;
      clearInterval(autoHideTimer);
      autoHideTimer = null;
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
    style.textContent = CONTENT_CSS;
    const html = CONTENT_HTML;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    shadow.append(style, wrapper);
    (document.body || document.documentElement).appendChild(host);
    const {
      bar,
      barGrip,
      recordBtn,
      recordLabelEl,
      moreBtn,
      toolsMenu,
      langBtn,
      langLabel,
      langPicker,
      sourceLangsEl,
      targetLangsEl,
      subBox,
      subHandle,
      subResize,
      subScroll,
      subRows,
      subPlaceholder,
      subStatus,
      subListening,
      copyBtn,
      exportTxtBtn,
      exportMdBtn,
      streamingRow,
      streamingText,
      streamingSource,
      streamingLabel,
      drawer,
      chatEl,
      chatComposer,
      chatEditor,
      chatPreview,
      mdPreviewBtn,
      citeBtn,
      citePopover,
      citeList,
      citeEmpty,
      citeClose,
      notesEditor,
      notesPreview,
      notesPreviewBtn,
      drawerTabChat,
      drawerTabNotes,
      paneChat,
      paneNotes,
      chatNewTopic,
      chatHistoryBtn,
      chatHistoryPopover,
      chatHistoryList,
      chatHistoryEmpty,
      chatHistoryClose,
      chatBtn,
      chatAttachBtn,
      chatFile,
      chatAttachments,
      sendBtn,
      fsWarn,
      hideBtn,
      showBtn,
      noteBtn,
      summaryBtn,
      imageBtn,
      screenshotBtn,
      screenBtn,
      notesCount,
      notesBadge,
      notesBtn,
      notesList,
      notesAdd,
      obsidianBtn,
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
      shotModal,
      shotImg,
      shotClose,
      shotCloseX,
      shotDownload,
      shotSave,
      shotInsert,
      imageModal,
      imgClose,
      imgPrompt,
      imgSize,
      imgNeg,
      imgGenerate,
      imgStatus,
      imgResult,
      imgResultFrame,
      imgOpen,
      imgActions,
      imgFun,
      imgSave,
      imgInsert,
      imgDownload,
      toasts
    } = collectRefs(shadow);
    const langPickerCtrl = createLangPicker({
      shadow,
      bar,
      langBtn,
      langLabel,
      langPicker,
      sourceLangsEl,
      targetLangsEl,
      getSession: () => session,
      setSourceLang: (code) => {
        session.sourceLang = code;
      },
      setTargetLang: (code) => {
        session.targetLang = code;
      },
      onSourceChanged: (code) => {
        bg("SET_LANG", { sourceLang: code }).then(() => syncSessionFromBackground()).catch(() => {
        });
      },
      onTargetChanged: (code) => {
        bg("SET_LANG", { targetLang: code }).then(() => syncSessionFromBackground()).catch(() => {
        });
      }
    });
    const buildLangPicker = langPickerCtrl.build;
    const updateLangLabel = langPickerCtrl.updateLabel;
    const closeLangPicker = langPickerCtrl.close;
    const positionLangPicker = langPickerCtrl.position;
    async function bg(type, payload = {}) {
      try {
        const res = await chrome.runtime.sendMessage({ target: "background", type, ...payload });
        return res && typeof res.ok !== "undefined" ? res : { ok: true, ...res };
      } catch (err) {
        return { ok: false, error: err.message || "\u540E\u53F0\u901A\u4FE1\u5F02\u5E38" };
      }
    }
    const videoClock = createVideoClock({
      send: (sample) => {
        void bg("VIDEO_CLOCK", sample);
      },
      isActive: () => {
        const state = session.state;
        if (session.isDemoMode) return false;
        return state === "starting" || state === "running" || state === "stopping";
      }
    });
    onAfterSeek(() => videoClock.sample(true));
    function adoptBackgroundSession(incoming) {
      session = {
        ...incoming,
        sourceLang: incoming.sourceLang || "auto",
        targetLang: incoming.targetLang || "zh",
        // Notes are local to the content surface and are not part of the
        // background session snapshot.
        notes: session.notes,
        activeNoteId: session.activeNoteId,
        isDemoMode: session.isDemoMode,
        agentSessionId: incoming.agentSessionId ?? null
      };
      if (!Array.isArray(session.messages)) session.messages = [];
      render();
      videoClock.sync();
    }
    let sessionSyncSerial = 0;
    async function syncSessionFromBackground() {
      const serial = ++sessionSyncSerial;
      const res = await bg("GET_SESSION");
      if (serial !== sessionSyncSerial || !res.ok || !res.session) return false;
      adoptBackgroundSession(res.session);
      return true;
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
        shotModal
      },
      bg,
      toast,
      closeImagePanel: () => closeImagePanel(),
      closeShotPreview: () => closeShotPreview()
    });
    const openSettings = settingsPanel.openSettings;
    const screenToggle = bindScreenCaptionToggle({
      button: screenBtn,
      getSession: () => session,
      bg,
      toast,
      adoptSession: (next) => adoptBackgroundSession(next),
      openSettings
    });
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
        chatEl
      },
      getSession: () => session,
      isUiHidden: () => uiHidden,
      applyUiHidden,
      updateLangLabel,
      renderNotes: () => renderNotes(),
      openShotPreview: (url, saved, insertable) => openShotPreview(url, saved, insertable)
    });
    const renderBase = subtitleView.render;
    const render = () => {
      renderBase();
      screenToggle.sync();
    };
    const updateChat = subtitleView.updateChat;
    const renderStreaming = subtitleView.renderStreaming;
    const clearStreaming = subtitleView.clearStreaming;
    const positionSubBox = subtitleView.positionSubBox;
    const markSubtitleActivity = subtitleView.markSubtitleActivity;
    const wakeSubtitleBox = subtitleView.wakeSubtitleBox;
    const applySubBoxSize = subtitleView.applySubBoxSize;
    const toolbarDrag = createToolbarDrag({
      bar,
      grip: barGrip,
      isLangPickerOpen: langPickerCtrl.isOpen,
      positionLangPicker: langPickerCtrl.position
    });
    const initBarPosition = toolbarDrag.initBarPosition;
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
      ensureToolbarVisible
    });
    const drawerCtrl = createDrawer({
      refs: {
        drawer,
        close: shadow.getElementById("rtts-drawer-close"),
        chatButton: chatBtn,
        notesButton: notesBtn,
        chatTab: drawerTabChat,
        notesTab: drawerTabNotes,
        chatPane: paneChat,
        notesPane: paneNotes,
        chatEditor,
        notesEditor
      },
      setCiteOpen: (open) => setCiteOpen(open),
      renderNotes: () => renderNotes()
    });
    const openDrawer = drawerCtrl.open;
    const closeDrawer = drawerCtrl.close;
    const QQ_GROUP_NUMBER = "545073970";
    const communityBtn = shadow.getElementById("rtts-community-btn");
    const communityQr = shadow.getElementById("rtts-community-qr");
    try {
      communityQr.src = chrome.runtime.getURL("assets/qq-group-qrcode.jpg");
    } catch {
    }
    communityBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(QQ_GROUP_NUMBER);
        toast(`\u7FA4\u53F7\u5DF2\u590D\u5236\uFF1A${QQ_GROUP_NUMBER}`, "ok");
      } catch {
        toast(`\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u52A0\u7FA4\uFF1A${QQ_GROUP_NUMBER}`, "err");
      }
    });
    const chatAttachmentsCtrl = createAttachments({
      container: chatAttachments,
      toast
    });
    let isPreviewingFlag = false;
    const togglePreview = (() => {
      const toggle = createPreviewToggle(chatEditor, chatPreview, mdPreviewBtn, renderMarkdownLite);
      return () => {
        isPreviewingFlag = !isPreviewingFlag;
        toggle();
      };
    })();
    function chatPreviewing() {
      return isPreviewingFlag;
    }
    bindEditorInput(chatEditor, chatPreviewing);
    bindMarkdownToolbar(shadow.getElementById("rtts-chat-toolbar"), chatEditor, chatPreviewing, () => {
      if (chatPreviewing()) togglePreview();
    });
    function getChatText() {
      return getEditorText(chatEditor);
    }
    function clearChatEditor() {
      chatEditor.innerHTML = "";
    }
    let isNotesPreviewing = false;
    const notesPreviewing = () => isNotesPreviewing;
    bindEditorInput(notesEditor, notesPreviewing);
    bindMarkdownToolbar(shadow.getElementById("rtts-notes-toolbar"), notesEditor, notesPreviewing, () => {
      if (isNotesPreviewing) toggleNotesPreview();
    });
    const toggleNotesPreview = createPreviewToggle(notesEditor, notesPreview, notesPreviewBtn, renderMarkdownLite);
    notesEditor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        addQuickNote();
      }
    });
    const citePicker = createCitePicker({
      refs: {
        button: citeBtn,
        popover: citePopover,
        list: citeList,
        empty: citeEmpty,
        close: citeClose,
        editor: chatEditor,
        shadow
      },
      getNotes: () => session.notes,
      hasImage: (url) => chatAttachmentsCtrl.list().includes(url),
      addImage: (url) => chatAttachmentsCtrl.addUrl(url),
      toast
    });
    function setCiteOpen(open) {
      citePicker.setOpen(open);
    }
    const addFiles = chatAttachmentsCtrl.addFiles;
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
      getVideoContext: readVideoContext
    });
    const submitQuestion = ask.submitQuestion;
    const sendQuestion = ask.sendQuestion;
    const companionSessions = createCompanionSessions({
      refs: {
        newTopic: chatNewTopic,
        historyButton: chatHistoryBtn,
        popover: chatHistoryPopover,
        list: chatHistoryList,
        empty: chatHistoryEmpty,
        close: chatHistoryClose
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
      isBusy: ask.isBusy
    });
    drawer.addEventListener("transitionend", () => {
      if (!drawer.classList.contains("open")) companionSessions.close();
    });
    const toolsMenuCtrl = createToolsMenu({ button: moreBtn, menu: toolsMenu, shadow });
    const setMenuOpen = toolsMenuCtrl.setOpen;
    shadow.getElementById("rtts-settings-btn").addEventListener("click", () => {
      openSettings();
    });
    hideBtn.addEventListener("click", () => {
      uiHidden = true;
      autoShowDismissed = true;
      autoShown = false;
      stopAutoHideWatch();
      persistUiHidden();
      applyUiHidden();
      toast("\u5DE5\u5177\u5DF2\u5173\u95ED", "ok");
    });
    showBtn.addEventListener("click", () => {
      uiHidden = false;
      autoShowDismissed = false;
      autoShown = false;
      stopAutoHideWatch();
      hasBeenShownOnce = true;
      persistUiHidden();
      applyUiHidden();
      render();
    });
    window.addEventListener("message", (e) => {
      if (!isLiveInstance()) return;
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
      if (!isLiveInstance()) return;
      if (!document.fullscreenElement) {
        fsWarn.classList.add("hidden");
        setTimeout(positionSubBox, 300);
      }
    });
    const notesCtrl = createNotes({
      refs: {
        count: notesCount,
        badge: notesBadge,
        button: notesBtn,
        list: notesList
      },
      getSession: () => session,
      openShotPreview: (url, saved, insertable) => openShotPreview(url, saved, insertable)
    });
    const addNoteEntry = notesCtrl.addEntry;
    function renderNotes() {
      notesCtrl.render();
    }
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
        openOriginal: imgOpen
      },
      getSession: () => session,
      bg,
      addNoteEntry,
      addImage: (url) => chatAttachmentsCtrl.addUrl(url),
      openDrawer,
      submitQuestion,
      toast
    });
    function openImagePanel(prompt) {
      imageGen.open(prompt);
    }
    function closeImagePanel() {
      imageGen.close();
    }
    const { captureVideoFrame } = createScreenshotCapturer({
      host,
      capture: () => bg("CAPTURE_SCREENSHOT")
    });
    const shotPreview = createShotPreview({
      refs: {
        modal: shotModal,
        image: shotImg,
        close: shotClose,
        closeX: shotCloseX,
        download: shotDownload,
        save: shotSave,
        insert: shotInsert
      },
      addNoteEntry,
      addImage: (url) => chatAttachmentsCtrl.addUrl(url),
      openDrawer,
      toast
    });
    function openShotPreview(dataUrl, saved, insertable = false) {
      shotPreview.open(dataUrl, saved, insertable);
    }
    function closeShotPreview() {
      shotPreview.close();
    }
    bindActions({
      refs: {
        copy: copyBtn,
        exportTxt: exportTxtBtn,
        exportMd: exportMdBtn,
        note: noteBtn,
        summary: summaryBtn,
        image: imageBtn,
        screenshot: screenshotBtn
      },
      getSession: () => session,
      getTranscript: async () => {
        const res = await bg("GET_TRANSCRIPT");
        return Array.isArray(res?.subtitles) ? res.subtitles : [];
      },
      toast,
      flashChip,
      addNoteEntry,
      openImagePanel,
      captureVideoFrame,
      openShotPreview,
      summarize: () => {
        const video = readVideoContext();
        return bg("SUMMARIZE", {
          videoKey: video.videoKey,
          videoTitle: video.videoTitle,
          videoUrl: video.videoUrl
        });
      },
      openNotes: () => openDrawer("notes")
    });
    document.addEventListener("keydown", (e) => {
      if (!isLiveInstance()) return;
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      if (!citePopover.hidden) {
        setCiteOpen(false);
        return;
      }
      if (companionSessions.isOpen()) {
        companionSessions.close();
        return;
      }
      if (drawerCtrl.isOpen()) closeDrawer();
    });
    shadow.getElementById("rtts-tab-notes").addEventListener("click", () => {
      companionSessions.close();
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
    bindObsidianExport({
      button: obsidianBtn,
      getSession: () => session,
      bg,
      toast,
      flashChip,
      openSettings,
      focusObsidianKey: () => settingsPanel.focusObsidianKey()
    });
    document.addEventListener("visibilitychange", () => {
      if (!isLiveInstance()) return;
      if (document.visibilityState === "visible") {
        syncSessionFromBackground().catch(() => {
        });
      }
    });
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!isLiveInstance()) return;
      if (msg && msg.type === "TOGGLE_TOOLBAR") {
        hasBeenShownOnce = true;
        if (uiHidden) {
          uiHidden = false;
          autoShowDismissed = false;
          autoShown = false;
          stopAutoHideWatch();
          persistUiHidden();
          applyUiHidden();
          render();
          wakeSubtitleBox();
          if (session.state === "idle" && session.subtitles.length === 0) {
            subPlaceholder.textContent = "\u70B9\u51FB\u300C\u5F55\u97F3\u300D\u5F00\u59CB\u5B9E\u65F6\u8F6C\u5199";
          }
        } else {
          uiHidden = true;
          autoShowDismissed = true;
          autoShown = false;
          stopAutoHideWatch();
          persistUiHidden();
          applyUiHidden();
        }
        sendResponse?.({ ok: true });
        return;
      }
      if (msg && msg.type === "OPEN_PAGE_SETTINGS") {
        openSettings();
        sendResponse?.({ ok: true });
        return;
      }
      if (msg && msg.type === "SEEK_VIDEO") {
        const result = seekTo(msg.seconds);
        sendResponse?.({ ok: true, seek: result });
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
    window[INSTALL_MARKER_KEY] = createContentInstallMarker();
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (!isLiveInstance()) return;
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
      for (const type of ["loadedmetadata", "canplay", "play"]) {
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
      console.log("[snooper-browser] content script loaded (extension context unavailable)");
    }
  })();
})();
