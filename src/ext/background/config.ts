/**
 * Background config persistence.
 *
 * One versioned key in chrome.storage.local, validated on write so a broken
 * side-panel payload cannot brick capture. Reads always return a complete
 * config, falling back to the default provider/routes.
 */

import type { AppConfig } from '../../lib/providers'

export const CONFIG_KEY = 'snooper.extension.config.v1'

export const DEFAULT_CONFIG: AppConfig = {
  providers: [
    {
      id: 'moss-official',
      name: 'MOSS 官方',
      baseUrl: 'https://api.mosi.cn/v1',
      apiKey: '',
      protocol: 'moss',
      note: '官方 MOSS 网关',
      models: [],
      lastSyncedAt: null,
      status: 'unknown',
      lastError: '',
    },
  ],
  routes: {
    llm: { providerId: 'moss-official', model: 'moss-vl-1.0' },
    audio: { providerId: 'moss-official', model: 'moss-transcribe-1.0' },
    video: { providerId: 'moss-official', model: 'moss-vl-realtime-1.0' },
    image: { providerId: 'moss-official', model: 'moss-image-sft-1.0' },
  },
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const result = await chrome.storage.local.get(CONFIG_KEY)
    if (result[CONFIG_KEY]) {
      return JSON.parse(result[CONFIG_KEY])
    }
  } catch {
    // corrupted or missing
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG))
}

export async function saveConfig(config: AppConfig): Promise<void> {
  // Basic validation
  if (!config || typeof config !== 'object') {
    throw new Error('配置格式无效')
  }
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error('至少需要配置一个服务商')
  }
  for (const p of config.providers) {
    if (!p.id || typeof p.id !== 'string') throw new Error('服务商缺少有效 ID')
    if (!p.baseUrl || typeof p.baseUrl !== 'string') throw new Error(`服务商 "${p.name}" 缺少 Base URL`)
    try {
      new URL(p.baseUrl)
    } catch {
      throw new Error(`服务商 "${p.name}" 的 Base URL 格式无效: ${p.baseUrl}`)
    }
    if (p.apiKey && typeof p.apiKey === 'string' && p.apiKey.length > 1024) {
      throw new Error(`服务商 "${p.name}" 的 API Key 过长`)
    }
  }
  if (!config.routes || typeof config.routes !== 'object') {
    throw new Error('能力路由配置无效')
  }

  const json = JSON.stringify(config)
  await chrome.storage.local.set({ [CONFIG_KEY]: json })
  // `chrome.storage.local` has no access-level restriction (only
  // `chrome.storage.session` does), so there is no setAccessLevel call to
  // make here. The key stays out of the content script by architecture:
  // content asks the background to act and never reads the config itself.
}
