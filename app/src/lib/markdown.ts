import MarkdownIt from 'markdown-it'
import { ref } from 'vue'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

export const markdownReady = ref(false)

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
  highlight(code, lang) {
    if (!highlighter) return ''
    const language = normalizeLang(lang)
    try {
      return highlighter.codeToHtml(code, { lang: language, theme: 'vesper' })
    } catch {
      try {
        return highlighter.codeToHtml(code, { lang: 'text', theme: 'vesper' })
      } catch {
        return ''
      }
    }
  },
})

md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index]?.attrSet('target', '_blank')
  tokens[index]?.attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, index, options)
}

let highlighter: HighlighterCore | null = null
let initPromise: Promise<void> | null = null

const LOADED_LANGS = [
  'typescript',
  'javascript',
  'vue',
  'python',
  'json',
  'bash',
  'html',
  'css',
  'sql',
  'go',
  'rust',
  'markdown',
]

function normalizeLang(lang: string) {
  const map: Record<string, string> = {
    ts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    tsx: 'typescript',
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    md: 'markdown',
    py: 'python',
  }
  const next = map[lang.toLowerCase()] ?? lang.toLowerCase()
  return LOADED_LANGS.includes(next) ? next : 'text'
}

export function initMarkdown(): Promise<void> {
  if (markdownReady.value) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      highlighter = await createHighlighterCore({
        themes: [import('shiki/themes/vesper.mjs')],
        langs: [
          import('shiki/langs/typescript.mjs'),
          import('shiki/langs/javascript.mjs'),
          import('shiki/langs/vue.mjs'),
          import('shiki/langs/python.mjs'),
          import('shiki/langs/json.mjs'),
          import('shiki/langs/bash.mjs'),
          import('shiki/langs/html.mjs'),
          import('shiki/langs/css.mjs'),
          import('shiki/langs/sql.mjs'),
          import('shiki/langs/go.mjs'),
          import('shiki/langs/rust.mjs'),
          import('shiki/langs/markdown.mjs'),
        ],
        engine: createJavaScriptRegexEngine(),
      })
      markdownReady.value = true
    } catch (error) {
      console.warn('[snooper] shiki init failed, falling back to plain code blocks', error)
    }
  })()
  return initPromise
}

export function renderMarkdown(content: string) {
  if (!content) return ''
  try {
    return md.render(content)
  } catch {
    return md.utils.escapeHtml(content)
  }
}
