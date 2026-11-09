/**
 * Every element the content script touches, queried once from the shadow
 * root. The factory keeps the entry file free of a hundred getElementById
 * lines.
 */

export interface ContentRefs {
  bar: HTMLElement
  barGrip: HTMLElement
  recordBtn: HTMLElement
  recordLabelEl: HTMLElement
  moreBtn: HTMLButtonElement
  toolsMenu: HTMLElement
  langBtn: HTMLElement
  langLabel: HTMLElement
  langPicker: HTMLElement
  sourceLangsEl: HTMLElement
  targetLangsEl: HTMLElement
  subBox: HTMLElement
  subHandle: HTMLElement
  subResize: HTMLElement
  subScroll: HTMLElement
  subRows: HTMLElement
  subPlaceholder: HTMLElement
  subStatus: HTMLElement
  copyBtn: HTMLElement
  exportTxtBtn: HTMLElement
  exportMdBtn: HTMLElement
  streamingRow: HTMLElement
  streamingText: HTMLElement
  streamingSource: HTMLElement
  streamingLabel: HTMLElement
  drawer: HTMLElement
  chatEl: HTMLElement
  chatComposer: HTMLElement
  chatEditor: HTMLElement
  chatPreview: HTMLElement
  mdPreviewBtn: HTMLButtonElement
  citeBtn: HTMLButtonElement
  citePopover: HTMLElement
  citeList: HTMLElement
  citeEmpty: HTMLElement
  citeClose: HTMLButtonElement
  notesEditor: HTMLElement
  notesPreview: HTMLElement
  notesPreviewBtn: HTMLButtonElement
  drawerTabChat: HTMLButtonElement
  drawerTabNotes: HTMLButtonElement
  chatNewTopic: HTMLButtonElement
  paneChat: HTMLElement
  paneNotes: HTMLElement
  chatBtn: HTMLElement
  chatAttachBtn: HTMLButtonElement
  chatFile: HTMLInputElement
  chatAttachments: HTMLElement
  sendBtn: HTMLButtonElement
  fsWarn: HTMLElement
  hideBtn: HTMLElement
  showBtn: HTMLElement
  noteBtn: HTMLElement
  imageBtn: HTMLElement
  screenshotBtn: HTMLButtonElement
  notesCount: HTMLElement
  notesBadge: HTMLElement
  notesBtn: HTMLElement
  notesList: HTMLElement
  notesAdd: HTMLElement
  obsidianBtn: HTMLElement
  settingsModal: HTMLElement
  settingsClose: HTMLButtonElement
  cfgBaseUrl: HTMLInputElement
  cfgApiKey: HTMLInputElement
  cfgToggleKey: HTMLButtonElement
  cfgLlm: HTMLInputElement
  cfgAudio: HTMLInputElement
  cfgImage: HTMLInputElement
  cfgStatus: HTMLElement
  cfgTest: HTMLButtonElement
  cfgSave: HTMLButtonElement
  cfgCancel: HTMLButtonElement
  cfgObProtocol: HTMLSelectElement
  cfgObPort: HTMLInputElement
  cfgObKey: HTMLInputElement
  cfgObFolder: HTMLInputElement
  cfgObTest: HTMLButtonElement
  cfgObStatus: HTMLElement
  shotModal: HTMLElement
  shotImg: HTMLImageElement
  shotClose: HTMLButtonElement
  shotCloseX: HTMLButtonElement
  shotDownload: HTMLButtonElement
  shotSave: HTMLButtonElement
  shotInsert: HTMLButtonElement
  imageModal: HTMLElement
  imgClose: HTMLButtonElement
  imgPrompt: HTMLTextAreaElement
  imgSize: HTMLSelectElement
  imgNeg: HTMLInputElement
  imgGenerate: HTMLButtonElement
  imgStatus: HTMLElement
  imgResult: HTMLElement
  imgResultFrame: HTMLElement
  imgOpen: HTMLAnchorElement
  imgActions: HTMLElement
  imgFun: HTMLElement
  imgSave: HTMLButtonElement
  imgInsert: HTMLButtonElement
  imgDownload: HTMLButtonElement
  toasts: HTMLElement
}

export function collectRefs(shadow: ShadowRoot): ContentRefs {
  return {
    bar: shadow.getElementById('rtts-bar') as ContentRefs['bar'],
    barGrip: shadow.getElementById('rtts-bar-grip') as ContentRefs['barGrip'],
    recordBtn: shadow.getElementById('rtts-record') as ContentRefs['recordBtn'],
    recordLabelEl: shadow.getElementById('rtts-record-label') as ContentRefs['recordLabelEl'],
    moreBtn: shadow.getElementById('rtts-more-btn') as ContentRefs['moreBtn'],
    toolsMenu: shadow.getElementById('rtts-menu') as ContentRefs['toolsMenu'],
    langBtn: shadow.getElementById('rtts-lang-btn') as ContentRefs['langBtn'],
    langLabel: shadow.getElementById('rtts-lang-label') as ContentRefs['langLabel'],
    langPicker: shadow.getElementById('rtts-lang-picker') as ContentRefs['langPicker'],
    sourceLangsEl: shadow.getElementById('rtts-source-langs') as ContentRefs['sourceLangsEl'],
    targetLangsEl: shadow.getElementById('rtts-target-langs') as ContentRefs['targetLangsEl'],
    subBox: shadow.getElementById('rtts-sub-box') as ContentRefs['subBox'],
    subHandle: shadow.getElementById('rtts-sub-handle') as ContentRefs['subHandle'],
    subResize: shadow.getElementById('rtts-sub-resize') as ContentRefs['subResize'],
    subScroll: shadow.getElementById('rtts-sub-scroll') as ContentRefs['subScroll'],
    subRows: shadow.getElementById('rtts-sub-rows') as ContentRefs['subRows'],
    subPlaceholder: shadow.getElementById('rtts-sub-placeholder') as ContentRefs['subPlaceholder'],
    subStatus: shadow.getElementById('rtts-sub-status') as ContentRefs['subStatus'],
    copyBtn: shadow.getElementById('rtts-copy-btn') as ContentRefs['copyBtn'],
    exportTxtBtn: shadow.getElementById('rtts-export-txt-btn') as ContentRefs['exportTxtBtn'],
    exportMdBtn: shadow.getElementById('rtts-export-md-btn') as ContentRefs['exportMdBtn'],
    streamingRow: shadow.getElementById('rtts-streaming-row') as ContentRefs['streamingRow'],
    streamingText: shadow.getElementById('rtts-streaming-text') as ContentRefs['streamingText'],
    streamingSource: shadow.getElementById('rtts-streaming-source') as ContentRefs['streamingSource'],
    streamingLabel: shadow.getElementById('rtts-streaming-label') as ContentRefs['streamingLabel'],
    drawer: shadow.getElementById('rtts-drawer') as ContentRefs['drawer'],
    chatEl: shadow.getElementById('rtts-chat') as ContentRefs['chatEl'],
    chatComposer: shadow.getElementById('rtts-chat-composer') as ContentRefs['chatComposer'],
    chatEditor: shadow.getElementById('rtts-chat-editor') as ContentRefs['chatEditor'],
    chatPreview: shadow.getElementById('rtts-chat-preview') as ContentRefs['chatPreview'],
    mdPreviewBtn: shadow.getElementById('rtts-md-preview-btn') as ContentRefs['mdPreviewBtn'],
    citeBtn: shadow.getElementById('rtts-cite-btn') as ContentRefs['citeBtn'],
    citePopover: shadow.getElementById('rtts-cite-popover') as ContentRefs['citePopover'],
    citeList: shadow.getElementById('rtts-cite-list') as ContentRefs['citeList'],
    citeEmpty: shadow.getElementById('rtts-cite-empty') as ContentRefs['citeEmpty'],
    citeClose: shadow.getElementById('rtts-cite-close') as ContentRefs['citeClose'],
    notesEditor: shadow.getElementById('rtts-notes-editor') as ContentRefs['notesEditor'],
    notesPreview: shadow.getElementById('rtts-notes-preview') as ContentRefs['notesPreview'],
    notesPreviewBtn: shadow.getElementById('rtts-notes-preview-btn') as ContentRefs['notesPreviewBtn'],
    drawerTabChat: shadow.getElementById('rtts-tab-chat') as ContentRefs['drawerTabChat'],
    drawerTabNotes: shadow.getElementById('rtts-tab-notes') as ContentRefs['drawerTabNotes'],
    chatNewTopic: shadow.getElementById('rtts-chat-new-topic') as ContentRefs['chatNewTopic'],
    paneChat: shadow.getElementById('rtts-pane-chat') as ContentRefs['paneChat'],
    paneNotes: shadow.getElementById('rtts-pane-notes') as ContentRefs['paneNotes'],
    chatBtn: shadow.getElementById('rtts-chat-btn') as ContentRefs['chatBtn'],
    chatAttachBtn: shadow.getElementById('rtts-chat-attach-btn') as ContentRefs['chatAttachBtn'],
    chatFile: shadow.getElementById('rtts-chat-file') as ContentRefs['chatFile'],
    chatAttachments: shadow.getElementById('rtts-chat-attachments') as ContentRefs['chatAttachments'],
    sendBtn: shadow.getElementById('rtts-send') as ContentRefs['sendBtn'],
    fsWarn: shadow.getElementById('rtts-fs-warn') as ContentRefs['fsWarn'],
    hideBtn: shadow.getElementById('rtts-hide-btn') as ContentRefs['hideBtn'],
    showBtn: shadow.getElementById('rtts-show-btn') as ContentRefs['showBtn'],
    noteBtn: shadow.getElementById('rtts-note-btn') as ContentRefs['noteBtn'],
    imageBtn: shadow.getElementById('rtts-image-btn') as ContentRefs['imageBtn'],
    screenshotBtn: shadow.getElementById('rtts-screenshot-btn') as ContentRefs['screenshotBtn'],
    notesCount: shadow.getElementById('rtts-notes-count') as ContentRefs['notesCount'],
    notesBadge: shadow.getElementById('rtts-notes-badge') as ContentRefs['notesBadge'],
    notesBtn: shadow.getElementById('rtts-notes-btn') as ContentRefs['notesBtn'],
    notesList: shadow.getElementById('rtts-notes-list') as ContentRefs['notesList'],
    notesAdd: shadow.getElementById('rtts-notes-add') as ContentRefs['notesAdd'],
    obsidianBtn: shadow.getElementById('rtts-obsidian-btn') as ContentRefs['obsidianBtn'],
    settingsModal: shadow.getElementById('rtts-settings-modal') as ContentRefs['settingsModal'],
    settingsClose: shadow.getElementById('rtts-settings-close') as ContentRefs['settingsClose'],
    cfgBaseUrl: shadow.getElementById('rtts-cfg-baseurl') as ContentRefs['cfgBaseUrl'],
    cfgApiKey: shadow.getElementById('rtts-cfg-apikey') as ContentRefs['cfgApiKey'],
    cfgToggleKey: shadow.getElementById('rtts-cfg-toggle-key') as ContentRefs['cfgToggleKey'],
    cfgLlm: shadow.getElementById('rtts-cfg-llm') as ContentRefs['cfgLlm'],
    cfgAudio: shadow.getElementById('rtts-cfg-audio') as ContentRefs['cfgAudio'],
    cfgImage: shadow.getElementById('rtts-cfg-image') as ContentRefs['cfgImage'],
    cfgStatus: shadow.getElementById('rtts-cfg-status') as ContentRefs['cfgStatus'],
    cfgTest: shadow.getElementById('rtts-cfg-test') as ContentRefs['cfgTest'],
    cfgSave: shadow.getElementById('rtts-cfg-save') as ContentRefs['cfgSave'],
    cfgCancel: shadow.getElementById('rtts-cfg-cancel') as ContentRefs['cfgCancel'],
    cfgObProtocol: shadow.getElementById('rtts-cfg-ob-protocol') as ContentRefs['cfgObProtocol'],
    cfgObPort: shadow.getElementById('rtts-cfg-ob-port') as ContentRefs['cfgObPort'],
    cfgObKey: shadow.getElementById('rtts-cfg-ob-key') as ContentRefs['cfgObKey'],
    cfgObFolder: shadow.getElementById('rtts-cfg-ob-folder') as ContentRefs['cfgObFolder'],
    cfgObTest: shadow.getElementById('rtts-cfg-ob-test') as ContentRefs['cfgObTest'],
    cfgObStatus: shadow.getElementById('rtts-cfg-ob-status') as ContentRefs['cfgObStatus'],
    shotModal: shadow.getElementById('rtts-shot-modal') as ContentRefs['shotModal'],
    shotImg: shadow.getElementById('rtts-shot-img') as ContentRefs['shotImg'],
    shotClose: shadow.getElementById('rtts-shot-close') as ContentRefs['shotClose'],
    shotCloseX: shadow.getElementById('rtts-shot-close-x') as ContentRefs['shotCloseX'],
    shotDownload: shadow.getElementById('rtts-shot-download') as ContentRefs['shotDownload'],
    shotSave: shadow.getElementById('rtts-shot-save') as ContentRefs['shotSave'],
    shotInsert: shadow.getElementById('rtts-shot-insert') as ContentRefs['shotInsert'],
    imageModal: shadow.getElementById('rtts-image-modal') as ContentRefs['imageModal'],
    imgClose: shadow.getElementById('rtts-img-close') as ContentRefs['imgClose'],
    imgPrompt: shadow.getElementById('rtts-img-prompt') as ContentRefs['imgPrompt'],
    imgSize: shadow.getElementById('rtts-img-size') as ContentRefs['imgSize'],
    imgNeg: shadow.getElementById('rtts-img-neg') as ContentRefs['imgNeg'],
    imgGenerate: shadow.getElementById('rtts-img-generate') as ContentRefs['imgGenerate'],
    imgStatus: shadow.getElementById('rtts-img-status') as ContentRefs['imgStatus'],
    imgResult: shadow.getElementById('rtts-img-result') as ContentRefs['imgResult'],
    imgResultFrame: shadow.getElementById('rtts-img-result-frame') as ContentRefs['imgResultFrame'],
    imgOpen: shadow.getElementById('rtts-img-open') as ContentRefs['imgOpen'],
    imgActions: shadow.getElementById('rtts-img-actions') as ContentRefs['imgActions'],
    imgFun: shadow.getElementById('rtts-img-fun') as ContentRefs['imgFun'],
    imgSave: shadow.getElementById('rtts-img-save') as ContentRefs['imgSave'],
    imgInsert: shadow.getElementById('rtts-img-insert') as ContentRefs['imgInsert'],
    imgDownload: shadow.getElementById('rtts-img-download') as ContentRefs['imgDownload'],
    toasts: shadow.getElementById('rtts-toasts') as ContentRefs['toasts'],
  }
}
