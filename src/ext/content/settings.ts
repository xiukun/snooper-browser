/**
 * In-page settings modal: provider config, route models, Obsidian connection.
 *
 * The modal edits the first provider plus the llm/audio/image routes and
 * writes through the background service worker, which validates and stores
 * the config. The API key never leaves the extension's trusted storage.
 */

import { loadObsidianConfig, saveObsidianConfig, type SharedObsidianConfig } from './obsidian-config'

export interface SettingsRefs {
  settingsModal: HTMLElement
  settingsClose: HTMLButtonElement
  cfgBaseUrl: HTMLInputElement
  cfgApiKey: HTMLInputElement
  cfgToggleKey: HTMLButtonElement
  cfgLlm: HTMLInputElement
  cfgAudio: HTMLInputElement
  cfgImage: HTMLInputElement
  cfgStatus: HTMLElement
  cfgTest: HTMLButtonElement
  cfgSave: HTMLButtonElement
  cfgCancel: HTMLButtonElement
  cfgObProtocol: HTMLSelectElement
  cfgObPort: HTMLInputElement
  cfgObKey: HTMLInputElement
  cfgObFolder: HTMLInputElement
  cfgObTest: HTMLButtonElement
  cfgObStatus: HTMLElement
  imageModal: HTMLElement
  shotModal: HTMLElement
}

export interface SettingsDeps {
  refs: SettingsRefs
  bg: (type: string, payload?: Record<string, any>) => Promise<any>
  toast: (message: string, tone?: 'info' | 'ok' | 'err') => void
  closeImagePanel: () => void
  closeShotPreview: () => void
}

export function createSettingsPanel(deps: SettingsDeps) {
  const r = deps.refs
  let cfgCache: any = null

  function setCfgStatus(text: string, tone: 'ok' | 'err' | 'info' | '' = '') {
    r.cfgStatus.textContent = text
    r.cfgStatus.className = 'rtts-status' + (text ? ` show ${tone}` : '')
  }

  function setObStatus(text: string, tone: 'ok' | 'err' | 'info' | '' = '') {
    r.cfgObStatus.textContent = text
    r.cfgObStatus.className = 'rtts-status' + (text ? ` show ${tone}` : '')
  }

  function buildObsidianConfig(): SharedObsidianConfig {
    const protocol: 'http' | 'https' = r.cfgObProtocol.value === 'https' ? 'https' : 'http'
    const fallbackPort = protocol === 'https' ? 27124 : 27123
    return {
      enabled: true,
      apiProtocol: protocol,
      apiPort: Number(r.cfgObPort.value) || fallbackPort,
      apiKey: r.cfgObKey.value.trim(),
      noteFolder: r.cfgObFolder.value.trim() || 'snooper-notes',
    }
  }

  async function testObsidian() {
    r.cfgObTest.disabled = true
    setObStatus('正在测试 Obsidian 连接…', 'info')
    const res: any = await deps.bg('TEST_OBSIDIAN', { obsidianConfig: buildObsidianConfig() })
    r.cfgObTest.disabled = false
    if (res.ok) {
      r.cfgObProtocol.value = res.protocol
      r.cfgObPort.value = String(res.port)
      await saveObsidianConfig(buildObsidianConfig())
      setObStatus(`连接成功（${String(res.protocol).toUpperCase()} ${res.port}），已自动保存`, 'ok')
    } else {
      setObStatus(res.error || '连接失败，请确认 Obsidian 正在运行', 'err')
    }
  }

  async function openSettings() {
    r.cfgApiKey.type = 'password'
    r.cfgToggleKey.classList.remove('revealed')
    const [res, ob] = await Promise.all([
      deps.bg('GET_CONFIG'),
      loadObsidianConfig(),
    ])
    r.cfgObProtocol.value = ob.apiProtocol
    r.cfgObPort.value = String(ob.apiPort)
    r.cfgObKey.value = ob.apiKey
    r.cfgObFolder.value = ob.noteFolder
    setObStatus('')
    if (res.ok && res.config) {
      cfgCache = res.config
      const first = cfgCache.providers?.[0] ?? {}
      r.cfgBaseUrl.value = first.baseUrl || 'https://api.mosi.cn/v1'
      r.cfgApiKey.value = first.apiKey || ''
      r.cfgLlm.value = cfgCache.routes?.llm?.model || 'moss-vl-1.0'
      r.cfgAudio.value = cfgCache.routes?.audio?.model || 'moss-transcribe-1.0'
      r.cfgImage.value = cfgCache.routes?.image?.model || 'moss-image-sft-1.0'
    } else {
      cfgCache = null
      r.cfgBaseUrl.value = 'https://api.mosi.cn/v1'
      r.cfgApiKey.value = ''
      r.cfgLlm.value = 'moss-vl-1.0'
      r.cfgAudio.value = 'moss-transcribe-1.0'
      r.cfgImage.value = 'moss-image-sft-1.0'
      if (!res.ok) deps.toast('读取配置失败：' + (res.error || '未知错误'), 'err')
    }
    setCfgStatus('')
    r.settingsModal.classList.add('open')
  }

  function closeSettings() {
    r.settingsModal.classList.remove('open')
  }

  function buildConfig(): any {
    const defaultProvider = () => ({
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
    })

    const base = cfgCache
      ? JSON.parse(JSON.stringify(cfgCache))
      : { providers: [defaultProvider()], routes: {} }

    if (!Array.isArray(base.providers) || base.providers.length === 0) {
      base.providers = [defaultProvider()]
    }
    if (!base.routes || typeof base.routes !== 'object') {
      base.routes = {}
    }

    const provider = base.providers[0]
    provider.baseUrl = r.cfgBaseUrl.value.trim() || 'https://api.mosi.cn/v1'
    provider.apiKey = r.cfgApiKey.value.trim()

    const keepProvider = (current: any) =>
      current?.providerId && base.providers.some((item: any) => item.id === current.providerId)
        ? current.providerId
        : provider.id

    base.routes.llm = {
      ...(base.routes.llm || {}),
      providerId: keepProvider(base.routes.llm),
      model: r.cfgLlm.value.trim() || 'moss-vl-1.0',
    }
    base.routes.audio = {
      ...(base.routes.audio || {}),
      providerId: keepProvider(base.routes.audio),
      model: r.cfgAudio.value.trim() || 'moss-transcribe-1.0',
    }
    base.routes.image = {
      ...(base.routes.image || {}),
      providerId: keepProvider(base.routes.image),
      model: r.cfgImage.value.trim() || 'moss-image-sft-1.0',
    }
    if (!base.routes.video) {
      base.routes.video = { providerId: provider.id, model: 'moss-vl-realtime-1.0' }
    }
    return base
  }

  async function saveSettings() {
    const config = buildConfig()
    r.cfgSave.disabled = true
    setCfgStatus('正在保存…', 'info')
    await saveObsidianConfig(buildObsidianConfig())
    const res: any = await deps.bg('SAVE_CONFIG', { config })
    r.cfgSave.disabled = false
    if (res.ok) {
      cfgCache = config
      setCfgStatus('已保存。密钥只存储在本机浏览器。', 'ok')
      deps.toast('配置已保存', 'ok')
      setTimeout(closeSettings, 600)
    } else {
      setCfgStatus('保存失败：' + (res.error || '未知错误'), 'err')
    }
  }

  async function testConnection() {
    r.cfgTest.disabled = true
    setCfgStatus('正在连接 ' + (r.cfgBaseUrl.value.trim() || '…') + ' …', 'info')
    const res: any = await deps.bg('TEST_CONNECTION', { config: buildConfig() })
    r.cfgTest.disabled = false
    if (res.ok) {
      const sample = Array.isArray(res.models) && res.models.length
        ? '：' + res.models.slice(0, 4).join('、')
        : ''
      setCfgStatus(`连接成功，发现 ${res.count} 个模型${sample}`, 'ok')
    } else {
      setCfgStatus('连接失败：' + (res.error || '未知错误'), 'err')
    }
  }

  r.settingsClose.addEventListener('click', closeSettings)
  r.cfgCancel.addEventListener('click', closeSettings)
  r.settingsModal.addEventListener('click', (e) => {
    if (e.target === r.settingsModal) closeSettings()
  })
  r.cfgSave.addEventListener('click', saveSettings)
  r.cfgTest.addEventListener('click', testConnection)
  r.cfgObTest.addEventListener('click', testObsidian)
  r.cfgObProtocol.addEventListener('change', () => {
    const port = Number(r.cfgObPort.value)
    if (!port || port === 27123 || port === 27124) {
      r.cfgObPort.value = r.cfgObProtocol.value === 'https' ? '27124' : '27123'
    }
  })
  r.cfgToggleKey.addEventListener('click', () => {
    const revealed = r.cfgApiKey.type === 'password'
    r.cfgApiKey.type = revealed ? 'text' : 'password'
    r.cfgToggleKey.classList.toggle('revealed', revealed)
  })
  document.addEventListener('keydown', (e) => {
    const settingsOpen = r.settingsModal.classList.contains('open')
    const imageOpen = r.imageModal.classList.contains('open')
    const shotOpen = r.shotModal.classList.contains('open')
    if (!settingsOpen && !imageOpen && !shotOpen) return

    if (e.key === 'Escape') {
      if (imageOpen) deps.closeImagePanel()
      else if (shotOpen) deps.closeShotPreview()
      else closeSettings()
      return
    }
    if (
      e.key === 'Enter' &&
      settingsOpen &&
      (e.target as HTMLElement | null)?.tagName === 'INPUT'
    ) {
      e.preventDefault()
      saveSettings()
    }
  })

  return {
    openSettings,
    closeSettings,
    buildObsidianConfig,
    focusObsidianKey: () => r.cfgObKey.focus(),
  }
}
