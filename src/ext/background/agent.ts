/**
 * ConversationAgent — multi-turn memory for the companion chat.
 *
 * Why hand-rolled (decided after evaluating pi-agent / langgraph / ai /
 * mem0 / conversationalist / ctxfit): the MOSS gateway requires exactly one
 * user message per request (AGENTS.md §2.2), so every framework's multi-turn
 * message abstraction must be flattened by us anyway; pi-agent explicitly
 * ships no persistence or compaction ("the consumer owns state.messages");

 * and MV3 service workers sleep, so memory must live in chrome.storage.
 * What remains after subtracting what we must write ourselves is a tool-loop
 * we have no tools for. ~150 lines of pure TS replaces all of it.
 *
 * Model: sessions of turns persisted to chrome.storage.session (survives SW
 * restarts, cleared when the browser closes — right privacy trade-off for a
 * companion chat). Prompt assembly delegates to lib/moss.ts flattenMessages,
 * which is already gateway-correct; this module only decides *which* turns
 * enter the prompt and persists the rest.
 *
 * Known limitation: recordExchange is a read-modify-write without a
 * cross-tab lock. The content script's per-page `busy` flag prevents
 * concurrent submits from one page; simultaneous asks from two different
 * tabs can lose one exchange from replay history (capture still works —
 * only the stored context misses it). Acceptable for a single-user
 * companion chat; revisit only if multi-tab parallel chat becomes a use
 * case.
 */

import { flattenMessages } from '../../lib/moss'

export interface AgentTurn {
  role: 'user' | 'assistant'
  content: string
  /**
   * Images attached to the user turn, stored for the record only. Replayed
   * history deliberately drops them: re-sending megabytes of data URLs on
   * every question is wasteful, and only the current question's images go
   * on the wire (buildAskParts).
   */
  images?: string[]
  at: number
}

export interface AgentSession {
  id: string
  title: string
  turns: AgentTurn[]
  createdAt: number
  updatedAt: number
}

interface AgentStore {
  currentId: string | null
  sessions: AgentSession[]
}

const STORE_KEY = 'snooper.agent.sessions.v1'
/** Bounded so storage.session stays small; oldest sessions evicted. */
const MAX_SESSIONS = 20
/** Turns kept per session (pairs of user+assistant). */
const MAX_TURNS_PER_SESSION = 50
/**
 * Prompt budget in approximate tokens for replayed history. Chinese is
 * ~1.5-1.8 chars/token, English ~4 chars/token; 3.2 chars/token is a safe
 * middle that slightly under-fills the window rather than over-running it.
 */
const HISTORY_TOKEN_BUDGET = 3000
const CHARS_PER_TOKEN = 3.2
/** The current question always gets this much room regardless of history. */
const MIN_HISTORY_TURNS = 2

function emptyStore(): AgentStore {
  return { currentId: null, sessions: [] }
}

/** Rough char-based token estimate — good enough for budgeting decisions. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function newSession(title: string): AgentSession {
  const now = Date.now()
  return { id: `agt_${now}_${Math.random().toString(36).slice(2, 8)}`, title, turns: [], createdAt: now, updatedAt: now }
}

/** Load the whole store; SW restarts start from storage, not from zero. */
export async function loadAgentStore(): Promise<AgentStore> {
  try {
    const result = await chrome.storage.session.get(STORE_KEY)
    const store = result?.[STORE_KEY]
    if (store && Array.isArray(store.sessions)) return store as AgentStore
  } catch { /* session storage unavailable — behave stateless */ }
  return emptyStore()
}

export async function saveAgentStore(store: AgentStore): Promise<void> {
  await saveAgentStoreInternal(store)
}

async function saveAgentStoreInternal(store: AgentStore): Promise<void> {
  try {
    await chrome.storage.session.set({ [STORE_KEY]: store })
  } catch { /* quota or context invalidated — keep going stateless */ }
}

/** The session a new question should attach to (latest, or a fresh one). */
export async function resolveCurrentSession(store: AgentStore, preferNew = false): Promise<AgentSession> {
  if (!preferNew) {
    const current = store.sessions.find((s) => s.id === store.currentId)
    if (current) return current
  }
  const created = newSession('新对话')
  store.sessions.unshift(created)
  store.currentId = created.id
  // Evict oldest beyond the cap (never the current one).
  while (store.sessions.length > MAX_SESSIONS) {
    const oldestIdx = store.sessions.findIndex((s) => s.id !== store.currentId)
    if (oldestIdx < 0) break
    store.sessions.splice(oldestIdx, 1)
  }
  return created
}

/**
 * Select replayed turns for the prompt: newest-first within the token
 * budget, then re-reversed to chronological order. The latest user turn is
 * NOT included here (the caller adds it separately). The most recent
 * MIN_HISTORY_TURNS pairs are always kept even when over budget — recent
 * context matters more than the ceiling; older turns stop at the budget.
 */
export function selectHistoryTurns(turns: AgentTurn[], budgetTokens = HISTORY_TOKEN_BUDGET): AgentTurn[] {
  const history = turns.slice(0, -1) // everything except the current question
  const picked: AgentTurn[] = []
  let used = 0
  let keptNewest = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!
    const cost = estimateTokens(turn.content)
    const minimumNotMet = keptNewest < MIN_HISTORY_TURNS * 2
    if (minimumNotMet || used + cost <= budgetTokens) {
      picked.unshift(turn)
      used += cost
      keptNewest++
    } else {
      break
    }
  }
  return picked
}

/**
 * Build the gateway-shaped parts array for one question: flattened dialogue
 * history + subtitle context + the question itself, then any images last
 * (flattenMessages already orders text before images).
 */
export function buildAskParts({ history, subtitleContext, question, images }: {
  history: AgentTurn[]
  subtitleContext: string
  question: string
  images: string[]
}): Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  const turns: AgentTurn[] = []
  for (const turn of history) {
    turns.push({ role: turn.role, content: turn.content })
  }
  const questionText = [
    subtitleContext ? `【最近的字幕上下文】\n${subtitleContext}\n` : '',
    question || '请描述这张图片，并结合视频上下文解释。',
  ].filter(Boolean).join('\n')
  turns.push({ role: 'user', content: questionText, images: images.length ? images : undefined })

  const messages = turns.map((turn) => ({
    role: turn.role,
    content: turn.images?.length
      ? [
          { type: 'text', text: turn.content },
          ...turn.images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
      : turn.content,
  }))
  return flattenMessages(messages as any)
}

/** Record a finished exchange and persist. Returns the updated store. */
export async function recordExchange(store: AgentStore, session: AgentSession, userTurn: AgentTurn, assistantTurn: AgentTurn): Promise<AgentStore> {
  session.turns.push(userTurn, assistantTurn)
  if (session.turns.length > MAX_TURNS_PER_SESSION) {
    session.turns = session.turns.slice(-MAX_TURNS_PER_SESSION)
  }
  // Title from the first user question, once.
  if (session.title === '新对话' && userTurn.content) {
    session.title = userTurn.content.slice(0, 24) || session.title
  }
  session.updatedAt = Date.now()
  await saveAgentStore(store)
  return store
}

/** List sessions newest-first for a picker UI. */
export function listSessions(store: AgentStore): Array<Pick<AgentSession, 'id' | 'title' | 'updatedAt'>> {
  return [...store.sessions]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
}

/** Switch the active session; creates nothing. */
export function switchSession(store: AgentStore, id: string): AgentSession | null {
  const target = store.sessions.find((s) => s.id === id)
  if (!target) return null
  store.currentId = id
  return target
}

/** Delete one session; if it was current, the pointer clears. */
export async function deleteSession(store: AgentStore, id: string): Promise<void> {
  store.sessions = store.sessions.filter((s) => s.id !== id)
  if (store.currentId === id) store.currentId = store.sessions[0]?.id ?? null
  await saveAgentStore(store)
}
