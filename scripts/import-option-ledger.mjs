import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const finite=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const text=x=>String(x??'').trim();
export function dateValue(value){
 if(typeof value==='number') return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 if(typeof value==='string'&&/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)){const [m,d,y]=value.split('/');return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
 return null;
}
export function normalizeSheet(source,brokerTrades=[]){
 const rows=source.tracker?.values;
 if(!Array.isArray(rows)||rows[0]?.[0]!=='Order Date'||rows[0]?.[41]!=='Closed Profit')throw new Error('Tracker headers do not match the verified schema');
 const trades=[],excluded={futures:0,thirdParty:0,incomplete:0};
 const duplicates=new Set();
 for(let i=1;i<rows.length;i++){
  const r=rows[i],owner=text(r[1]),entryDate=dateValue(r[0]),ticker=text(r[4]).split(' ')[0];
  if(!entryDate||!owner||!ticker)continue;
  if(/^(ES|MES|NQ|MNQ|RTY|M2K|CL|GC|SI)$/.test(ticker)){excluded.futures++;continue;}
  if(owner==='Rich'){excluded.thirdParty++;continue;}
  const strike=finite(r[6]),contracts=finite(r[15]),entryPremium=finite(r[9]),strategy=text(r[2]);
  if(!strike||!contracts||entryPremium===null||!['CSP','CC','BPS'].includes(strategy)){excluded.incomplete++;continue;}
  const flags=[];
  const code=text(r[4]).match(/\b(\d{2})(\d{2})(\d{2})\b/);
  let expiration=code?`20${code[1]}-${code[2]}-${code[3]}`:null;
  const closeDate=dateValue(r[38]),closedProfit=finite(r[41]),closePrice=finite(r[40]);
  const brokers=brokerTrades.filter(b=>(b.trader==='G'?'Giselle':b.trader==='L'?'Ludi':b.traderName)===owner&&b.entryDate===entryDate&&b.strike===strike&&b.contracts===contracts&&b.strategy===strategy&&Math.abs(b.entryPremium-entryPremium)<0.011);
  const broker=brokers.find(b=>b.closeDate===closeDate&&b.closePrice===closePrice)??(brokers.length===1?brokers[0]:undefined);
  if(broker?.expirationCorrected&&expiration!==broker.expiration){expiration=broker.expiration;flags.push('到期日依既有核對紀錄修正；保留原標籤');}
  if(!expiration)flags.push('缺少到期日，無法計算 DTE／報價');
  const dte=expiration?Math.round((Date.parse(expiration)-Date.parse(entryDate))/86400000):null;
  if(dte!==null&&finite(r[14])!==null&&dte!==r[14])flags.push(`DTE 已按日期重算：${r[14]} → ${dte}`);
  if(dte!==null&&(dte<0||dte>365))flags.push('到期日與開倉日期需核對');
  if(closeDate&&closedProfit===null)flags.push('有平倉日期但缺少損益');
  if(!closeDate&&closedProfit!==null)flags.push('有損益但缺少平倉日期');
  const brokerPnl=broker?.closedProfit??null;
  const reconciliation=closedProfit!==null&&brokerPnl!==null?Math.round((closedProfit-brokerPnl)*100)/100:null;
  if(reconciliation!==null&&Math.abs(reconciliation)>0.01)flags.push(`Sheet 與券商紀錄差額 $${reconciliation.toFixed(2)}`);
  const key=[owner,entryDate,text(r[4]),strike,contracts,entryPremium,closeDate,closePrice].join('|');
  if(duplicates.has(key))flags.push('相同交易欄位重複；需核對，未自動刪除');duplicates.add(key);
  const longStrike=finite(r[7]);
  const cashRequired=strategy==='CSP'?strike*100*contracts:strategy==='BPS'&&longStrike!==null?Math.max(0,(strike-longStrike-entryPremium)*100*contracts):null;
  trades.push({id:`sheet-447250455-${i+1}`,sourceRow:i+1,account:owner,ticker,strategy,entryDate,expiration,sourceContractLabel:text(r[4]),strike,longStrike,contracts,multiplier:100,entryPremium,grossPremium:entryPremium*100*contracts,cashRequired,entryDte:dte,sourceDte:finite(r[14]),entryDelta:finite(r[32]),closeDate,closePrice,closedProfit,brokerProfit:brokerPnl,brokerTradeId:broker?.id??null,reconciliation,rollGroupId:broker?.rollGroupId??null,notes:text(r[34]),flags});
 }
 return {schemaVersion:1,importedAt:source.fetchedAt,sourceUrl:source.spreadsheetUrl,sourceLabel:'Google Sheet · 已核對欄位快照',excluded,trades};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const input=process.argv[2];if(!input)throw new Error('Usage: node scripts/import-option-ledger.mjs <connector-export.json>');
 const source=JSON.parse(fs.readFileSync(input,'utf8'));
 const broker=JSON.parse(fs.readFileSync(path.join(root,'data/soxl-trades/trades.json'),'utf8'));
 const ledger=normalizeSheet(source,broker.trades);
 const output=path.join(root,'data/private/ledger.local.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(ledger,null,2)+'\n');
 console.log(JSON.stringify({output,stockOptionRows:ledger.trades.length,excluded:ledger.excluded,flags:ledger.trades.filter(t=>t.flags.length).length}));
}
