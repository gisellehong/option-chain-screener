import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import type {OptionCandidate, ScoredCandidate} from '../lib/types';
import {formatCurrency, formatNumber} from '../lib/format';

export interface LedgerTrade {
 id:string; sourceRow:number; account:string; ticker:string; strategy:'CSP'|'CC'|'BPS'; entryDate:string; expiration:string|null; sourceContractLabel:string;
 strike:number;longStrike:number|null;contracts:number;multiplier:number;entryPremium:number;grossPremium:number;cashRequired:number|null;entryDte:number|null;
 closeDate:string|null;closePrice:number|null;closedProfit:number|null;brokerProfit:number|null;reconciliation:number|null;rollGroupId:string|null;notes:string;flags:string[];
}
interface Ledger {schemaVersion:1;importedAt:string;sourceUrl:string;sourceLabel:string;trades:LedgerTrade[];excluded?:Record<string,number>}
interface LedgerContextValue {ledger:Ledger|null;error:string;loadFile:(file:File)=>Promise<void>;clear:()=>void;loading:boolean}
const Context=createContext<LedgerContextValue>({ledger:null,error:'',loadFile:async()=>{},clear:()=>{},loading:false});
const storageKey='stock-options-ledger-v1';
function validateLedger(value:unknown):Ledger {
 const d=value as Ledger;
 if(d?.schemaVersion!==1||!Array.isArray(d.trades)||typeof d.sourceLabel!=='string'||typeof d.sourceUrl!=='string'||typeof d.importedAt!=='string'||!Number.isFinite(Date.parse(d.importedAt)))throw new Error('請匯入版本 1 的交易帳本 JSON。');
 const ids=new Set();
 for(const t of d.trades){
  if(!t||!t.id||ids.has(t.id)||typeof t.account!=='string'||!t.account||!t.ticker||/^(ES|MES|NQ|MNQ|RTY|M2K|CL|GC|SI)$/.test(t.ticker)||!['CSP','CC','BPS'].includes(t.strategy)||!Array.isArray(t.flags)||!t.flags.every(f=>typeof f==='string')||typeof t.notes!=='string'||typeof t.entryDate!=='string'||!Number.isInteger(t.sourceRow)||!(t.expiration===null||typeof t.expiration==='string'&&Number.isFinite(Date.parse(t.expiration)))||!(t.reconciliation===null||Number.isFinite(t.reconciliation))||!(t.brokerProfit===null||Number.isFinite(t.brokerProfit))||(t.strategy==='BPS'&&(!Number.isFinite(t.longStrike)||t.longStrike!<=0||t.longStrike!>=t.strike))||!Number.isFinite(t.strike)||t.strike<=0||!Number.isInteger(t.contracts)||t.contracts<=0||t.multiplier!==100||!Number.isFinite(t.entryPremium)||!Number.isFinite(t.grossPremium)||!Number.isFinite(Date.parse(t.entryDate))||!(t.closedProfit===null||Number.isFinite(t.closedProfit))||!(t.closeDate===null||Number.isFinite(Date.parse(t.closeDate))))throw new Error('帳本有無效或重複交易，或包含非標準股票選擇權。');
  ids.add(t.id);
 }
 return d;
}
export function LedgerProvider({children}:{children:ReactNode}){
 const [ledger,setLedger]=useState<Ledger|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let live=true;async function read(){
  try {const saved=localStorage.getItem(storageKey);if(saved&&live)setLedger(validateLedger(JSON.parse(saved)));}catch{if(live)setError('本機已儲存帳本無法讀取，請重新匯入。');}
  if(['localhost','127.0.0.1'].includes(location.hostname))try{
   const r=await fetch('/api/private-ledger',{cache:'no-store'});if(r.ok){const data=validateLedger(await r.json());if(live)setLedger(current=>!current||Date.parse(data.importedAt)>=Date.parse(current.importedAt)?data:current);}
  }catch{if(live)setError('本機資料來源暫時無法讀取。');}
  if(live)setLoading(false);
 }void read();return()=>{live=false};},[]);
 async function loadFile(file:File){try{if(file.size>5_000_000)throw new Error('帳本檔案不可超過 5 MB。');const data=validateLedger(JSON.parse(await file.text()));localStorage.setItem(storageKey,JSON.stringify(data));setLedger(data);setError('');}catch(e){setError(e instanceof Error?e.message:'讀取失敗');}}
 return <Context.Provider value={{ledger,error,loading,loadFile,clear:()=>{localStorage.removeItem(storageKey);setLedger(null);}}}>{children}</Context.Provider>;
}
export const useLedger=()=>useContext(Context);
const money=(n:number|null)=>n===null?'—':formatCurrency(n);
const sum=(items:number[])=>items.reduce((a,b)=>a+b,0);
function matchQuote(t:LedgerTrade,quotes:OptionCandidate[],long=false){return quotes.find(q=>q.ticker===t.ticker&&q.expiration===t.expiration&&q.strike===(long?t.longStrike:t.strike)&&q.optionType===(t.strategy==='CC'?'call':'put')&&q.bid>0&&q.ask>=q.bid);}
function positionMark(t:LedgerTrade,quotes:OptionCandidate[]){const q=matchQuote(t,quotes);if(!q)return null;if(t.strategy==='BPS'){const l=matchQuote(t,quotes,true);if(!l)return null;return t.grossPremium-(q.ask-l.bid)*100*t.contracts;}return t.grossPremium-q.ask*100*t.contracts;}
export function Portfolio({quotes,quoteAt,legacy}:{quotes:OptionCandidate[];quoteAt:string|null;legacy:ReactNode}){
 const {ledger,error,loading,loadFile,clear}=useLedger();
 const [account,setAccount]=useState('All'),[ticker,setTicker]=useState('All'),[status,setStatus]=useState('All');
 const accounts=Array.from(new Set(['Giselle','Ludi',...(ledger?.trades.map(t=>t.account)??[])]));
 const available=ledger?.trades??[];
 const rows=available.filter(t=>(account==='All'||t.account===account)&&(ticker==='All'||t.ticker===ticker));
 const closed=rows.filter(t=>t.closeDate&&t.closedProfit!==null),open=rows.filter(t=>!t.closeDate);
 const marks=open.map(t=>positionMark(t,quotes)).filter((n):n is number=>n!==null);
 const realized=sum(closed.map(t=>t.closedProfit!)),wins=closed.filter(t=>t.closedProfit!>0).length;
 const monthly=useMemo(()=>{const values=new Map<string,number>();for(const t of closed){const key=t.closeDate!.slice(0,7);values.set(key,(values.get(key)??0)+t.closedProfit!);}return [...values].sort(([a],[b])=>a.localeCompare(b));},[closed]);
 const maxMonth=Math.max(1,...monthly.map(([,v])=>Math.abs(v)));
 const shown=rows.filter(t=>status==='All'||(status==='Open'?!t.closeDate:!!t.closeDate)).sort((a,b)=>b.entryDate.localeCompare(a.entryDate)||b.sourceRow-a.sourceRow);
 return <section className="wideWorkspace portfolio">
  <div className="sectionHead"><div><span className="eyebrow">自己的交易 · OWN ACCOUNTS</span><h2>股票選擇權損益 · P&L</h2><p>已平倉依帳本損益；未平倉以可得 Ask 估價。CC 僅顯示選擇權腿，正股損益未包含。</p></div><label className="fileButton">匯入私人帳本 · Import<input aria-label="匯入私人帳本" type="file" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];if(f)void loadFile(f);e.target.value='';}} /></label></div>
  <div className="filterBar"><label>帳戶 Account<select value={account} onChange={e=>setAccount(e.target.value)}><option value="All">全部帳戶</option>{accounts.map(a=><option key={a}>{a}</option>)}</select></label><label>標的 Ticker<select value={ticker} onChange={e=>setTicker(e.target.value)}><option value="All">全部股票／ETF</option>{[...new Set(available.map(t=>t.ticker))].sort().map(t=><option key={t}>{t}</option>)}</select></label><label>狀態 Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="All">全部</option><option value="Open">未記錄平倉</option><option value="Closed">已記錄平倉</option></select></label>{ledger&&<button onClick={clear}>清除本次顯示與瀏覽器副本</button>}</div>
  {error&&<p role="alert" className="notice warning">{error}</p>}
  {!ledger?<div className="emptyState"><h3>{loading?'讀取本機帳本…':'尚未載入私人帳本'}</h3><p>本機版讀取已同步的 Google Sheet 快照；線上版可匯入交易帳本 JSON，僅儲存在此瀏覽器，不上傳交易資料。</p></div>:<>
  <p className="sourceLine">{ledger.sourceLabel} · 同步 {new Date(ledger.importedAt).toLocaleString('zh-TW')} · {ledger.trades.length} 筆股票選擇權 <a href={ledger.sourceUrl.startsWith('https://docs.google.com/')?ledger.sourceUrl:undefined} target="_blank" rel="noreferrer">查看來源 Sheet ↗</a></p>
  <div className="metricGrid"><Metric label="已實現 Realized" value={rows.length?money(realized):'—'} detail={`${closed.length} 個已平倉交易列；依 Sheet 費用口徑`} /><Metric label="未實現（可估價部分） Unrealized" value={marks.length?money(sum(marks)): '—'} detail={`${marks.length}/${open.length} 列有報價；未扣待發生平倉費`} /><Metric label="獲利列比例 Win rows" value={closed.length?`${formatNumber(wins/closed.length*100,1)}%`:'—'} detail={`${wins}/${closed.length}；分批平倉未合併為獨立策略`} /><Metric label="Put 接股義務 Assignment" value={rows.length?money(sum(open.filter(t=>t.strategy==='CSP').map(t=>t.strike*100*t.contracts))):'—'} detail="表內尚未記錄平倉的 CSP；未扣權利金" /></div>
  {open.length>0&&<p className="notice">估價快照：{quoteAt?new Date(quoteAt).toLocaleString('zh-TW'):'無行情'}。未記錄平倉不等於已核實券商持倉；缺少報價以「—」顯示，不當成零損益。</p>}
  {rows.length===0?<div className="emptyState"><h3>此條件沒有交易</h3><p>請匯入含對應 account 標籤的私人帳本，或調整篩選條件。</p></div>:<>
  <div className="portfolioPanels"><section className="panel"><h3>每月已實現 · Monthly P&L</h3>{monthly.map(([month,v])=><div className="monthRow" key={month}><span>{month}</span><div className="barTrack"><div className={v<0?'lossBar':'gainBar'} style={{width:`${Math.abs(v)/maxMonth*100}%`}} /></div><strong className={v<0?'loss':'gain'}>{money(v)}</strong></div>)}{!monthly.length&&<p>尚無已平倉損益。</p>}</section><section className="panel"><h3>帳本核對 · Reconciliation</h3><p>{rows.filter(t=>t.flags.length).length} 列有資料提示；{rows.filter(t=>t.reconciliation!==null&&Math.abs(t.reconciliation)>0.01).length} 列與既有券商紀錄金額不同。</p><p>到期日推導 DTE；保留來源值與差異。轉倉舊倉損益保留，新的權利金不抵銷歷史虧損。</p><p>本頁僅股票選擇權損益，不能當整個帳戶淨值報酬。</p></section></div>
  <div className="tableWrap"><table><thead><tr><th>帳戶／交易日</th><th>合約／策略</th><th>口數／DTE</th><th>開倉權利金</th><th>平倉／估價損益</th><th>核對與來源</th></tr></thead><tbody>{shown.map(t=><tr key={t.id}><td><strong>{t.account}</strong><small>{t.entryDate}</small></td><td><strong>{t.ticker} {t.expiration??'到期日待核對'}</strong><small>{t.strike}{t.strategy==='BPS'?` / ${t.longStrike}`:''} · {t.strategy}</small>{t.rollGroupId&&<small>轉倉群組 · {t.rollGroupId}</small>}</td><td>{t.contracts} 口<small>開倉 {t.entryDte??'—'} DTE</small></td><td>{money(t.grossPremium)}<small>每股 {money(t.entryPremium)}</small></td><td className={(t.closeDate?t.closedProfit:positionMark(t,quotes))!<0?'loss':'gain'}>{money(t.closeDate?t.closedProfit:positionMark(t,quotes))}<small>{t.closeDate?`已平倉 ${t.closeDate}`:'尚未記錄平倉 · Ask 估價'}</small></td><td><details><summary>來源列 {t.sourceRow}{t.flags.length?` · ${t.flags.length} 提示`:''}</summary>{t.flags.map(f=><p key={f}>{f}</p>)}{t.brokerProfit!==null&&<p>券商紀錄：{money(t.brokerProfit)}</p>}{t.notes&&<p>{t.notes}</p>}{!t.flags.length&&!t.notes&&<p>未發現欄位差異；尚非完整券商對帳。</p>}</details></td></tr>)}</tbody></table></div></>}
  </>}
  <details className="legacyDetails"><summary>既有 SOXL 券商紀錄與路徑分析 · Legacy evidence</summary><p className="notice">保留 main 的分批平倉、轉倉與 Greeks 證據。此歷史紀錄可能落後 Sheet，未重複加進上方損益。</p>{legacy}</details>
 </section>;
}
function Metric({label,value,detail}:{label:string;value:string;detail:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;}
export function TradeRisk({row,quoteAt}:{row:ScoredCandidate|undefined;quoteAt:string|null}){
 const {ledger}=useLedger();const [qty,setQty]=useState(1),[budget,setBudget]=useState(''),[fee,setFee]=useState(2),[account,setAccount]=useState('Giselle'),[decline,setDecline]=useState(40);
 if(!row||row.optionType!=='put')return null;
 const existing=ledger?.trades.filter(t=>t.account===account&&!t.closeDate&&t.strategy==='CSP')??[];
 const accountKnown=!!ledger?.trades.some(t=>t.account===account);
 const exposure=sum(existing.map(t=>t.strike*100*t.contracts));const required=row.strike*100*qty;
 const net=row.bid*100*qty-fee*qty;const cap=Number(budget),known=budget!==''&&Number.isFinite(cap)&&cap>=0;
 const oldQuote=!quoteAt||!Number.isFinite(Date.parse(quoteAt))||Date.now()-Date.parse(quoteAt)>24*3600000;
 const stressSpot=row.underlyingPrice*(1-decline/100),stress=net-Math.max(0,row.strike-stressSpot)*100*qty;
 const invalid=!row.matched||oldQuote||net<=0;
 return <section className="riskPanel panel"><h3>下單前資金檢查 · Pre-trade</h3><p>{row.ticker} {row.expiration} {row.strike}P</p><div className="riskInputs"><label>帳戶 Account<select value={account} onChange={e=>setAccount(e.target.value)}>{[...new Set(['Giselle','Ludi',...(ledger?.trades.map(t=>t.account)??[])])].map(a=><option key={a}>{a}</option>)}</select></label><label>口數 Contracts<input type="number" min="1" max="1000" step="1" value={qty} onChange={e=>setQty(Math.min(1000,Math.max(1,Math.trunc(Number(e.target.value)||1))))}/></label><label>每口預估來回費用 $<input type="number" min="0" step="0.1" value={fee} onChange={e=>setFee(Math.max(0,Number(e.target.value)||0))}/></label><label>新單可用現金 Available cash<input type="number" min="0" placeholder="填入券商確認的剩餘現金" value={budget} onChange={e=>setBudget(e.target.value)}/></label></div><dl className="riskNumbers"><dt>Bid 扣預估費用</dt><dd>{money(net)}</dd><dt>新單接股現金</dt><dd>{money(required)}</dd><dt>表內既有 CSP 義務</dt><dd>{accountKnown?money(exposure):'尚無此帳戶紀錄'}</dd><dt>新增後接股義務</dt><dd>{accountKnown?money(exposure+required):'待核對既有部位'}</dd><dt>新單到期最大損失</dt><dd>{money(required-net)}</dd></dl><label>到期壓力情境 · Spot −{decline}%<input aria-label="到期跌幅壓力情境" type="range" min="10" max="80" step="5" value={decline} onChange={e=>setDecline(Number(e.target.value))}/></label><p>假設到期股價 {money(stressSpot)}，新單損益 {money(stress)}。這是到期情境，不是機率或盤中估價。</p><p className={`notice ${invalid||!known||cap<required?'warning':''}`}>{invalid?'需重新檢查：報價超過 24 小時、未通過預設風險篩選，或扣費收益不足。':!known?'尚未輸入券商可用現金，資金檢查未完成。':cap<required?'新單所需接股現金超過可用現金。':'輸入的現金足以覆蓋新單；仍需確認實際持倉與成交報價。'}</p><small>使用完整現金擔保口徑，低 Delta 不代表不會被指派。費用 $2/口為可修改假設。</small></section>;
}
