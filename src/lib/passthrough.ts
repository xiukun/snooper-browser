/**
 * Same-language passthrough for the subtitle pipeline.
 *
 * When the transcription already IS the target language, translating it adds
 * latency and cost and gives the LLM a chance to rewrite — or invent — text
 * that was correct. In that case we display the transcript as a single line
 * and skip the translation request entirely.
 *
 * Decision rules, deliberately conservative:
 *  - explicit source === target        → skip (the user knows their audio)
 *  - source is `auto`                  → infer from the transcript's dominant
 *                                        script and compare with the target
 *  - no meaningful language (code, numbers, symbols) → do NOT skip; let the
 *    model decide rather than guessing wrong
 */

export type LanguageCode = 'zh' | 'en' | 'ja' | 'ko' | string

/** Ranges that identify a script without matching every codepoint one by one. */
const HAN = /\p{Script=Han}/u
const HIRAGANA_KATAKANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const HANGUL = /\p{Script=Hangul}/u
const LATIN = /\p{Script=Latin}/u

/**
 * Infer the language of `text` from its dominant script.
 * Returns `null` when no script carries a meaningful share of the text
 * (code, digits, punctuation-only output), so callers never skip on a guess.
 */
export function detectLanguage(text: string): LanguageCode | null {
  const chars = Array.from(text)
  if (chars.length === 0) return null

  let han = 0
  let kana = 0
  let hangul = 0
  let latin = 0
  for (const char of chars) {
    if (HIRAGANA_KATAKANA.test(char)) kana++
    else if (HANGUL.test(char)) hangul++
    else if (HAN.test(char)) han++
    else if (LATIN.test(char)) latin++
  }

  const scriptChars = han + kana + hangul + latin
  // Code and symbol soup still often contains letters (`const a = 1;` is
  // exactly half letters). Require a clear majority of script characters so
  // we never guess a language for something that is mostly syntax.
  if (scriptChars * 2 <= chars.length) return null

  // Japanese: kana presence is decisive even when kanji dominate the count.
  if (kana > 0) return 'ja'
  if (hangul > 0) return 'ko'
  if (han > 0) return 'zh'
  if (latin > 0) return 'en'

  return null
}

/**
 * True when the transcript does not need translation because it already is
 * the target language.
 */
export function shouldSkipTranslation(
  sourceLang: string,
  targetLang: string,
  transcription: string,
): boolean {
  if (!transcription || !transcription.trim()) return false
  const effectiveSource = sourceLang === 'auto' ? detectLanguage(transcription) : sourceLang
  if (!effectiveSource) return false
  return effectiveSource === targetLang
}
