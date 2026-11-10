/** Shadow-DOM CSS: host, toolbar, community pop, tools menu, language picker, subtitle overlay. */

export const TOOLBAR_CSS = `
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
    /* Shown while the capture is alive but nothing above the gate arrives —
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
