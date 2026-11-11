import assert from 'node:assert/strict'
import { harness } from './library-test-harness.mjs'
import { installDOM, until } from './library-dom-fixture.mjs'
const h=harness([['panel','src/ext/sidepanel/library-panel.ts'],['favorites','src/ext/content/favorite-control.ts'],['render','src/ext/sidepanel/library-render.ts'],['subtitle','src/ext/content/subtitle-view.ts'],['notes','src/ext/content/notes.ts']])
const failures=[]
async function check(name,run){try{await run();console.log(`PASS ${name}`)}catch(error){failures.push(name);console.error(`FAIL ${name}: ${error.message}`)}}
try {
 const dom=installDOM(), events=[]
 chrome.storage.onChanged={addListener:fn=>events.push(fn)}
 globalThis.window={innerWidth:390,innerHeight:844,addEventListener(){},setTimeout(){return 1},clearTimeout(){}}
 globalThis.localStorage={getItem(){return null},setItem(){}}
 const api=await h.load()
 const ref=id=>({kind:'transcript',recordId:'r',lineId:id})
 const hit=id=>({ref:ref(id),sourceRef:{key:'lesson',title:'课程',url:'https://example.com',confidence:'exact'},title:'课程',at:1,videoTime:1,source:'手机',target:'',text:'',type:'subtitle',favorite:false,highlights:{source:[[0,2]],target:[],text:[]}})
 await check('mounted panel invalidates complete and empty snapshots and revalidates on activation',async()=>{
  const ids=['panel-search','library-query','library-favorites-only','library-status','library-warning','library-message','library-retry','library-restart','library-cancel','library-usage','library-results','library-manage-history','library-manage-notes','library-refresh-usage']
  const nodes=Object.fromEntries(ids.map(id=>{const el=document.createElement('div');el.id=id;el.value='手机';el.checked=false;document.body.append(el);return[id,el]}))
  document.getElementById=id=>nodes[id]
  let saved=[hit('one')],calls=0
  chrome.runtime.sendMessage=async m=>m.type==='LIBRARY_FAVORITES'?{ok:true,refs:[]}:m.type==='LIBRARY_USAGE'?{ok:true,complete:true,errors:[],bytes:1,transcriptCount:saved.length,noteCount:0,noteEntryCount:0,favoriteCount:0,pendingWrites:{transcriptLines:0,sessions:0,noteMigration:false},pendingDeletes:[]}:{ok:true,hits:(calls++,saved),cursor:null,complete:true,scanned:saved.length,errors:[],changed:false,scopes:saved.length?[{kind:'transcript',id:'r',title:'课程',count:1}]:[]}
  const mounted=api.panel.mountLibraryPanel(()=>{})
  await mounted.controller.start('手机',false)
  assert.equal(mounted.controller.state.hits.size,1)
  for(const key of ['snooper.notes.v1','snooper.extension.transcripts.v1','snooper.extension.transcript.v1.r.0','snooper.library.deletions.v1','snooper.extension.transcript-deletions.v1']){
   await mounted.controller.start('手机',false)
   events.forEach(fn=>fn({[key]:{newValue:'never inspect body'}},'local'))
   assert.equal(mounted.controller.state.changed,true,`${key} must invalidate saved results`)
   assert.ok(nodes['library-warning'].textContent.includes('变化'))
   assert.equal(nodes['library-restart'].hidden,false)
  }
  saved=[];const before=calls;mounted.activate();await until(()=>calls>before&&mounted.controller.state.status==='empty')
  assert.equal(mounted.controller.state.hits.size,0,'reactivation revalidates previously complete snapshots')
  saved=[hit('added')];events.forEach(fn=>fn({'snooper.notes.v1':{}},'local'))
  assert.equal(mounted.controller.state.changed,true,'empty library can become stale')
  assert.equal(nodes['library-restart'].hidden,false)
  const emptyCalls=calls;mounted.activate();await until(()=>calls>emptyCalls&&mounted.controller.state.status==='complete')
  assert.equal(mounted.controller.state.hits.size,1)
 })
 await check('favorite ACK preserves authoritative cross-surface additions',async()=>{
  let read=0,ack,delayed
  const state=api.favorites.createFavoriteState(async type=>{
   if(type==='LIBRARY_FAVORITE')return new Promise(resolve=>ack=resolve)
   read++;if(read===1)return {ok:true,refs:[]};if(read===2)return new Promise(resolve=>delayed=resolve)
   return {ok:true,refs:[ref('A'),ref('B')]}
  })
  await state.refresh();const mutation=state.toggle(ref('A'));const refresh=state.refresh()
  ack({ok:true,ref:ref('A'),favorite:true});await mutation
  delayed({ok:true,refs:[ref('A'),ref('B')]});await refresh
  assert.equal(state.has(ref('A')),true);assert.equal(state.has(ref('B')),true);assert.equal(state.status,'ready')
 })
 let liveSubscriptions=0
 const shared=api.favorites.favoriteState(),subscribe=shared.subscribe
 shared.subscribe=fn=>{liveSubscriptions++;const off=subscribe(fn);let closed=false;return()=>{if(!closed){closed=true;liveSubscriptions--;off()}}}
 chrome.runtime.sendMessage=async()=>({ok:true,refs:[]});await shared.refresh()
 await check('200-row subtitle window disposes old subscriptions before twenty rerenders',async()=>{
  const refs=Object.fromEntries(['recordBtn','recordLabelEl','subBox','subHandle','subResize','subScroll','subRows','subPlaceholder','subStatus','subListening','streamingRow','streamingText','streamingSource','streamingLabel','chatEl'].map(key=>[key,document.createElement('div')]))
  Object.values(refs).forEach(el=>document.body.append(el))
  const session={state:'idle',isDemoMode:false,transcriptId:'r',currentTranscriptSaveState:{status:'saved'},subtitles:[],messages:[]}
  const view=api.subtitle.createSubtitleView({refs,getSession:()=>session,isUiHidden:()=>false,applyUiHidden(){},updateLangLabel(){},renderNotes(){},openShotPreview(){}})
  const before=liveSubscriptions
  for(let turn=0;turn<20;turn++){session.subtitles=Array.from({length:200},(_,i)=>({id:`${turn}-${i}`,source:'手机',at:i}));view.render()}
  assert.equal(liveSubscriptions-before,200,'only attached200 subtitle buttons may remain subscribed without future emits')
  session.subtitles=[];view.render();assert.equal(liveSubscriptions,before)
 })
 await check('note rerenders and result resets release detached controls',async()=>{
  const before=liveSubscriptions
  const refs=Object.fromEntries(['count','badge','button','list'].map(key=>[key,document.createElement('div')]))
  Object.values(refs).forEach(el=>document.body.append(el))
  const session={notes:[{id:'n',title:'note',entries:[{id:'e',type:'subtitle',source:'手机',at:1}]}],activeNoteId:'n'}
  const notes=api.notes.createNotes({refs,getSession:()=>session,toast(){},openShotPreview(){}})
  for(let i=0;i<20;i++)notes.render()
  assert.equal(liveSubscriptions-before,1)
  session.notes=[];notes.render();assert.equal(liveSubscriptions,before)
  const root=document.createElement('div');document.body.append(root)
  const results=api.render.createResultRenderer(root,()=>{})
  for(let i=0;i<20;i++)results.update({status:'complete',hits:new Map()},[hit('one')],true)
  assert.equal(liveSubscriptions-before,1)
  results.update({status:'empty',hits:new Map()},[],true);assert.equal(liveSubscriptions,before)
 })
 await check('retry context requests immediately and disposed async contexts cannot subscribe',async()=>{
  let calls=0,resolve
  chrome.runtime.sendMessage=async m=>m.type==='LIBRARY_CONTEXT'?++calls===1?{ok:false,error:'read failure'}:calls===3?new Promise(r=>resolve=r):{ok:true,entry:hit('one'),before:[hit('neighbor')],after:[]}:{ok:true,refs:[]}
  const row=api.render.renderEntry(hit('one'),()=>{});document.body.append(row)
  const context=dom.action(row,'context')
  await context.click();assert.equal(calls,1);assert.equal(context.textContent,'重试上下文')
  await context.click();assert.equal(calls,2,'first retry click must re-read context')
  await context.click() // collapse and release context controls
  const before=liveSubscriptions
  const opening=context.click();api.favorites.disposeFavoriteControls(row);row.remove()
  resolve({ok:true,entry:hit('one'),before:[hit('neighbor')],after:[]});await opening
  assert.equal(liveSubscriptions,before-1,'late response must not attach subscribed children to a disposed tree')
 })
 console.log(`${5-failures.length}/5 lifecycle regressions passed`)
 if(failures.length)process.exitCode=1
} finally {h.close()}
