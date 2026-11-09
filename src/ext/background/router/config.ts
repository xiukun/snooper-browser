/** Config read/write and connection probing from the settings surfaces. */

import type { AppConfig } from '../../../lib/providers'
import { loadConfig, saveConfig } from '../config'
import type { MessageHandlerMap } from './types'

export const configHandlers: MessageHandlerMap = {
  /* ---------- Config (in-page settings modal + side panel) ---------- */
  // Both surfaces are trusted extension contexts: the content script runs in
  // an isolated world that page scripts cannot reach, and `sender.tab` proves
  // the message came from an injected content script rather than the page.
  GET_CONFIG: (_message, { sendResponse }) => {
    loadConfig().then((config) => {
      sendResponse({ ok: true, config })
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message })
    })
    return true // async
  },

  SAVE_CONFIG: (message, { sendResponse }) => {
    saveConfig(message.config).then(() => {
      sendResponse({ ok: true })
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message })
    })
    return true // async
  },

  /* ---------- Connection test (in-page settings modal) ---------- */
  TEST_CONNECTION: (message, { sendResponse }) => {
    (async () => {
      try {
        const config: AppConfig = message.config || (await loadConfig())
        const provider = Array.isArray(config.providers) ? config.providers[0] : null
        if (!provider?.baseUrl) throw new Error('请先填写 Base URL')
        let origin: string
        try {
          origin = new URL(provider.baseUrl).origin
        } catch {
          throw new Error('Base URL 格式无效')
        }
        const res = await fetch(`${origin}${new URL(provider.baseUrl).pathname.replace(/\/+$/, '')}/models`, {
          headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
        })
        const text = await res.text().catch(() => '')
        if (!res.ok) {
          let detail = ''
          try {
            const parsed = JSON.parse(text) as { error?: { message?: string } }
            detail = parsed.error?.message || ''
          } catch {
            detail = text.slice(0, 160)
          }
          throw new Error(`HTTP ${res.status}${detail ? ` · ${detail}` : ''}`)
        }
        let ids: string[] = []
        try {
          const payload = JSON.parse(text) as { data?: Array<{ id?: string }> }
          ids = (payload.data || []).map((item) => item.id).filter(Boolean) as string[]
        } catch {
          throw new Error('返回内容不是有效的模型列表')
        }
        sendResponse({ ok: true, count: ids.length, models: ids.slice(0, 60) })
      } catch (err: any) {
        sendResponse({ ok: false, error: err.message || '连接失败' })
      }
    })()
    return true // async
  },
}
