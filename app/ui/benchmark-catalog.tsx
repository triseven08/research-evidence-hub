"use client";
import {useEffect,useState} from "react";
import {benchmarks} from "../../lib/benchmarks";
import {Icon} from "./icons";
import {benchmarkTags,benchmarkTagIds,tagsFor} from "../../lib/benchmark-tags";
export function BenchmarkCatalog(){
 const [selected,setSelected]=useState<string[]>([]);
 useEffect(()=>{const tag=new URLSearchParams(window.location.search).get("tag");if(tag&&benchmarkTags.some(t=>t.id===tag))setSelected([tag]);},[]);
 const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(t=>t!==id):[...current,id]);
 const visible=benchmarks.filter(b=>selected.every(id=>benchmarkTagIds[b.id]?.includes(id)));
 return <><section className="tag-filter" aria-label="按标签筛选"><div className="section-heading"><h2>按标签筛选</h2>{selected.length>0&&<button onClick={()=>setSelected([])}>清除筛选</button>}</div>{["工具环境","评测目标","发现方式"].map(group=><div className="tag-group" key={group}><span>{group}</span><div>{benchmarkTags.filter(t=>t.group===group).map(tag=><button type="button" aria-pressed={selected.includes(tag.id)} onClick={()=>toggle(tag.id)} className={selected.includes(tag.id)?"benchmark-chip selected":"benchmark-chip"} key={tag.id}>{tag.label}</button>)}</div></div>)}<details className="tag-guide"><summary>标签说明</summary><dl>{benchmarkTags.map(t=><div key={t.id}><dt>{t.label}</dt><dd>{t.description}</dd></div>)}</dl></details></section>
 <div className="benchmark-list" aria-live="polite">{visible.map((b,i)=><a href={`/benchmarks/${b.id}`} key={b.id}><span className="benchmark-list-number">{String(i+1).padStart(2,"0")}</span><div className="benchmark-list-main"><h2>{b.name}</h2><p>{b.summary}</p><div className="benchmark-chips">{tagsFor(b.id).map(t=><span className="benchmark-chip" key={t.id}>{t.label}</span>)}</div></div><Icon name="arrow-up-right" size={19}/></a>)}{visible.length===0&&<p className="empty-state">没有符合全部标签的评测，请减少筛选条件。</p>}</div>
 <details className="benchmark-comparison"><summary>横向对照评测方式</summary><div className="run-table-scroll"><table className="run-table benchmark-compare"><thead><tr><th>研究对象</th><th>工具发现方式</th><th>评分关注</th></tr></thead><tbody>{visible.map(b=><tr key={b.id}><td><a href={`/benchmarks/${b.id}`}>{b.name}</a></td><td>{b.control}</td><td>{b.metric}</td></tr>)}</tbody></table></div></details></>;
}
