"use client";
import {useState} from "react";
type Result={id:string;label:string;metric:string;condition:string;url:string;accessed:string;note:string;source_version:string|null;source_locator:string;sample_size:number|null;tested_at:string|null;rows:{model:string;value:number}[]};
export function BenchmarkRanking({results}:{results:Result[]}){
 const [id,setId]=useState(results[0]?.id||""),[query,setQuery]=useState("");
 const selected=results.find(r=>r.id===id);
 if(!selected)return <p className="empty-state">暂无已核验成绩。</p>;
 const ranked=[...selected.rows].sort((a,b)=>b.value-a.value);
 const rows=ranked.map((row,i)=>({row,rank:i>0&&ranked[i-1].value===row.value?ranked.findIndex(r=>r.value===row.value)+1:i+1})).filter(({row})=>row.model.toLowerCase().includes(query.toLowerCase()));
 return <section className="benchmark-ranking" id="results"><div className="section-heading"><h2>模型成绩</h2><a href={selected.url} target="_blank" rel="noreferrer">查看来源 ↗</a></div>
 <div className="benchmark-controls"><label>来源与条件 <select value={id} onChange={e=>setId(e.target.value)}>{results.map(r=><option value={r.id} key={r.id}>{r.label}</option>)}</select></label><label>搜索模型 <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入模型或方法"/></label></div>
 <p className="benchmark-note">{selected.metric} · {selected.condition} · 获取日期 {selected.accessed}</p>
 <div className="run-table-scroll"><table className="run-table"><thead><tr><th>排名</th><th>模型 / 方法</th><th>{selected.metric}</th></tr></thead><tbody>{rows.map(({row,rank})=><tr key={row.model}><td>{rank}</td><td>{row.model}</td><td>{row.value.toFixed(2)}%</td></tr>)}</tbody></table></div>
 {!rows.length&&<p className="empty-state">{selected.rows.length ? "没有匹配的模型，请修改搜索词。" : "本地未收录成绩，请通过来源链接查看。"}</p>}<p className="benchmark-note">{selected.note}</p><p className="benchmark-note">样本数：{selected.sample_size??"未记录"} · 测试时间：{selected.tested_at??"未记录"}</p><details className="record-metadata"><summary>来源定位</summary><p>{selected.source_version||"版本未核验"} · {selected.source_locator}</p></details></section>;
}
