/**
 * Shared contenteditable editor plumbing for the chat composer and the notes
 * composer: placeholder cleanup, IME-safe input binding, Markdown toolbar
 * shortcuts, and preview toggling.
 */

export function getEditorText(editor: HTMLElement): string {
  const raw = (editor.innerText || editor.textContent || '').replace(/\u00a0/g, ' ')
  return raw.replace(/\n{3,}/g, '\n\n').trim()
}

// contenteditable="plaintext-only" can leave a lone <br> after the user
// deletes everything; clear it so the CSS :empty placeholder comes back.
export function refreshEditorPlaceholder(editor: HTMLElement, previewing: boolean) {
  if (previewing) return
  if (!(editor.textContent || '').trim() && !editor.querySelector('img')) {
    editor.innerHTML = ''
  }
}

// Never rewrite the node while an IME composition is active: clearing the
// DOM mid-composition dismisses the Chinese/Japanese candidate window.
export function bindEditorInput(editor: HTMLElement, isPreviewingFn: () => boolean) {
  let composing = false
  editor.addEventListener('compositionstart', () => { composing = true })
  editor.addEventListener('compositionend', () => {
    composing = false
    refreshEditorPlaceholder(editor, isPreviewingFn())
  })
  editor.addEventListener('input', (e) => {
    if (composing || (e as InputEvent).isComposing) return
    refreshEditorPlaceholder(editor, isPreviewingFn())
  })
}

export function insertMarkdown(
  editor: HTMLElement,
  prefix: string,
  suffix: string,
  placeholder: string,
  isPreviewingFn: () => boolean,
) {
  editor.focus()
  const selection = window.getSelection()
  let selected = ''
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    if (editor.contains(range.commonAncestorContainer)) {
      selected = range.toString()
    }
  }
  document.execCommand('insertText', false, prefix + (selected || placeholder) + suffix)
  refreshEditorPlaceholder(editor, isPreviewingFn())
}

export function bindMarkdownToolbar(
  toolbar: ParentNode,
  editor: HTMLElement,
  isPreviewingFn: () => boolean,
  leavePreview: () => void,
) {
  toolbar.querySelectorAll('[data-md]').forEach((button) => {
    button.addEventListener('click', () => {
      // Formatting a hidden editor is a no-op: leave preview first.
      if (isPreviewingFn()) leavePreview()
      const kind = (button as HTMLElement).dataset.md
      if (kind === 'bold') insertMarkdown(editor, '**', '**', '加粗文字', isPreviewingFn)
      else if (kind === 'italic') insertMarkdown(editor, '*', '*', '斜体文字', isPreviewingFn)
      else if (kind === 'code') insertMarkdown(editor, '`', '`', '代码', isPreviewingFn)
      else if (kind === 'link') insertMarkdown(editor, '[', '](https://)', '链接文字', isPreviewingFn)
    })
  })

  editor.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'i')) {
      e.preventDefault()
      if (e.key === 'b') insertMarkdown(editor, '**', '**', '加粗文字', isPreviewingFn)
      else insertMarkdown(editor, '*', '*', '斜体文字', isPreviewingFn)
    }
  })
}

/** Wire a preview toggle button to an editor + preview pair. */
export function createPreviewToggle(
  editor: HTMLElement,
  preview: HTMLElement,
  button: HTMLButtonElement,
  render: (text: string) => string,
): () => boolean {
  let previewing = false
  const toggle = () => {
    previewing = !previewing
    button.classList.toggle('active', previewing)
    if (previewing) {
      const text = getEditorText(editor)
      preview.innerHTML = text ? render(text) : '<span class="rtts-md-empty">没有可预览的内容</span>'
      preview.hidden = false
      editor.hidden = true
      button.textContent = '编辑'
    } else {
      preview.hidden = true
      editor.hidden = false
      button.textContent = '预览'
      editor.focus()
    }
  }
  button.addEventListener('click', toggle)
  return () => previewing
}
