import { installDOM, until } from './library-dom-fixture.mjs'
import assert from 'node:assert/strict'
import { harness } from './library-test-harness.mjs'
const h = harness([['ui','src/ext/sidepanel/library.ts'], ['favorites','src/ext/content/favorite-control.ts'],['render','src/ext/sidepanel/library-render.ts'],['client','src/ext/content/library-client.ts'],['subtitle','src/ext/content/subtitle-view.ts'],['notes','src/ext/content/notes.ts']])
try {
 const { ui, favorites, render, client, subtitle, notes } = await h.load()
 const hit = (id, source='手机') => ({ref:{kind:'transcript',recordId:'r',lineId:id},sourceRef:{key:'x',title:'课程',url:'https://example.com',confidence:'exact'},title:'课程',at:1,videoTime:1,source,target:'',text:'',type:'subtitle',favorite:false,highlights:{source:[[0,2]],target:[],text:[]}})
 const page = (hits=[], extra={}) => ({ok:true,hits,cursor:null,complete:true,scanned:1,errors:[],changed:false,scopes:[{kind:'transcript',id:'r',title:'课程',count:10}],...extra})
 let calls=[], responses=[page([hit('a')],{cursor:'c1',complete:false}),page([hit('b')],{cursor:'retry',complete:false,errors:[{kind:'transcript',id:'r',message:'missing'}]}),page([hit('b'),hit('c')])]
 const request = async (type, fields) => {calls.push({type,...fields}); return type==='LIBRARY_CANCEL_SEARCH'?{ok:true}:responses.shift()}
 const c=ui.createLibrarySearch({request,changed:()=>{}})
 await c.start('手机', false)
 assert.equal(c.state.status,'partial'); assert.equal(calls.length,2); assert.equal(c.state.hits.size,2)
 await c.retry(); assert.equal(calls[2].cursor,'retry'); assert.equal(c.state.hits.size,3); assert.equal(c.state.status,'complete')
 responses=[page([],{scopes:[]})]; await c.start('手机',false); assert.equal(c.state.status,'empty')
 responses=[page([])]; await c.start('zzz',false); assert.equal(c.state.status,'no-match')
 responses=[page([],{changed:true})]; await c.start('zzz',false); assert.equal(c.state.changed,true)
 responses=[{ok:false,code:'CURSOR_EXPIRED',error:'expired'}]; await c.start('手机',false); assert.equal(c.state.status,'failed'); assert.equal(c.state.cursor,null)
 let resolveOld; const pending=new Promise(r=>resolveOld=r); calls=[]
 const race=ui.createLibrarySearch({request:async(type,fields)=>{calls.push({type,...fields});return type==='LIBRARY_CANCEL_SEARCH'?{ok:true}:fields.query==='old'?pending:page([hit('new')])},changed:()=>{}})
 const old=race.start('old',false); await race.start('new',false); resolveOld(page([hit('old')],{cursor:'stale',complete:false}));await old
 assert.deepEqual([...race.state.hits.keys()],[JSON.stringify(['transcript','r','new'])]);assert.ok(calls.some(c=>c.type==='LIBRARY_CANCEL_SEARCH'&&c.cursor==='stale'))
 let timers=[]; const debounced=ui.createLibrarySearch({request,changed:()=>{},schedule:(fn,ms)=>{timers.push({fn,ms});return timers.length},unschedule:()=>{}})
 debounced.input('first',false);debounced.input('last',true);assert.equal(debounced.state.hits.size,0);assert.equal(debounced.state.query,'last');assert.equal(timers.at(-1).ms,180);responses=[page()];await timers.at(-1).fn();assert.equal(debounced.state.query,'last');assert.equal(debounced.state.favoritesOnly,true)
 let writes=0, fail=true; const f=favorites.createFavoriteState(async(type,fields)=>{
 if(type==='LIBRARY_FAVORITES')return {ok:true,refs:[hit('a').ref]};writes++;if(fail)return {ok:false,error:'disk'};return {ok:true,ref:fields.ref,favorite:fields.favorite}
 })
 await f.refresh();assert.equal(f.status,'ready');assert.equal(f.has(hit('a').ref),true)
 await assert.rejects(f.toggle(hit('a').ref),/disk/);assert.equal(f.has(hit('a').ref),true)
 fail=false;await f.toggle(hit('a').ref);assert.equal(f.has(hit('a').ref),false);assert.equal(writes,2)
 assert.equal(favorites.subtitleFavoriteRef({isDemoMode:false,transcriptId:'r',saveState:{status:'pending'}},{id:'a'}),null)
 assert.equal(favorites.subtitleFavoriteRef({isDemoMode:true,transcriptId:'r',saveState:{status:'saved'}},{id:'a'}),null)
 assert.deepEqual(favorites.subtitleFavoriteRef({isDemoMode:false,transcriptId:'r',saveState:{status:'saved'}},{id:'a'}),hit('a').ref)
 const dom=installDOM()
 chrome.storage.onChanged={addListener:()=>{}}
 chrome.runtime.sendMessage=async message=>message.type==='LIBRARY_FAVORITES'?{ok:true,refs:[]}:message.type==='LIBRARY_CONTEXT'?{ok:true,entry:hit('a'),before:[hit('previous')],after:[hit('next')]}:{ok:true,action:'opened',degraded:'未保存可靠播放位置，已打开来源页面'}
 chrome.tabs.query=async()=>[{id:7}]
 const container=document.createElement('div');document.body.append(container)
 const safe=document.createElement('p');render.appendHighlight(safe,'<img onerror=alert(1)>手机',[[21,23]])
 assert.equal(safe.textContent,'<img onerror=alert(1)>手机');assert.equal(dom.all(safe,n=>n.tagName==='IMG').length,0)
 const renderer=render.createResultRenderer(container,()=>{})
 const lots=Array.from({length:123},(_,i)=>hit(String(i)))
 renderer.update(c.state,lots,true)
 assert.equal(dom.all(container,n=>n.tagName==='ARTICLE').length,3)
 await dom.action(container,'more').click();assert.equal(dom.all(container,n=>n.tagName==='ARTICLE').length,53)
 await dom.action(container,'more').click();await dom.action(container,'more').click();assert.equal(dom.all(container,n=>n.tagName==='ARTICLE').length,123)
 const first=container.children[0].children[2].children[0]
 await dom.action(first,'context').click();assert.ok(first.textContent.includes('上下文'));assert.equal(dom.all(first,n=>n.tagName==='ARTICLE').length,3)
 assert.equal(render.groupKey({...hit('a'),sourceRef:{...hit('a').sourceRef,confidence:'legacy'}}),'record:r')
 assert.equal(await render.openEntrySource(hit('a').ref),'未保存可靠播放位置，已打开来源页面')
 const state=favorites.createFavoriteState(async(type,fields)=>type==='LIBRARY_FAVORITES'?{ok:true,refs:[]}:{ok:true,favorite:fields.favorite})
 await state.refresh();const star=favorites.createFavoriteButton(hit('a').ref,()=>{},state);document.body.append(star)
 await star.click();assert.equal(star.getAttribute('aria-pressed'),'true');await star.click();assert.equal(star.getAttribute('aria-pressed'),'false')
 const unavailable=favorites.createFavoriteButton(null,()=>{},state);assert.equal(unavailable.disabled,true)
 // Exercise the actual subtitle render cache with unchanged text after a save retry.
 globalThis.window={innerWidth:390,innerHeight:844,addEventListener(){},setTimeout(){return 1},clearTimeout(){}}
 globalThis.localStorage={getItem(){return null},setItem(){}}
 await favorites.favoriteState().refresh()
 const refs=Object.fromEntries(['recordBtn','recordLabelEl','subBox','subHandle','subResize','subScroll','subRows','subPlaceholder','subStatus','subListening','streamingRow','streamingText','streamingSource','streamingLabel','chatEl'].map(key=>[key,document.createElement('div')]))
 for(const ref of Object.values(refs))document.body.append(ref)
 const live={state:'idle',isDemoMode:false,transcriptId:'r',saveState:{status:'error'},currentTranscriptSaveState:{status:'pending'},subtitles:[{id:'live',source:'same text',at:1}],messages:[]}
 const view=subtitle.createSubtitleView({refs,getSession:()=>live,isUiHidden:()=>false,applyUiHidden(){},updateLangLabel(){},renderNotes(){},openShotPreview(){}})
 view.render();assert.equal(dom.action(refs.subRows,'favorite').disabled,true)
 live.currentTranscriptSaveState={status:'saved'};view.render();assert.equal(dom.action(refs.subRows,'favorite').disabled,false)
 const unchanged=refs.subRows.children[0];view.render();assert.equal(refs.subRows.children[0],unchanged,'stable text/state reuses row')
 // A visible local note draft must remain uncollectible until real persistence succeeds.
 let saveNote;const noteResponse=new Promise(resolve=>saveNote=resolve)
 const noteSession={notes:[{id:'note',title:'lesson',createdAt:1,updatedAt:1,entries:[]}],activeNoteId:'note'}
 const noteRefs=Object.fromEntries(['count','badge','button','list'].map(key=>[key,document.createElement('div')]))
 for(const ref of Object.values(noteRefs))document.body.append(ref)
 chrome.runtime.sendMessage=async m=>m.type==='NOTES_ADD_ENTRY'?noteResponse:{ok:true,refs:[]}
 const noteUI=notes.createNotes({refs:noteRefs,getSession:()=>noteSession,toast(){},openShotPreview(){}})
 const note={id:'saved-later',type:'subtitle',at:1,source:'same text',sourceRef:hit('a').sourceRef}
 const savingNote=noteUI.addEntry(note);assert.equal(dom.action(noteRefs.list,'favorite').disabled,true)
 saveNote({ok:true,notes:[{...noteSession.notes[0],entries:[note]}]});assert.equal(await savingNote,true);assert.equal(dom.action(noteRefs.list,'favorite').disabled,false)
 let deletes=0
 chrome.runtime.sendMessage=async m=>m.type==='LIBRARY_PREPARE_DELETE'?{ok:true,targets:[{kind:'note',noteId:'n',entryIds:['one','two'],wholeDocument:true}],skipped:[],favoriteCount:2,token:'confirmed'}:{ok:true,operationId:'confirmed',completed:[],skipped:[],pending:++deletes===1?[{target:{kind:'note'},error:'disk failure'}]:[]}
 const prev=document.createElement('button');document.body.append(prev);prev.focus()
 const deletion=client.confirmLibraryDelete({noteIds:['n']});await until(()=>dom.dialog());const dialog=dom.dialog()
 assert.ok(dialog.textContent.includes('2 条笔记内容'));assert.ok(dialog.textContent.includes('2 条收藏'))
 await dom.action(dialog,'confirm-delete').click();assert.ok(dialog.textContent.includes('尚未完成'));assert.ok(dom.dialog())
 await dom.action(dialog,'confirm-delete').click();assert.equal((await deletion).pending.length,0);assert.equal(document.activeElement,prev)
 chrome.runtime.sendMessage=async m=>m.type==='LIBRARY_PREPARE_DELETE'?{ok:true,targets:[{kind:'transcript',recordId:'r'}],skipped:[],favoriteCount:1,token:'stale'}:{ok:false,code:'CONFIRMATION_STALE',error:'internal token changed'}
 const staleDelete=client.confirmLibraryDelete({transcriptIds:['r']});await until(()=>dom.dialog());await dom.action(dom.dialog(),'confirm-delete').click()
 assert.equal(dom.action(dom.dialog(),'confirm-delete').disabled,true);assert.ok(dom.dialog().textContent.includes('重新预览'));assert.equal(dom.dialog().textContent.includes('token'),false)
 await dom.action(dom.dialog(),'cancel-delete').click();assert.equal(await staleDelete,null)
 console.log('library UI: query batches/error pause/retry, stale response cancellation, debounce, favorite durability and saved-only refs passed')
} finally { h.close() }
