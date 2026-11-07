/**
 * Regression tests for the companion chat's state reconciliation.
 *
 * The duplicate-bubble bug was a race: the background pushed the assistant
 * answer through SESSION_UPDATE while the content script also appended the
 * answer from the ASK response. These helpers make the decision explicit.
 *
 *   node scripts/test-chat-state.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'snooper-chat-state-'));
const out = join(outDir, 'chat-state.mjs');

execSync(
  `npx esbuild src/ext/chat-state.ts --bundle --format=esm --log-level=error --outfile=${out}`,
  { stdio: 'inherit' },
);

const { hasAssistantTail, isLatestAssistantReply, chatRenderSignature } = await import(
  pathToFileURL(out).href
);

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

/* ---------- 1. Answer de-duplication ---------- */

check('an empty history does not already hold an answer', isLatestAssistantReply([], 'answer'), false);
check(
  'a trailing user message does not count as the answer',
  isLatestAssistantReply([{ role: 'user', content: 'question' }], 'answer'),
  false,
);
check(
  'a different assistant message does not count',
  isLatestAssistantReply([{ role: 'assistant', content: 'old answer' }], 'answer'),
  false,
);
check(
  'the same assistant message is already rendered',
  isLatestAssistantReply([
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'answer' },
  ], 'answer'),
  true,
);
check(
  'only the last message is considered',
  isLatestAssistantReply([
    { role: 'assistant', content: 'answer' },
    { role: 'user', content: 'next question' },
  ], 'answer'),
  false,
);
check(
  'attachments do not hide an already rendered answer',
  isLatestAssistantReply([
    { role: 'assistant', content: 'answer', images: ['data:image/png;base64,AA'] },
  ], 'answer'),
  true,
);
check('an empty history has no assistant tail', hasAssistantTail([]), false);
check(
  'a trailing user message is not an assistant tail',
  hasAssistantTail([{ role: 'user', content: 'question' }]),
  false,
);
check(
  'a trailing assistant message is an assistant tail',
  hasAssistantTail([
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'whitespace-normalized answer' },
  ]),
  true,
);

/* ---------- 2. Redundant render suppression ---------- */

const base = [
  { role: 'user', content: 'question', images: ['data:image/png;base64,AA'] },
  { role: 'assistant', content: 'answer' },
];
check('the same history has a stable signature', chatRenderSignature(base), chatRenderSignature([...base]));
check(
  'a content change invalidates the signature',
  chatRenderSignature(base) === chatRenderSignature([base[0], { role: 'assistant', content: 'new answer' }]),
  false,
);
check(
  'an image count change invalidates the signature',
  chatRenderSignature(base) === chatRenderSignature([
    { ...base[0], images: [...base[0].images, 'data:image/png;base64,BB'] },
    base[1],
  ]),
  false,
);
check(
  'roles are part of the signature',
  chatRenderSignature([{ role: 'user', content: 'same' }]) ===
    chatRenderSignature([{ role: 'assistant', content: 'same' }]),
  false,
);

/* ---------- 3. ASK response / SESSION_UPDATE race ---------- */

// Mirrors the reconciliation branch in submitQuestion().
const reconcileAskAnswer = (current, answer, backgroundMessages) => {
  if (isLatestAssistantReply(current, answer)) return current;
  if (backgroundMessages) {
    const next = [...backgroundMessages];
    if (!hasAssistantTail(next)) next.push({ role: 'assistant', content: answer });
    return next;
  }
  return [...current, { role: 'assistant', content: answer }];
};

const question = { role: 'user', content: 'question' };
const answer = { role: 'assistant', content: 'answer' };

check(
  'SESSION_UPDATE first: the canonical answer is not appended twice',
  reconcileAskAnswer([question, answer], 'answer', [question, answer]),
  [question, answer],
);
check(
  'ASK response first: the returned session replaces the optimistic list',
  reconcileAskAnswer([question], 'answer', [question, answer]),
  [question, answer],
);
check(
  'whitespace-normalized background text still has one assistant bubble',
  reconcileAskAnswer([question], 'answer', [question, { role: 'assistant', content: 'answer ' }]),
  [question, { role: 'assistant', content: 'answer ' }],
);
check(
  'without a returned session the answer is appended exactly once',
  reconcileAskAnswer([question], 'answer', null),
  [question, answer],
);

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`✅ ${passed} chat-state checks passed`);
