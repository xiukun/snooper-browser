/**
 * Tests for the companion-chat agent: history selection under a token
 * budget, gateway-shaped prompt assembly (single user message, text before
 * images), session eviction, and title assignment.
 *
 * flattenMessages is bundled from src/lib/moss.ts so the gateway constraints
 * are asserted against the real implementation, not a copy.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-agent-'))
const out = join(outDir, 'agent-bundle.mjs')

try {
  execSync(
    // moss.ts reads import.meta.env (Vite); esbuild needs it defined.
    `npx esbuild src/ext/background/agent.ts --bundle --format=esm --define:import.meta.env={} --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const {
    buildAskParts,
    listSessions,
    resolveCurrentSession,
    selectHistoryTurns,
    switchSession,
  } = await import(pathToFileURL(out).href)

  let passed = 0
  const failures = []
  const check = (name, actual, expected) => {
    if (actual === expected) passed++
    else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
  }

  const turn = (role, content) => ({ role, content, at: 0 })

  /* ---------- selectHistoryTurns ---------- */
  {
    const turns = [
      turn('user', '第一轮问题'),
      turn('assistant', '第一轮回答'),
      turn('user', '第二轮问题'),
      turn('assistant', '第二轮回答'),
      turn('user', '当前问题'),
    ]
    const picked = selectHistoryTurns(turns)
    check('history excludes current question', picked.some((t) => t.content === '当前问题'), false)
    check('history keeps recent turns', picked.length, 4)
    check('history chronological', picked[0].content, '第一轮问题')
  }

  {
    // Tiny budget: only the last full pair survives beyond the minimum.
    const turns = []
    for (let i = 0; i < 20; i++) {
      turns.push(turn('user', `问题 ${i} ${'很长的内容'.repeat(50)}`))
      turns.push(turn('assistant', `回答 ${i} ${'很长的回答'.repeat(50)}`))
    }
    turns.push(turn('user', '当前问题'))
    const picked = selectHistoryTurns(turns, 500)
    check('budget: drops old turns', picked.length < 40, true)
    check('budget: keeps newest first', picked[picked.length - 1].content.startsWith('回答 19'), true)
  }

  /* ---------- buildAskParts ---------- */
  {
    const parts = buildAskParts({
      history: [turn('user', '之前问过什么'), turn('assistant', '之前的回答')],
      subtitleContext: '[Hello] → 你好',
      question: '总结一下',
      images: ['data:image/png;base64,AAAA'],
    })
    check('parts: exactly two entries (one text + one image)', parts.length, 2)
    check('parts: text first', parts[0].type, 'text')
    check('parts: image last', parts[1].type, 'image_url')
    const text = parts[0].text
    check('parts: single user message', text.includes('【对话记录】'), true)
    check('parts: replayed user turn', text.includes('用户：之前问过什么'), true)
    check('parts: replayed assistant turn', text.includes('助手：之前的回答'), true)
    check('parts: subtitle context attached', text.includes('[Hello] → 你好'), true)
    check('parts: question attached', text.includes('总结一下'), true)
  }

  {
    // No history, no images: bare question with context.
    const parts = buildAskParts({ history: [], subtitleContext: '', question: '你好', images: [] })
    check('parts: bare question single text', parts.length, 1)
    check('parts: bare question text', parts[0].text.includes('你好'), true)
  }

  /* ---------- session management (in-memory paths) ---------- */
  {
    const store = { currentId: null, sessions: [] }
    const s1 = await resolveCurrentSession(store)
    check('session: creates first', store.sessions.length, 1)
    const s2 = await resolveCurrentSession(store)
    check('session: reuses current', s2.id, s1.id)
    s1.title = '第一个会话'
    const s3 = await resolveCurrentSession(store, true)
    check('session: preferNew creates', store.sessions.length, 2)
    check('session: currentId moves', store.currentId, s3.id)
    check('session: newest first', store.sessions[0].id, s3.id)

    // Eviction: 25 sessions, cap 20, current never evicted.
    for (let i = 0; i < 25; i++) await resolveCurrentSession(store, true)
    check('session: eviction cap', store.sessions.length <= 20, true)
    check('session: current survives eviction', store.sessions.some((s) => s.id === store.currentId), true)

    const list = listSessions(store)
    check('session: list sorted newest first', list[0].updatedAt >= list[list.length - 1].updatedAt, true)

    const target = store.sessions[1]
    const switched = switchSession(store, target.id)
    check('session: switch works', switched.id, target.id)
    check('session: switch moves pointer', store.currentId, target.id)
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`agent tests passed (${passed} checks)`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
