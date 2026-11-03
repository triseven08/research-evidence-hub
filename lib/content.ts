import raw from "../content/articles.json" with { type: "json" };
import rawRuns from "../content/experiments.json" with { type: "json" };
import type {Experiment} from "./experiments.ts";
import {benchmarks} from "./benchmarks.ts";

export type Section = { id: string; title: string; paragraphs: string[]; bullets?: string[]; code?: string; flow?: string[] };
export type Article = { id: string; title: string; summary: string; category: string; level: string; minutes: number; icon: string; updatedAt: string; review_status:string; tags: string[]; sources: { title: string; url: string; version?: string }[]; sections: Section[]; href?:string };
const benchmarkArticles:Article[]=benchmarks.map(b=>({id:`benchmark-${b.id}`,title:b.name,summary:b.summary,category:"评测与前沿",level:"研究",minutes:5,icon:"compass",updatedAt:"2026-11-03",review_status:"reviewed",tags:[b.name,"benchmark","工具检索","评测"],sources:[{title:b.sourceTitle,url:b.source}],sections:[{id:"overview",title:"测量范围与流程",paragraphs:[b.scope,b.candidates,b.control,b.metric,b.limits]}],href:`/benchmarks/${b.id}`}));
export const articles = [...(raw as Article[]).filter(a=>a.review_status==="reviewed"),...benchmarkArticles];
export const articleHref=(a:Article)=>a.href||`/knowledge/${a.id}`;
export const contentVersion = "2026-11-03.3";
export const categories = ["Agent 基础", "工具调用", "MCP 协议", "规划与上下文", "评测与前沿"];
export const articleById = (id: string) => articles.find(a => a.id === id);
export const paths = [
  { id: "first-agent", title: "从第一次工具调用开始", summary: "理解一条从问题到行动的完整链路。", level: "入门", icon: "route", ids: ["what-is-agent", "tool-calling", "mcp-architecture", "tool-discovery", "planning"] },
  { id: "reliable-agent", title: "让 Agent 更可靠", summary: "把关注点从一次调用，移向任务的完整过程。", level: "进阶", icon: "layers", ids: ["tool-discovery", "planning", "context-and-skills", "reading-benchmarks"] },
  { id: "research-frontiers", title: "带着问题看研究", summary: "从评测证据出发，理解方法的适用范围。", level: "探索", icon: "compass", ids: ["reading-benchmarks", "frontiers", "context-and-skills"] },
];

const aliases: Record<string, string> = { "智能体": "agent", "代理": "agent", "函数调用": "tool calling", "工具调用": "tool calling", "工具发现": "tool discovery", "检索": "retrieval", "多轮": "multi turn", "规划": "planning", "上下文": "context", "技能": "skill", "记忆": "memory", "评测": "benchmark" };
function normalize(text: string) { let s = text.toLowerCase(); for (const [a,b] of Object.entries(aliases)) if(s.includes(a)) s += " " + b; return s; }
function grams(text: string) { const s = normalize(text); const tokens: string[] = [...(s.match(/[a-z][a-z0-9_+-]*/g) || [])]; const chinese = s.match(/[\u4e00-\u9fff]+/g) || []; for(const run of chinese) { if(run.length===1) tokens.push(run); for(let i=0;i<run.length-1;i++) tokens.push(run.slice(i,i+2)); } return [...new Set(tokens)]; }
export function searchArticles(query: string, category = "全部") {
  const candidates = articles.filter(a=>category==="全部" || a.category===category);
  if(!query.trim()) return candidates;
  const terms = grams(query);
  return candidates.map(a=>({article:a, score:terms.reduce((s,t)=> s + (normalize(a.title).includes(t)?8:0) + (normalize(a.tags.join(" ")).includes(t)?5:0) + (normalize(a.summary+ a.sections.map(x=>x.paragraphs.join(" ")).join(" ")).includes(t)?1:0),0)})).filter(a=>a.score>0).sort((a,b)=>b.score-a.score).map(x=>x.article);
}
export type Chunk = { id: string; articleId: string; articleTitle: string; anchor: string; title: string; text: string; score: number; href?:string };
export function retrieve(question: string, articleId?: string): Chunk[] {
  const terms=grams(question);
  if(terms.length===0) return [];
  const chunks: Chunk[]=[];
  for(const a of articles) for(const section of a.sections) {
    const text=[...section.paragraphs,...(section.bullets||[])].join("\n");
    const body=normalize(text); const heading=normalize(a.title+" "+section.title+" "+a.tags.join(" ")); const sectionHeading=normalize(section.title);
    const hits=terms.filter(t=>body.includes(t)||heading.includes(t));
    const explicit=a.tags.filter(t=>t.length>=2&&question.toLowerCase().includes(t.toLowerCase()));
    const score=hits.reduce((s,t)=>s+(sectionHeading.includes(t)?6:0)+(heading.includes(t)?3:0)+(body.includes(t)?2:0),0)+explicit.filter(t=>body.includes(t.toLowerCase())).length*8+(articleId===a.id&&hits.length?2:0);
    if(hits.length && (hits.length>=2 || explicit.length || hits.some(t=>t.length>=4))) chunks.push({id:a.id+"#"+section.id, articleId:a.id,articleTitle:a.title,anchor:section.id,title:section.title,text,score,href:a.href?`${a.href}?view=overview#${section.id}`:undefined});
  }
  for(const run of rawRuns as Experiment[]){
    const text=`团队实测：${run.benchmark}，模型 ${run.model}，${run.scope==="subset"?"任务子集":"完整任务集"}，${run.recorded_at}。${run.summary}\n计划 ${run.counts.planned}，成功 ${run.counts.succeeded}，任务失败 ${run.counts.task_failed}，环境失败 ${run.counts.environment_failed}，评分失败 ${run.counts.scoring_failed}，未运行 ${run.counts.not_run}。\n${run.metrics.map(m=>`${m.name}: ${m.value} ${m.unit}；口径：${m.denominator}`).join("\n")}\n方法 ${run.method}；评分器 ${run.scorer}；上游 ${run.upstream_commit}。`;
    const body=normalize(text),heading=normalize(run.benchmark+" "+run.model);const hits=terms.filter(t=>body.includes(t));
    if(hits.length>=2||hits.some(t=>t.length>=4))chunks.push({id:"experiment:"+run.run_id,articleId:run.run_id,articleTitle:run.benchmark+" · "+run.model,anchor:"summary",title:"团队实测",text,score:hits.reduce((s,t)=>s+(heading.includes(t)?7:2),0),href:`/experiments/${run.run_id}#summary`});
  }
  return chunks.sort((a,b)=>b.score-a.score).slice(0,5);
}
