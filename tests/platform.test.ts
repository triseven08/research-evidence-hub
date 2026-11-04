import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync,type SQLInputValue} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {settings,dayBucket,resetAt,reservation} from "../lib/settings.ts";
import {reserve,settle,usage,type Database,type Statement} from "../lib/quota.ts";
import {ask,validateAnswer,prepareEvidence,referenceNotice} from "../lib/ask.ts";
import {retrieve,articles,paths} from "../lib/content.ts";
import {identity} from "../lib/identity.ts";

class SqlStatement implements Statement {
 db:DatabaseSync;sql:string;values:SQLInputValue[]=[];
 constructor(db:DatabaseSync,sql:string){this.db=db;this.sql=sql;}
 bind(...values:unknown[]){this.values=values as SQLInputValue[];return this;}
 async first<T>(){return this.db.prepare(this.sql).get(...this.values) as T||null;}
 async run(){return this.execute();}
 execute(){return this.db.prepare(this.sql).run(...this.values);}
}
class LocalDatabase implements Database {
 sql=new DatabaseSync(":memory:");
 constructor(){for(const migration of readdirSync(new URL("../drizzle",import.meta.url)).filter(n=>n.endsWith(".sql")).sort())this.sql.exec(readFileSync(new URL("../drizzle/"+migration,import.meta.url),"utf8"));}
 prepare(sql:string){return new SqlStatement(this.sql,sql);}
 async batch(statements:SqlStatement[]){this.sql.exec("BEGIN IMMEDIATE");try{const out=statements.map(s=>s.execute());this.sql.exec("COMMIT");return out;}catch(e){this.sql.exec("ROLLBACK");throw e;}}
}
const s=()=>({...settings({COOKIE_SECRET:"a".repeat(32),DEEPSEEK_API_KEY:"test-key"}),userConcurrency:10,siteConcurrency:10,userMinute:100,ipMinute:100});
const params=(id:string,visitor="visitor",now=Date.now())=>({id,visitor,ip:"ip-"+visitor,signature:"sig",now});
const failCode=(code:string)=>(e:unknown)=>!!e&&typeof e==="object"&&"code" in e&&e.code===code;

test("testing quota requires a loopback hostname; budget cannot exceed approved $5",()=>{
 assert.equal(settings({APP_ENV:"testing"},"localhost").userDay,1000);
 assert.equal(settings({APP_ENV:"testing"},"example.com").userDay,100);
 assert.equal(settings({API_SITE_DAILY_BUDGET_USD:"999"}).budgetMicro,5_000_000);
 assert.equal(settings().outputCap,2000);
});
test("Beijing date bucket resets at 16:00 UTC, independent of host timezone",()=>{
 const before=Date.parse("2026-11-03T15:59:59Z"),after=Date.parse("2026-11-03T16:00:00Z");
 assert.equal(dayBucket(before),"2026-11-03");assert.equal(dayBucket(after),"2026-11-04");assert.equal(resetAt(before),"2026-11-03T16:00:00.000Z");
});
test("daily quota is atomic when two requests compete for the last slot",async()=>{
 const db=new LocalDatabase(),config={...s(),userDay:1};
 const results=await Promise.allSettled([reserve(db,params("a"),config),reserve(db,params("b"),config)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal((await usage(db,"visitor",config)).remaining,0);
});
test("minute, IP, site and concurrency limits enforce their own boundaries",async()=>{
 for(const [override,expected] of [[{userMinute:1},"RATE_LIMITED"],[{siteDay:1},"SITE_QUOTA_EXCEEDED"],[{userConcurrency:1},"CONCURRENCY_LIMITED"]] as const){const db=new LocalDatabase(),config={...s(),...override};await reserve(db,params("a"),config);await assert.rejects(reserve(db,params("b"),config),failCode(expected));}
 const db=new LocalDatabase(),config={...s(),ipDay:1};await reserve(db,{...params("a","one"),ip:"shared"},config);await assert.rejects(reserve(db,{...params("b","two"),ip:"shared"},config),failCode("IP_QUOTA_EXCEEDED"));
});
test("unknown-cost timeout keeps the reservation and count while freeing concurrency",async()=>{
 const db=new LocalDatabase(),config={...s(),budgetMicro:reservation(s()),userConcurrency:1};await reserve(db,params("a"),config);await settle(db,"a",null,null,"UPSTREAM_TIMEOUT");
 assert.equal((await usage(db,"visitor",config)).remaining,config.userDay-1);
 await assert.rejects(reserve(db,params("b"),config),failCode("SITE_BUDGET_EXCEEDED"));
});
test("settlement returns unused cost allowance; a new day restores daily count",async()=>{
 const db=new LocalDatabase(),config={...s(),userDay:1,budgetMicro:reservation(s())};const now=Date.parse("2026-11-03T15:59:59Z");await reserve(db,params("a","visitor",now),config);await settle(db,"a",10,{ok:true});
 await reserve(db,params("b","visitor",now+1001),config);assert.equal((await usage(db,"visitor",config,now+1001)).remaining,0);
});
test("idempotency reuses settled answer and refuses a different signature",async()=>{
 const db=new LocalDatabase(),config=s();await reserve(db,params("a"),config);await settle(db,"a",10,{status:"answered",answer:"已完成"});
 assert.deepEqual((await reserve(db,params("a"),config)).duplicate,{status:"answered",answer:"已完成"});await assert.rejects(reserve(db,{...params("a"),signature:"different"},config),failCode("IDEMPOTENCY_CONFLICT"));
});
test("expired in-flight request stops holding concurrency without refunding cost",async()=>{
 const db=new LocalDatabase(),config={...s(),userConcurrency:1};const now=Date.now();await reserve(db,params("a","visitor",now-100000),config);await reserve(db,params("b","visitor",now),config);
 const row=await db.prepare("SELECT state FROM requests WHERE id='a'").first<{state:string}>();assert.equal(row?.state,"unknown");
});
test("signed visitor cookie is stable and tampering creates a new identity",async()=>{
 const secret="c".repeat(32);const first=await identity(new Request("https://example.com"),secret);const cookie=first.cookie.split(";")[0];const second=await identity(new Request("https://example.com",{headers:{cookie}}),secret);assert.equal(first.visitor,second.visitor);const tampered=await identity(new Request("https://example.com",{headers:{cookie:cookie+"x"}}),secret);assert.notEqual(first.visitor,tampered.visitor);assert.ok(first.cookie.includes("HttpOnly"));assert.ok(first.cookie.includes("Secure"));
});
test("all learning paths and sources refer to real approved content",()=>{
 assert.equal(articles.length,12);for(const id of ["livemcpbench","toolbench","humanmcp","mcp-zero"])assert.ok(articles.some(a=>a.href===`/benchmarks/${id}`));for(const p of paths)for(const id of p.ids)assert.ok(articles.some(a=>a.id===id));for(const a of articles){assert.ok(a.sources.length);for(const source of a.sources)assert.equal(new URL(source.url).protocol,"https:");}
});
const questions:[string,string][]=[
 ["Agent 与固定工作流有什么区别？","what-is-agent"],["模型提出工具调用后谁执行？","tool-calling"],["MCP Server 和一个 tool 有什么不同？","mcp-architecture"],["工具很多时为什么要检索？","tool-discovery"],["单任务多步和用户多轮有什么区别？","planning"],["并行工具调用适合什么条件？","planning"],["单步准确率能否代表任务成功率？","reading-benchmarks"],["Skill、记忆和上下文有什么区别？","context-and-skills"],["子集成绩能不能当作全量榜单？","reading-benchmarks"],["资料如何通过 RAG 提供给闭源模型？","context-and-skills"]];
test("10 annotated learning questions retrieve target evidence in top five",()=>{const failures=questions.filter(([q,id])=>!retrieve(q).some(c=>c.articleId===id));assert.ok(failures.length<=1,JSON.stringify(failures));});
test("specific Chinese tags retrieve matching body evidence, not just adjacent sections",()=>{
 for(const [q,id] of [["并行调用什么时候合适，什么时候会出错？","planning#dependency"],["LiveMCPBench 主要关注什么能力？","reading-benchmarks#two-benchmarks"]])assert.ok(prepareEvidence(q,retrieve(q),s().inputBudget).chunks.some(c=>c.id===id));
});
test("evidence packing bounds full prompt and accepts only supplied citations",()=>{
 const budget=s().inputBudget;const chunks=retrieve("MCP Server 与工具的区别");const e=prepareEvidence("MCP Server 与工具的区别",chunks,budget);assert.ok(e.chunks.length);assert.ok(new TextEncoder().encode(e.messages.map(m=>m.content).join("")).length<=budget-128);
 assert.throws(()=>validateAnswer(JSON.stringify({status:"answered",basis:"knowledge",answer:"不可靠 [S99]",citations:["S99"]}),e.chunks),failCode("INVALID_MODEL_CITATIONS"));
 assert.throws(()=>validateAnswer(JSON.stringify({status:"answered",basis:"knowledge",answer:"没有出处",citations:[]}),e.chunks),failCode("INVALID_MODEL_CITATIONS"));
});
test("cached answer performs no second model call and consumes only one generation",async()=>{
 const db=new LocalDatabase(),config=s();let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{calls++;const body=JSON.parse(init?.body as string);assert.deepEqual(body.thinking,{type:"disabled"});assert.equal(body.max_tokens,2000);assert.equal(body.tools,undefined);return Response.json({choices:[{message:{content:JSON.stringify({status:"answered",basis:"knowledge",answer:"MCP 的 Server 可以提供多个工具。[S1]",citations:["S1"]})}}],usage:{prompt_tokens:100,completion_tokens:50}});};
 const first=await ask(db,config,{question:"MCP Server 与工具的区别",requestId:"request-first"},"v","ip",fetcher);const second=await ask(db,config,{question:"MCP Server 与工具的区别",requestId:"request-second"},"v","ip",fetcher);assert.equal(calls,1);assert.equal(first.status,"answered");assert.equal(second.cached,true);assert.equal(second.quota.remaining,config.userDay-1);
});
test("malformed citations still account for a billed attempt",async()=>{
 const db=new LocalDatabase(),config=s();const fetcher:typeof fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({status:"answered",basis:"knowledge",answer:"错 [S99]",citations:["S99"]})}}],usage:{prompt_tokens:100,completion_tokens:20}});
 await assert.rejects(ask(db,config,{question:"MCP Server 与工具的区别",requestId:"request-bad-cites"},"v","ip",fetcher),failCode("INVALID_MODEL_CITATIONS"));assert.equal((await usage(db,"v",config)).remaining,config.userDay-1);
});

test("greetings and project introductions call the model with trusted project context and can be cached without citations",async()=>{
 for(const [question,basis,text] of [["你好","general","你好！有什么想了解的？"],["介绍一下你的功能","project","我可以解释 Agent、工具调用和 MCP，推荐学习路径。"],["介绍一下知识库有什么内容","project","知识库包含 Agent 基础、工具调用、MCP 协议、规划与上下文、评测与前沿。"]]){
  const db=new LocalDatabase(),config=s();let calls=0;
  const fetcher:typeof fetch=async(_url,init)=>{
   calls++;const body=JSON.parse(init?.body as string);const prompt=body.messages[0].content;
   assert.equal(body.messages[0].role,"system");assert.ok(prompt.includes("研知台"));assert.ok(prompt.includes("预录"));
   for(const a of articles)assert.ok(prompt.includes(a.title));for(const p of paths)assert.ok(prompt.includes(p.title));
   assert.ok(body.messages[1].content.includes(question));
   return Response.json({choices:[{message:{content:JSON.stringify({status:"answered",basis,answer:text,citations:[]})}}],usage:{prompt_tokens:100,completion_tokens:20}});
  };
  const first=await ask(db,config,{question,requestId:"request-intro-first"},"v","ip",fetcher);
  const second=await ask(db,config,{question,requestId:"request-intro-second"},"v","ip",fetcher);
  assert.equal(calls,1);assert.equal(first.basis,basis);assert.equal(first.answer,text);assert.deepEqual(first.citations,[]);assert.equal(second.cached,true);assert.equal(second.quota.remaining,config.userDay-1);
 }
});

test("missing research evidence still calls the model, adds a reference notice and preserves quota and cache behavior",async()=>{
 const question="反事实信用归因";assert.equal(retrieve(question).length,0);
 const db=new LocalDatabase(),config=s();let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{
  calls++;const body=JSON.parse(init?.body as string);assert.ok(body.messages[1].content.includes("未检索到可用片段"));
  return Response.json({choices:[{message:{content:JSON.stringify({status:"answered",basis:"reference",answer:"这需要区分物理机制与协作流程，不能仅凭概念类比得出结论。",citations:[]})}}],usage:{prompt_tokens:100,completion_tokens:20}});
 };
 const first=await ask(db,config,{question,requestId:"request-reference-first"},"v","ip",fetcher);
 const second=await ask(db,config,{question,requestId:"request-reference-second"},"v","ip",fetcher);
 assert.equal(calls,1);assert.equal(first.status,"answered");assert.equal(first.basis,"reference");assert.ok(first.answer.startsWith(referenceNotice));assert.equal(second.answer,first.answer);assert.equal(second.cached,true);assert.equal(second.quota.remaining,config.userDay-1);
 await assert.rejects(ask(new LocalDatabase(),{...config,budgetMicro:0},{question:"你好",requestId:"request-no-budget"},"v","ip",fetcher),failCode("SITE_BUDGET_EXCEEDED"));assert.equal(calls,1);
});

test("unrelated or partial evidence does not force citations, and fabricated references are rejected in every mode",()=>{
 const chunks=retrieve("MCP Server 与工具的区别");assert.ok(chunks.length);
 const project=validateAnswer(JSON.stringify({status:"answered",basis:"project",answer:"研知台有知识库、学习路径和 Benchmark 展示。",citations:[]}),chunks);assert.equal(project.answer.includes(referenceNotice),false);
 const partial=validateAnswer(JSON.stringify({status:"answered",basis:"reference",answer:"片段介绍了 Server。[S1] 进一步的研究方案需要另行验证。",citations:["S1"]}),chunks);assert.ok(partial.answer.startsWith(referenceNotice));assert.equal(partial.citations[0].article_id,chunks[0].articleId);
 for(const basis of ["knowledge","project","general","reference"])assert.throws(()=>validateAnswer(JSON.stringify({status:"answered",basis,answer:"错误引用 [S99]",citations:["S99"]}),chunks),failCode("INVALID_MODEL_CITATIONS"));
 assert.throws(()=>validateAnswer(JSON.stringify({status:"answered",basis:"knowledge",answer:"假装有依据 [S1]",citations:["S1"]}),[]),failCode("INVALID_MODEL_CITATIONS"));
 assert.throws(()=>validateAnswer(JSON.stringify({status:"answered",basis:"other",answer:"回答",citations:[]}),[]),failCode("INVALID_MODEL_RESPONSE"));
 const repeated=validateAnswer(JSON.stringify({status:"answered",basis:"reference",answer:referenceNotice+"\n\n说明。",citations:[]}),[]);assert.equal(repeated.answer.split(referenceNotice).length,2);
});

test("the full prompt fits the input reservation, including maximum Chinese question and empty evidence",()=>{
 const budget=s().inputBudget;
 for(const q of ["你好","介绍一下知识库有什么内容","问".repeat(s().maxQuestion)]){
  const e=prepareEvidence(q,retrieve(q),budget);assert.ok(new TextEncoder().encode(e.messages.map(m=>m.content).join("")).length<=budget-128);
 }
 assert.throws(()=>prepareEvidence("你好",[],512),failCode("INPUT_CONTEXT_TOO_LONG"));
});
test("upstream timeout does not automatically retry and preserves unknown fee",async()=>{
 const db=new LocalDatabase(),config=s();let calls=0;const fetcher:typeof fetch=async()=>{calls++;throw new DOMException("timed out","TimeoutError");};await assert.rejects(ask(db,config,{question:"MCP Server 与工具的区别",requestId:"request-timeout"},"v","ip",fetcher),failCode("UPSTREAM_TIMEOUT"));assert.equal(calls,1);const row=await db.prepare("SELECT state,reserved_micro FROM requests").first<{state:string;reserved_micro:number}>();assert.equal(row?.state,"unknown");assert.equal(row?.reserved_micro,reservation(config));
});
test("unavailable quota storage fails before any paid generation",async()=>{
 const broken={prepare(){throw new Error("offline");},batch(){throw new Error("offline");}} as Database;let calls=0;await assert.rejects(ask(broken,s(),{question:"MCP Server 与工具的区别",requestId:"request-storage"},"v","ip",async()=>{calls++;return Response.json({});}));assert.equal(calls,0);
});
