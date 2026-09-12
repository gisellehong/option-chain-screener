import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {freezeSnapshot,chooseSnapshot,marketDate,diagnose,makeDecision,pairedOutcome,contractKey,buildComparison,screenshotExceptions} from '../compare-laok.mjs';
import {configs} from '../score-options.mjs';
const config=configs.find(c=>c.id==='soxl_conservative_csp');
const scenario=config.scenarios.find(s=>s.id==='execution');
const base={id:'a',ticker:'SOXL',optionType:'put',expiration:'2026-09-18',dte:8,strike:70,underlyingPrice:100,bid:1,ask:1.1,delta:-.05,openInterest:500,volume:100,expiryItmProbability:2,touchProbability:5,soxlFridayBucket:2,iv:100,ivPercentile:80};
const snap=(at,candidates=[base],fresh=true)=>({generatedAt:at,candidates,fresh});
test('alignment never selects future, stale, prior trading day, or premarket snapshots',()=>{
 const good=snap('2026-09-10T13:40:00Z');
 const rows=[snap('2026-09-10T14:01:00Z'),snap('2026-09-10T13:50:00Z',[base],false),snap('2026-09-09T14:00:00Z'),snap('2026-09-10T13:15:00Z'),good];
 assert.equal(chooseSnapshot(rows,'2026-09-10T14:00:00Z'),good);
 assert.equal(chooseSnapshot(rows,'2026-09-10T15:30:00Z'),null);
 assert.equal(marketDate('2026-09-11T03:00:00+08:00'),'2026-09-10');
});
test('diagnosis separates missing data, scope, bad quotes and deliberate gates',()=>{
 const s=snap('2026-09-10T14:00:00Z');
 assert.equal(diagnose({...base,ticker:'LITE'},s,scenario).status,'outside_universe');
 assert.equal(diagnose(base,null,scenario).status,'missing_snapshot');
 assert.equal(diagnose({...base,strike:60},s,scenario).status,'missing_contract');
 assert.equal(diagnose(base,snap(s.generatedAt,[{...base,bid:0}]),scenario).status,'invalid_quote');
 assert.equal(diagnose(base,snap(s.generatedAt,[{...base,touchProbability:null}]),scenario).status,'missing_model_data');
 const filtered=diagnose(base,snap(s.generatedAt,[{...base,touchProbability:15}]),scenario);
 assert.equal(filtered.status,'filtered');assert.ok(filtered.reasons.some(r=>r.includes('Touch')));
});
test('paired P/L uses simultaneous executable sides and collateral; missing/expired/zero/proxy marks do not count',()=>{
 const pick={...base,id:'b',strike:65,bid:.5,ask:.6};
 const entry=snap('2026-09-10T14:00:00Z',[base,pick]);
 const later=snap('2026-09-11T14:00:00Z',[{...base,bid:.1,ask:.2},{...pick,bid:.1,ask:.15}]);
 const invalid=[snap('2026-09-11T15:00:00Z',[{...base,bid:0,ask:0},{...pick,bid:0,ask:0}]),snap('2026-09-14T14:00:00Z',[{...base,ask:.01}]),snap('2026-09-21T14:00:00Z',[base,pick]),snap('2026-09-15T14:00:00Z',[base,pick],false)];
 const o=pairedOutcome(base,pick,entry,[...invalid,later]);
 assert.equal(o.observations,1);assert.equal(o.last.reference.pnlPerContract,80);assert.equal(o.last.screener.pnlPerContract,35);
 assert.equal(o.last.reference.collateralReturnPct,1.143);assert.equal(o.last.screener.collateralReturnPct,.538);
 assert.equal(o.referenceFirst80,later.generatedAt);assert.equal(o.screenerFirst80,null);
 assert.equal(pairedOutcome(base,{...pick,ticker:'NBIS'},entry,[later]),null);
});
test('frozen decisions and historical replay remain distinguishable; absent data is excluded from match denominator',()=>{
 const source={date:'2026-09-10',postId:'x',publishedAt:'2026-09-10T14:10:00Z',sourcePage:'test'};
 const dataset={sources:[source],recommendations:[{...base,date:source.date,sourceId:'x'},{...base,ticker:'NBIS',sourceId:'x'},{...base,strike:60,sourceId:'x'}]};
 const s={...snap('2026-09-10T14:00:00Z'),file:'test'};
 const r=buildComparison(dataset,[s]);assert.equal(r.groups[0].decisionMode,'current_rules_replay');
 assert.equal(r.summary.scenarios.execution.comparable,1);assert.equal(r.summary.scenarios.execution.exactMatches,1);assert.equal(r.summary.scenarios.execution.missingData,1);
 const decision=makeDecision(s);decision.scenarios.execution=[];
 const frozen=buildComparison(dataset,[s],new Map([['test',decision]]));
 assert.equal(frozen.groups[0].decisionMode,'frozen_forward');assert.equal(frozen.groups[0].rows[0].scenarios.execution.pick,null);
});
test('new source exceptions invalidate timeless 5% / 20% hypotheses; dataset identities, DTE and source linkage are sound',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('../../data/laok-reference/recommendations.json',import.meta.url)));
 const seen=new Set();
 for(const row of data.recommendations){
  const key=row.date+contractKey(row);assert.ok(!seen.has(key));seen.add(key);
  assert.equal((Date.parse(row.expiration)-Date.parse(row.date))/86400000,row.dte);
  if(row.bid!=null && row.ask!=null) assert.ok(row.bid>0 && row.ask>=row.bid);assert.ok(data.sources.some(s=>s.postId===row.sourceId));
 }
 assert.ok(data.recommendations.length>=54);
 assert.ok(data.recommendations.some(r=>screenshotExceptions(r).includes('ITM >5%')));
 assert.ok(data.recommendations.some(r=>screenshotExceptions(r).includes('Mid 年化 <20%')));
 assert.equal(data.otherObservations[0].bid,null);
});

test('missing screenshot values remain unknown rather than becoming threshold violations',()=>{assert.deepEqual(screenshotExceptions({ticker:'SOXL',expiryItmPct:null,midAnnualizedRoiPct:null,delta:null,otmPct:null,openInterest:null}),[]);});

test('forward archive rejects stale reuse and preserves original config, time and picks on rerun',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'laok-freeze-'));
 try {
  const file=path.join(root,'data/snapshots/2026-09-10/test.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(snap('2026-09-10T14:00:00Z',[base],false)));
  assert.throws(()=>freezeSnapshot(file,root),/fresh/);
  fs.writeFileSync(file,JSON.stringify(snap('2026-09-10T14:00:00Z')));
  const result=freezeSnapshot(file,root,'2026-09-10T14:00:01Z');
  const destination=path.join(root,result.decisionFile),original=fs.readFileSync(destination,'utf8');
  freezeSnapshot(file,root,'2026-09-11T14:00:00Z');
  assert.equal(fs.readFileSync(destination,'utf8'),original);
  const d=JSON.parse(original);assert.equal(d.recordedAt,'2026-09-10T14:00:01Z');assert.equal(d.scenarios.execution[0].strike,70);assert.ok(d.snapshotSha256 && d.configHash);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('coverage audit distinguishes unrequested, absent response, unusable quote, and unknown historical data',()=>{
 const s={...snap('2026-09-10T14:00:00Z',[]),coverage:{tickers:[{ticker:'SOXL',expirations:[base.expiration],contracts:[]}]}};
 assert.equal(diagnose(base,s,scenario).status,'inventory_not_listed');
 for(const status of ['outside_scope','not_returned','invalid_quote']) {
   s.coverage.tickers[0].contracts=[{...base,status}];
   assert.equal(diagnose(base,s,scenario).status,status);
   const dataset={sources:[{date:'2026-09-10',postId:'x',publishedAt:'2026-09-10T14:10:00Z'}],recommendations:[{...base,sourceId:'x'}]};
   const result=buildComparison(dataset,[s]);
   assert.equal(result.summary.scenarios.execution.missingData,1);
   assert.equal(result.summary.scenarios.execution.comparable,0);
 }
});
test('explicit omitted bucket is preserved without inventing a recommendation',()=>{
 const source={date:'2026-09-10',postId:'x',publishedAt:'2026-09-10T14:10:00Z',excludedBuckets:[{ticker:'SOXL',expiration:base.expiration,displayWeek:1,reason:'ITM ceiling'}]};
 const result=buildComparison({sources:[source],recommendations:[]},[snap('2026-09-10T14:00:00Z')]);
 assert.equal(result.summary.recommendations,0);
 assert.equal(result.groups[0].excludedBuckets.length,1);
 assert.equal(result.groups[0].extraPicks.execution[0].classification,'explicit_no_recommendation');
});
