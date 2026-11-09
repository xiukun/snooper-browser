/**
 * Tests for the companion-chat agent: grounded prompt assembly (system role +
 * subtitle digest + explicit question), video-scoped sessions, legacy
 * migration, history selection under a token budget, and gateway shape
 * (single user message, text before images).
 *
 * flattenMessages is bundled from src/lib/moss-messages.ts so the gateway
 * constraints are asserted against the real implementation, not a copy.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-agent-'))
const out = join(outDir, 'agent-bundle.mjs')

/* Minimal chrome.storage mock: the agent persists through it, and the
 * migration test needs to observe the legacy key being removed. */
const localStore = {}
const sessionStore = {}
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return key in localStore ? { [key]: localStore[key] } : {}
      },
      async set(obj) {
        Object.assign(localStore, obj)
      },
      async remove(key) {
        delete localStore[key]
      },
    },
    session: {
      async get(key) {
        return key in sessionStore ? { [key]: sessionStore[key] } : {}
      },
      async set(obj) {
        Object.assign(sessionStore, obj)
      },
      async remove(key) {
        delete sessionStore[key]
      },
    },
  },
}

try {
  execSync(
    `npx esbuild src/ext/background/agent.ts --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  )
  const {
    COMPANION_SYSTEM_PROMPT,
    buildAskParts,
    buildSubtitleDigest,
    deleteSession,
    formatSubtitleOffset,
    listSessions,
    loadAgentStore,
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

  const turn = (role, content, extra = {}) => ({ role, content, at: 0, ...extra })
  const video = (key, title = '') => ({ videoKey: key, videoTitle: title, videoUrl: `https://example.com/${key}` })

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

  /* ---------- subtitle digest ---------- */
  {
    check('offset: zero', formatSubtitleOffset(0), '00:00')
    check('offset: minutes', formatSubtitleOffset(65_000), '01:05')

    const digest = buildSubtitleDigest([
      { at: 1_000, source: '在光影交错的未来' },
      { at: 4_000, source: '在光影交错的未来' },
      { at: 6_000, source: 'AI 不再只是工具' },
      { at: 7_000, source: '[音乐]' },
      { at: 8_000, source: '。。。' },
      { at: 61_000, source: '在光影交错的未来' },
      { at: 62_000, source: '而是你创作的灵感之眼', target: 'and the eye of inspiration' },
    ])
    check('digest: repeated tagline appears once', digest.split('在光影交错的未来').length - 1, 1)
    check('digest: keeps relative timestamp', digest.includes('[+00:00]'), true)
    check('digest: stamps later line', digest.includes('[+01:01]'), true)
    check('digest: drops noise rows', digest.includes('[音乐]') || digest.includes('。。。'), false)
    check('digest: keeps translation pair', digest.includes('而是你创作的灵感之眼 → and the eye of inspiration'), true)
  }

  {
    // 100 unique rows with a 12-line cap: head and tail must both survive.
    const rows = Array.from({ length: 100 }, (_, i) => ({ at: i * 1_000, source: `第 ${i} 条字幕` }))
    const digest = buildSubtitleDigest(rows, { maxLines: 12 })
    const lines = digest.split('\n')
    check('digest: line cap', lines.length <= 12, true)
    check('digest: keeps the opening', lines[0].includes('第 0 条字幕'), true)
    check('digest: keeps the latest moment', lines[lines.length - 1].includes('第 99 条字幕'), true)
  }

  {
    const rows = Array.from({ length: 50 }, (_, i) => ({ at: i * 1_000, source: `${i}` + '长'.repeat(80) }))
    const digest = buildSubtitleDigest(rows, { maxLines: 999, maxChars: 300 })
    check('digest: character cap', digest.length <= 300, true)
    check('digest: cap keeps the latest line', digest.endsWith('长'.repeat(80)), true)
  }

  check('digest: empty input', buildSubtitleDigest([]), '')
  check('digest: noise-only input', buildSubtitleDigest([{ at: 0, source: '[音乐]' }]), '')

  /* ---------- buildAskParts ---------- */
  {
    const parts = buildAskParts({
      history: [turn('user', '之前问过什么'), turn('assistant', '之前的回答')],
      subtitleContext: '[+00:12] 在光影交错的未来',
      question: '总结一下',
      images: ['data:image/png;base64,AAAA'],
      videoTitle: '测试视频',
      videoTime: 65,
    })
    check('parts: one text + one image', parts.length, 2)
    check('parts: text first', parts[0].type, 'text')
    check('parts: image last', parts[1].type, 'image_url')
    const text = parts[0].text
    check('parts: system prompt present', text.includes('【系统指令】'), true)
    check('parts: system role stated', text.includes(COMPANION_SYSTEM_PROMPT.split('\n')[0]), true)
    check('parts: system before dialogue', text.indexOf('【系统指令】') < text.indexOf('【对话记录】'), true)
    check('parts: replayed user turn', text.includes('用户：之前问过什么'), true)
    check('parts: replayed assistant turn', text.includes('助手：之前的回答'), true)
    check('parts: video title', text.includes('【视频】测试视频'), true)
    check('parts: playback position', text.includes('当前播放到 1:05'), true)
    check('parts: subtitle evidence', text.includes('【最近字幕'), true)
    check('parts: question marker', text.includes('【当前问题】\n总结一下'), true)
    check('parts: question comes last', text.lastIndexOf('【当前问题】') > text.indexOf('之前问过什么'), true)
    check('parts: anti-echo instruction', text.includes('不要复述字幕'), true)
  }

  {
    // No history, no images: bare question still carries the system rules.
    const parts = buildAskParts({ history: [], subtitleContext: '', question: '你好', images: [] })
    check('parts: bare question single text', parts.length, 1)
    check('parts: bare question text', parts[0].text.includes('你好'), true)
    check('parts: bare question system', parts[0].text.includes('【系统指令】'), true)
  }

  /* ---------- video-scoped sessions ---------- */
  {
    const store = { activeByVideo: {}, sessions: [] }
    const a1 = await resolveCurrentSession(store, video('youtube:A', '视频 A'))
    check('session: creates first', store.sessions.length, 1)
    check('session: A is active', store.activeByVideo['youtube:A'], a1.id)
    check('session: video metadata stored', a1.videoKey, 'youtube:A')
    check('session: title stored', a1.videoTitle, '视频 A')

    const b1 = await resolveCurrentSession(store, video('youtube:B', '视频 B'))
    check('session: B gets its own session', b1.id === a1.id, false)
    check('session: both videos retained', store.sessions.length, 2)
    check('session: A pointer unchanged', store.activeByVideo['youtube:A'], a1.id)
    check('session: B pointer set', store.activeByVideo['youtube:B'], b1.id)

    const aAgain = await resolveCurrentSession(store, video('youtube:A'))
    check('session: same video reuses session', aAgain.id, a1.id)

    // 新话题 twice without asking must not spray empty sessions.
    const aNew1 = await resolveCurrentSession(store, video('youtube:A'), true)
    check('session: preferNew reuses an empty session', aNew1.id, a1.id)
    check('session: no empty duplicate', store.sessions.length, 2)

    a1.turns.push(turn('user', '问题'), turn('assistant', '回答'))
    a1.updatedAt = Date.now() + 10
    const aNew2 = await resolveCurrentSession(store, video('youtube:A'), true)
    check('session: preferNew creates after a turn', aNew2.id === a1.id, false)
    check('session: new session is active', store.activeByVideo['youtube:A'], aNew2.id)
    check('session: sessions count', store.sessions.length, 3)

    check('session: switch rejects another video', switchSession(store, b1.id, 'youtube:A'), null)
    const switched = switchSession(store, a1.id, 'youtube:A')
    check('session: switch works', switched?.id, a1.id)
    check('session: switch moves pointer', store.activeByVideo['youtube:A'], a1.id)

    const scoped = listSessions(store, 'youtube:A')
    check('session: list is video-scoped', scoped.every((s) => s.videoKey === 'youtube:A'), true)
    check('session: list has both A sessions', scoped.length, 2)
    check('session: list sorted newest first', scoped[0].updatedAt >= scoped[1].updatedAt, true)

    await deleteSession(store, aNew2.id)
    check('session: deleted session removed', store.sessions.some((s) => s.id === aNew2.id), false)
    check('session: deletion re-points to newest remaining', store.activeByVideo['youtube:A'], a1.id)
  }

  {
    // Eviction: 35 turns-bearing sessions, cap 30, active never evicted.
    const store = { activeByVideo: {}, sessions: [] }
    for (let i = 0; i < 35; i++) {
      const session = await resolveCurrentSession(store, video('youtube:evict'))
      session.turns.push(turn('user', `问题 ${i}`), turn('assistant', `回答 ${i}`))
      session.updatedAt = Date.now() + i
    }
    check('session: eviction cap', store.sessions.length <= 30, true)
    const activeId = store.activeByVideo['youtube:evict']
    check('session: active survives eviction', store.sessions.some((s) => s.id === activeId), true)
  }

  /* ---------- legacy v1 migration ---------- */
  {
    localStore['snooper.agent.sessions.v2'] = undefined
    delete localStore['snooper.agent.sessions.v2']
    sessionStore['snooper.agent.sessions.v1'] = {
      currentId: 'legacy1',
      sessions: [
        {
          id: 'legacy1',
          title: '旧会话',
          turns: [
            { role: 'user', content: '旧问题', images: ['data:image/png;base64,AAAA'], at: 1 },
            { role: 'assistant', content: '旧回答', at: 2 },
          ],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    }
    const migrated = await loadAgentStore()
    check('migration: session preserved', migrated.sessions.length, 1)
    check('migration: turns preserved', migrated.sessions[0].turns.length, 2)
    check('migration: image payload stripped', 'images' in migrated.sessions[0].turns[0], false)
    check('migration: image presence kept', migrated.sessions[0].turns[0].hasImages, true)
    check('migration: v2 persisted', Array.isArray(localStore['snooper.agent.sessions.v2']?.sessions), true)
    check('migration: v1 removed', 'snooper.agent.sessions.v1' in sessionStore, false)

    const adopted = await resolveCurrentSession(migrated, video('bilibili:BV1TEST', '旧视频'))
    check('migration: legacy session adopted by first video', adopted.id, 'legacy1')
    check('migration: no duplicate session created', migrated.sessions.length, 1)
    check('migration: adopted session scoped', adopted.videoKey, 'bilibili:BV1TEST')
    check('migration: adopted session active', migrated.activeByVideo['bilibili:BV1TEST'], 'legacy1')
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exit(1)
  }
  console.log(`agent tests passed (${passed} checks)`)
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
