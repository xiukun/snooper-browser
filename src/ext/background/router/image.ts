/** Image generation and remote-image materialisation. */

import { materializeImage } from '../../../lib/image-material'
import { loadConfig } from '../config'
import type { MessageHandlerMap } from './types'

export const imageHandlers: MessageHandlerMap = {
  /* ---------- In-page image generation ---------- */
  GENERATE_IMAGE: (message, { sendResponse }) => {
    (async () => {
      try {
        const config = await loadConfig()
        const route = config.routes.image
        const provider =
          config.providers.find((p) => p.id === route?.providerId) || config.providers[0]
        if (!provider?.apiKey) {
          throw new Error('尚未配置 API Key，请点击页面悬浮栏的 ⚙ 在页面内配置')
        }
        const prompt = String(message.prompt || '').trim()
        if (!prompt) throw new Error('提示词不能为空')
        if (prompt.length > 4000) throw new Error('提示词过长（最多 4000 字）')

        const baseUrl = provider.baseUrl.replace(/\/+$/, '')
        const body: Record<string, unknown> = {
          model: route?.model || 'moss-image-sft-1.0',
          prompt,
          n: 1,
          size: message.size || '1024x1024',
          prompt_enhance: true,
          output_watermark: { enabled: false },
        }
        const negative = String(message.negativePrompt || '').trim()
        if (negative) body.negative_prompt = negative

        async function tryGenerate(requestBody: Record<string, unknown>): Promise<string[]> {
          const res = await fetch(`${baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${provider.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          })
          const text = await res.text().catch(() => '')
          if (!res.ok) {
            let detail = ''
            try {
              const parsed = JSON.parse(text) as { error?: { message?: string } }
              detail = parsed.error?.message || ''
            } catch {
              detail = text.slice(0, 200)
            }
            const errMsg = `HTTP ${res.status}${detail ? ` · ${detail}` : ''}`
            // Retry once without optional params on 4xx errors
            if (res.status >= 400 && res.status < 500 && requestBody.prompt_enhance !== undefined) {
              const retryBody = { ...requestBody }
              delete retryBody.prompt_enhance
              delete retryBody.output_watermark
              const r2 = await fetch(`${baseUrl}/images/generations`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${provider.apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(retryBody),
              })
              const text2 = await r2.text().catch(() => '')
              if (r2.ok) {
                const imgs = parseImageResponse(text2)
                if (imgs.length > 0) return imgs
              }
              // Retry failed too; show first error
              throw new Error(`生图失败 ${errMsg}`)
            }
            throw new Error(`生图失败 ${errMsg}`)
          }
          return parseImageResponse(text)
        }

        function parseImageResponse(text: string): string[] {
          const payload = JSON.parse(text)
          const images: string[] = []
          // Standard OpenAI-style: data[{url}], data[{b64_json}]
          if (Array.isArray(payload.data)) {
            for (const item of payload.data) {
              if (item.url) images.push(item.url)
              else if (item.b64_json) images.push(`data:image/png;base64,${item.b64_json}`)
            }
          }
          // Alternative: images[{url}], images[string]
          if (payload.images && Array.isArray(payload.images)) {
            for (const item of payload.images) {
              if (typeof item === 'string' && item.length > 0) images.push(item)
              else if (item.url) images.push(item.url)
              else if (item.b64_json) images.push(`data:image/png;base64,${item.b64_json}`)
            }
          }
          // output field
          if (images.length === 0 && payload.output) {
            if (typeof payload.output === 'string' && payload.output.length > 0) images.push(payload.output)
            else if (Array.isArray(payload.output)) {
              for (const o of payload.output) {
                if (typeof o === 'string' && o.length > 0) images.push(o)
                else if (o.url) images.push(o.url)
                else if (o.b64_json) images.push(`data:image/png;base64,${o.b64_json}`)
              }
            }
          }
          if (images.length === 0) throw new Error('生图接口响应中没有找到图片')
          return images
        }

        const images = await tryGenerate(body)

        // The page's <img> runs under the page CSP/CORS rules. A URL that
        // the background can fetch may still fail to render inside the tab
        // (signed URLs, auth headers, expiring CDN links). Materialise every
        // remote image here so the UI only receives data URLs.
        const outcomes = await Promise.all(images.map(async (image) => {
          if (image.startsWith('data:')) {
            return { rendered: image, remote: '', warning: '' }
          }
          try {
            return {
              rendered: await materializeImage(image, baseUrl, provider.apiKey),
              remote: image,
              warning: '',
            }
          } catch (err: any) {
            return {
              rendered: image,
              remote: image,
              warning: err?.message || '图片下载失败',
            }
          }
        }))
        const renderedImages = outcomes.map((item) => item.rendered)
        const remoteImages = outcomes.map((item) => item.remote).filter(Boolean)
        const warnings = outcomes.map((item) => item.warning).filter(Boolean)

        console.log('[RTTS] image generation', {
          fields: images.length,
          remote: remoteImages.length,
          dataUrls: renderedImages.filter((item) => item.startsWith('data:')).length,
          warnings,
        })
        sendResponse({
          ok: true,
          images: renderedImages,
          remoteImages,
          warnings,
          model: route?.model || 'moss-image-sft-1.0',
        })
      } catch (err: any) {
        sendResponse({ ok: false, error: err.message || '生图失败' })
      }
    })()
    return true // async
  },

  FETCH_IMAGE: (message, { sendResponse }) => {
    const url = String(message.url || '').trim()
    if (!url) {
      sendResponse({ ok: false, error: 'URL 为空' })
      return false
    }
    (async () => {
      try {
        const config = await loadConfig()
        const route = config.routes.image
        const provider =
          config.providers.find((p) => p.id === route?.providerId) || config.providers[0]
        const dataUrl = await materializeImage(
          url,
          provider?.baseUrl || '',
          provider?.apiKey || '',
        )
        sendResponse({ ok: true, dataUrl })
      } catch (err: any) {
        sendResponse({ ok: false, error: err?.message || '无法下载图片' })
      }
    })()
    return true
  },
}
