// Synthetic DOM, clock and records only; no network or persistent storage.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const originalTZ = process.env.TZ;
for (const [zone, instant, today] of [
    ['America/New_York','2026-11-15T03:30:00Z','2026-11-14'],
    ['Asia/Tokyo','2026-10-31T16:00:00Z','2026-11-01']
]) {
    process.env.TZ = zone;
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
    const nodes = new Map(), events = {};
    const node = () => ({value:'',textContent:'',children:[],handlers:{},appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(name,fn){this.handlers[name]=fn;}});
    const el = id => {if (!nodes.has(id)) nodes.set(id,node());return nodes.get(id);};
    const payment = localDate => ({version:1,localDate,originalMiles:100,storeToBackhaul:0,backhaulToBase:0,backhaul:false,destination:'',extraDayCents:0,rateCents:65,initialTrailer:''});
    const data = {jornadaAtiva:null,jornadasSalvas:['2026-10-23','2026-10-24','2026-10-25'].map(date=>({id:date,inicio:date+'T12:00:00Z',pagamento:payment(date)})),trailersSalvos:[]};
    const before = JSON.stringify(data);
    let subscriber;
    const c = vm.createContext({Date:Clock,Intl,document:{documentElement:{lang:'pt-BR'},getElementById:el,createElement:node},window:{addEventListener:(name,fn)=>events[name]=fn},
        PaycheckUI:{t:key=>key,money:String,number:String},TrailerStorage:{subscribe(fn){subscriber=fn;fn({data});},change(){throw Error('Writes forbidden');}}});
    vm.runInContext(source('payments.js'),c);vm.runInContext(source('paycheck-page.js'),c);
    assert.equal(el('payFrom').value,today);assert.equal(el('payTo').value,today);
    const submit=()=>el('payFilter').handlers.submit({preventDefault(){}});
    el('payFrom').value='2026-10-23';el('payTo').value='2026-10-25';submit();
    assert.equal(el('payTotal').textContent,'29500','both boundary dates and weekend bonuses included');
    subscriber({data});events.trailerpaylanguage();
    assert.equal(el('payFrom').value,'2026-10-23');assert.equal(el('payTo').value,'2026-10-25');
    el('payFrom').value='2026-10-24';el('payTo').value='';submit();
    assert.equal(el('payTotal').textContent,'11500','existing single-date fallback preserved');
    el('payFrom').value='';submit();subscriber({data});events.trailerpaylanguage();
    assert.equal(el('payFrom').value,'');assert.equal(el('payTo').value,'');
    assert.equal(el('payTotal').textContent,'—');assert.equal(el('payReport').children.length,0);
    assert.equal(JSON.stringify(data),before);
}
if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ=originalTZ;
console.log('PASS paycheck defaults: local today in two timezones, historical inclusive totals, edits/clearing preserved across updates and language events; no writes.');
