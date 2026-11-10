/**
 * Shared subtitle-translation prompt and output cleanup.
 *
 * Two surfaces translate subtitles: the SPA through `lib/moss.ts`
 * (non-streaming) and the extension offscreen document through SSE. The
 * prompt is what governs hallucination behaviour, so it must not fork.
 */

export interface TranslationPromptInput {
  text: string
  source?: string
  target?: string
  /** Recent subtitle lines, used for terminology continuity. */
  context?: string
}

const LANGUAGE_NAMES: Record<string, string> = {
  auto: '自动检测',
  zh: '简体中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  ru: '俄语',
  ar: '阿拉伯语',
  pt: '葡萄牙语',
}

export function translationLanguageName(code: string | undefined, fallback: string): string {
  if (!code) return fallback
  return LANGUAGE_NAMES[code] ?? fallback
}

export function buildTranslationPrompt(input: TranslationPromptInput): string {
  const source = translationLanguageName(input.source, '自动检测')
  const target = translationLanguageName(input.target, '简体中文')
  const contextBlock = input.context ? `【上下文（最近的字幕）】\n${input.context}\n` : ''

  return [
    `你是一名专业的同声传译员。源语言：${source}；目标语言：${target}。`,
    '输入来自语音识别，可能有错字、漏字或断句错误。只翻译你看到的内容：不得补全、不得扩写、不得根据上下文编造未说出的信息。',
    '碎片或语气词就译成碎片或语气词，不要改写成完整句子。',
    '人名、地名、专有名词只使用上下文中出现过的写法；没有把握时音译，不得虚构。',
    '只输出译文本身，不要解释、不要加引号、不要重复原文、不要输出标签或注释。',
    '保持口语化、简洁、适合作为实时字幕显示。',
    contextBlock ? `注意保持与上下文的连贯性，专有名词前后一致。\n${contextBlock}` : '',
    '',
    input.text,
  ]
    .filter(Boolean)
    .join('\n')
}

export function cleanTranslation(value: string): string {
  return value
    .trim()
    .replace(/^["“「『]([\s\S]*)["”」』]$/, '$1')
    .trim()
}
