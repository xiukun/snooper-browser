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
 * The provider used here returns only `json.text` — no no_speech_prob /
 * avg_logprob / compression_ratio — so server-side metric filtering
 * (whisper-guard's L1/L2) is impossible. Everything below is the text-side
 * analogue of what those packages do, informed by:
 *
 *   - whisper-guard (vulture-s) L3 repetition: unique-chunk ratio < 0.35
 *   - whisper-guard L4 char loops: 2–4 chars repeated 3+ times
 *   - Vexa hallucination blocklists (135+ en phrases, community zh/ja)
 *   - whisper-cleanup: short everyday phrases need context, not a ban
 *   - openai/whisper#1873 production post-filter (repeated-line cut)
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

/**
 * whisper-guard L4: a short unit looped several times is a decoder loop, not
 * speech. The unit is 2–4 characters ("加油加油加油", "xyzxyzxyzxyz"); a
 * single repeated char is already covered by DEGENERATE_RUN. All punctuation
 * is stripped first — "小心。小心。小心。" is the same loop as "小心小心小心".
 */
function isCharacterLoop(text: string): boolean {
  // ASR casing can drift between repeated ASCII syllables ("Yayayaya"),
  // while the underlying decoder loop is still the same sequence.
  const t = normalize(text).replace(/[。.!！?？…，,、;；:：\s]+/g, '').toLowerCase();
  if (t.length < 6) return false;
  for (let len = 2; len <= 4; len++) {
    const unit = t.slice(0, len);
    if (!unit) continue;
    let repeats = 1;
    let pos = len;
    while (pos + len <= t.length && t.slice(pos, pos + len) === unit) {
      repeats++;
      pos += len;
    }
    if (repeats >= 3) return true;
  }
  return false;
}

function normalize(text: string): string {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** normalize + trailing-punctuation strip: the comparable form of a line. */
function bareText(text: string): string {
  return normalize(text).replace(/[。.!！?？…\s]+$/g, '');
}

function normalizeEnglish(text: string): string {
  return normalize(text).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

const GENERIC_BURST_LINES = new Set(['what s up', 'keep it up', 'thank you', 'be careful', 'you go']);
const COUNTING_BURST_LINE = 'one two three four five six seven eight nine ten';
const GENERIC_BURST_LINES_ZH = new Set(['谢谢', '加油', '小心', '你去']);
const COUNTING_BURST_LINE_ZH = '一二三四五六七八九十';

// These are common ASR continuations after a non-lexical decoder loop. They
// remain valid dialogue on their own; only a nearby rejected character loop
// makes them suspicious.
const NOISE_BURST_CONTINUATIONS_EN = new Set(['come out here', 'thank you all']);
const NOISE_BURST_CONTINUATIONS_ZH = new Set(['有人吗']);

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
  if (isCharacterLoop(t)) return true;

  return false;
}

/**
 * Burst evidence window (rejected lines only, maintained by capture.ts).
 *
 * Generic one-liners are common, valid dialogue — standalone they must pass.
 * They become hallucination evidence only in company:
 *
 *   1. right after the characteristic counting burst (original guard), or
 *   2. while a generic line is already under suspicion — the tail of a noise
 *      burst continues emitting stock lines ("Keep it up. / You go.") even
 *      though no two of them repeat.
 */
export function isLikelyAsrHallucinationSequence(rejectedHistory: string[], text: string): boolean {
  if (isLikelyAsrHallucination(text)) return true;

  const recent = rejectedHistory.slice(-4);
  const current = normalizeEnglish(text);
  const followsCharacterLoop = recent.some((candidate) => isCharacterLoop(candidate));

  if (GENERIC_BURST_LINES.has(current)) {
    if (recent.some((candidate) => normalizeEnglish(candidate) === COUNTING_BURST_LINE)) {
      return true;
    }
    if (recent.some((candidate) => GENERIC_BURST_LINES.has(normalizeEnglish(candidate)))) {
      return true;
    }
    if (followsCharacterLoop) {
      return true;
    }
  }

  if (NOISE_BURST_CONTINUATIONS_EN.has(current) && followsCharacterLoop) {
    return true;
  }

  // zh burst: bare 谢谢/加油 are common real dialogue, but a counting-burst
  // neighbour or a second generic line inside an active zh burst are the
  // noise signature.
  const bareZh = bareText(text);
  if (GENERIC_BURST_LINES_ZH.has(bareZh)) {
    if (recent.some((candidate) => normalizeChineseCounting(candidate) === COUNTING_BURST_LINE_ZH)) {
      return true;
    }
    if (recent.some((candidate) => GENERIC_BURST_LINES_ZH.has(bareText(candidate)))) {
      return true;
    }
    if (followsCharacterLoop) {
      return true;
    }
  }

  if (NOISE_BURST_CONTINUATIONS_ZH.has(bareZh) && followsCharacterLoop) {
    return true;
  }

  return false;
}

/**
 * Repeat confirmation window (ALL recent lines — accepted and rejected alike,
 * maintained by capture.ts).
 *
 * The reported failure mode is a loop: "Keep it up. / 加油。" cycling over
 * noise forever. Each member passes standalone, and the burst evidence window
 * is cleared on every accept, so the loop never accumulates evidence there.
 * Only the full window can confirm it: a real speaker does not emit the same
 * 2–3 word stock line as separate back-to-back segments, a noise decoder does
 * (openai/whisper#1873 drops exact repeats for the same reason).
 *
 * Deliberately restricted to the generic stock lines. Arbitrary short
 * repeats ("你好吗" twice) stay — echo/chant dialogue is real.
 */
export function isLikelyAsrRepeatLoop(fullWindow: string[], text: string): boolean {
  const currentEn = normalizeEnglish(text);
  if (GENERIC_BURST_LINES.has(currentEn)) {
    if (fullWindow.some((candidate) => normalizeEnglish(candidate) === currentEn)) return true;
    return false;
  }
  const currentZh = bareText(text);
  if (GENERIC_BURST_LINES_ZH.has(currentZh)) {
    return fullWindow.some((candidate) => bareText(candidate) === currentZh);
  }
  return false;
}
