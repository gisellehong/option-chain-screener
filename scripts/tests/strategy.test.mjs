import test from 'node:test';
import assert from 'node:assert/strict';
import {configs,scoreCandidates} from '../score-options.mjs';
import {normalizeSheet,dateValue} from '../import-option-ledger.mjs';
const config=configs.find(c=>c.id==='soxl_conservative_csp');
const base={id:'safe',ticker:'SOXL',optionType:'put',expiration:'2026-09-18',dte:14,strike:70,underlyingPrice:100,bid:0.1,ask:0.11,delta:-0.05,openInterest:500,volume:100,expiryItmProbability:2,touchProbability:5,soxlFridayBucket:2,iv:70,ivPercentile:50};
const score=(rows,showAll=false)=>scoreCandidates(config,config.scenarios[0].filters,rows,showAll);
test('risk first accepts lower income without forcing 20% Mid annualized',()=>{
 const result=score([base]);assert.equal(result.length,1);assert.ok(result[0].midAnnualizedRoi<20);
 assert.equal(scoreCandidates(config,config.scenarios[1].filters,[base]).length,0);
});
test('risk first rejects missing probabilities, excessive touch, wide/proxy/invalid quotes',()=>{
 for(const patch of [{expiryItmProbability:null},{touchProbability:null},{touchProbability:11},{bid:0.1,ask:0.3},{bid:0},{ask:0.05},{priceSource:'moomoo_last_price_proxy'},{ticker:'ES'},{optionType:'call'}])assert.equal(score([{...base,...patch}]).length,0,JSON.stringify(patch));
});
test('one contract per expiration chooses lower tail risk ahead of premium',()=>{
 const rows=score([base,{...base,id:'rich',bid:1,ask:1.1,expiryItmProbability:4}]);assert.equal(rows.length,1);assert.equal(rows[0].id,'safe');
 assert.equal(score([{...base,touchProbability:11}],true)[0].matched,false);
});
function raw(rows){const h=Array(50).fill('');h[0]='Order Date';h[41]='Closed Profit';return {fetchedAt:'2026-09-07T00:00:00Z',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/example',tracker:{values:[h,...rows]}};}
function trade(patch={}){const r=Array(50).fill(null);Object.assign(r,{0:'2026-08-14',1:'Giselle',2:'CSP',4:'SOXL 260911',6:70,9:1,14:99,15:2,38:'2026-08-21',40:0.2,41:158},patch);return r;}
test('ledger scope excludes futures and third-party accounts and recalculates DTE',()=>{
 const ledger=normalizeSheet(raw([trade(),trade({4:'ES 260911'}),trade({1:'Rich'})]));
 assert.equal(ledger.trades.length,1);assert.equal(ledger.excluded.futures,1);assert.equal(ledger.excluded.thirdParty,1);
 const t=ledger.trades[0];assert.equal(t.entryDte,28);assert.equal(t.sourceDte,99);assert.equal(t.cashRequired,14000);assert.equal(t.closedProfit,158);
 assert.equal(dateValue(46269),'2026-09-04');
});
test('ledger preserves roll losses and flags reconciliation and duplicate rows',()=>{
 const row=trade({41:-100});const broker={id:'verified',trader:'G',entryDate:'2026-08-14',strike:70,contracts:2,strategy:'CSP',entryPremium:1,closeDate:'2026-08-21',closePrice:0.2,closedProfit:-99,rollGroupId:'roll-example'};
 const ledger=normalizeSheet(raw([row,row]),[broker]);assert.equal(ledger.trades.length,2);assert.equal(ledger.trades[0].closedProfit,-100);assert.equal(ledger.trades[0].reconciliation,-1);assert.equal(ledger.trades[0].rollGroupId,'roll-example');assert.ok(ledger.trades[1].flags.some(f=>f.includes('重複')));
});
test('missing expiry stays unknown; spread collateral respects long leg',()=>{
 const ledger=normalizeSheet(raw([trade({4:'SOXL'}),trade({2:'BPS',7:65})]));assert.equal(ledger.trades[0].expiration,null);assert.equal(ledger.trades[1].cashRequired,800);
 assert.throws(()=>normalizeSheet({tracker:{values:[[]]}}),/headers/);
});
