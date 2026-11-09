// Fictional records and isolated clocks/DOM only. No network or persistent storage.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = source('historico.html'), originalTZ = process.env.TZ;
let scenarios = 0;
for (const [zone, instant, today] of [
    ['America/New_York','2026-11-01T03:30:00Z','2026-10-31'],
    ['Asia/Tokyo','2026-10-31T16:00:00Z','2026-11-01'],
    ['America/New_York','2026-11-01T06:30:00Z','2026-11-01']
]) {
    process.env.TZ = zone;
    const RealDate = Date;
    class Clock extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } }
    const nodes = new Map(), handlers = {}, events = {};
    const el = id => { if (!nodes.has(id)) nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{toggle(){}},hidden:false}); return nodes.get(id); };
    const journey = (id, day) => ({id,truck:'T',trailer:'AbC123',inicio:day+'T12:00:00',fim:day+'T18:00:00'});
    const data = {jornadasSalvas:[journey('old','2026-10-30'),journey('start','2026-10-31'),journey('end','2026-11-01'),journey('late','2026-11-02')],jornadaAtiva:null, trucksCadastrados:[],
        trailersSalvos:[{registroId:'visit-a',jornadaId:'start',trailer:'abc123'},{registroId:'visit-b',jornadaId:'end',trailer:'ABC123'},{registroId:'ambiguous',jornadaId:'duplicate',trailer:'AbC123',data:'2026-10-31T12:00:00'}]};
    data.jornadasSalvas.push(journey('duplicate','2020-01-01'),journey('duplicate','2021-01-01'));
    const before = JSON.stringify(data);
    const c = vm.createContext({Date:Clock,Intl,document:{getElementById:el,querySelectorAll:()=>[],addEventListener:(name,fn)=>handlers[name]=fn},window:{addEventListener:(name,fn)=>events[name]=fn},
        TrailerAuth:{scope:()=> 'synthetic'},TrailerStorage:{read:()=>({data,token:'mock'}),subscribe(fn){fn({data,token:'mock'},false,true)},change(){throw Error('Writes forbidden');}},PaycheckUI:{language:'pt'}});
    vm.runInContext(source('equipment-history.js'),c);
    vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],c);
    const run = code => vm.runInContext(code,c);
    handlers.DOMContentLoaded();
    assert.equal(el('dataPesquisa').value,today); assert.equal(el('dataPesquisaAte').value,today);
    run('selecionarAba("journey")');
    const cards = () => (el('historico').innerHTML.match(/class="registro-historico truck"/g)||[]).length;
    assert.equal(cards(),1);
    el('dataPesquisa').value='2026-10-31';el('dataPesquisaAte').value='2026-11-01';run('mostrarHistorico()');assert.equal(cards(),2);
    assert.equal(run('correspondeDiaHistorico("2026-11-01")'),true);
    el('dataPesquisaAte').value='';run('mostrarHistorico()');assert.equal(cards(),3);
    el('dataPesquisa').value='';el('dataPesquisaAte').value='2026-10-30';run('mostrarHistorico()');assert.equal(cards(),2);
    el('dataPesquisa').value='2026-11-02';run('mostrarHistorico()');assert.equal(cards(),0);
    run('limparDataHistorico()');assert.equal(cards(),5); // Existing duplicate-ID protection remains.
    for (const lang of ['pt','en']) { c.PaycheckUI.language=lang;events.trailerpaylanguage();run('mostrarHistorico()');assert.equal(el('dataPesquisa').value,'');assert.equal(el('dataPesquisaAte').value,''); }
    run('selecionarAba("trailer")');
    for (const value of ['abc123','ABC123','AbC123']) { el('campoPesquisa').value=value;run('mostrarHistorico()');assert.equal((el('historico').innerHTML.match(/class="registro-historico trailer"/g)||[]).length,3);assert(!el('historico').innerHTML.includes('excluirJornada(4)')); }
    el('dataPesquisa').value='2026-10-31';el('dataPesquisaAte').value='2026-10-31';run('mostrarHistorico()');assert.equal((el('historico').innerHTML.match(/class="registro-historico trailer"/g)||[]).length,2);
    const api=run('EquipmentHistory');
    assert.equal(api.uniqueJourney(data.jornadasSalvas,'duplicate'),null);
    assert.equal(api.sameTrailer('ABC-123','ABC123'),false);
    assert.equal(api.sameTrailer('', ''),false);
    const independent={jornadasSalvas:[],jornadaAtiva:null,trucksCadastrados:[],trailersSalvos:[{registroId:'one',trailer:'abc123',data:instant},{registroId:'two',trailer:'ABC123',data:instant}]};
    assert.equal(api.summarize(independent,{truck:'T',trailer:'AbC123'}).trailer.count,2,'distinct unlinked IDs are not merged by number/time');
    const summarized=api.summarize({...data,jornadasSalvas:data.jornadasSalvas.slice(0,4)},{truck:'T',trailer:'aBc123'});
    assert(summarized.trailer.count>=2);
    assert.equal(JSON.stringify(data),before);
    scenarios++;
}
if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ=originalTZ;
console.log(`PASS history range/identity: ${scenarios} timezone/month/DST clocks, defaults, inclusive/open/cleared ranges, case-insensitive search, ambiguous IDs and immutable fixtures.`);
