import assert from 'node:assert/strict'
import { harness, modules, noteEntry, recording } from './library-test-harness.mjs'
const h=harness([...modules,['router','src/ext/background/router/index.ts'],['client','src/ext/content/library-client.ts']])
try {
let a=await h.load(), listener
chrome.runtime.onMessage={addListener:fn=>{listener ||= fn}}
a.router.registerBackgroundRouters()
const sender={url:'chrome-extension://test/sidepanel/index.html'}
const rpc=(type,fields={},from=sender)=>new Promise(resolve=>listener({target:'background',type,...fields},from,resolve))
chrome.runtime.sendMessage=message=>rpc(message.type,message)
assert.equal((await rpc('LIBRARY_USAGE',{}, {url:'https://untrusted.example'})).ok,false)
for(const [type,fields] of [['LIBRARY_SEARCH',{query:4,favoritesOnly:false}],['LIBRARY_FAVORITE',{ref:{},favorite:true}],['LIBRARY_PREPARE_DELETE',{noteIds:[false]}],['LIBRARY_DELETE',{token:3}],['LIBRARY_CONTEXT',{ref:{kind:'transcript',recordId:'x',lineId:''}}]]) assert.equal((await rpc(type,fields)).code,'INVALID_INPUT')
const id=await recording(a,1,1)
await a.notes.addNoteEntry({noteId:'n',entry:noteEntry('e','电脑')})
await a.library.setFavorite({kind:'note',noteId:'n',entryId:'e'},true)
for(const [type,fields] of [['DELETE_HISTORY',{id}],['DELETE_ALL_HISTORY',{}],['NOTES_DELETE_ENTRY',{noteId:'n',entryId:'e'}],['NOTES_DELETE_DOCUMENTS',{ids:['n']}]]) assert.equal((await rpc(type,fields)).code,'CONFIRMATION_REQUIRED')
assert.equal((await a.transcripts.readTranscript(id)).length,1)
let prompt=''
globalThis.confirm=text=>{prompt=text;return false}
assert.equal(await a.client.confirmLibraryDelete({noteIds:['n']}),null)
assert.ok(prompt.includes('1 条收藏'))
assert.equal((await a.notes.listNotes()).length,1)
globalThis.confirm=()=>true
assert.equal((await a.client.confirmLibraryDelete({noteIds:['n']})).pending.length,0)
assert.equal((await a.notes.listNotes()).length,0)
let opened=[];chrome.tabs.create=async input=>{opened.push(input.url);return input}
const ref={kind:'transcript',recordId:id,lineId:'line-0'}
assert.equal((await rpc('LIBRARY_OPEN_SOURCE',{ref})).action,'opened')
assert.equal(opened.length,1)
const plan=await a.library.prepareDelete({transcriptIds:[id]});await a.library.confirmDelete(plan.token)
assert.equal((await rpc('LIBRARY_OPEN_SOURCE',{ref})).ok,false)
assert.equal(opened.length,1,'saved ref must be resolved again before opening')
console.log('✅ library-router: sender restrictions, runtime validation, all old-delete denial, reachable favorite-impact confirmation/cancel and source re-resolution passed')
} finally {h.close()}
