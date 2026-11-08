// Isolated fictional data; no network, browser profile, or Supabase.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
async function main(){
 const nodes=new Map(),events={},alerts=[],confirmations=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',classList:{toggle(){}},hidden:false});return nodes.get(id)};
 let owner='account-A',token=1,writes=0,approved=true,confirmHook=()=>{};
 const payment={version:1,localDate:'2026-11-02',originalMiles:150,storeToBackhaul:0,backhaulToBase:0,backhaul:false,destination:'',extraDayCents:0,rateCents:65,initialTrailer:'T1',numeroParadas:2};
 const journey=(id,truck,day)=>({id,registroId:'r-'+id,truck,trailer:'T1',inicio:day+'T10:30:00',fim:day+'T18:00:00',status:'Finalizada',pagamento:{...payment,localDate:day},detentions:[],pagamentoCorrecoes:[]});
 let data={jornadasSalvas:[journey('delete','A','2026-11-02'),journey('keep','A','2026-11-03'),journey('other','B','2026-11-02')],jornadaAtiva:{...journey('active','A','2026-11-02'),status:'Em andamento',fim:undefined},trucksCadastrados:[{numero:'A'}],trailersSalvos:[{registroId:'u1',trailer:'T1',jornadaId:'delete'},{registroId:'u2',trailer:'T2',jornadaId:'delete'},{registroId:'u3',trailer:'T1',jornadaId:'keep'},{registroId:'legacy',trailer:'T1',truck:'A'}],paymentSettings:{rateCents:68}};
 data.jornadasSalvas[0].detentions=[{version:1,id:'detention-delete',localDate:'2026-11-02',minutes:90,rateCents:1500,createdAt:'2026-11-02T10:00:00Z'}];
 data.jornadasSalvas[0].pagamentoCorrecoes=[{at:'2026-11-02T18:30:00Z',before:null,after:clone(payment)}];
 const c=vm.createContext({console,Date,Intl,document:{getElementById:get,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener:(n,fn)=>events[n]=fn},PaycheckUI:{language:'pt'},TrailerAuth:{scope(){if(owner!=='account-A')throw Error('account changed');return owner}},confirm:msg=>{confirmations.push(msg);confirmHook();return approved},alert:msg=>alerts.push(msg),TrailerStorage:{
 read:()=>({data:clone(data),token}),
 async change(fn,expected){assert.equal(owner,'account-A');if(expected!==token)throw Error('stale snapshot');const next=clone(data);fn(next);data=next;token++;writes++}
 }});
 vm.runInContext(read('payments.js'),c);vm.runInContext(read('historico.html').match(/<script>([\s\S]*?)<\/script>/)[1],c);
 const run=s=>vm.runInContext(s,c);
 // Journey view includes the active journey, protects it from deletion and filters only by day.
 run('selecionarAba("journey")');assert.equal((get('historico').innerHTML.match(/onclick="excluirJornada/g)||[]).length,3);assert(get('historico').innerHTML.includes('Em andamento'));
 get('campoPesquisa').value='A';get('dataPesquisa').value='2026-11-02';run('mostrarHistorico()');
 assert.equal((get('historico').innerHTML.match(/onclick="excluirJornada/g)||[]).length,2);
 assert(!read('historico.html').includes('trailerPesquisa'));
 get('dataPesquisa').value='2026-11-05';run('mostrarHistorico()');assert(get('historico').innerHTML.includes('Nenhuma jornada encontrada'));
 run('limparDataHistorico()');assert.equal(get('dataPesquisa').value,'');assert.equal((get('historico').innerHTML.match(/onclick="excluirJornada/g)||[]).length,3);
 assert.equal(run('diaLocalHistorico("invalid")'),null);
 c.PaycheckUI.language='en';events.trailerpaylanguage();assert.equal(get('labelPesquisa').textContent,'Search Truck');assert(get('historico').innerHTML.includes('Delete journey'));
 const original=JSON.stringify(data);approved=false;await run('excluirJornada(0)');assert.equal(JSON.stringify(data),original);assert.equal(writes,0);assert(confirmations.at(-1).includes('delete')&&confirmations.at(-1).includes('Truck: A'));
 approved=true;confirmHook=()=>token++;await run('excluirJornada(0)');assert.equal(writes,0);assert.equal(JSON.stringify(data),original);assert(alerts.at(-1).includes('stale'));
 confirmHook=()=>{};run('mostrarHistorico()');
 const preserved=JSON.stringify({journeys:data.jornadasSalvas.slice(1),active:data.jornadaAtiva,trucks:data.trucksCadastrados,settings:data.paymentSettings});
 c.fixture=clone(data);assert.throws(()=>run('removerJornadaFinalizada(fixture,fixture.jornadaAtiva)'));
 c.fixture=clone(data);c.fixture.jornadasSalvas.push(clone(c.fixture.jornadasSalvas[0]));assert.throws(()=>run('removerJornadaFinalizada(fixture,fixture.jornadasSalvas[0])'));
 const before=run('TrailerPay.report(TrailerStorage.read().data,"2026-11-01","2026-11-07").totals.totalCents');
 await run('excluirJornada(0)');assert.equal(writes,1);assert(!data.jornadasSalvas.some(j=>j.id==='delete'));assert(!data.trailersSalvos.some(u=>u.jornadaId==='delete'));assert(data.trailersSalvos.some(u=>u.registroId==='legacy'));
 assert.equal(JSON.stringify({journeys:data.jornadasSalvas,active:data.jornadaAtiva,trucks:data.trucksCadastrados,settings:data.paymentSettings}),preserved);
 const after=run('TrailerPay.report(TrailerStorage.read().data,"2026-11-01","2026-11-07").totals.totalCents');assert.equal(before-after,14000);
 assert(get('historicoStatus').textContent.includes('Journey deleted'));
 // Weekend allocation is recomputed, without rewriting the remaining journey.
 c.weekend={jornadasSalvas:[journey('sat-first','A','2026-10-24'),journey('sat-next','A','2026-10-24')],jornadaAtiva:null,trailersSalvos:[],trucksCadastrados:[]};
 const untouched=JSON.stringify(c.weekend.jornadasSalvas[1]);
 assert.equal(run('TrailerPay.report(weekend,"2026-10-24","2026-10-24").totals.saturdayCents'),5000);
 run('removerJornadaFinalizada(weekend,weekend.jornadasSalvas[0])');
 assert.equal(run('TrailerPay.report(weekend,"2026-10-24","2026-10-24").totals.saturdayCents'),5000);
 assert.equal(JSON.stringify(c.weekend.jornadasSalvas[0]),untouched);
 owner='account-B';const final=JSON.stringify(data);await run('excluirJornada(0)');assert.equal(JSON.stringify(data),final);assert.equal(writes,1);
 console.log('PASS journey deletion/cancel/stale/account fences, associated visits only, payment totals, date-only journey filter and PT/EN.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
