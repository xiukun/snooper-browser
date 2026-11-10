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
 * Whisper counting hallucination (observed: "一、二、三…一百六十二、一百" over
 * music, openai/whisper#1873 "123456789" is the ASCII cousin). The signature
 * is not a fixed phrase — it is *density of number tokens* inside one
 * segment. A real sentence can mention several numbers; it does not chain
 * dozens of comma-separated counting units as a single subtitle line.
 */
function isCountingSequence(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  // Split on list separators; count tokens that are purely a number.
  const tokens = t.split(/[、,，\s.。;；!！?？…]+/).filter(Boolean);
  if (tokens.length < 8) return false;
  let numeric = 0;
  for (const token of tokens) {
    if (/^[0-9〇零一二两三四五六七八九十百千万]+$/.test(token)) numeric += 1;
  }
  // 8+ tokens of which ≥ 85% are bare numbers: nobody speaks a pure list of
  // 8 numbers as one subtitle segment; a counter does.
  return numeric >= 8 && numeric / tokens.length >= 0.85;
}

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
  if (isCountingSequence(t)) return true;

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
  return isLikelyShortRepeatLoop(fullWindow, text);
}

/**
 * ADR-039: the stock lists above only cover the phrases that were reported
 * before. A decoder loop can emit any short line ("Speak up." in the reported
 * screenshot). Any short line that repeats exactly within the last four
 * segments is a loop, not speech.
 *
 * Exported separately because the same rule runs on the translated line:
 * similar source fragments ("你快" / "快快") can collapse into the same English
 * translation ("Speak up.") even when the ASR text differs.
 */
export function isLikelyShortRepeatLoop(fullWindow: string[], text: string): boolean {
  if (!isShortLine(text)) return false;
  const key = repeatKey(text);
  if (!key) return false;
  return fullWindow.slice(-4).some((candidate) => repeatKey(candidate) === key);
}

/* ===== ADR-042: sparse transcript ===== */

/**
 * Continuous audio for seconds reduced to one to three words is the shape of
 * a music/noise hallucination, not speech. Real speech emits a clause in that
 * time; genuine short utterances do not reach the duration floor because
 * `trimToSpeechBounds` removes their surrounding silence before `durationMs`
 * is measured (a 0.4 s "谢谢" in 3 s of quiet is a ~0.6 s segment).
 *
 * Thresholds are deliberately narrow. A long line (>4 words / >12 CJK) is
 * never judged here: the stock list and the repeat rules own that class.
 */
const SPARSE_MIN_DURATION_MS = 3000
const SPARSE_MAX_WORDS = 4
const SPARSE_MIN_WORDS_PER_SECOND = 0.85
const SPARSE_MAX_CJK = 12
const SPARSE_MIN_CJK_PER_SECOND = 1.2

export function isLikelySparseTranscript(text: string, durationMs: number): boolean {
  const t = normalize(text)
  if (!t) return true;
  if (!Number.isFinite(durationMs) || durationMs < SPARSE_MIN_DURATION_MS) return false;

  const seconds = durationMs / 1000;
  const cjk = countCjk(t);
  if (cjk > 0) {
    if (cjk > SPARSE_MAX_CJK) return false;
    return cjk / seconds < SPARSE_MIN_CJK_PER_SECOND;
  }

  const words = normalizeEnglish(t).split(' ').filter(Boolean);
  if (words.length === 0 || words.length > SPARSE_MAX_WORDS) return false;
  return words.length / seconds < SPARSE_MIN_WORDS_PER_SECOND;
}

/* ===== ADR-042: artifact burst ===== */

/**
 * Whole lines that are overwhelmingly artifacts when they appear in a run.
 * They stay valid as a first line after real content: this list is only used
 * with burst context, never as an unconditional blacklist.
 */
const ARTIFACT_LINES_EN = new Set([
  'i',
  'i love you',
  'thank you',
  'thanks',
  'go for it',
  'winnie the pooh',
  'three two one',
  'one two three',
]);

const ARTIFACT_LINES_CJK = new Set(['三二一', '小熊维尼']);

const BARE_MONTH_DATE =
  /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\s+\d{4}$/;

function artifactKey(text: string): string {
  return normalize(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cjkKey(text: string): string {
  return normalize(text).replace(/[、,，\s。.!！?？…]+/g, '');
}

export function isArtifactLine(text: string): boolean {
  const key = artifactKey(text);
  if (key && (ARTIFACT_LINES_EN.has(key) || BARE_MONTH_DATE.test(key))) return true;
  return ARTIFACT_LINES_CJK.has(cjkKey(text));
}

/**
 * A stock line that follows a filler or another stock line is the observed
 * music-bridge burst ("Hmm. / I. / I love you. / Thank you. / Go for it. /
 * Winnie the Pooh. / January 5, 2024."). A lone stock line after real speech
 * is kept: "Thank you." at the end of a talk is dialogue, not a hallucination.
 *
 * `recent` must contain accepted and rejected weak lines only (the capture
 * session clears it on a contentful line and after a long silence).
 */
export function isLikelyArtifactBurst(recent: string[], text: string): boolean {
  if (!isArtifactLine(text)) return false;
  return recent
    .slice(-4)
    .some((candidate) => isArtifactLine(candidate) || isFillerOnly(candidate));
}

/* ===== ADR-039: short repeats, language mismatch, fillers ===== */

/** CJK ideographs, kana and hangul — the scripts the capture app supports. */
function countCjk(text: string): number {
  const matches = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g);
  return matches ? matches.length : 0;
}

const SHORT_LINE_MAX_CJK = 12;
const SHORT_LINE_MAX_WORDS = 4;

/**
 * A line short enough that an exact repeat is a decoder loop rather than a
 * deliberate callback. Long lines can repeat in real speech (a refrain), but a
 * four-word phrase repeated across adjacent segments is the observed failure.
 */
function isShortLine(text: string): boolean {
  const bare = bareText(text);
  if (!bare) return false;
  const cjk = countCjk(bare);
  if (cjk > 0) return cjk <= SHORT_LINE_MAX_CJK;
  const words = normalizeEnglish(bare).split(' ').filter(Boolean);
  return words.length > 0 && words.length <= SHORT_LINE_MAX_WORDS;
}

/** Comparable form for repeat detection: punctuation-insensitive per script. */
function repeatKey(text: string): string {
  return countCjk(text) > 0 ? bareText(text) : normalizeEnglish(text);
}

/**
 * Configured source language vs. the script actually returned. Whisper-family
 * gateways occasionally ignore the `language` field and return English (or
 * Chinese) regardless of the audio; translating that output hides the failure
 * and produces confident nonsense.
 *
 * Deliberately only fires for explicit languages and for lines that look like
 * a sentence in the other script — a single romanized name must survive.
 */
export function isLikelyAsrLanguageMismatch(text: string, sourceLang: string): boolean {
  const lang = String(sourceLang || '').trim().toLowerCase();
  if (!lang || lang === 'auto') return false;
  const t = normalize(text);
  if (!t) return false;

  const cjk = countCjk(t);
  const latinWords = t.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  const latinLetters = latinWords.reduce(
    (sum, word) => sum + word.replace(/[^A-Za-z]/g, '').length,
    0,
  );
  const latinLooksLikeSentence = latinWords.length >= 2 && latinLetters >= 8;

  switch (lang) {
    case 'zh':
    case 'ja':
      return cjk === 0 && latinLooksLikeSentence;
    case 'ko':
      return !/[\uac00-\ud7af]/.test(t) && latinLooksLikeSentence;
    case 'en':
      return latinWords.length === 0 && cjk > 0;
    default:
      return false;
  }
}

/**
 * Backchannels and fillers. They are real speech and stay in the transcript,
 * but the overlay dims them so "Ah. / Hmm. / 嗯。" does not compete with the
 * lecture. Matching is whole-line only: "Ah, I see." is content.
 */
const FILLER_ONLY = new RegExp(
  '^(?:' +
    [
      'ah+', 'oh+', 'uh+', 'um+', 'hmm+', 'mm+', 'eh+', 'hey', 'hi', 'hello',
      'well', 'okay', 'ok', 'yeah', 'yep', 'yes', 'no', 'right', 'alright',
      'wow', 'ouch', 'huh+', 'aha+', 'ha+', 'bye', 'thanks?', 'sorry', 'please',
      '嗯+', '啊+', '哦+', '噢+', '呃+', '唉+', '哎+', '呀+', '哈+', '嘿+',
      '喂+', '好+', '对+', '是+', '行+', '可以', '好吧', '谢谢', '抱歉',
      '不好意思',
    ].join('|') +
    ')[\\s.。!！?？…,，、~～]*$',
  'i',
);

export function isFillerOnly(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  return FILLER_ONLY.test(t);
}
