/**
 * Reproduces loading the provider module in an esbuild-built MV3 bundle,
 * where Vite's `import.meta.env` object is absent at runtime.
 *
 *   node scripts/test-extension-provider-env.mjs
 */
import { execSync } from 'node:child_process'
import { readFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'

const outDir = mkdtempSync(join(tmpdir(), 'snooper-provider-env-'))
const out = join(outDir, 'providers.js')
const offscreenOut = join(outDir, 'offscreen.js')

try {
  execSync(
    `npx esbuild src/lib/providers.ts --bundle --format=iife --global-name=providersModule --platform=browser --target=chrome116 --outfile=${out}`,
    { stdio: 'inherit' },
  )

  const context = {}
  vm.runInNewContext(readFileSync(out, 'utf8'), context, { filename: out })

  const defaults = context.providersModule?.DEFAULT_CONFIG
  if (!defaults?.providers?.[0]) {
    throw new Error('provider bundle did not expose a default provider')
  }
  if (defaults.providers[0].baseUrl !== 'https://api.mosi.cn/v1') {
    throw new Error(`unexpected default base URL: ${defaults.providers[0].baseUrl}`)
  }
  if (defaults.providers[0].apiKey !== '') {
    throw new Error('extension defaults must not include an API key')
  }

  execSync(
    `npx esbuild src/ext/offscreen.ts --bundle --format=iife --platform=browser --target=chrome116 '--define:import.meta.env={}' --outfile=${offscreenOut}`,
    { stdio: 'inherit' },
  )

  const offscreenSource = readFileSync(offscreenOut, 'utf8')
  if (/\bimport_meta\.env\b/.test(offscreenSource)) {
    throw new Error('offscreen bundle still reads Vite env at runtime')
  }

  const listeners = []
  const intervals = []
  const responses = []
  const extensionId = 'test-extension-id'
  const offscreenContext = {
    chrome: {
      runtime: {
        id: extensionId,
        getURL: (path) => path,
        sendMessage: async () => {},
        onMessage: { addListener: (listener) => listeners.push(listener) },
      },
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => { throw new Error('mock media failure') },
      },
    },
    setInterval: (callback, delay) => {
      intervals.push({ callback, delay })
      return intervals.length
    },
    clearInterval: () => {},
    console,
  }
  vm.runInNewContext(readFileSync(offscreenOut, 'utf8'), offscreenContext, { filename: offscreenOut })

  if (listeners.length !== 1) throw new Error('offscreen entry did not register its message listener')
  const keepAlive = listeners[0](
    {
      target: 'offscreen',
      type: 'START_CAPTURE',
      tabId: 1,
      streamId: 'test-stream',
      sourceLang: 'auto',
      targetLang: 'en',
      config: { providers: [], routes: {} },
      generation: 1,
    },
    { id: extensionId },
    (response) => responses.push(response),
  )

  if (keepAlive !== true) throw new Error('START_CAPTURE did not keep its response channel open')
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (responses.length !== 1 || responses[0]?.error !== 'mock media failure') {
    throw new Error(`START_CAPTURE did not reach media capture: ${JSON.stringify(responses)}`)
  }

  console.log('offscreen registers START_CAPTURE and reaches media capture without Vite env')
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
