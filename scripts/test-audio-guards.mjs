/**
 * Regression tests for the two guards that keep invented subtitles out of the
 * pipeline: the energy gate (`lib/audio-segments.ts`) and the stock-phrase
 * filter (`lib/asr-guard.ts`).
 *
 * No test framework: the repo has none, and these are pure functions. Bundles
 * the TS with esbuild (already a build dependency), imports the ESM output and
 * asserts.
 *
 *   node scripts/test-audio-guards.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-guards-'));
const bundle = (entry, name) => {
  const out = join(outDir, name);
  execSync(
    `npx esbuild ${entry} --bundle --format=esm --log-level=error --outfile=${out}`,
    { stdio: 'inherit' },
  );
  return out;
};

const { isLikelyAsrHallucination, isLikelyAsrHallucinationSequence, isLikelyAsrRepeatLoop } = await import(
  pathToFileURL(bundle('src/lib/asr-guard.ts', 'asr-guard.mjs')).href
);
const {
  computeRMS,
  speechDurationMs,
  trimToSpeechBounds,
  MIN_SPEECH_MS,
} = await import(
  pathToFileURL(bundle('src/lib/audio-segments.ts', 'audio-segments.mjs')).href
);

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (actual === expected) {
    passed++;
  } else {
    failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
};

/* ---------- 1. Stock-phrase filter ---------- */

const hallucinations = [
  'Who are you?',
  'I need to go eat.',
  "I'll reach out to you.",
  'Thanks for watching!',
  'Subtitles by the Amara.org community',
  '123456789',
  '[whistle]',
  '[whistle',
  '...',
  '请不吝点赞 订阅 转发 打赏支持明镜与点点栏目',
  '字幕由Amara.org社区提供',
  'ご視聴ありがとうございました',
  '啊啊啊啊啊啊啊啊',
  'One, two, three, four, five, six, seven, eight, nine, ten.',
  '一、二、三、四、五、六、七、八、九、十。',
  '一、二、三、四、五、六、七、八、九、十',
  '一 二 三 四 五 六 七 八 九 十',
  '一二三四五六七八九十',
];

const realLines = [
  '今天我们来讲一下 Midway.js 的过滤器。',
  "That's a good question.",
  '他今年 30 岁。',
  '[音乐] 这段旋律其实很有讲究',
  '1. 打开项目目录',
  '订阅号怎么注册',
  'const a = 1;',
];

for (const text of hallucinations) {
  check(`drop hallucination: ${text.slice(0, 24)}`, isLikelyAsrHallucination(text), true);
}
for (const text of realLines) {
  check(`keep real line: ${text.slice(0, 24)}`, isLikelyAsrHallucination(text), false);
}

// Generic one-liners can be real dialogue. They become suspicious only when
// they follow the characteristic counting hallucination burst from the ASR,
// or when the same short generic line repeats within a few segments — the
// reported "Keep it up. / 加油。" loop has no counting line at all.
// Chinese 谢谢。/加油。 behave the same way after the zh counting burst.
{
  check('keep standalone generic dialogue', isLikelyAsrHallucination("What's up?"), false);
  check('keep standalone 谢谢', isLikelyAsrHallucination('谢谢。'), false);
  check('keep standalone 加油', isLikelyAsrHallucination('加油。'), false);
  check('keep standalone 小心', isLikelyAsrHallucination('小心。'), false);
  check('keep standalone Be careful', isLikelyAsrHallucination('Be careful.'), false);
  const burst = [
    'One, two, three, four, five, six, seven, eight, nine, ten.',
    "What's up?",
    'Keep it up.',
    'Thank you.',
  ];
  const history = [];
  for (const text of burst) {
    check(`drop hallucination sequence: ${text.slice(0, 20)}`, isLikelyAsrHallucinationSequence(history, text), true);
    history.push(text);
  }
  const zhBurst = [
    '一、二、三、四、五、六、七、八、九、十。',
    '谢谢。',
    '加油。',
  ];
  const zhHistory = [];
  for (const text of zhBurst) {
    check(`drop zh hallucination sequence: ${text.slice(0, 12)}`, isLikelyAsrHallucinationSequence(zhHistory, text), true);
    zhHistory.push(text);
  }

  // The user-reported pattern: a repeat loop with no counting burst. Driven
  // through a faithful simulation of the capture.ts state machine: rejected
  // lines feed the burst window (cleared on accept), all lines feed the
  // repeat window.
  const pipeline = () => {
    let candidates = [];
    let window = [];
    return (text) => {
      const dropped =
        isLikelyAsrHallucinationSequence(candidates, text) ||
        isLikelyAsrRepeatLoop(window, text);
      if (dropped) {
        candidates = [...candidates.slice(-5), text];
      } else {
        candidates = [];
      }
      window = [...window.slice(-2), text];
      return dropped;
    };
  };

  // Each occurrence is accepted until the repeat confirms the loop; after
  // the confirmation the burst window is hot and new generic lines drop.
  const enPipe = pipeline();
  check('reported: first Keep it up accepted', enPipe('Keep it up.'), false);
  check('reported: first Be careful accepted', enPipe('Be careful.'), false);
  check('reported: repeated Keep it up dropped', enPipe('Keep it up.'), true);
  check('reported: You go dropped (burst active)', enPipe('You go.'), true);
  // A genuine coach line resets the burst window and evicts the loop from
  // the repeat window, so speech returns to normal immediately.
  check('recovery: real sentence accepted', enPipe('Nice depth on that squat, keep your back straight'), false);
  check('recovery: generic line accepted again', enPipe('Be careful.'), false);

  const zhPipe = pipeline();
  check('zh reported: first 加油 accepted', zhPipe('加油。'), false);
  check('zh reported: first 小心 accepted', zhPipe('小心。'), false);
  check('zh reported: repeated 加油 dropped', zhPipe('加油。'), true);
  check('zh reported: 你去 dropped (burst active)', zhPipe('你去。'), true);
  check('zh recovery: real sentence accepted', zhPipe('这个动作要慢一点，腰背挺直'), false);
  check('zh recovery: generic line accepted again', zhPipe('小心。'), false);
}

// whisper-guard L4: a 2–4 char unit looped 3+ times is a decoder loop.
{
  check('char loop zh: 加油x3', isLikelyAsrHallucination('加油加油加油'), true);
  check('char loop en: xyzxyzxyz', isLikelyAsrHallucination('xyzxyzxyzxyz'), true);
  check('char loop with punctuation', isLikelyAsrHallucination('小心。小心。小心。'), true);
  check('two repeats is still speech', isLikelyAsrHallucination('加油加油'), false);
  check('longer real phrase with repetition passes', isLikelyAsrHallucination('我们一起加油，一起努力'), false);
}

// Exact-repeat loop: the repeat rule is restricted to the generic stock
// lines — arbitrary short repeats ("你好吗" twice) are real echo/chant
// dialogue and must pass.
{
  const h1 = [];
  check('echo dialogue: 你好吗 twice passes', isLikelyAsrHallucinationSequence(h1, '你好吗'), false);
  check('echo dialogue: repeated 你好吗 not a loop', isLikelyAsrRepeatLoop(['你好吗'], '你好吗。'), false);
  check('echo dialogue: long line passes alone', isLikelyAsrHallucinationSequence([], '今天我们要讲的内容是关于浏览器扩展开发的一些基本概念和最佳实践'), false);
  check('exact repeat: thank you loop confirmed', isLikelyAsrRepeatLoop(['Thank you.'], 'Thank you!'), true);
  check('exact repeat: zh 谢谢 loop confirmed', isLikelyAsrRepeatLoop(['谢谢。'], '谢谢！'), true);
}

/* ---------- 2. Energy gate + trimming ---------- */

const SAMPLE_RATE = 16000;
const FRAME = 320; // 20 ms
const AAC_FRAME_MS = (FRAME / SAMPLE_RATE) * 1000;

const silenceFrame = () => new Int16Array(FRAME);
const speechFrame = () => {
  const frame = new Int16Array(FRAME);
  for (let i = 0; i < FRAME; i++) frame[i] = Math.round(12000 * Math.sin(i / 4));
  return frame;
};

function buildFrames(spec) {
  const frames = [];
  for (const [count, kind] of spec) {
    for (let i = 0; i < count; i++) frames.push(kind === 'speech' ? speechFrame() : silenceFrame());
  }
  return frames;
}

function flatten(frames) {
  const pcm = new Int16Array(frames.length * FRAME);
  frames.forEach((frame, index) => pcm.set(frame, index * FRAME));
  return pcm;
}

function stats(frames) {
  return {
    pcm: flatten(frames),
    frameRms: frames.map(computeRMS),
    frameLens: frames.map((frame) => frame.length),
  };
}

// Paused video: 5 s of digital silence must never reach ASR.
{
  const { pcm, frameRms, frameLens } = stats(buildFrames([[250, 'silence']]));
  const speechMs = speechDurationMs(frameRms, frameLens, SAMPLE_RATE);
  check('paused: no speech energy', speechMs, 0);
  check('paused: gate drops', speechMs < MIN_SPEECH_MS, true);
  check('paused: trim leaves input alone', trimToSpeechBounds(pcm, frameRms, frameLens, SAMPLE_RATE).length, pcm.length);
}

// One second of speech followed by three seconds of silence: keep, then trim.
{
  const { pcm, frameRms, frameLens } = stats(buildFrames([[50, 'speech'], [150, 'silence']]));
  const speechMs = speechDurationMs(frameRms, frameLens, SAMPLE_RATE);
  check('speech: energy counted', speechMs >= 990 && speechMs <= 1010, true);
  check('speech: gate keeps', speechMs >= MIN_SPEECH_MS, true);

  const trimmed = trimToSpeechBounds(pcm, frameRms, frameLens, SAMPLE_RATE);
  const trimmedMs = (trimmed.length / SAMPLE_RATE) * 1000;
  // 1000 ms of speech + one 120 ms pad; the speech starts at frame 0.
  check('speech: trimmed to speech plus pad', trimmedMs >= 1100 && trimmedMs <= 1140, true);
}

// A 200 ms click (notification, UI sound) is not speech.
{
  const { frameRms, frameLens } = stats(buildFrames([[10, 'speech'], [240, 'silence']]));
  check('blip: gate drops', speechDurationMs(frameRms, frameLens, SAMPLE_RATE) < MIN_SPEECH_MS, true);
}

// Degenerate input must not throw.
{
  check('empty: no energy', speechDurationMs([], [], SAMPLE_RATE), 0);
  check('empty: trim', trimToSpeechBounds(new Int16Array(0), [], [], SAMPLE_RATE).length, 0);
  check('frame duration', Math.round(AAC_FRAME_MS), 20);
}

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log(`${passed} passed, 0 failed`);
