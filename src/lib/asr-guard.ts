/**
 * Guard against ASR "hallucinations" — text a speech model invents when it is
 * fed silence, music, or noise instead of speech.
 *
 * Whisper-family models do not return empty output for non-speech audio. They
 * return plausible text learned from their training data, and the same stock
 * lines appear across languages:
 *
 *   en: "Who are you?", "I need to go eat.", "Thanks for watching!",
 *       "Subtitles by the Amara.org community", "[whistle]", "123456789"
 *   zh: "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目", "字幕由…提供"
 *   ja: "ご視聴ありがとうございました"
 *
 * A subtitle pipeline that forwards these to translation turns a paused video
 * into confident bilingual nonsense. Energy gating upstream prevents most of
 * it; this list catches what slips through (loud music, encoder noise).
 *
 * Kept deliberately narrow: it must never eat real dialogue.
 */

/** Whole-line stock phrases. Matched against a whitespace-normalized string. */
const STOCK_LINES: RegExp[] = [
  // English
  /^(who are you|i need to go eat|i'?ll reach out to you|thank you for watching|thanks for watching|thanks? for (liking|subscribing)|please subscribe|like and subscribe|see you (next|in the next) (time|video))(?:[\s.!?…]*)$/i,
  /^(one[,.\s]+two[,.\s]+three[,.\s]+four[,.\s]+five[,.\s]+six[,.\s]+seven[,.\s]+eight[,.\s]+nine[,.\s]+ten|一[、,，\s]+二[、,，\s]+三[、,，\s]+四[、,，\s]+五[、,，\s]+六[、,，\s]+七[、,，\s]+八[、,，\s]+九[、,，\s]+十|一二三四五六七八九十)[.!?…。]*$/i,
  /^(subtitles? (by|provided by)|captions? by|transcri(bed|ption) by)\b.*$/i,
  /^(amara\.org|www\.amara\.org).*$/i,
  // Chinese: `\b` never matches between CJK characters, so these use explicit
  // anchors instead. The 「订阅」 CTA is only dropped when it *is* the whole
  // line, otherwise a real sentence like 「订阅号怎么注册」 disappears.
  /^(请不吝?点赞|请大家?点赞|点赞[、,，]?\s*订阅|感谢(您的)?观看|谢谢观看)/,
  /^(请?订阅|关注我们)[\s!！。.,，]*$/,
  /^(字幕由|字幕提供|本字幕由|字幕组)/,
  /^(明镜与点点|点点栏目)/,
  // Japanese
  /^(ご視聴ありがとうございました|チャンネル登録|高評価).*$/,
];

/** Bare non-speech annotations such as "[whistle]" or "（音乐）". */
const ANNOTATION_ONLY = /^[\[(（【]?\s*(whistle|music|silence|blank_?audio|inaudible|noise|applause|laughter|sighs?|音乐|掌声|笑声|静音|無音)\s*[\])）】]?$/i;

/** Pure numbers, punctuation or ellipses — never a real subtitle on their own. */
const NO_CONTENT = /^(?:[0-9\s.,，、:：;；!！?？'"“”‘’()（）\-—–_*/\\|]+|[.…·\s]+)$/;

/** A single character repeated 8+ times ("啊啊啊啊啊啊啊啊"). */
const DEGENERATE_RUN = /(.)\1{7,}/u;

function normalize(text: string): string {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEnglish(text: string): string {
  return normalize(text).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

const GENERIC_BURST_LINES = new Set(['what s up', 'keep it up', 'thank you']);
const COUNTING_BURST_LINE = 'one two three four five six seven eight nine ten';
const GENERIC_BURST_LINES_ZH = new Set(['谢谢', '加油']);
const COUNTING_BURST_LINE_ZH = '一二三四五六七八九十';

/** Normalize a zh counting line to its bare digits so separators don't matter. */
function normalizeChineseCounting(text: string): string {
  return normalize(text).replace(/[、,，\s。.!！?？…]/g, '');
}

/**
 * True when the transcript is almost certainly invented rather than heard.
 * Conservative by design: real speech that merely looks odd should pass.
 */
export function isLikelyAsrHallucination(text: string): boolean {
  const t = normalize(text);
  if (!t) return true;

  // Strip surrounding punctuation for the phrase checks.
  const bare = t.replace(/^[\s"'“”‘’(\[（【]+|[\s"'“”‘’)\]）】。.!！?？…]+$/g, '');
  if (!bare) return true;

  if (ANNOTATION_ONLY.test(t)) return true;
  if (NO_CONTENT.test(t)) return true;
  if (STOCK_LINES.some((re) => re.test(bare))) return true;
  if (DEGENERATE_RUN.test(t)) return true;

  return false;
}

/**
 * Detect the characteristic multi-segment noise burst shown by Whisper-like
 * models. The generic lines are intentionally not rejected on their own:
 * they are common, valid dialogue in a real programme.
 */
export function isLikelyAsrHallucinationSequence(history: string[], text: string): boolean {
  if (isLikelyAsrHallucination(text)) return true;

  const current = normalizeEnglish(text);
  if (GENERIC_BURST_LINES.has(current)) {
    return history
      .slice(-4)
      .some((candidate) => normalizeEnglish(candidate) === COUNTING_BURST_LINE);
  }

  // zh burst: bare 谢谢/加油 are common real dialogue, but right after the
  // zh counting line they are the same noise signature as the English burst.
  const bareZh = normalize(text).replace(/[。.!！?？…\s]+$/g, '');
  if (GENERIC_BURST_LINES_ZH.has(bareZh)) {
    return history
      .slice(-4)
      .some((candidate) => normalizeChineseCounting(candidate) === COUNTING_BURST_LINE_ZH);
  }

  return false;
}
