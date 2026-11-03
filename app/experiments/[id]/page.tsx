import {notFound} from "next/navigation";
import runs from "../../../content/experiments.json";
import type {Experiment} from "../../../lib/experiments";
import {Icon} from "../../ui/icons";
const statusNames={succeeded:"成功",task_failed:"任务失败",environment_failed:"环境失败",scoring_failed:"评分失败",not_run:"未运行"};
export default async function ExperimentPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const run=(runs as Experiment[]).find(r=>r.run_id===id);if(!run)notFound();
 const c=run.counts,executed=c.planned-c.not_run;
 return <article className="experiment-detail"><a href="/benchmarks" className="back-link"><Icon name="arrow-left" size={15}/>Benchmark</a><div className="article-meta"><span>团队实测</span><span>·</span><span>{run.scope==="subset"?"任务子集":"完整任务集"}</span><span>·</span><span>{run.recorded_at.slice(0,10)}</span></div><h1 id="summary">{run.benchmark}</h1><p className="article-lead">{run.summary}</p><dl className="experiment-config"><dt>模型</dt><dd>{run.model}</dd><dt>方法</dt><dd>{run.method}</dd><dt>任务集</dt><dd>{run.dataset}</dd><dt>评分器</dt><dd>{run.scorer}</dd><dt>上游 commit</dt><dd><code>{run.upstream_commit}</code></dd><dt>Run</dt><dd><code>{run.run_id}</code></dd></dl>
 <div className="run-measures"><div><strong>{c.succeeded} / {c.planned}</strong><span>成功 / 计划</span></div><div><strong>{executed} / {c.planned}</strong><span>已运行 / 计划</span></div><div><strong>{run.tokens===null?"未记录":run.tokens.toLocaleString()}</strong><span>Tokens</span></div><div><strong>{run.cost_usd===null?"未记录":`$${run.cost_usd.toFixed(4)}`}</strong><span>实际费用</span></div></div>
 {run.metrics.length>0&&<table className="run-table"><thead><tr><th>官方指标</th><th>结果</th><th>分母 / 口径</th></tr></thead><tbody>{run.metrics.map((m,i)=><tr key={i}><td>{m.name}</td><td>{m.value} {m.unit}</td><td>{m.denominator}</td></tr>)}</tbody></table>}
 <div className="status-counts">{Object.entries(statusNames).map(([key,label])=><span key={key}>{label} <strong>{c[key as keyof typeof statusNames]}</strong></span>)}</div>
 <div className="run-table-scroll"><table className="run-table"><thead><tr><th>任务</th><th>状态</th><th>结果与案例</th></tr></thead><tbody>{run.tasks.map(t=><tr key={t.task_id}><td><code>{t.task_id}</code></td><td>{statusNames[t.status]}</td><td><p>{t.summary}</p>{t.replay_id&&<a href={`/replays/${t.replay_id}`} className="inline-replay"><Icon name="play" size={13}/>查看回放</a>}</td></tr>)}</tbody></table></div>
 <details className="record-metadata"><summary>运行配置</summary><pre>{JSON.stringify(run.config,null,2)}</pre></details><div className="reference-links">{run.sources.map(s=><a href={s.url} key={s.url} target="_blank" rel="noreferrer">{s.title}<Icon name="external" size={13}/></a>)}</div>
 </article>;
}
