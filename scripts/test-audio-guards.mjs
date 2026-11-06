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

const { isLikelyAsrHallucination, isLikelyAsrHallucinationSequence } = await import(
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
// they follow the characteristic counting hallucination burst from the ASR.
{
  check('keep standalone generic dialogue', isLikelyAsrHallucination("What's up?"), false);
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
