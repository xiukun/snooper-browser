/**
 * ADR-036 markdown evidence-stamp tests.
 *
 * `renderMarkdownLite` escapes first, then whitelists transformations; the
 * `[mm:ss]` rule must only fire on the strict stamp grammar and must never
 * reach inside code spans/blocks or markdown links.
 *
 *   node scripts/test-markdown.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-markdown-'))
const out = join(outDir, 'markdown.mjs')

try {
  execSync(
    `npx esbuild src/ext/content/markdown.ts --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const { renderMarkdownLite } = await import(pathToFileURL(out).href)

  let passed = 0
  let failed = 0
  const check = (name, actual, expected) => {
    if (actual === expected) {
      passed += 1
    } else {
      failed += 1
      console.error(`  ✗ ${name}\n    expected: ${expected}\n    actual:   ${actual}`)
    }
  }
  const has = (name, html, needle, want = true) => {
    check(name, html.includes(needle), want)
  }

  /* ---------- Absolute stamps become buttons ---------- */

  const mmss = renderMarkdownLite('见 [12:35] 处')
  has('mm:ss renders a seek button', mmss, '<button type="button" class="chat-time-ref" data-t="755">12:35</button>')

  const hms = renderMarkdownLite('在 [1:02:03] 提到')
  has('h:mm:ss renders a seek button', hms, 'data-t="3723"')

  const zero = renderMarkdownLite('开头 [00:00]')
  has('00:00 renders a seek button', zero, 'data-t="0"')

  /* ---------- Offset and prose brackets stay text ---------- */

  const offset = renderMarkdownLite('开场 [+00:07] 时')
  has('offset stamp stays plain text', offset, 'chat-time-ref', false)
  has('offset stamp content preserved', offset, '[+00:07]')

  const prose = renderMarkdownLite('见 [附录] 一节')
  has('prose brackets stay text', prose, 'chat-time-ref', false)
  has('prose brackets preserved', prose, '[附录]')

  /* ---------- Code protection ---------- */

  const inline = renderMarkdownLite('代码 `[12:35]` 保持原样')
  has('inline code has no button', inline, 'chat-time-ref', false)
  has('inline code keeps the stamp', inline, '<code>[12:35]</code>')

  const block = renderMarkdownLite('```\n[12:35]\n```')
  has('code block has no button', block, 'chat-time-ref', false)

  /* ---------- Markdown links win over stamps ---------- */

  const link = renderMarkdownLite('[01:35](https://example.com/x)')
  has('link label is not a seek button', link, 'chat-time-ref', false)
  has('link renders as an anchor', link, '<a href="https://example.com/x"')

  /* ---------- Escaping still first ---------- */

  const escaped = renderMarkdownLite('<img src=x onerror=alert(1)> [01:00]')
  has('raw html stays escaped', escaped, '&lt;img', true)
  has('stamp still works after escaping', escaped, 'chat-time-ref', true)

  console.log(`markdown: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
