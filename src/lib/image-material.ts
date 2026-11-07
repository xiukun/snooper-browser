/**
 * Turning a generated image URL into bytes the page can always render.
 *
 * The background worker is not bound by the page CSP/CORS rules, so it is the
 * right place to download a provider/CDN URL. The pure policy below decides
 * where the request goes, whether the provider key may accompany it, and
 * whether the response really is an image.
 */

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export interface ImageFetchPlan {
  url: string
  headers: Record<string, string>
}

/**
 * Resolve a provider-relative URL and decide whether the API key may travel
 * with it. The key is only ever sent to the provider's own origin; a signed
 * third-party CDN URL must work without it.
 */
export function planImageFetch(url: string, baseUrl: string, apiKey: string): ImageFetchPlan {
  let target: URL
  try {
    // An absolute URL does not need a provider base; a relative one does.
    target = /^[a-z][a-z0-9+.-]*:/i.test(url)
      ? new URL(url)
      : new URL(url, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  } catch {
    throw new Error('图片地址无效')
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error(`不支持的图片协议：${target.protocol}`)
  }

  const headers: Record<string, string> = {}
  try {
    if (apiKey && new URL(baseUrl).origin === target.origin) {
      headers.Authorization = `Bearer ${apiKey}`
    }
  } catch { /* an invalid baseUrl is rejected by the caller */ }

  return { url: target.toString(), headers }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ascii = (bytes: Uint8Array, offset: number, text: string): boolean =>
  text.split('').every((char, index) => bytes[offset + index] === char.charCodeAt(0))

/**
 * Trust an explicit `image/*` content type. For `application/octet-stream`
 * (common on CDNs) fall back to magic bytes; a 200 HTML error page must never
 * become a broken data URL.
 */
export function detectImageMime(contentType: string, bytes: Uint8Array): string | null {
  const declared = contentType.split(';')[0]!.trim().toLowerCase()
  if (declared.startsWith('image/')) return declared

  if (bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6 && (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a'))) {
    return 'image/gif'
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    return 'image/webp'
  }
  if (bytes.length >= 2 && ascii(bytes, 0, 'BM')) {
    return 'image/bmp'
  }
  return null
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export interface MaterializeOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

export async function materializeImage(
  url: string,
  baseUrl: string,
  apiKey: string,
  options: MaterializeOptions = {},
): Promise<string> {
  if (url.startsWith('data:')) return url

  const plan = planImageFetch(url, baseUrl, apiKey)
  const fetchImpl = options.fetchImpl ?? fetch
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)

  try {
    const res = await fetchImpl(plan.url, { headers: plan.headers, signal: controller.signal })
    if (!res.ok) throw new Error(`图片下载失败 HTTP ${res.status}`)

    const declared = Number(res.headers.get('content-length') || '0')
    if (declared > maxBytes) throw new Error('图片超过 12 MB，已跳过缓存')

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > maxBytes) throw new Error('图片超过 12 MB，已跳过缓存')

    const mime = detectImageMime(
      res.headers.get('content-type') || '',
      new Uint8Array(buffer),
    )
    if (!mime) throw new Error('图片地址返回的内容不是图片')
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('图片下载超时')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
