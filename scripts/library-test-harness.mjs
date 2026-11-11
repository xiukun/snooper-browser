import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
export function harness(modules) {
  const dir = mkdtempSync(join(tmpdir(), 'snooper-library-'))
  const out = join(dir, 'test.mjs')
  buildSync({ stdin: { contents: modules.map(([name,path]) => `export * as ${name} from '${resolve(path)}'`).join(';'), resolveDir: process.cwd() }, bundle: true, format: 'esm', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' } })
  const local = {}, session = {}
  let fault = null, hold = null, counter = 0
  const area = (data, name) => ({
    async get(keys) { await intercept(name, 'get', keys); return structuredClone(Object.fromEntries((keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys]).filter(k=>k in data).map(k=>[k,data[k]]))) },
    async set(items) { await intercept(name, 'set', Object.keys(items)); Object.assign(data, structuredClone(items)) },
    async remove(keys) { await intercept(name, 'remove', keys); for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k] },
    async getBytesInUse() { await intercept(name, 'bytes', []); return Buffer.byteLength(JSON.stringify(data)) },
  })
  async function intercept(area, method, keys) {
    const list = Array.isArray(keys) ? keys : [keys]
    const matches = f => f && f.area === area && f.method === method && (!f.key || list.includes(f.key))
    if (matches(hold)) { const h = hold; hold = null; h.enter(); await h.promise }
    if (matches(fault)) { if (!fault.persistent) fault = null; throw Error('injected storage failure') }
  }
  globalThis.chrome = { storage: {local: area(local,'local'), session: area(session,'session')}, runtime: {getURL: p=>'chrome-extension://test/'+p}, tabs: {create: async p=>p, sendMessage: async ()=>({})} }
  return { local, session, load: ()=>import(`${pathToFileURL(out).href}?v=${++counter}`), fail: (method,key,area='local')=>{fault={method,key,area}}, failPersistent: (method,key,area='local')=>{fault={method,key,area,persistent:true}}, clearFault: ()=>{fault=null}, hold(method,key,area='local') { let release, enter; const entered = new Promise(r=>enter=r); const promise = new Promise(r=>release=r); hold={method,key,area,promise,enter}; return {entered,release} }, close: ()=>rmSync(dir,{recursive:true,force:true}) }
}
export const modules = [['transcripts','src/ext/background/transcript-store.ts'],['notes','src/ext/background/notes-store.ts'],['library','src/ext/background/library-store.ts'],['search','src/ext/background/library-search.ts']]
export const noteEntry = (id,text='手机',extra={})=>({id,type:'text',at:1,text,...extra})
export async function recording(api, id, count=1, finalized=true) {
  const r = await api.transcripts.beginTranscript({tabId:id,generation:1,startedAt:id,pageTitle:`Lesson ${id}`,url:'https://www.youtube.com/watch?v=example'})
  for(let i=0;i<count;i++) await api.transcripts.appendTranscriptLine(r.id,{id:`line-${i}`,at:count-i,endedAt:null,source:`computer ${i}`,target:`电脑 ${i}`,videoTime:i,latency:0})
  if(finalized) await api.transcripts.finalizeTranscript(r.id)
  return r.id
}
