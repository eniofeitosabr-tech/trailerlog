// Reproduce the two deletion paths using real storage and payment-page code. No network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const source=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const owner='61000000-0000-4000-8000-000000000001',map=new Map(),tabs=[],pending=[];
let tail=Promise.resolve();
const locks={request(name,fn){const p=tail.then(fn);tail=p.catch(()=>{});return p}};
function make(kind){
 const nodes=new Map(),handlers={},docHandlers={},messages=[];
 const node=()=>({value:'',textContent:'',children:[],classList:{toggle(){},remove(){}},hidden:false,
  appendChild(n){this.children.push(n)},replaceChildren(){this.children=[]},addEventListener(n,fn){this.handlers??={};this.handlers[n]=fn}});
 const el=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
 const fire=ev=>{for(const fn of handlers[ev.type]||[])fn(ev)};
 const c=vm.createContext({console,Date,Intl,crypto,TextEncoder,Event:class{constructor(type){this.type=type}},
  TrailerAuth:{scope:()=>owner,authorize:async id=>assert.equal(id,owner),ready:{then:fn=>fn()}},navigator:{locks},
  document:{documentElement:{lang:'pt-BR'},visibilityState:'visible',getElementById:el,createElement:node,querySelectorAll:()=>[],addEventListener:(n,fn)=>(docHandlers[n]??=[]).push(fn)},
  window:{addEventListener:(n,fn)=>(handlers[n]??=[]).push(fn),dispatchEvent:fire},
  localStorage:{getItem:k=>map.get(k)??null,setItem(k,v){assert(k.startsWith('trailerlog:user:'+owner+':'));map.set(k,v);for(const tab of tabs)if(tab.c!==c)pending.push(()=>tab.fire({type:'storage',key:k}))}},
  alert:msg=>messages.push(msg),confirm:msg=>{messages.push(msg);return true},PaycheckUI:{t:k=>k,money:String,number:String}
 });
 for(const f of ['sha256.js','payments.js','storage.js','equipment-history.js'])vm.runInContext(source(f),c);
 if(kind==='history')vm.runInContext(source('historico.html').match(/<script>([\s\S]*?)<\/script>/)[1],c);
 if(kind==='pay')vm.runInContext(source('paycheck-page.js'),c);
 const api={c,el,fire,messages,run:s=>vm.runInContext(s,c),ready(){for(const fn of docHandlers.DOMContentLoaded||[])fn()}};
 tabs.push(api);return api;
}
const flush=()=>{while(pending.length)pending.shift()()};
const setPeriod=t=>{t.el('payFrom').value='2026-11-01';t.el('payTo').value='2026-11-07';t.el('payFilter').handlers.submit({preventDefault(){}})};
async function main(){
 const history=make('history');
 await history.run(`TrailerStorage.change(d=>{
  const p={version:1,localDate:'2026-11-02',originalMiles:100,storeToBackhaul:0,backhaulToBase:0,backhaul:false,destination:'',extraDayCents:0,rateCents:65,initialTrailer:'TR-F'};
  d.jornadasSalvas=[{id:'fictitious-id',registroId:'fictitious-source',truck:'teste001',trailer:'TR-F',inicio:'2026-11-02T10:00:00Z',fim:'2026-11-02T18:00:00Z',status:'Finalizada',pagamento:{...p}},
    {id:'legitimate-no-visits',registroId:'real-source',truck:'REAL',trailer:'',inicio:'2026-11-03T10:00:00Z',fim:'2026-11-03T18:00:00Z',status:'Finalizada',pagamento:{...p,localDate:'2026-11-03',initialTrailer:''}}];
  d.trailersSalvos=[{registroId:'fictitious-use',trailer:'TR-F',jornadaId:'fictitious-id'}];
  d.legacyIndependentPayments=[{id:'unknown-legitimate-payment',amount:123}];
 })`);
 history.ready();history.run('limparDataHistorico()');history.el('campoPesquisa').value='TR-F';history.run('mostrarHistorico()');
 assert(history.el('historico').innerHTML.includes('mantém pagamento'));
 assert(history.el('historico').innerHTML.includes('Excluir jornada e pagamento'));
 const payA=make('pay'),payB=make('pay');setPeriod(payA);setPeriod(payB);
 assert.equal(payA.el('payTotal').textContent,'13000');
 // This was the ambiguous old Excluir Registro path: only the visit is deleted.
 await history.run('excluirTrailer(0)');flush();
 assert(history.messages.some(m=>m.includes('pagamento')&&m.includes('mantidos')));
 assert.equal(payA.el('payTotal').textContent,'13000');
 assert.equal(history.run('TrailerStorage.read().data.jornadasSalvas.length'),2);
 assert(!history.el('historico').innerHTML.includes('onclick="excluirTrailer'));
 // It is not a detached payment: the owner journey still exists, even with zero visits.
 history.run('selecionarAba("journey")');history.el('campoPesquisa').value='teste001';history.run('mostrarHistorico()');
 assert(history.el('historico').innerHTML.includes('excluirJornada(0)'));
 const survivingBefore=history.run('JSON.stringify(TrailerStorage.read().data.jornadasSalvas[1])');
 await history.run('excluirJornada(0)');flush();
 for(const pay of [payA,payB]){assert.equal(pay.el('payTotal').textContent,'6500');assert.equal(pay.el('payReport').children.filter(c=>c.className==='pay-card').length,1)}
 assert.equal(history.run('JSON.stringify(TrailerStorage.read().data.jornadasSalvas[0])'),survivingBefore);
 assert.equal(history.run('TrailerStorage.read().data.legacyIndependentPayments[0].amount'),123);
 const f5=make('pay');setPeriod(f5);assert.equal(f5.el('payTotal').textContent,'6500');
 const contains=(n,s)=>n.textContent.includes(s)||n.children.some(c=>contains(c,s));
 assert(contains(f5.el('payReport'),'legitimate-no-visits'));assert(!contains(f5.el('payReport'),'fictitious-id'));
 f5.fire({type:'traileraccountchange'});assert.equal(f5.el('payTotal').textContent,'—');assert.equal(f5.el('payReport').children.length,0);
 console.log('PASS exact visit-only reproduction; real storage deletion/recalculation; two payment sessions and F5; legitimate no-visit/unknown standalone data preserved.');
}main().catch(e=>{console.error(e);process.exitCode=1});
