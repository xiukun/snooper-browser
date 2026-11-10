import { installDOM, until } from './library-dom-fixture.mjs'
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
// Runtime cancellation must not coerce arrays into an otherwise valid cursor.
for(let i=0;i<801;i++) await a.notes.addNoteEntry({noteId:'cancel-fixture',entry:noteEntry(`cancel-${i}`,'手机')})
const pending=await rpc('LIBRARY_SEARCH',{query:'手机',favoritesOnly:false})
assert.ok(pending.cursor)
const invalidCancel=await rpc('LIBRARY_CANCEL_SEARCH',{cursor:[pending.cursor]})
assert.equal(invalidCancel.code,'INVALID_INPUT','non-string cancellation must not mutate the real query')
const remaining=await rpc('LIBRARY_SEARCH',{query:'手机',favoritesOnly:false,cursor:pending.cursor})
assert.equal(remaining.ok,true);assert.equal(remaining.complete,true)
assert.equal(remaining.scanned,801)
await a.notes.deleteNoteDocuments(['cancel-fixture'])
const id=await recording(a,1,1)
await a.notes.addNoteEntry({noteId:'n',entry:noteEntry('e','电脑')})
await a.library.setFavorite({kind:'note',noteId:'n',entryId:'e'},true)
for(const [type,fields] of [['DELETE_HISTORY',{id}],['DELETE_ALL_HISTORY',{}],['NOTES_DELETE_ENTRY',{noteId:'n',entryId:'e'}],['NOTES_DELETE_DOCUMENTS',{ids:['n']}]]) assert.equal((await rpc(type,fields)).code,'CONFIRMATION_REQUIRED')
assert.equal((await a.transcripts.readTranscript(id)).length,1)
const dom=installDOM()
assert.deepEqual(await rpc('LIBRARY_FAVORITES'), {ok:true,refs:[{kind:'note',noteId:'n',entryId:'e'}]})
assert.equal((await rpc('LIBRARY_FAVORITES',{}, {url:'https://untrusted.example'})).ok,false)
let prompt=''
const cancelled = a.client.confirmLibraryDelete({noteIds:['n']})
await until(()=>dom.dialog())
prompt=dom.dialog().textContent
await dom.action(dom.dialog(),'cancel-delete').click()
assert.equal(await cancelled,null)
assert.ok(prompt.includes('1 条收藏'))
assert.equal((await a.notes.listNotes()).length,1)
const confirmed=a.client.confirmLibraryDelete({noteIds:['n']})
await until(()=>dom.dialog())
await dom.action(dom.dialog(),'confirm-delete').click()
assert.equal((await confirmed).pending.length,0)
assert.equal((await a.notes.listNotes()).length,0)
assert.equal((await rpc('LIBRARY_OPEN_SOURCE',{recordId:id,tabId:-1})).code,'INVALID_INPUT','invalid tab IDs are input errors')
let opened=[];chrome.tabs.create=async input=>{opened.push(input.url);return input}
const ref={kind:'transcript',recordId:id,lineId:'line-0'}
assert.equal((await rpc('LIBRARY_OPEN_SOURCE',{ref})).action,'opened')
assert.equal(opened.length,1)
const plan=await a.library.prepareDelete({transcriptIds:[id]});await a.library.confirmDelete(plan.token)
assert.equal((await rpc('LIBRARY_OPEN_SOURCE',{ref})).ok,false)
assert.equal(opened.length,1,'saved ref must be resolved again before opening')
console.log('✅ library-router: sender restrictions, runtime validation/non-coercing cancellation/invalid source tab, all old-delete denial, reachable favorite-impact confirmation/cancel and source re-resolution passed')
} finally {h.close()}
