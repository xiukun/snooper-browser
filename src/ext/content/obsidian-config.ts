/**
 * Obsidian connection config shared with the side panel.
 *
 * Both surfaces read/write chrome.storage.local under one key. The old
 * page-localStorage copy is migrated on first read. Default is the plugin's
 * plain HTTP endpoint (27123) because Chrome rejects its self-signed HTTPS
 * certificate on 27124.
 */

export const OBSIDIAN_CONFIG_KEY = 'snooper.obsidian-config.v1'

export interface SharedObsidianConfig {
  enabled: boolean
  apiProtocol: 'http' | 'https'
  apiPort: number
  apiKey: string
  noteFolder: string
}

const DEFAULT_OBSIDIAN_CONFIG: SharedObsidianConfig = {
  enabled: false,
  apiProtocol: 'http',
  apiPort: 27123,
  apiKey: '',
  noteFolder: 'snooper-notes',
}

export function normalizeObsidianConfig(raw: any): SharedObsidianConfig {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  const port = Number(cfg.apiPort) || DEFAULT_OBSIDIAN_CONFIG.apiPort
  const protocol: 'http' | 'https' =
    cfg.apiProtocol === 'https' || cfg.apiProtocol === 'http'
      ? cfg.apiProtocol
      : port === 27124
        ? 'https'
        : 'http'
  return {
    enabled: !!cfg.enabled,
    apiProtocol: protocol,
    apiPort: port,
    // The Obsidian plugin shows the key as "Bearer <token>"; users copy the
    // whole line. Strip the prefix so callers can safely add their own.
    apiKey: typeof cfg.apiKey === 'string'
      ? cfg.apiKey.trim().replace(/^Bearer\s+/i, '').trim()
      : '',
    noteFolder: typeof cfg.noteFolder === 'string' && cfg.noteFolder.trim()
      ? cfg.noteFolder.trim()
      : DEFAULT_OBSIDIAN_CONFIG.noteFolder,
  }
}

export async function loadObsidianConfig(): Promise<SharedObsidianConfig> {
  try {
    const got = await (chrome as any).storage.local.get(OBSIDIAN_CONFIG_KEY)
    const stored = got?.[OBSIDIAN_CONFIG_KEY]
    if (stored && typeof stored === 'object') return normalizeObsidianConfig(stored)
  } catch { /* ignore */ }
  try {
    const raw = localStorage.getItem(OBSIDIAN_CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const normalized = normalizeObsidianConfig(parsed)
      try {
        await (chrome as any).storage.local.set({ [OBSIDIAN_CONFIG_KEY]: normalized })
      } catch { /* ignore */ }
      return normalized
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_OBSIDIAN_CONFIG }
}

export async function saveObsidianConfig(config: SharedObsidianConfig) {
  const normalized = normalizeObsidianConfig(config)
  try {
    await (chrome as any).storage.local.set({ [OBSIDIAN_CONFIG_KEY]: normalized })
  } catch { /* ignore */ }
  try {
    localStorage.setItem(OBSIDIAN_CONFIG_KEY, JSON.stringify(normalized))
  } catch { /* ignore */ }
}
