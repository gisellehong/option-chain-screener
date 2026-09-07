import {useState} from 'react';
import fixture from '../../analysis/lao-k-soxl-csp-2026-08/recommendations.json';
import {formatCurrency,formatNumber} from '../lib/format';
export function LaoKTracker(){
 const dates=[...new Set(fixture.recommendations.map(r=>r.date))].sort().reverse();
 const [date,setDate]=useState(dates[0]);const rows=fixture.recommendations.filter(r=>r.date===date);
 return <section className="wideWorkspace"><div className="sectionHead"><div><span className="eyebrow">第三方公開樣本 · REFERENCE</span><h2>老 K · SOXL 推薦追蹤</h2><p>24 筆已轉錄推薦，來源日期 2026/8/24–9/1。推薦與模型估值，不代表券商成交或已實現損益。</p></div><label>推薦日期 Date<select value={date} onChange={e=>setDate(e.target.value)}>{dates.map(d=><option key={d}>{d}</option>)}</select></label></div>
 <div className="metricGrid"><div className="metric"><span>當日推薦</span><strong>{rows.length}</strong><small>未入選的到期日保持空白</small></div><div className="metric"><span>到期 ITM 門檻</span><strong>≤5%</strong><small>來源模型歷史估計</small></div><div className="metric"><span>成交證據</span><strong>未核實</strong><small>不計入自有帳戶 P&L</small></div><div className="metric"><span>績效驗證</span><strong>待累積</strong><small>24 筆符合規則不等於勝率</small></div></div>
 <div className="tableWrap"><table><thead><tr><th>到期／履約價</th><th>DTE</th><th>Delta／OTM</th><th>到期 ITM／期間觸及</th><th>Bid／Mid／Ask</th><th>單口接股義務</th><th>Bid 簡單年化</th></tr></thead><tbody>{rows.map(r=><tr key={`${r.expiration}-${r.strike}`}><td><strong>{r.expiration}</strong><small>SOXL {r.strike}P</small></td><td>{r.dte}</td><td>{r.delta}<small>{r.otmPct}% OTM</small></td><td>{r.expiryItmPct}%<small>{r.touchPct}% Touch</small></td><td>{formatCurrency(r.bid)} / {formatCurrency(r.mid)} / {formatCurrency(r.ask)}</td><td>{formatCurrency(r.strike*100,0)}</td><td>{formatNumber(r.bidAnnualizedRoiPct,1)}%<small>未扣費用；非帳戶報酬</small></td></tr>)}</tbody></table></div>
 <p className="notice">推薦日的歷史數字，不能當成今日可成交報價。持倉截圖的 Mid 浮盈、入選比例與真實獲利勝率分開處理。</p></section>;
}
