import {useState} from 'react';
import data from '../data/generated/laokComparison.json';
import {formatCurrency,formatNumber} from '../lib/format';

type Mark = {pnlPerContract:number;collateralReturnPct:number;premiumCapturePct:number};
type Pick = {ticker:string;expiration:string;strike:number;bid:number;ask:number};
type Result = {referenceAtSnapshot?:{expiryItmProbability?:number|null;touchProbability?:number|null};status:string;reasons:string[];pick:Pick|null;strikeDifference:number|null;outcome:null|{status:string;observations:number;last?:{at:string;reference:Mark;screener:Mark};excessCollateralReturnPct?:number;referenceWorstObservedCollateralReturnPct?:number;screenerWorstObservedCollateralReturnPct?:number}};
type Row = {ticker:string;expiration:string;strike:number;dte:number;delta:number;otmPct:number;expiryItmPct:number;touchPct:number;bid:number;mid:number;ask:number;bidAnnualizedRoiPct:number;screenshotExceptions:string[];scenarios:Record<string,Result>};
type Group = {date:string;publishedAt:string;snapshotAt:string|null;alignmentMinutes:number|null;decisionMode:string;configVersion:string;configHash:string;sourcePage:string;rows:Row[];extraPicks:Record<string,(Pick & {classification:string})[]>};
const groups=data.groups as unknown as Group[];
const labels:Record<string,string>={outside_universe:'標的範圍不同 · Universe',missing_snapshot:'缺當時快照',missing_contract:'缺合約 · Coverage',invalid_quote:'報價不可用',missing_model_data:'缺模型欄位',exact_match:'同合約 · Match',filtered:'門檻淘汰 · Filter',rank_difference:'排序差異 · Ranking',no_pick:'未選出'};
const money=(v:number|null|undefined)=>v==null?'—':formatCurrency(v);
const val=(v:number|null|undefined)=>v==null?'—':v;
const pct=(v:number|null|undefined)=>v==null?'—':`${formatNumber(v,2)}%`;
const time=(v:string|null)=>v ? new Date(v).toLocaleString('zh-TW',{timeZone:'America/New_York',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' ET':'缺資料';
export function LaoKTracker(){
 const [date,setDate]=useState(groups.at(-1)?.date ?? '');
 const [scenario,setScenario]=useState('execution');
 const group=groups.find(g=>g.date===date);
 if(!group)return <p className="notice">尚無老 K 來源；請執行 npm run compare:laok。</p>;
 const summary=data.summary.scenarios[scenario as keyof typeof data.summary.scenarios];
 const pending=data.inventory.filter(s=>s.status==='needs_transcription').length;
 const pairs=group.rows.filter(r=>r.scenarios[scenario].outcome?.last);
 return <section className="wideWorkspace">
  <div className="sectionHead"><div><span className="eyebrow">老 K WIKI · DAILY COMPARISON</span><h2>每日推薦與 Screener 比對</h2><p>{data.summary.sourceDays} 日、{data.summary.recommendations} 筆，來源截至 {data.summary.latestSourceDate}。更新 {time(data.generatedAt)}。推薦截圖與紙上估值不等於成交。</p></div><label>推薦日期 Date<select value={date} onChange={e=>setDate(e.target.value)}>{[...groups].reverse().map(g=><option key={g.date}>{g.date}</option>)}</select></label></div>
  <div className="metricGrid"><div className="metric"><span>當日老 K 推薦</span><strong>{group.rows.length}</strong><small>SOXL、NBIS、LITE 分開記錄</small></div><div className="metric"><span>累計可比合約命中</span><strong>{summary.exactMatches} / {summary.comparable}</strong><small>缺資料 {summary.missingData}；範圍外 {summary.outsideUniverse}</small></div><div className="metric"><span>事前凍結 · Forward</span><strong>{data.summary.frozenDays} 日</strong><small>歷史回放 {data.summary.replayDays} 日；命中率非勝率</small></div><div className="metric"><span>舊規則例外</span><strong>{data.summary.screenshotExceptionRows} 筆</strong><small>新資料改變推論，不自動放寬風控</small></div></div>
  <div className="sectionHead"><label>比較版本 Version<select value={scenario} onChange={e=>setScenario(e.target.value)}><option value="execution">風險優先 · Risk first</option><option value="conservative">舊版老 K 假說 · Reference</option></select></label><p>{group.decisionMode==='frozen_forward'?'事前凍結結果':'目前規則歷史回放（不代表當日推薦）'} · {group.configVersion} · {group.configHash.slice(0,10)}</p></div>
  <p className="notice">發文 {time(group.publishedAt)}；選用快照 {time(group.snapshotAt)}（相差 {group.alignmentMinutes==null?'—':formatNumber(group.alignmentMinutes,1)} 分鐘）。淘汰原因依本機快照計算；右側截圖是另一時點。截圖的精確報價時間未知，只用發文前 60 分鐘內的正常交易時段快照對齊。</p>
  <div className="tableWrap"><table><thead><tr><th>老 K 合約</th><th>Screener 同到期選擇</th><th>比對結果／原因</th><th>截圖 ITM／Touch</th><th>截圖 Bid／Mid／Ask</th><th>舊假說例外</th></tr></thead><tbody>{group.rows.map(r=>{const result=r.scenarios[scenario];return <tr key={`${r.ticker}-${r.expiration}-${r.strike}`}><td><strong>{r.ticker} {r.strike}P</strong><small>{r.expiration} · {r.dte} DTE</small></td><td>{result.pick?<><strong>{result.pick.ticker} {result.pick.strike}P</strong><small>Strike 差 {result.strikeDifference}；Bid {formatCurrency(result.pick.bid)}</small></>:'—'}</td><td><strong>{labels[result.status] ?? result.status}</strong><small>{result.reasons.join(' / ') || (result.status==='rank_difference'?'風險排序選了同桶其他合約':'—')}</small>{result.referenceAtSnapshot && <small>快照 ITM / Touch：{pct(result.referenceAtSnapshot.expiryItmProbability)} / {pct(result.referenceAtSnapshot.touchProbability)}</small>}</td><td>{pct(r.expiryItmPct)} / {pct(r.touchPct)}<small>Delta {val(r.delta)} · {pct(r.otmPct)} OTM</small></td><td>{money(r.bid)} / {money(r.mid)} / {money(r.ask)}<small>Bid 簡單年化 {pct(r.bidAnnualizedRoiPct)}</small></td><td>{r.screenshotExceptions.join('；') || '—'}</td></tr>})}</tbody></table></div>
  <h3>後續共同報價 · Paired paper marks</h3><p>同標的、同到期、相同快照以 Bid 開倉／Ask 回購估值，每口乘數 100。報酬除以 strike 接股現金；未計費用，沒有自動平倉假設。</p>
  {pairs.length?<div className="tableWrap"><table><thead><tr><th>老 K / Screener</th><th>最後共同觀察</th><th>老 K 現金報酬</th><th>Screener 現金報酬</th><th>報酬差（百分點）</th><th>最差觀察值：老 K / Screener</th></tr></thead><tbody>{pairs.map(r=>{const result=r.scenarios[scenario],outcome=result.outcome!,last=outcome.last!;return <tr key={`${r.ticker}-${r.expiration}`}><td>{r.ticker} {r.strike}P / {result.pick!.strike}P<small>{r.expiration}</small></td><td>{time(last.at)}<small>{outcome.observations} 個共同觀察點</small></td><td>{pct(last.reference.collateralReturnPct)}<small>{formatCurrency(last.reference.pnlPerContract)} / 口</small></td><td>{pct(last.screener.collateralReturnPct)}<small>{formatCurrency(last.screener.pnlPerContract)} / 口</small></td><td>{formatNumber(outcome.excessCollateralReturnPct ?? 0,3)}</td><td>{pct(outcome.referenceWorstObservedCollateralReturnPct)} / {pct(outcome.screenerWorstObservedCollateralReturnPct)}</td></tr>})}</tbody></table></div>:<p className="notice">尚無同時點可配對的後續報價；缺資料保留空白。</p>}
  {(group.extraPicks[scenario]?.length ?? 0)>0 && <><h3>Screener 額外選擇</h3><p>{group.extraPicks[scenario].map(p=>`${p.ticker} ${p.expiration} ${p.strike}P${p.classification==='unlisted_bucket_not_proven_rejected'?'（老 K 未列示此標的／到期桶）':'（不同履約價）'}`).join('；')}。未列示不視為已證實拒絕。</p></>}
  <p className="notice">目前優劣未定。9 月截圖已出現 ITM &gt;5%、Mid 年化 &lt;20% 與跨標的推薦；舊假說只能用來追蹤變化。Risk first 保留現行風控，後續以凍結版本的前推資料（Forward validation）評估。</p>
  <details><summary>來源與資料限制{pending?` · ${pending} 篇待判讀`:''}</summary><p>LaoK Wiki / {group.sourcePage}</p><ul>{data.limitations.map(l=><li key={l}>{l}</li>)}</ul></details>
 </section>;
}
