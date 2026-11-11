import assert from 'node:assert/strict'
import { harness } from './library-test-harness.mjs'
const h = harness([['search','src/lib/knowledge-search.ts']])
try {
const {search:s} = await h.load()
assert.equal(s.matchesQuery({source:'computer',target:'电脑'},'  电脑 '),true)
assert.equal(s.matchesQuery({source:'计算机',target:''},'电脑'),false)
assert.equal(s.matchesQuery({text:'Phone  book'},'PHONE  book'),true)
assert.equal(s.matchesQuery({text:'Phone  book'},'phone book'),false)
assert.deepEqual(s.matchRanges('电脑 / COMPUTer / computer','computer'),[[5,13],[16,24]])
assert.deepEqual(s.matchRanges('İPhone','phone'),[[1,6]],'ASCII folding must preserve original indices')
assert.deepEqual(s.matchRanges('手机',' '),[])
const a={ref:{kind:'note',noteId:'a',entryId:'1'},sourceRef:{key:'lesson-a'},source:'电脑'}
const b={...a,ref:{...a.ref,entryId:'2'}}
assert.equal(s.groupHits([a,b])[0].hits.length,2)
console.log('✅ knowledge-search: literal ASCII-insensitive matching, original ranges and stable grouping passed')
} finally {h.close()}
