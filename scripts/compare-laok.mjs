import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {configs, scoreCandidates} from './score-options.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = configs.find(c => c.id === 'soxl_conservative_csp');
const SCORING = fs.readFileSync(path.join(ROOT, 'src/lib/scoring.ts'), 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const HASH = sha(JSON.stringify(CONFIG) + SCORING);
const NY = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York', year:'numeric',month:'2-digit',day:'2-digit'});
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, data) => { fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n'); };
const round = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
export const contractKey = r => `${r.ticker}:${r.expiration}:${r.optionType ?? 'put'}:${r.strike}`;
export const marketDate = time => NY.format(new Date(time));
export const usableQuote = r => r && r.priceSource !== 'moomoo_last_price_proxy' && Number.isFinite(r.bid) && Number.isFinite(r.ask) && r.bid > 0 && r.ask >= r.bid;
const markable = r => r && r.priceSource !== 'moomoo_last_price_proxy' && Number.isFinite(r.bid) && Number.isFinite(r.ask) && r.bid >= 0 && r.ask > 0 && r.ask >= r.bid;
function regularSession(time) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date(time));
  const p = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const minutes = Number(p.hour)*60 + Number(p.minute);
  return !['Sat','Sun'].includes(p.weekday) && minutes >= 570 && minutes <= 960;
}
const slim = r => Object.fromEntries(['id','ticker','optionType','expiration','dte','strike','underlyingPrice','bid','ask','delta','openInterest','volume','expiryItmProbability','touchProbability','soxlFridayBucket','iv','ivPercentile','priceSource','underlyingPriceSource','probabilitySource','probabilitySampleSize'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
export function makeDecision(snapshot, config = CONFIG) {
  return {schemaVersion:1, generatedAt:snapshot.generatedAt, configHash:sha(JSON.stringify(config)+SCORING), configVersion:config.version, config,
    scenarios:Object.fromEntries(config.scenarios.map(s=>[s.id, scoreCandidates(config,s.filters,snapshot.candidates).map(slim)]))};
}
export function chooseSnapshot(snapshots, publishedAt, maxMinutes=60) {
  const end=Date.parse(publishedAt);
  return snapshots.filter(s=>s.fresh !== false && regularSession(s.generatedAt) && marketDate(s.generatedAt)===marketDate(publishedAt) && Date.parse(s.generatedAt)<=end && end-Date.parse(s.generatedAt)<=maxMinutes*60000).sort((a,b)=>Date.parse(b.generatedAt)-Date.parse(a.generatedAt))[0] ?? null;
}
export function diagnose(reference, snapshot, scenario, config=CONFIG) {
  if (!config.tickerWhitelist.includes(reference.ticker)) return {status:'outside_universe',reasons:['標的範圍不同 · Universe']};
  if (!snapshot) return {status:'missing_snapshot',reasons:['發文前 60 分鐘內無正常交易時段快照']};
  const row=snapshot.candidates.find(c=>contractKey(c)===contractKey(reference));
  if (!row) {
    const coverage=snapshot.coverage?.tickers?.find(t=>t.ticker===reference.ticker);
    const entry=coverage?.contracts?.find(c=>contractKey(c)===contractKey(reference));
    const reasons={outside_scope:'合約存在，但未納入報價抓取範圍',not_returned:'已請求報價，但供應商未回傳',invalid_quote:'已回傳，但報價或必要欄位不完整'};
    if(entry && reasons[entry.status]) return {status:entry.status,reasons:[reasons[entry.status]]};
    if(coverage) return {status:coverage.expirations.includes(reference.expiration)?'inventory_not_listed':'outside_scope',reasons:[coverage.expirations.includes(reference.expiration)?'該到期日的合約清單未列出此合約':'該到期日未納入本次合約清單']};
    return {status:'missing_contract',reasons:['歷史快照未收錄，無抓取紀錄可判定原因']};
  }
  if (!usableQuote(row)) return {status:'invalid_quote',reasons:['報價不可用 · Quote quality']};
  const scored=scoreCandidates(config, scenario.filters,[row],true)[0];
  const missing=scenario.filters.filter(f=>!Number.isFinite(scored[f.field]));
  if(missing.length) return {status:'missing_model_data',reasons:missing.map(f=>`缺少 ${f.label}`),referenceAtSnapshot:slim(row)};
  return {status:scored.matched ? 'eligible' : 'filtered',reasons:scored.failedFilters,referenceAtSnapshot:slim(row)};
}
// Paired paper marks: both legs must have quotes at exactly the same archived observation.
// Entry uses the common snapshot bid, never screenshot midpoint. No expiry/roll/fill inference.
export function pairedOutcome(reference, pick, entry, snapshots) {
  if (!entry || !pick || !usableQuote(reference) || !usableQuote(pick) || reference.expiration!==pick.expiration || reference.ticker!==pick.ticker) return null;
  const mark=(r,q)=>({pnlPerContract:round((r.bid-q.ask)*100),collateralReturnPct:round((r.bid-q.ask)/r.strike*100),premiumCapturePct:round((r.bid-q.ask)/r.bid*100)});
  const points=[];
  for (const s of snapshots) {
    if (s.fresh===false || !regularSession(s.generatedAt) || Date.parse(s.generatedAt)<=Date.parse(entry.generatedAt) || marketDate(s.generatedAt)>reference.expiration) continue;
    const a=s.candidates.find(c=>contractKey(c)===contractKey(reference));
    const b=s.candidates.find(c=>contractKey(c)===contractKey(pick));
    if (markable(a) && markable(b)) points.push({at:s.generatedAt,reference:mark(reference,a),screener:mark(pick,b)});
  }
  points.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  if (!points.length) return {status:'awaiting_common_quotes',observations:0};
  const last=points.at(-1);
  const sessionDates=[...new Set(points.map(p=>marketDate(p.at)))].filter(d=>d>marketDate(entry.generatedAt));
  const horizons=Object.fromEntries([1,3,5].map(n=>{
    const day=sessionDates[n-1];
    const observations=day ? points.filter(p=>marketDate(p.at)===day) : [];
    return [`session${n}`,observations.at(-1) ?? null];
  }));
  return {status:'paper_mark_only',observations:points.length,last,...horizons,
    observedSessions:sessionDates.length, horizonsBasis:'Nth observed session, not guaranteed consecutive exchange sessions',
    excessCollateralReturnPct:round(last.screener.collateralReturnPct-last.reference.collateralReturnPct),
    referenceWorstObservedCollateralReturnPct:Math.min(0,...points.map(p=>p.reference.collateralReturnPct)),
    screenerWorstObservedCollateralReturnPct:Math.min(0,...points.map(p=>p.screener.collateralReturnPct)),
    referenceFirst80:points.find(p=>p.reference.premiumCapturePct>=80)?.at ?? null,
    screenerFirst80:points.find(p=>p.screener.premiumCapturePct>=80)?.at ?? null};
}
export function screenshotExceptions(r) {
  const flags=[];
  if(r.ticker!=='SOXL') flags.push('SOXL-only');
  if(Number.isFinite(r.expiryItmPct) && r.expiryItmPct>5) flags.push('ITM >5%');
  if(Number.isFinite(r.midAnnualizedRoiPct) && r.midAnnualizedRoiPct<20) flags.push('Mid 年化 <20%');
  if(Number.isFinite(r.delta) && (r.delta < -.1 || r.delta > -.02)) flags.push('Delta 超出 -0.10～-0.02');
  if(Number.isFinite(r.otmPct) && (r.otmPct<20 || r.otmPct>45)) flags.push('OTM 超出 20%～45%');
  if(Number.isFinite(r.openInterest) && r.openInterest<250) flags.push('OI <250');
  return flags;
}
function sourceInventory(wiki, dataset) {
  const known=new Map(dataset.sources.map(s=>[s.postId,s]));
  const entries=[];
  for(const name of fs.readdirSync(path.join(wiki,'wiki/sources')).filter(n=>n.startsWith('laok-post-'))) {
    const body=fs.readFileSync(path.join(wiki,'wiki/sources',name),'utf8');
    // Include recommendation titles even when the wiki classifier calls them market-note.
    if (!/content_class: daily-recommendation/.test(body) && !/^title:.*(?:推荐|推薦|开仓标的|開倉標的)/m.test(body)) continue;
    const id=name.match(/-(\d+)\.md$/)?.[1];
    const source=known.get(id) ?? dataset.otherObservations?.find(r=>r.postId===id);
    const imagePath=source ? path.join(wiki,source.imagePath) : null;
    const verified=source && fs.existsSync(imagePath) && sha(fs.readFileSync(imagePath))===source.imageSha256;
    entries.push({sourcePage:`wiki/sources/${name}`,postId:id,status:!source?'needs_transcription':verified?(known.has(id)?'imported':'separate_observation'):'source_changed_or_missing'});
  }
  return entries;
}
function loadSnapshots(root, startDate) {
  const cacheRoot=path.join(root,'data/laok-comparison/cache');
  const snapshots=[];
  const referenceFile=path.join(root,'data/laok-reference/recommendations.json');
  const tickers=new Set(['SOXL','NBIS','LITE',...(fs.existsSync(referenceFile)?read(referenceFile).recommendations.map(r=>r.ticker):[])]);
  const universeKey=[...tickers].sort().join(',');
  const archive=path.join(root,'data/snapshots');
  if(!fs.existsSync(archive)) return snapshots;
  for(const day of fs.readdirSync(archive).filter(d=>d>=startDate).sort()) {
    const directory=path.join(archive,day);
    if(!fs.statSync(directory).isDirectory()) continue;
    for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json')).sort()) {
      const filename=path.join(directory,name), stat=fs.statSync(filename);
      const cache=path.join(cacheRoot,day,name);
      let data=fs.existsSync(cache)?read(cache):null;
      if(!data || data.cacheVersion!==2 || data.universeKey!==universeKey || data.size!==stat.size || data.mtime!==stat.mtimeMs) {
        const raw=read(filename);
        data={cacheVersion:2,universeKey,size:stat.size,mtime:stat.mtimeMs,generatedAt:raw.generatedAt,session:raw.session,fresh:raw.fresh,coverage:raw.coverage,
          candidates:(raw.candidates??[]).filter(c=>c.optionType==='put' && tickers.has(c.ticker)).map(slim)};
        write(cache,data);
      }
      if(!data.generatedAt) continue;
      snapshots.push({...data,file:path.relative(root,filename),decisionPath:path.join(root,'data/laok-comparison/decisions',day,name)});
    }
  }
  return snapshots.sort((a,b)=>Date.parse(a.generatedAt)-Date.parse(b.generatedAt));
}
export function buildComparison(dataset, snapshots, decisions=new Map()) {
  const groups=dataset.sources.map(source=>{
    const selected=chooseSnapshot(snapshots,source.publishedAt);
    const saved=selected && decisions.get(selected.file);
    const config=saved?.config ?? CONFIG;
    const decision=selected ? (saved ?? makeDecision(selected,config)) : null;
    const rows=dataset.recommendations.filter(r=>r.sourceId===source.postId).map(r=>{
      const scenarios=Object.fromEntries(config.scenarios.map(s=>{
        const diagnosis=diagnose(r,selected,s,config);
        const pick=decision?.scenarios[s.id]?.find(p=>p.expiration===r.expiration && p.ticker===r.ticker) ?? null;
        const exact=pick ? contractKey(pick)===contractKey(r) : false;
        const status=['outside_universe','missing_snapshot','missing_contract','outside_scope','not_returned','inventory_not_listed','invalid_quote','missing_model_data'].includes(diagnosis.status) ? diagnosis.status : exact ? 'exact_match' : diagnosis.status==='filtered' ? 'filtered' : pick ? 'rank_difference' : 'no_pick';
        return [s.id,{...diagnosis,status,pick,exactMatch:exact,strikeDifference:pick?round(pick.strike-r.strike):null,
          outcome:pairedOutcome(diagnosis.referenceAtSnapshot,pick,selected,snapshots)}];
      }));
      return {...r,screenshotExceptions:screenshotExceptions(r),scenarios};
    });
    const recommended=new Set(rows.map(contractKey));
    const publishedBuckets=new Set(rows.map(r=>`${r.ticker}:${r.expiration}`));
    const extraPicks=decision ? Object.fromEntries(config.scenarios.map(s=>[s.id,decision.scenarios[s.id].filter(p=>!recommended.has(contractKey(p))).map(p=>({...p,classification:publishedBuckets.has(`${p.ticker}:${p.expiration}`)?'alternative_strike':'unlisted_bucket_not_proven_rejected'}))])) : {};
    return {date:source.date,sourceId:source.postId,sourcePage:source.sourcePage,publishedAt:source.publishedAt,
      snapshotAt:selected?.generatedAt ?? null,snapshotFile:selected?.file ?? null,alignmentMinutes:selected?round((Date.parse(source.publishedAt)-Date.parse(selected.generatedAt))/60000):null,
      decisionMode:saved?'frozen_forward':selected?'current_rules_replay':'unavailable',configHash:decision?.configHash ?? HASH,configVersion:config.version,rows,extraPicks};
  });
  const all=groups.flatMap(g=>g.rows);
  const summary={sourceDays:groups.length,recommendations:all.length,latestSourceDate:groups.at(-1)?.date ?? null,
    frozenDays:groups.filter(g=>g.decisionMode==='frozen_forward').length,replayDays:groups.filter(g=>g.decisionMode==='current_rules_replay').length,
    screenshotExceptionRows:all.filter(r=>r.screenshotExceptions.length).length,
    scenarios:Object.fromEntries(CONFIG.scenarios.map(s=>{
      const rows=all.map(r=>r.scenarios[s.id]).filter(Boolean);
      const comparable=rows.filter(r=>['exact_match','filtered','rank_difference','no_pick'].includes(r.status));
      return [s.id,{total:rows.length,comparable:comparable.length,exactMatches:comparable.filter(r=>r.exactMatch).length,
        exactMatchPct:comparable.length?round(comparable.filter(r=>r.exactMatch).length/comparable.length*100):null,
        outsideUniverse:rows.filter(r=>r.status==='outside_universe').length,missingData:rows.filter(r=>['missing_snapshot','missing_contract','outside_scope','not_returned','inventory_not_listed','invalid_quote','missing_model_data'].includes(r.status)).length,
        pairedMarks:rows.filter(r=>r.outcome?.status==='paper_mark_only').length}];
    }))};
  return {schemaVersion:1,generatedAt:new Date().toISOString(),configHash:HASH,summary,groups,
    limitations:['發文時間不等於截圖報價時間；對齊值僅為發文前最近 60 分鐘內的正常交易時段快照。','歷史回放使用目前規則，不代表當日曾經推薦；凍結紀錄另列。','同時點 Bid → Ask 紙上估值，未計佣金與滑價；不代表成交、平倉或實現損益。','缺漏合約不計入可比命中率；來源未列出的到期桶不當作已證實拒絕。','1／3／5 session 為有共同報價的觀察交易日；資料缺日不能視為連續交易日。','目前沒有足夠前推樣本判定優勝，也不以截圖入選比例自動修改風控。']};
}
export const statusLabel = {outside_universe:'標的範圍不同',missing_snapshot:'缺當時快照',missing_contract:'缺合約・原因未知',outside_scope:'未納入抓取',not_returned:'已請求未回傳',inventory_not_listed:'合約清單未列出',invalid_quote:'報價不可用',missing_model_data:'缺模型欄位',exact_match:'同合約',filtered:'門檻淘汰',rank_difference:'排序差異',no_pick:'未選出'};
function markdown(report) {
  const s=report.summary;
  const lines=['# 老 K 每日比對 · Daily comparison','',`更新：${report.generatedAt}；來源截至 ${s.latestSourceDate}。共 ${s.sourceDays} 日／${s.recommendations} 筆。`, '',
    `歷史回放 ${s.replayDays} 日，事前凍結 ${s.frozenDays} 日。${s.screenshotExceptionRows} 筆至少違反一項舊版推定規則。`, '',
    '## 方法與限制','',...report.limitations.map(l=>`- ${l}`),'',
    '## Fine-tuning 決策','',
    '- 9/2 起出現 ITM >5%；9/4 出現 Mid 年化 <20%；9/8–9/9 出現 NBIS / LITE、Delta 與 OTM 護欄例外。舊規則是有日期範圍的假說。',
    '- 保留 Risk first 現行風控。擴大 Universe、放寬機率門檻、移除最低 Delta 均先作獨立 shadow experiment，不能由貼近老 K 直接推論更有利。',
    '- 每週檢查差異是否持續；凍結 configHash 與修改理由，依交易日切分校準／後續驗證，避免同日多筆當成獨立樣本。',
    '- 優劣以同標的／到期、相同報價時點、每單位接股現金的 Bid → Ask 報酬及最差觀察值比較；未有足夠到期／虧損／前推資料前保持未定。','',
    '## 覆蓋與命中率','', '|版本|可比筆數|同合約|缺資料|範圍外|紙上共同估值|','|---|---:|---:|---:|---:|---:|',
    ...Object.entries(s.scenarios).map(([k,v])=>`|${k}|${v.comparable}|${v.exactMatches}|${v.missingData}|${v.outsideUniverse}|${v.pairedMarks}|`),''];
  for(const g of [...report.groups].reverse()) {
    lines.push(`## ${g.date}`,'',`模式：${g.decisionMode}；發文：${g.publishedAt}；快照：${g.snapshotAt ?? '缺資料'}；間隔：${g.alignmentMinutes ?? '—'} 分鐘。`,'', '|老 K 合約|Risk first|選出合約|差異原因|Reference|','|---|---|---|---|---|');
    for(const r of g.rows) {
      const a=r.scenarios.execution,b=r.scenarios.conservative;
      lines.push(`|${r.ticker} ${r.expiration} ${r.strike}P|${statusLabel[a.status]}|${a.pick?`${a.pick.strike}P`:'—'}|${a.reasons.join(' / ') || (a.status==='rank_difference'?'同桶排序較後':'—')}|${statusLabel[b.status]}|`);
    }
    const paired=g.rows.filter(r=>r.scenarios.execution.outcome?.last);
    if(paired.length) {
      lines.push('', '|老 K / Risk first|共同觀察|老 K 現金報酬|Risk first 現金報酬|差（百分點）|','|---|---|---:|---:|---:|');
      for(const r of paired) {
        const a=r.scenarios.execution,o=a.outcome;
        lines.push(`|${r.ticker} ${r.expiration} ${r.strike}P / ${a.pick.strike}P|${o.last.at}|${o.last.reference.collateralReturnPct}%|${o.last.screener.collateralReturnPct}%|${o.excessCollateralReturnPct}|`);
      }
    }
    lines.push('',`截圖例外：${g.rows.filter(r=>r.screenshotExceptions.length).map(r=>`${r.ticker} ${r.strike}P (${r.expiration})：${r.screenshotExceptions.join('、')}`).join('；') || '無'}。`,'');
  }
  lines.push('## 參考連結','',...report.groups.map(g=>`- [${g.date} LaoK Wiki](${path.join(report.sourceWikiRoot,g.sourcePage)})`));
  return lines.join('\n')+'\n';
}
export function freezeSnapshot(snapshotPath, root=ROOT, recordedAt=new Date().toISOString()) {
    const filename=path.resolve(snapshotPath);
    const snapshot=read(filename);
    if(snapshot.fresh!==true || !snapshot.candidates?.length) throw new Error('Only explicitly fresh successful snapshots can freeze a forward decision');
    const relative=path.relative(path.join(root,'data/snapshots'),filename);
    if(relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Snapshot must be inside data/snapshots');
    const destination=path.join(root,'data/laok-comparison/decisions',relative);
    const decision={...makeDecision(snapshot),snapshotFile:path.relative(root,filename),snapshotSha256:sha(fs.readFileSync(filename)),recordedAt};
    // Exclusive create: re-running never overwrites a decision made by an older version.
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    try {fs.writeFileSync(destination,JSON.stringify(decision,null,2)+'\n',{flag:'wx'});} catch(e){if(e.code!=='EEXIST') throw e;}
    return {decisionFile:path.relative(root,destination)};
}
export function main(args=process.argv.slice(2)) {
  const root=ROOT;
  const snapshotArg=args.indexOf('--snapshot');
  if(snapshotArg>=0) {
    console.log(JSON.stringify(freezeSnapshot(args[snapshotArg+1]))); return;
  }
  const wikiArg=args.indexOf('--wiki');
  const wiki=wikiArg>=0?path.resolve(args[wikiArg+1]):path.join(process.env.HOME,'Documents/llm_wiki/LaoK');
  const dataset=read(path.join(root,'data/laok-reference/recommendations.json'));
  const inventory=sourceInventory(wiki,dataset);
  if(inventory.some(s=>s.status==='source_changed_or_missing')) throw new Error('Source image changed or missing; verify provenance before comparing');
  const snapshots=loadSnapshots(root,dataset.sources[0].date);
  const decisions=new Map();
  for(const s of snapshots) if(fs.existsSync(s.decisionPath)) {
    const d=read(s.decisionPath);
    // A decision recorded after publication can never become a forward observation.
    const source=dataset.sources.find(src=>chooseSnapshot([s],src.publishedAt));
    if(source && Date.parse(d.recordedAt)<=Date.parse(source.publishedAt) && d.snapshotSha256===sha(fs.readFileSync(path.join(root,s.file)))) decisions.set(s.file,d);
  }
  const report={...buildComparison(dataset,snapshots,decisions),sourceWikiRoot:wiki,inventory,otherObservations:dataset.otherObservations ?? []};
  const {sourceWikiRoot: _localWikiRoot, ...publicReport} = report;
  write(path.join(root,'src/data/generated/laokComparison.json'),publicReport);
  const destination=path.join(root,'analysis/laok-daily-comparison.md');
  fs.writeFileSync(destination,markdown(report));
  console.log(JSON.stringify({summary:report.summary,pendingSources:inventory.filter(s=>s.status==='needs_transcription'),report:destination},null,2));
}
if(process.argv[1]===fileURLToPath(import.meta.url)) main();
