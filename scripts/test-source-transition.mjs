/** Actual capture, frame, routing, storage and restart integration with delayed providers. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'snooper-transition-'))
const values = {}, snapshot = {}, listeners = [], sent = [], intervals = []
let rejectLocal = false, rejectSession = false, mod, captureMetaOverride, requestStreamCount = 0
const realSetInterval = globalThis.setInterval
const area = store => ({
  async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in store).map(k => [k, structuredClone(store[k])])) },
  async set(items) { if (store === values && rejectLocal || store === snapshot && rejectSession) throw new Error('quota'); Object.assign(store, structuredClone(items)); if (store === values) await localSetHook?.(items) },
  async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k] },
})
const deferred = () => Promise.withResolvers()
const asr = deferred(), frame = deferred(), summary = deferred()
let localSetHook = null
globalThis.__summaryApi = () => summary.promise
let asrStarted = false, frameStarted = false, translationContext = null
const emitted = []
globalThis.__sourceApi = {
  async transcribeAudio() { asrStarted = true; return asr.promise },
  async translateTextStream(text, options) { translationContext = options.context; options.onDelta('旧课节'); return '旧课节手机与电脑的工作原理' },
  async readScreenCaption() { frameStarted = true; return frame.promise },
}
const sender = { url: 'chrome-extension://test/offscreen.html' }
const dispatch = message => new Promise(resolve => {
  const handled = listeners.at(-1)?.(message, sender, resolve)
  if (!handled) resolve({ok:true})
})
globalThis.chrome = {
  storage: { local: area(values), session: area(snapshot) },
  tabs: { async sendMessage(_, m) { sent.push(structuredClone(m)) } },
  tabCapture: { getMediaStreamId() { requestStreamCount++ } },
  runtime: {
    getURL: p => `chrome-extension://test/${p}`,
    onMessage: { addListener(fn) { listeners.push(fn) } },
    async getContexts() { return [{contextType:'OFFSCREEN_DOCUMENT'}] },
    async sendMessage(m) {
      emitted.push(structuredClone(m))
      if (m.target === 'offscreen') {
        if (m.type === 'PREPARE_CAPTURE_SOURCE') return mod.prepareCaptureSource(m.tabId, m.generation, m.sourceEpoch)
        if (m.type === 'SET_CAPTURE_SOURCE') return mod.setCaptureSource(m.tabId, m.generation, m.previousSourceEpoch, m.sourceEpoch, m.sourceRef)
        if (m.type === 'GET_CAPTURE_SESSIONS') return captureMetaOverride || { ok:true, sessions:Object.fromEntries([...mod.captureSessions].map(([id,s]) => [id,s.generation])), sources:Object.fromEntries([...mod.captureSessions].map(([id,s]) => [id,{sourceEpoch:s.sourceEpoch,bindings:s.sourceBindings}])) }
        if (m.type === 'STOP_CAPTURE') return {ok:true}
      }
      return dispatch(m)
    },
  },
  offscreen: { async hasDocument() { return true }, async closeDocument() {} },
}
globalThis.document = { createElement(tag) { assert.equal(tag,'canvas'); return { width:128,height:8,getContext() { return { drawImage() {}, getImageData() { return {data:new Uint8ClampedArray(128*8*4).fill(120)} } } }, toDataURL() { return 'data:image/jpeg;base64,fixture' } } } }
globalThis.setInterval = fn => { intervals.push(fn); return intervals.length }
try {
  const out = join(dir, 'test.mjs')
  await build({ stdin:{resolveDir:process.cwd(),contents:['src/ext/background/session-store.ts','src/ext/background/source-sessions.ts','src/ext/background/router/offscreen-events.ts','src/ext/background/transcript-store.ts','src/ext/background/video-clock.ts','src/ext/background/recovery.ts','src/ext/background/router/session.ts','src/ext/background/notes-store.ts','src/ext/offscreen/capture.ts','src/ext/offscreen/screen-caption.ts'].map(p => `export * from '${resolve(p)}';`).join('\n')}, bundle:true,format:'esm',outfile:out,logLevel:'silent',define:{'import.meta.env':'{}'},plugins:[{name:'provider-fixture',setup(b){b.onLoad({filter:/background\/llm\.ts$/},()=>({contents:'export const askLLM = () => globalThis.__summaryApi();',loader:'ts'}));b.onLoad({filter:/offscreen\/api\.ts$/},()=>({contents:'export const transcribeAudio = (...a) => globalThis.__sourceApi.transcribeAudio(...a); export const translateTextStream = (...a) => globalThis.__sourceApi.translateTextStream(...a); export const readScreenCaption = (...a) => globalThis.__sourceApi.readScreenCaption(...a);',loader:'ts'}))}}] })
  mod = await import(pathToFileURL(out))
  mod.registerOffscreenEventRouter()
  const old = mod.createSession(7)
  old.state='running'; old.generation=11
  mod.bindInitialSource(old,'https://www.bilibili.com/video/BV1?p=1','P1')
  await mod.ensureTranscript(old)
  const oldId=old.transcriptId, oldEpoch=old.sourceEpoch
  const before=Date.now()-1000
  mod.recordVideoClock(7,{at:before,videoTime:11,paused:true,rate:1},oldEpoch)
  const pcm = Int16Array.from({length:16000},(_,i) => Math.round((0.3 + 0.18*Math.sin(i/16000*Math.PI*6)) * (Math.sin(i/16000*Math.PI*2*350)+0.4*Math.sin(i/16000*Math.PI*2*700)) * 16000))
  const capture={tabId:7,generation:11,sourceEpoch:oldEpoch,sourceBindings:{[oldEpoch]:{sourceRef:old.sourceRef,pending:0}},sourceLang:'en',targetLang:'zh',config:{},pcmBuffer:[pcm],frameRms:Array.from({length:50},(_,i)=>0.1+0.08*Math.sin(i)),frameLens:Array(50).fill(320),segmentStartTime:before,pendingTranscriptions:0,aborted:false,captureStopped:false,draining:false,recentContext:[{source:'old lesson context',target:'旧课节上下文'}],recentAsrCandidates:[],recentAsrWindow:[],recentWeakWindow:[],lastAsrAt:0,videoEl:{readyState:2,videoWidth:800,videoHeight:600}}
  mod.captureSessions.set(7,capture)
  const audioJob=mod.finalizeSegment(7)
  assert.equal(asrStarted,true,'fixture must reach actual ASR pipeline')
  mod.startScreenCaption({tabId:7,generation:11,config:{},targetLang:'zh'})
  intervals.at(-1)()
  assert.equal(frameStarted,true,'fixture must reach actual frame provider')
  assert.equal(capture.sourceBindings[oldEpoch].pending,2)
  capture.pcmBuffer=[new Int16Array(100)]; capture.frameRms=[0.1]; capture.frameLens=[100]
  const next=await mod.transitionSource(7,{key:'ignored',url:'https://www.bilibili.com/video/BV1?p=2',title:'P2',confidence:'exact'})
  assert.notEqual(next.sourceEpoch,oldEpoch)
  assert.notEqual(next.transcriptId,oldId)
  assert.equal(next.generation,11)
  assert.equal(requestStreamCount,0)
  assert.equal(capture.pcmBuffer.length,0,'source boundary cuts buffered PCM')
  assert.equal(capture.sourceContext.recentContext.length,0)
  mod.recordVideoClock(7,{at:Date.now(),videoTime:90,paused:true,rate:1},next.sourceEpoch)
  assert.equal((await mod.getTranscriptRecord(oldId)).status,'recording','old transcript waits for both pending requests')
  // Tracking-only churn must not replace the stream or transcript.
  assert.equal((await mod.transitionSource(7,{url:next.sourceRef.url+'&spm_id_from=tracking',title:'P2'})).transcriptId,next.transcriptId)
  // Worker restart keeps both active/retiring bindings and the original records.
  await mod.persistSessionsStrict()
  const restarted=await import(`${pathToFileURL(out)}?restart`)
  await restarted.recoverSessions()
  assert.equal(restarted.sessions.get(7).sourceEpoch,next.sourceEpoch)
  assert.equal(restarted.sessions.get(7).transcriptId,next.transcriptId)
  assert.equal(restarted.sessions.get(7).retiringSources[0].transcriptId,oldId)
  // Complete the frame first: old display arbitration must not suppress the later old audio body.
  frame.resolve({source:'screen from old lesson',target:'旧画面'})
  for(let i=0;i<20 && capture.sourceBindings[oldEpoch]?.pending===2;i++) await new Promise(r=>setTimeout(r,0))
  assert.equal(next.lastScreenAt,0,'old frame must not suppress current audio')
  assert.equal((await mod.getTranscriptRecord(oldId)).status,'recording','pending audio still owns old epoch')
  asr.resolve('The phone and computer use different processors for this lesson.')
  await audioJob
  assert.ok(translationContext.includes('old lesson context'))
  assert.equal(capture.sourceContext.recentContext.length,0,'late old translation cannot seed new context')
  assert.equal(next.subtitles.length,0)
  const oldRows=await mod.readTranscript(oldId)
  assert.equal(oldRows.length,2)
  assert.ok(oldRows.every(row=>row.sourceRef.key===old.sourceRef.key && row.videoTime===11))
  assert.equal((await mod.getTranscriptRecord(oldId)).status,'completed')
  assert.equal((await mod.readTranscript(next.transcriptId)).length,0)
  assert.ok(emitted.filter(m=>['CAPTURE_SUBTITLE','CAPTURE_SUBTITLE_STREAMING','CAPTURE_SCREEN_SUBTITLE'].includes(m.type)).every(m=>m.sourceEpoch===oldEpoch))
  // A failed save in a retired epoch remains independently retryable.
  rejectLocal=true
  const failed=mod.createSession(8); failed.state='running'; failed.generation=12
  mod.bindInitialSource(failed,'https://youtu.be/old','old')
  const failedEpoch=failed.sourceEpoch
  mod.saveSessionSubtitle(failed,{id:'rescue',at:1,endedAt:null,videoTime:null,source:'手机',target:'电脑',latency:0,sourceRef:failed.sourceRef})
  await new Promise(r=>setTimeout(r,0))
  rejectLocal=false
  mod.captureSessions.set(8,{...capture,tabId:8,generation:12,sourceEpoch:failedEpoch,sourceBindings:{[failedEpoch]:{sourceRef:failed.sourceRef,pending:1}}})
  const newer=await mod.transitionSource(8,{url:'https://youtu.be/new',title:'new'})
  await mod.retrySessionTranscript(newer)
  assert.equal((await mod.readTranscript(failed.transcriptId))[0].id,'rescue')
  assert.equal(mod.safeSession(newer).pendingTranscriptCount,0)
  // New worker refuses a live capture whose source provenance was lost.
  await mod.persistSessionsStrict()
  captureMetaOverride={ok:true,sessions:{7:11},sources:{}}
  const missing=await import(`${pathToFileURL(out)}?missing`)
  await missing.recoverSessions()
  assert.equal(missing.sessions.get(7).state,'error')
  assert.match(missing.sessions.get(7).saveState.message,/来源无法核验/)
  assert.ok(emitted.some(m=>m.type==='STOP_CAPTURE'&&m.tabId===7))
  captureMetaOverride=undefined
  // A summary's source/time/count freeze with its evidence, before provider await.
  const summarizing=mod.createSession(10);summarizing.state='running';summarizing.generation=10;summarizing.configSnapshot={}
  mod.bindInitialSource(summarizing,'https://youtu.be/summary-old','old summary')
  summarizing.subtitles=[{id:'evidence',source:'old evidence',target:'原证据',at:1,videoTime:42}]
  const summaryResult = new Promise(resolve => mod.sessionHandlers.SUMMARIZE({videoTitle:'old'},{tabId:10,sendResponse:resolve}))
  summarizing.subtitles=[]
  summary.resolve('Summary body')
  const result = await summaryResult
  assert.equal(result.sourceRef.key,'youtube:summary-old');assert.equal(result.videoTime,42);assert.equal(result.subtitleCount,1)
  // Old URL-only records remain legacy, never silently mapped into exact P1.
  const legacy=await mod.beginTranscript({tabId:20,generation:20,url:'https://www.bilibili.com/video/BV1?p=1'})
  await mod.appendTranscriptLine(legacy.id,{id:'legacy-line',at:1,endedAt:null,source:'旧字幕',target:'legacy',videoTime:10,latency:0})
  const oldRow=(await mod.readTranscript(legacy.id))[0]
  assert.equal(oldRow.sourceRef.confidence,'legacy');assert.equal(oldRow.sourceRef.key,`legacy:${legacy.id}`)
  values['snooper.notes.v1']=[{id:'legacy-note',title:'旧笔记',entries:[{id:'entry',type:'text',at:1,text:'旧正文',videoUrl:'https://www.bilibili.com/video/BV1?p=1'}]}]
  values['snooper.notes.initialized.v1']=true
  const oldNote=(await mod.listNotes())[0].entries[0]
  assert.equal(oldNote.sourceRef.confidence,'legacy');assert.equal(oldNote.sourceRef.key,'legacy:legacy-note')
  // Lost snapshot writes cannot authorize requests under a new epoch.
  const broken=mod.createSession(21);broken.state='running';broken.generation=21
  mod.bindInitialSource(broken,'https://youtu.be/before','before');await mod.ensureTranscript(broken)
  mod.captureSessions.set(21,{...capture,tabId:21,generation:21,sourceEpoch:broken.sourceEpoch,sourceBindings:{[broken.sourceEpoch]:{sourceRef:broken.sourceRef,pending:1}}})
  rejectSession=true
  await assert.rejects(mod.transitionSource(21,{url:'https://youtu.be/after',title:'after'}),/quota/)
  assert.equal(mod.sessions.get(21).state,'error')
  assert.equal(mod.captureSessions.get(21).sourceEpoch,broken.sourceEpoch)
  assert.equal(mod.captureSessions.get(21).sourcePaused,true)
  rejectSession=false
  // STOP while the next transcript is being created must never revive capture.
  const stopping=mod.createSession(22);stopping.state='running';stopping.generation=22
  mod.bindInitialSource(stopping,'https://youtu.be/stop-old','old');await mod.ensureTranscript(stopping)
  mod.captureSessions.set(22,{...capture,tabId:22,generation:22,sourceEpoch:stopping.sourceEpoch,sourceBindings:{[stopping.sourceEpoch]:{sourceRef:stopping.sourceRef,pending:1}}})
  const writeReached=deferred(), releaseWrite=deferred()
  localSetHook=async items=>{if(items[mod.TRANSCRIPT_INDEX_KEY]?.some(r=>r.url==='https://youtu.be/stop-new')){localSetHook=null;writeReached.resolve();await releaseWrite.promise}}
  const changing=mod.transitionSource(22,{url:'https://youtu.be/stop-new',title:'new'})
  await writeReached.promise
  const stopped=new Promise(resolve=>mod.sessionHandlers.STOP({}, {tabId:22,sendResponse:resolve}))
  releaseWrite.resolve()
  await changing;await stopped
  assert.equal(mod.sessions.get(22).state,'idle')
  assert.equal(mod.sessions.get(22).sourceEpoch,stopping.sourceEpoch)
  assert.equal(emitted.some(m=>m.type==='SET_CAPTURE_SOURCE'&&m.tabId===22),false)
  // Unbound old completions cannot render or write into the current lesson.
  const test=mod.createSession(9);test.state='running';test.generation=99;mod.bindInitialSource(test,'https://youtu.be/new','new');await mod.ensureTranscript(test)
  await dispatch({type:'CAPTURE_SUBTITLE',tabId:9,generation:99,sourceEpoch:'lost',at:Date.now(),source:'old',target:'旧',latency:0})
  assert.equal(test.subtitles.length,0)
  assert.equal((await mod.readTranscript(test.transcriptId)).length,0)
  console.log('source-transition: delayed ASR+frame, immutable epochs/context, same-stream switch, old drain, clocks, restart, rescue and unbound refusal passed')
} finally { globalThis.setInterval=realSetInterval; rmSync(dir,{recursive:true,force:true}) }
