// Isolated synthetic payments only. No browser, credentials, storage or network.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const context = vm.createContext({ Date });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'payments.js'), 'utf8'), context);
const p = vm.runInContext('TrailerPay', context);
const journey = { id: 'synthetic', inicio: '2026-11-07T12:00:00Z', trailer: 'TEST' };
const input = { originalMiles: 0, storeToBackhaul: 0, backhaulToBase: 0,
    backhaul: false, destination: '', extraDayCents: 0 };
const make = (miles, rate = 65, overrides = {}) => p.create({ ...input, originalMiles: miles, ...overrides }, journey, { rateCents: rate });
let cases = 0;
function check(payment, expected) {
    const before = JSON.stringify(payment);
    assert.equal(p.calculate(payment).mileageCents, expected);
    assert.equal(p.calculate(p.normalize(JSON.parse(before))).mileageCents, expected);
    assert.equal(JSON.stringify(payment), before);
    cases++;
}
for (const [miles, cents] of [[0,4500],[17,4500],[69,4500],[70,4550],[80,5200],[96,6240],[97,6305]]) check(make(miles), cents);
for (const rate of [60,68,100]) for (const miles of [0,17,44,45,69,70,75,80,96,96.01,97]) {
    const normal = Math.round(miles * rate);
    check(make(miles, rate), miles <= 96 ? Math.max(4500, normal) : normal);
}
// A historical low rate exposes both sides of the inclusive distance boundary.
for (const [miles, cents] of [[96,4500],[96.01,960]]) check({ ...make(miles), rateCents: 10 }, cents);
check(make(74.99,60),4500); check(make(75,60),4500); check(make(75.01,60),4501);
for (const backhaul of [false,true]) for (let stops=1; stops<=5; stops++) for (const extra of p.extras) {
    const payment = make(backhaul ? 100 : 17,65,{ backhaul, destination: backhaul ? 'TEST' : '', numeroParadas: stops, extraDayCents: extra });
    const bonus = (backhaul ? 5150 : 0) + (stops-1)*2000 + extra;
    const calculated = p.calculate(payment);
    assert.equal(calculated.payableMiles, backhaul ? 50 : 17);
    assert.equal(calculated.totalCents,4500+bonus);
    const data = { jornadasSalvas: [{ ...journey, pagamento: payment }], jornadaAtiva: null };
    const before = JSON.stringify(data);
    for (let repeat=0; repeat<2; repeat++) assert.equal(p.report(data,'2026-11-07','2026-11-07').totals.totalCents,9500+bonus);
    assert.equal(JSON.stringify(data),before);
    assert.equal(p.edit(data,journey.id,JSON.parse(JSON.stringify(payment))),false);
    cases++;
}
check(make(100,65,{backhaul:true,destination:'TEST',additionalBackhaulMiles:20}),4550);
check(make(100,65,{backhaul:true,destination:'TEST',additionalBackhaulMiles:47}),6305);
check(make(0.01,65,{backhaul:true,destination:'TEST'}),4500);
const old = {...make(17)}; delete old.mileageMinimumVersion;
check(old,1105);
const data = { jornadasSalvas: [{...journey,pagamento:old}], jornadaAtiva:null, paymentSettings:{rateCents:100} };
const before = JSON.stringify(data);
assert.equal(p.report(data,'2026-11-07','2026-11-07').totals.totalCents,6105);
assert.equal(JSON.stringify(data),before);
p.edit(data,journey.id,{...old,numeroParadas:2});
assert.equal(p.calculate(data.jornadasSalvas[0].pagamento).mileageCents,1105);
assert.equal(data.jornadasSalvas[0].pagamentoCorrecoes[0].before.mileageMinimumVersion,undefined);
assert.throws(()=>p.normalize({...old,mileageMinimumVersion:2}));
assert(fs.readFileSync(path.join(__dirname,'..','payments-ui.js'),'utf8').includes('mileageMinimumVersion: 1'));
console.log(`PASS minimum payment: ${cases} synthetic scenarios, historical integrity, rounding, bonuses, reports and idempotence.`);
