/**
 * Single source of truth for product identity.
 * Renaming the product should only require touching this file, package.json and
 * the static favicon.
 */
export const BRAND = {
  name: 'snooper',
  repo: 'snooper-browser',
  product: 'snooper-browser',
  version: '0.1.0',
  tagline: 'See it. Translate it. Understand it.',
  description:
    'Open-source multimodal workspace for real-time translation, conversations and visual understanding.',
  repoUrl: 'https://github.com/snooper-browser/snooper-browser',
  docsUrl: 'https://platform.moss.cn/docs/models',
  license: 'MIT',
} as const

export const STORAGE_KEYS = {
  activeView: 'snooper.active-view.v1',
  providerConfig: 'snooper.provider-config.v1',
  providerConfigSession: 'snooper.provider-config.session.v1',
} as const
