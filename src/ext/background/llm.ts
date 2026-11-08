/**
 * Text + vision Q&A for the content-script drawer.
 *
 * The background owns this call because it already holds the config snapshot
 * and the API key never enters the page's isolated world. Conversation
 * assembly (multi-turn history + subtitle context + images) lives in
 * agent.ts and arrives here already gateway-shaped (single user message,
 * text before images).
 */

import type { AppConfig } from '../../lib/providers'

export async function askLLM({ parts, config, sourceLang: _sourceLang, targetLang: _targetLang }: {
  parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
  config: AppConfig
  sourceLang: string
  targetLang: string
}): Promise<string> {
  void _sourceLang
  void _targetLang
  const route = config.routes.llm
  const provider = config.providers.find((p) => p.id === route.providerId)
  if (!provider || !provider.apiKey) {
    throw new Error('尚未配置 LLM 服务商，请点击页面悬浮栏的 ⚙ 填入 API Key')
  }
  if (!route.model) {
    throw new Error('未选择 LLM 模型，请点击页面悬浮栏的 ⚙ 配置')
  }

  const baseUrl = provider.baseUrl.replace(/\/+$/, '')

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: route.model,
      messages: [{ role: 'user', content: parts }],
      temperature: 0.3,
      max_tokens: 2048,
      stream: false,
    }),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const text = await res.text()
      if (text) msg = text.slice(0, 240)
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((p: any) => p.text || '').join('').trim()
  return String(json.output_text || '').trim()
}
