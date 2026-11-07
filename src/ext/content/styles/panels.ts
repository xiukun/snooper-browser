/** Shadow-DOM CSS: drawer, chat, notes, cite popover, modals, toasts, image panel, motion. */

export const PANELS_CSS = `/* === Unified side drawer: chat + notes tabs === */
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
      min-height: 68px; max-height: 160px; overflow-y: auto;
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
