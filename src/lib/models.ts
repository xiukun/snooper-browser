export type MossRole = 'system' | 'user' | 'assistant'

export interface MossTextPart {
  type: 'text'
  text: string
}

export interface MossImagePart {
  type: 'image_url'
  /**
   * `url` must be a data URL. The MOSS gateway rejects `detail` on
   * `/chat/completions` (`invalid_field_value`), so it is deliberately omitted.
   */
  image_url: {
    url: string
  }
}

export type MossContentPart = MossTextPart | MossImagePart

export interface MossMessage {
  role: MossRole
  content: string | MossContentPart[]
}

export interface ModelInfo {
  id: string
  label: string
  kind: 'chat' | 'vision' | 'audio' | 'speech' | 'image'
  blurb: string
  badge?: string
}

/** Verified against GET https://api.mosi.cn/v1/models with the bundled key. */
export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: 'moss-vl-1.0',
    label: 'MOSS VL 1.0',
    kind: 'chat',
    blurb: '通用多模态理解，文本对话 / 翻译 / OCR 全能',
    badge: '推荐',
  },
  {
    id: 'moss-vl-realtime-1.0',
    label: 'MOSS VL Realtime',
    kind: 'vision',
    blurb: '低延迟视频帧流式理解（WebSocket）',
  },
  {
    id: 'moss-transcribe-1.0',
    label: 'MOSS Transcribe',
    kind: 'audio',
    blurb: '语音转写，实时字幕管线核心',
  },
  {
    id: 'moss-transcribe-diarize-pro',
    label: 'Transcribe Diarize Pro',
    kind: 'audio',
    blurb: '带说话人分离的高精度转写',
  },
  {
    id: 'moss-transcribe-diarize-flash-2026-09-02',
    label: 'Transcribe Diarize Flash',
    kind: 'audio',
    blurb: '低延迟说话人分离转写',
  },
  {
    id: 'moss-tts-1.5-flash',
    label: 'MOSS TTS Flash',
    kind: 'speech',
    blurb: '低延迟语音合成',
  },
  {
    id: 'moss-tts-1.0-pro',
    label: 'MOSS TTS Pro',
    kind: 'speech',
    blurb: '高自然度语音合成',
  },
  {
    id: 'moss-ttsd-1.0',
    label: 'MOSS TTSD',
    kind: 'speech',
    blurb: '对话式语音合成',
  },
  {
    id: 'moss-speech',
    label: 'MOSS Speech',
    kind: 'speech',
    blurb: '语音理解与增强',
  },
  {
    id: 'moss-image-prompt-enhancer-1.0',
    label: 'Image Prompt Enhancer',
    kind: 'image',
    blurb: '图像生成提示词增强',
  },
  {
    id: 'moss-image-sft-1.0',
    label: 'MOSS-Image SFT',
    kind: 'image',
    blurb: '官方文生图，中英文文字渲染/布局控制，限时免费',
    badge: '免费 · 推荐',
  },
  {
    id: 'moss-image-base-1.0',
    label: 'MOSS-Image Base',
    kind: 'image',
    blurb: '基础文生图模型，适合风格化与微调，限时免费',
    badge: '免费',
  },
  {
    id: 'moss-image-sft-1.0-2026-10-09',
    label: 'MOSS-Image SFT (快照)',
    kind: 'image',
    blurb: '锁定版本的 SFT 快照，保证结果可复现',
  },
  {
    id: 'moss-image-base-1.0-2026-10-09',
    label: 'MOSS-Image Base (快照)',
    kind: 'image',
    blurb: '锁定版本的 Base 快照，保证结果可复现',
  },
  {
    id: 'black-forest-labs/FLUX.1-schnell',
    label: 'FLUX.1-schnell',
    kind: 'image',
    blurb: '第三方中转模型：最快开源生图，1-4步推理（非 MOSS 官方）',
  },
  {
    id: 'stabilityai/stable-diffusion-3.5-medium',
    label: 'SD 3.5 Medium',
    kind: 'image',
    blurb: '第三方中转模型：质量与速度均衡（非 MOSS 官方）',
  },
  {
    id: 'stabilityai/stable-diffusion-xl-base-1.0',
    label: 'SDXL 1.0',
    kind: 'image',
    blurb: '第三方中转模型：高分辨率生成（非 MOSS 官方）',
  },
]

export const SOURCE_LANGUAGES = [
  { code: 'auto', label: '自动检测', short: 'AUTO' },
  { code: 'zh', label: '简体中文', short: 'ZH' },
  { code: 'en', label: 'English', short: 'EN' },
] as const

export const TARGET_LANGUAGES = [
  { code: 'zh', label: '简体中文', short: 'ZH' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ja', label: '日本語', short: 'JA' },
  { code: 'ko', label: '한국어', short: 'KO' },
  { code: 'fr', label: 'Français', short: 'FR' },
  { code: 'de', label: 'Deutsch', short: 'DE' },
  { code: 'es', label: 'Español', short: 'ES' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'ar', label: 'العربية', short: 'AR' },
  { code: 'pt', label: 'Português', short: 'PT' },
] as const

export const LANGUAGES = [...SOURCE_LANGUAGES, ...TARGET_LANGUAGES.filter(
  (target) => !SOURCE_LANGUAGES.some((source) => source.code === target.code),
)] as const

export function languageLabel(code: string) {
  return LANGUAGES.find((lang) => lang.code === code)?.label ?? code.toUpperCase()
}

export function languageShort(code: string) {
  return LANGUAGES.find((lang) => lang.code === code)?.short ?? code.toUpperCase()
}
