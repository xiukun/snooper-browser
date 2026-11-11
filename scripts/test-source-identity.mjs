/** Source identities and guarded seeks execute the real browser modules. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'snooper-source-'))
try {
  const out = join(dir, 'test.mjs')
  await build({ stdin: { resolveDir: process.cwd(), contents: `export * from '${resolve('src/lib/video-key.ts')}'; export * from '${resolve('src/ext/content/video-context.ts')}'; export * from '${resolve('src/ext/content/video-seek.ts')}'; export * from '${resolve('src/ext/content/video-clock.ts')}'; export * from '${resolve('src/ext/background/source-opening.ts')}';` }, bundle: true, format: 'esm', outfile: out, logLevel: 'silent' })
  const mod = await import(pathToFileURL(out))
  const p1 = 'https://www.bilibili.com/video/BV1xx411c7mD?p=1'
  const p2 = 'https://www.bilibili.com/video/BV1xx411c7mD?p=2'
  assert.notEqual(mod.videoKeyForUrl(p1), mod.videoKeyForUrl(p2), 'Bilibili P1 and P2 must be separate lessons')
  assert.equal(mod.videoKeyForUrl(p2), mod.videoKeyForUrl(p2 + '&spm_id_from=tracking'))
  assert.equal(mod.videoKeyForUrl(p1), mod.videoKeyForUrl(p1.split('?')[0]))
  for (const suffix of ['0', '-1', 'no', '1.5', '', '2&p=3']) {
    const source = mod.sourceRefForUrl(p1.split('?')[0] + '?p=' + suffix, 'Title', 'fixture')
    assert.equal(source.confidence, 'unknown')
    assert.notEqual(source.key, mod.videoKeyForUrl(p1))
  }
  assert.equal(mod.sourceRefForUrl('https://www.bilibili.com/festival/course').confidence,'unknown')
  assert.notEqual(mod.sourceRefForUrl('https://example.test/course','', 'record1').key,mod.sourceRefForUrl('https://example.test/course','', 'record2').key)
  const yt = mod.videoKeyForUrl('https://www.youtube.com/watch?v=abc123')
  assert.equal(yt, mod.videoKeyForUrl('https://youtu.be/abc123?t=4'))
  assert.equal(yt, mod.videoKeyForUrl('https://www.youtube.com/shorts/abc123'))
  globalThis.location = { href: p2 }
  globalThis.document = { title: 'Course_哔哩哔哩_bilibili', querySelectorAll: () => [] }
  const context = mod.readVideoContext()
  assert.equal(context.videoTime, null, 'missing video must never become a zero-second anchor')
  assert.equal(context.sourceRef.confidence, 'exact')
  assert.deepEqual(mod.seekTo(45, mod.videoKeyForUrl(p1)), { ok: false, reason: 'mismatched-source' })
  assert.deepEqual(mod.seekTo(45, context.videoKey), { ok: false, reason: 'no-video' })
  assert.deepEqual(mod.seekTo(NaN, context.videoKey), { ok: false, reason: 'seek-failed' })
  const events = {}, ticks = [], samples = []
  globalThis.window = { innerWidth:1000, innerHeight:800, getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',objectFit:'contain'}), setInterval(fn){ticks.push(fn);return ticks.length}, addEventListener(type, fn){events[type]=fn} }
  const mediaEvents = {}
  document.addEventListener = (type, fn) => { mediaEvents[type] = fn }
  const video = { tagName:'VIDEO',currentTime:3,videoWidth:800,videoHeight:600,readyState:4,isConnected:true,paused:true,playbackRate:1,ownerDocument:{defaultView:window},getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),pause(){this.paused=true} }
  document.querySelectorAll = selector => selector === 'video' ? [video] : []
  assert.equal(mod.readVideoContext().videoTime,3)
  assert.deepEqual(mod.seekTo(5,context.videoKey),{ok:true,time:4.75})
  assert.equal(video.currentTime,4.75)
  const sourceClock = mod.createVideoClock({isActive:()=>true,send:s=>samples.push(s)})
  sourceClock.start()
  assert.equal(samples.at(-1).sourceRef.key,context.videoKey)
  location.href = p1
  ticks[0]()
  assert.equal(samples.at(-1).sourceRef.key,mod.videoKeyForUrl(p1))
  location.href += '&spm_id_from=tracking'
  mediaEvents.loadedmetadata({type:'loadedmetadata',target:video})
  assert.equal(samples.at(-1).sourceRef.key,mod.videoKeyForUrl(p1))
  const opened = []
  globalThis.chrome = {tabs:{async sendMessage(_,m){ return {ok:true,seek:mod.seekTo(m.seconds,m.expectedSourceKey)} },async create(tab){opened.push(tab)}}}
  const source1 = mod.sourceRefForUrl(p1,'P1')
  assert.equal((await mod.openSource(source1,6,7)).action,'seeked')
  const source2 = mod.sourceRefForUrl(p2,'P2')
  assert.equal((await mod.openSource(source2,90,7)).action,'opened')
  assert.equal(new URL(opened.at(-1).url).searchParams.get('p'),'2')
  assert.equal(new URL(opened.at(-1).url).searchParams.get('t'),'90')
  assert.equal((await mod.openSource(source2,null,7)).action,'opened')
  assert.equal(opened.at(-1).url,p2)
  assert.equal((await mod.openSource({...source2,confidence:'legacy',key:'legacy:record'},90,7)).action,'opened')
  assert.equal(opened.at(-1).url,p2)
  assert.equal((await mod.openSource({url:'javascript:alert(1)'},0,7)).ok,false)
  console.log('source-identity: lesson keys, invalid parts, aliases, nullable context and guarded seeks passed')
} finally { rmSync(dir, { recursive: true, force: true }) }
