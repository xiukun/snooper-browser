/**
 * Safe-subset Markdown renderer for chat bubbles and note previews.
 *
 * Escapes first, then applies a whitelist of transformations. No raw HTML
 * from the model ever reaches the DOM.
 */

export function renderMarkdownLite(text: string): string {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // Protect code from bold/italic/link substitutions.
  const codeBlocks: string[] = []
  let html = escaped.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const body = code.replace(/^\n+|\n+$/g, '')
    codeBlocks.push(`<pre><code>${body}</code></pre>`)
    return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`
  })

  const inlineCodes: string[] = []
  html = html.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCodes.push(`<code>${code}</code>`)
    return `\u0000INLINECODE${inlineCodes.length - 1}\u0000`
  })

  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\n/g, '<br>')

  inlineCodes.forEach((code, index) => {
    html = html.replace(`\u0000INLINECODE${index}\u0000`, code)
  })
  codeBlocks.forEach((block, index) => {
    html = html.replace(`\u0000CODEBLOCK${index}\u0000`, block)
  })
  return html
}
