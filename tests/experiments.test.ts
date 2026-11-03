import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateBundle,replaySchema} from "../lib/experiments.ts";
const teaching=JSON.parse(readFileSync(new URL("../content/replays.json",import.meta.url),"utf8"))[0];
function bundle(){
 const replay={...structuredClone(teaching),id:"fixture-trace",origin:"recorded_run",benchmark:"fixture-only",run_id:"fixture-run",task_id:"task-1",attempt_id:"attempt-1",model:"fixture-model",recorded_at:"2026-11-03T00:00:00Z",article_ids:["planning"]};
 const experiment={run_id:"fixture-run",benchmark:"fixture-only",upstream_commit:"abcdef0",model:"fixture-model",method:"fixture",scorer:"fixture-scorer",recorded_at:"2026-11-03T00:00:00Z",scope:"subset",dataset:"fixture",config:{temperature:0},summary:"仅用于校验的测试夹具，不发布成绩。",sources:[{title:"fixture",url:"https://example.com/fixture"}],counts:{planned:1,succeeded:1,task_failed:0,environment_failed:0,scoring_failed:0,not_run:0},metrics:[],tokens:null,cost_usd:null,tasks:[{task_id:"task-1",attempt_id:"attempt-1",status:"succeeded",summary:"fixture",replay_id:"fixture-trace"}]};
 return {experiment,replays:[replay]};
}
test("teaching replay is explicit; actual runs retain unknown costs as null",()=>{
 assert.equal(replaySchema.parse(teaching).origin,"scripted_demo");
 assert.equal(validateBundle(bundle(),["planning"]).experiment.cost_usd,null);
 const wrong={...teaching,run_id:"fake"};assert.throws(()=>replaySchema.parse(wrong));
});
test("import rejects inconsistent denominators and dangling or mismatched traces",()=>{
 const wrongCount=bundle();wrongCount.experiment.counts.planned=10;assert.throws(()=>validateBundle(wrongCount,["planning"]));
 const wrongTask=bundle();wrongTask.replays[0].attempt_id="other";assert.throws(()=>validateBundle(wrongTask,["planning"]));
 const missing=bundle();missing.replays=[];assert.throws(()=>validateBundle(missing,["planning"]));
 const sequence=bundle();sequence.replays[0].events[0].sequence=2;assert.throws(()=>validateBundle(sequence,["planning"]));
});
test("import rejects credential fields and unreviewed article references",()=>{
 const secret=bundle();Object.assign(secret.experiment.config,{api_key:"fixture-secret"});assert.throws(()=>validateBundle(secret,["planning"]),/凭证/);
 assert.throws(()=>validateBundle(bundle(),[]),/文章/);
});

test("external author traces remain attributable and cannot enter team-run bundles",()=>{
 const traces=JSON.parse(readFileSync(new URL("../content/author-replays.json",import.meta.url),"utf8"));
 for(const trace of traces){assert.equal(replaySchema.parse(trace).origin,"author_record");assert.match(trace.source_url,/^https:\/\//);assert.throws(()=>replaySchema.parse({...trace,source_url:undefined}));const data=bundle();data.replays=[trace];assert.throws(()=>validateBundle(data,["planning"]));}
});
test("external scores retain source and condition; distinct groups do not get merged",()=>{
 const benchmarks: {results:string[]}[]=JSON.parse(readFileSync(new URL("../content/benchmarks.json",import.meta.url),"utf8"));
 const scores: {id:string;url:string;metric:string;condition:string;accessed:string;rows:{model:string;value:number}[]}[]=JSON.parse(readFileSync(new URL("../content/benchmark-results.json",import.meta.url),"utf8"));
 assert.equal(benchmarks.length,4);assert.equal(new Set(scores.map(g=>g.id)).size,scores.length);
 for(const b of benchmarks)for(const id of b.results)assert.ok(scores.some(g=>g.id===id));
 for(const group of scores){assert.match(group.url,/^https:\/\//);assert.ok(group.metric&&group.condition&&group.accessed);for(const row of group.rows)assert.ok(row.model&&Number.isFinite(row.value));}
 assert.notEqual(scores.find(g=>g.id==="live-paper")?.id,scores.find(g=>g.id==="live-leaderboard")?.id);
});

test("published score snapshots pin their evidence and keep missing denominators explicit",async()=>{
 const {benchmarks,benchmarkResults}=await import("../lib/benchmarks.ts");
 const referenced=benchmarks.flatMap(b=>b.results);
 assert.equal(new Set(referenced).size,benchmarkResults.length);
 for(const group of benchmarkResults){
  const owner=benchmarks.find(b=>b.results.includes(group.id));
  assert.equal(group.benchmark_id,owner?.id);
  assert.ok(group.source_locator);
  assert.ok(group.sample_size===null||(Number.isInteger(group.sample_size)&&group.sample_size>0));
  assert.equal(group.tested_at,null); // Source publication/access dates are not execution dates.
  assert.equal(new Set(group.rows.map(r=>r.model)).size,group.rows.length);
  for(const row of group.rows)assert.ok(row.value>=0&&row.value<=100);
  if(!group.rows.length)continue;
  assert.ok(group.source_version);
  if(group.source_version?.startsWith("arXiv:"))assert.ok(group.url.includes(group.source_version.slice(6)));
  else assert.ok(group.url.includes(`/blob/${group.source_version}/`));
 }
 // The API-Bank Full candidate pool has 48 tools; it is not a sample denominator.
 assert.equal(benchmarkResults.find(r=>r.id==="zero-full")?.sample_size,null);
});

test("ToolBench uses the explicit README Win Rate table, not mixed CSV columns or self-comparison",async()=>{
 const {benchmarkResults}=await import("../lib/benchmarks.ts");
 const scores=benchmarkResults.find(r=>r.id==="toolbench-win")!;
 assert.match(scores.url,/README\.md#main-results$/);
 assert.match(scores.condition,/ChatGPT-ReACT/);
 assert.equal(scores.rows.find(r=>r.model==="ToolLLaMA-ReACT")?.value,47);
 assert.equal(scores.rows.find(r=>r.model==="GPT4-DFSDT")?.value,70.4);
 assert.ok(!scores.rows.some(r=>r.model==="ChatGPT-ReACT"));
});

test("author replay evidence distinguishes returned answers from task outcomes",()=>{
 const raw:unknown[]=JSON.parse(readFileSync(new URL("../content/author-replays.json",import.meta.url),"utf8"));
 const traces=raw.map(r=>replaySchema.parse(r));
 for(const trace of traces){
  assert.ok(trace.source_version&&trace.source_url?.includes(trace.source_version));
  assert.ok(trace.source_locator&&trace.verified_at);
  assert.ok(trace.evaluation?.source_url.includes(trace.source_version!));
  assert.ok(trace.events.every(e=>e.source_pointer));
  const calls=trace.events.filter(e=>e.type==="tool_call"||e.type==="retrieve");
  for(const result of trace.events.filter(e=>e.type==="tool_result"))assert.ok(calls.some(c=>c.call_id===result.call_id&&c.sequence<result.sequence));
 }
 const live=traces.find(r=>r.id==="live-arxiv")!;
 const call=live.events.find(e=>e.type==="tool_call")!;
 assert.equal(call.tool_name,"execute-tool");
 assert.deepEqual(call.arguments,{server_name:"mcp-simple-arxiv",tool_name:"get_paper_data",params:{paper_id:"2203.12277"}});
 assert.equal(live.evaluation?.basis,"author_evaluation");
 const toolbench=traces.find(r=>r.id==="toolbench-tree")!;
 assert.match(toolbench.task,/Gondrand/);
 assert.equal(toolbench.events.at(-1)?.status,"success"); // Finish returned; this does not grade the task.
 assert.equal(toolbench.evaluation?.status,"failure");
 assert.equal(toolbench.evaluation?.basis,"editorial_review");
});
