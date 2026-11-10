/** Narrow DOM fixture for the exported library renderer and native confirmation. */
export function installDOM() {
 class Node {
  constructor(tag='') {this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.dataset={};this.style={};this.attributes={};this.events={};this.hidden=false;this.disabled=false;this._text='';this.className=''}
  get lastElementChild(){return this.children.at(-1)||null}
  get classList(){const list=()=>this.className.split(/\s+/).filter(Boolean);const set=v=>{this.className=v.join(' ')};return {contains:v=>list().includes(v),add:(...v)=>set([...new Set([...list(),...v])]),remove:(...v)=>set(list().filter(x=>!v.includes(x))),toggle:(v,on)=>{const has=list().includes(v);const next=on??!has;set(next?[...new Set([...list(),v])]:list().filter(x=>x!==v));return next}}}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('')}
  set textContent(v){this._text=String(v);for(const n of this.children)n.parentNode=null;this.children=[]}
  append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n)}}
  appendChild(n){this.append(n);return n}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null}}
  setAttribute(k,v){this.attributes[k]=String(v)}
  getAttribute(k){return this.attributes[k]??null}
  addEventListener(type,fn){(this.events[type]||=[]).push(fn)}
  async fire(type){for(const fn of this.events[type]||[])await fn({stopPropagation(){},preventDefault(){}})}
  async click(){if(!this.disabled)await this.fire('click')}
  matches(){return false}
  focus(){document.activeElement=this}
  showModal(){this.open=true}
  close(){this.open=false;void this.fire('close')}
 }
 globalThis.document={addEventListener(){},querySelector(){return null},body:new Node('body'),activeElement:null,createElement:tag=>new Node(tag),createTextNode:text=>{const n=new Node('#text');n.textContent=text;return n}}
 const all=(node,predicate)=>[...node.children.filter(predicate),...node.children.flatMap(n=>all(n,predicate))]
 return {all,action:(node,name)=>all(node,n=>n.dataset.action===name)[0],dialog:()=>document.body.children.find(n=>n.tagName==='DIALOG')}
}
export async function until(condition){for(let i=0;i<100;i++){if(condition())return;await new Promise(r=>setTimeout(r,1))}throw Error('condition did not settle')}
