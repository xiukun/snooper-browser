/** Regression: stopped epoch queues and STOP while snapshot persistence is pending. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'snooper-source-recovery-'))
const out = join(dir, 'actual.mjs')
let imports = 0
const fresh = () => import(`${pathToFileURL(out)}?instance=${++imports}`)
function environment() {
  const local = {}, session = {}, sent = []
  const controls = { failLocal:false, beforeSessionSet:null, stopped:false }
  const area = (store, isSession=false) => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in store).map(k=>[k,structuredClone(store[k])])) },
    async set(items) {
      if (!isSession && controls.failLocal) throw new Error('quota')
      const cloned = structuredClone(items)
      if (isSession) await controls.beforeSessionSet?.(cloned)
      Object.assign(store, cloned)
    },
    async remove(keys) { for(const key of Array.isArray(keys)?keys:[keys]) delete store[key] },
  })
  globalThis.chrome = {
    storage:{local:area(local),session:area(session,true)},
    tabs:{async sendMessage(){}},
    runtime:{getURL:p=>`chrome-extension://test/${p}`,async getContexts(){return[]},async sendMessage(message){
      sent.push(structuredClone(message))
      if(message.type==='GET_CAPTURE_SESSIONS') return {ok:true,sessions:{},sources:{}}
      if(message.type==='STOP_CAPTURE') {controls.stopped=true;return{ok:true}}
      if(message.type==='SET_CAPTURE_SOURCE'&&controls.stopped) return {ok:false,error:'采集课节绑定不匹配'}
      return {ok:true}
    }},
    offscreen:{async hasDocument(){return true},async closeDocument(){}},
  }
  return {local,session,sent,controls}
}
async function twoLessons(mod, tabId) {
  const old=mod.createSession(tabId)
  old.state='running';old.generation=101
  mod.bindInitialSource(old,'https://www.bilibili.com/video/BV1?p=1','P1')
  await mod.ensureTranscript(old)
  const current=await mod.transitionSource(tabId,{url:'https://www.bilibili.com/video/BV1?p=2',title:'P2'})
  return {old,current}
}
async function recovery() {
  const env=environment(), mod=await fresh()
  const {old,current}=await twoLessons(mod,41)
  const oldId=old.transcriptId,currentId=current.transcriptId
  assert.notEqual(oldId,currentId)
  const line=(id,owner)=>({id,at:1,endedAt:null,videoTime:4,source:id,target:id,latency:0,sourceRef:owner.sourceRef})
  env.controls.failLocal=true
  mod.saveSessionSubtitle(old,line('old-line',old));mod.saveSessionSubtitle(current,line('new-line',current))
  await mod.retrySessionTranscript(current).catch(()=>{})
  current.state='idle'
  await assert.rejects(mod.finishSessionTranscript(current),/quota/)
  assert.equal(old.sourceDrained,true,'actual stopped finalization marks retired epoch drained')
  assert.equal(old.pendingTranscriptLines.length,1);assert.equal(current.pendingTranscriptLines.length,1)
  await mod.persistSessionsStrict()
  env.controls.failLocal=false
  const restarted=await fresh()
  await restarted.recoverSessions()
  const restored=restarted.sessions.get(41)
  assert.equal(restored.transcriptId,currentId,'P1: stopped recovery must preserve current epoch transcript ID')
  assert.equal(restored.retiringSources[0].transcriptId,oldId)
  assert.equal(restored.saveState.status,'error')
  await restarted.retrySessionTranscript(restored)
  await restarted.finishSessionTranscript(restored)
  assert.deepEqual((await restarted.readTranscript(oldId)).map(l=>l.id),['old-line'])
  assert.deepEqual((await restarted.readTranscript(currentId)).map(l=>l.id),['new-line'])
  assert.equal(restarted.safeSession(restored).pendingTranscriptCount,0)
  assert.equal(restarted.safeSession(restored).saveState.status,'saved')
  await restarted.persistSessionsStrict()
  // Invalid persisted bindings remain blocked on retry; never repair by guessing another epoch.
  const malformed=JSON.parse(env.session[mod.SESSION_RECOVERY_KEY])
  malformed['41'].transcriptId=oldId
  malformed['41'].pendingTranscriptLines=[line('unproven-line',current)]
  malformed['41'].saveState={status:'pending'}
  env.session[mod.SESSION_RECOVERY_KEY]=JSON.stringify(malformed)
  const invalidWorker=await fresh();await invalidWorker.recoverSessions()
  const invalid=invalidWorker.sessions.get(41)
  assert.match(invalid.saveState.message,/课节绑定无法核验/)
  await assert.rejects(invalidWorker.retrySessionTranscript(invalid),/课节绑定无法核验/)
  assert.equal(invalid.pendingTranscriptLines[0].id,'unproven-line')
  assert.equal(invalidWorker.safeSession(invalid).saveState.status,'error')
  assert.deepEqual((await invalidWorker.readTranscript(oldId)).map(l=>l.id),['old-line'])
  assert.deepEqual((await invalidWorker.readTranscript(currentId)).map(l=>l.id),['new-line'])
  await invalidWorker.persistSessionsStrict()
  const ended=JSON.parse(env.session[mod.SESSION_RECOVERY_KEY])
  ended['41'].transcriptId=currentId
  env.session[mod.SESSION_RECOVERY_KEY]=JSON.stringify(ended)
  const endedWorker=await fresh();await endedWorker.recoverSessions()
  const endedOwner=endedWorker.sessions.get(41)
  await assert.rejects(endedWorker.retrySessionTranscript(endedOwner),/已结束但仍有未保存内容/)
  assert.equal(endedOwner.pendingTranscriptLines[0].id,'unproven-line')
  assert.deepEqual((await endedWorker.readTranscript(currentId)).map(l=>l.id),['new-line'])
  await endedWorker.persistSessionsStrict()
  console.log('source-recovery: stopped two-epoch failure/restart/retry preserves both bodies and saved state passed')
}
async function stopSnapshot(rejectSnapshot=false) {
  const env=environment(),mod=await fresh()
  const old=mod.createSession(42);old.state='running';old.generation=102
  mod.bindInitialSource(old,'https://youtu.be/old','old');await mod.ensureTranscript(old)
  await mod.persistSessionsStrict()
  const held=Promise.withResolvers(),release=Promise.withResolvers()
  env.controls.beforeSessionSet=async items=>{
    const saved=JSON.parse(items[mod.SESSION_RECOVERY_KEY]||'{}')['42']
    if(saved?.sourceRef?.url!=='https://youtu.be/new')return
    env.controls.beforeSessionSet=null
    held.resolve();await release.promise
    if(rejectSnapshot) throw new Error('delayed snapshot failure')
  }
  const transition=mod.transitionSource(42,{url:'https://youtu.be/new',title:'new'}).then(value=>({value}),error=>({error}))
  await held.promise
  const stopped=await new Promise(resolve=>mod.sessionHandlers.STOP({}, {tabId:42,sendResponse:resolve}))
  assert.equal(stopped.ok,true);assert.equal(stopped.session.state,'idle')
  release.resolve()
  const settled=await transition
  assert.equal(env.sent.filter(m=>m.type==='SET_CAPTURE_SOURCE').length,0,'P2: STOP during snapshot must prevent the later SET_CAPTURE_SOURCE')
  assert.equal(settled.error,undefined)
  assert.equal(mod.sessions.get(42).state,'idle')
  assert.equal(mod.safeSession(mod.sessions.get(42)).saveState.status,'saved')
  assert.equal(env.sent.filter(m=>m.type==='STOP_CAPTURE').length,1,'cancelled transition must not stop again')
  await mod.persistSessionsStrict()
  assert.equal(JSON.parse(env.session[mod.SESSION_RECOVERY_KEY])['42'].state,'idle')
  console.log(`source-recovery: STOP during ${rejectSnapshot?'rejected':'successful'} strict snapshot prevents source resume and false save error passed`)
}
try {
  await build({stdin:{resolveDir:process.cwd(),contents:['src/ext/background/session-store.ts','src/ext/background/transcript-store.ts','src/ext/background/source-sessions.ts','src/ext/background/recovery.ts','src/ext/background/router/session.ts'].map(p=>`export * from '${resolve(p)}';`).join('\n')},bundle:true,format:'esm',outfile:out,logLevel:'silent',define:{'import.meta.env':'{}'}})
  if (!process.argv[2]||process.argv[2]==='recovery') await recovery()
  if (!process.argv[2]||process.argv[2]==='stop-snapshot') { await stopSnapshot(); await stopSnapshot(true) }
} finally {rmSync(dir,{recursive:true,force:true})}
