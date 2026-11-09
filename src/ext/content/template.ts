/** Shadow-DOM markup: toolbar, subtitle overlay, drawer, settings/image/shot modals, toasts. */

export const CONTENT_HTML = `
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

      <!-- Community: hover shows the QQ group QR code for scanning -->
      <div class="rtts-community">
        <button id="rtts-community-btn" class="rtts-btn" data-tip="加入交流群" aria-label="加入 QQ 交流群" aria-haspopup="true">
          <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </button>
        <figure class="rtts-community-pop" role="img" aria-label="QQ 群二维码：snooper 实时翻译交流群，群号 545073970">
          <img id="rtts-community-qr" alt="" />
          <figcaption>QQ 群：545073970<small>鼠标停留扫码，点击复制群号</small></figcaption>
        </figure>
      </div>

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
      <div id="rtts-sub-status" class="hidden" aria-live="polite">视频已暂停或静音 · 等待音频</div>
      <div id="rtts-sub-resize" role="separator" tabindex="0" aria-label="调整字幕面板大小，方向键微调" title="拖动调整大小"></div>
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
        <div id="rtts-drawer-actions">
          <button id="rtts-chat-history" class="rtts-drawer-newtopic" type="button" title="查看这个视频的历史会话" aria-label="查看历史会话" aria-haspopup="dialog" aria-expanded="false">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            历史
          </button>
          <button id="rtts-chat-new-topic" class="rtts-drawer-newtopic" type="button" title="开始新话题（新建空白会话）" aria-label="开始新话题">
            <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新话题
          </button>
          <button id="rtts-drawer-close" aria-label="关闭"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </div>

      <div id="rtts-pane-chat" class="rtts-pane active" role="tabpanel" aria-label="AI 伴学">
        <div id="rtts-chat"></div>

        <div id="rtts-history-popover" class="rtts-history-popover" hidden role="dialog" aria-label="历史会话">
          <div class="rtts-history-head">
            <span>历史会话</span>
            <button id="rtts-history-close" type="button" aria-label="关闭">✕</button>
          </div>
          <div id="rtts-history-list" class="rtts-history-list"></div>
          <div id="rtts-history-empty" class="rtts-history-empty" hidden>这个视频还没有历史会话</div>
        </div>

        <div id="rtts-chat-composer">
          <div id="rtts-chat-attachments" aria-live="polite"></div>

          <div class="rtts-md-shell">
            <div class="rtts-md-toolbar" id="rtts-chat-toolbar" role="toolbar" aria-label="Markdown 快捷操作">
              <button type="button" data-md="bold" title="加粗（Ctrl/⌘+B）" aria-label="加粗"><b>B</b></button>
              <button type="button" data-md="italic" title="斜体（Ctrl/⌘+I）" aria-label="斜体"><i>I</i></button>
              <button type="button" data-md="code" title="行内代码" aria-label="行内代码"><span>&lt;/&gt;</span></button>
              <button type="button" data-md="link" title="链接" aria-label="插入链接">🔗</button>
              <button type="button" id="rtts-cite-btn" class="rtts-md-cite rtts-md-tail" title="引用笔记里的截图" aria-label="引用笔记里的截图" aria-haspopup="dialog" aria-expanded="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                <span>引用</span>
              </button>
              <button type="button" id="rtts-md-preview-btn" title="预览 Markdown">预览</button>
            </div>

            <!-- Attach, input and send share one row: the upload control is part
                 of the input, not a separate toolbar underneath it. -->
            <div id="rtts-chat-input-row">
              <button id="rtts-chat-attach-btn" type="button" aria-label="上传图片" title="上传图片">
                <svg viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <div id="rtts-chat-editor" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="提问" data-placeholder="问点什么，支持 Markdown…"></div>
              <div id="rtts-chat-preview" class="rtts-md-preview" hidden></div>
              <button id="rtts-send" type="button">发送</button>
            </div>
          </div>

          <div id="rtts-cite-popover" class="rtts-cite-popover" hidden role="dialog" aria-label="引用笔记截图">
            <div class="rtts-cite-head">
              <span>引用笔记截图</span>
              <button id="rtts-cite-close" type="button" aria-label="关闭">✕</button>
            </div>
            <div id="rtts-cite-list" class="rtts-cite-list"></div>
            <div id="rtts-cite-empty" class="rtts-cite-empty">还没有截图。先用工具栏的「页面截图」或「记入笔记」存一张。</div>
          </div>

          <input id="rtts-chat-file" type="file" accept="image/*" multiple hidden>
        </div>
      </div>

      <div id="rtts-pane-notes" class="rtts-pane" role="tabpanel" aria-label="笔记">
        <div id="rtts-notes-list"></div>

        <div class="rtts-md-shell" id="rtts-notes-shell">
          <div class="rtts-md-toolbar" id="rtts-notes-toolbar" role="toolbar" aria-label="笔记 Markdown 快捷操作">
            <button type="button" data-md="bold" title="加粗（Ctrl/⌘+B）" aria-label="加粗"><b>B</b></button>
            <button type="button" data-md="italic" title="斜体（Ctrl/⌘+I）" aria-label="斜体"><i>I</i></button>
            <button type="button" data-md="code" title="行内代码" aria-label="行内代码"><span>&lt;/&gt;</span></button>
            <button type="button" data-md="link" title="链接" aria-label="插入链接">🔗</button>
            <button type="button" id="rtts-notes-preview-btn" class="rtts-md-tail" title="预览 Markdown">预览</button>
          </div>
          <div id="rtts-notes-row">
            <div id="rtts-notes-editor" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="新笔记" data-placeholder="记一条笔记，支持 Markdown…"></div>
            <div id="rtts-notes-preview" class="rtts-md-preview" hidden></div>
            <button id="rtts-notes-add" type="button" title="添加笔记（Ctrl/⌘+Enter）">添加</button>
          </div>
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

    <!-- In-page image generation.
         No fullscreen mask: the user is watching a video, so the panel is a
         corner overlay (top-right) that must never darken or blur the page.
         Clicks outside the panel close it. -->
    <div id="rtts-image-modal" class="rtts-float-layer">
      <div class="rtts-modal rtts-image-panel" role="dialog" aria-label="生成配图">
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
            <!-- Generated images render inside an extension-origin iframe
                 (image-viewer.html): the host page's CSP img-src can forbid
                 data: and third-party CDN images, which left the panel blank
                 even though generation succeeded. -->
            <div id="rtts-img-result-frame" class="rtts-image-frame"></div>
            <a id="rtts-img-open" class="rtts-image-open" target="_blank" rel="noopener noreferrer" hidden>当前页面无法加载，打开原图</a>
          </div>
          <div id="rtts-img-fun" class="rtts-image-fun" role="group" aria-label="图片娱乐互动">
            <button type="button" data-fun="roast">吐槽这张图</button>
            <button type="button" data-fun="continue">续写剧情</button>
            <button type="button" data-fun="line">配一句台词</button>
          </div>
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-img-generate" class="rtts-btn-primary" type="button">
            <svg viewBox="0 0 24 24"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>
            <span>生成图片</span>
          </button>
          <div id="rtts-img-actions" class="rtts-image-actions">
            <button id="rtts-img-insert" class="rtts-btn-ghost" type="button">插入伴学</button>
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
            <h3>截图预览</h3>
            <p class="sub">优先裁到视频区域；找不到视频时保留整页，可存入笔记或插入伴学</p>
          </div>
          <button id="rtts-shot-close-x" class="rtts-modal-close" type="button" aria-label="关闭"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="rtts-modal-body rtts-shot-body">
          <img id="rtts-shot-img" alt="视频截图预览">
        </div>
        <div class="rtts-modal-footer">
          <button id="rtts-shot-download" class="rtts-btn-ghost" type="button">下载图片</button>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button id="rtts-shot-insert" class="rtts-btn-ghost" type="button">插入伴学</button>
            <button id="rtts-shot-close" class="rtts-btn-ghost" type="button">关闭</button>
            <button id="rtts-shot-save" class="rtts-btn-primary" type="button">存入笔记</button>
          </div>
        </div>
      </div>
    </div>

    <div id="rtts-toasts" aria-live="polite"></div>
  `;
