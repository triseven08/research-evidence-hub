import {z} from "zod";
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
const text=z.string().min(1).max(20000);
const nullableText=text.nullable();
const count=z.number().int().nonnegative();
const status=z.enum(["succeeded","task_failed","environment_failed","scoring_failed","not_run"]);
const url=z.string().url().refine(v=>v.startsWith("https://"),"来源必须使用 HTTPS");
export const replaySchema=z.object({
 id,origin:z.enum(["scripted_demo","recorded_run","author_record"]),title:text,task:text,benchmark:text,
 run_id:id.nullable(),task_id:id.nullable(),attempt_id:id.nullable(),model:nullableText,
 recorded_at:z.string().datetime({offset:true}).nullable(),article_ids:z.array(id),source_url:url.optional(),
 source_version:z.string().regex(/^[a-f0-9]{40}$/).optional(),source_locator:text.optional(),verified_at:z.string().date().optional(),
 evaluation:z.object({status:z.enum(["success","failure","unverified"]),basis:z.enum(["author_evaluation","editorial_review"]),summary:text,source_url:url,source_locator:text}).strict().optional(),
 events:z.array(z.object({id,sequence:z.number().int().positive(),type:z.enum(["retrieve","tool_call","tool_result","final_answer","error"]),title:text,tool_name:nullableText,arguments:z.record(z.unknown()),result:text,status:z.enum(["success","failure","pending"]),duration_ms:z.number().nonnegative().nullable(),call_id:id.optional(),depends_on:z.array(id).optional(),offset_ms:z.number().nonnegative().optional(),source_pointer:z.string().startsWith("/").optional()}).strict()).min(1).max(2000),
}).strict().superRefine((r,ctx)=>{
 if(r.origin==="recorded_run"&&(!r.run_id||!r.task_id||!r.attempt_id||!r.model||!r.recorded_at))ctx.addIssue({code:"custom",message:"真实回放必须关联运行、任务、尝试、模型和录制时间"});
 if(r.origin==="scripted_demo"&&(r.run_id||r.task_id||r.attempt_id||r.model||r.recorded_at))ctx.addIssue({code:"custom",message:"教学演示不能伪造真实运行元数据"});
 if(r.origin==="author_record"&&(!r.source_url||!r.task_id||!r.model||r.run_id||r.attempt_id))ctx.addIssue({code:"custom",message:"作者轨迹必须注明来源、任务和模型，不能关联团队运行"});
 const ids=new Set<string>();
 r.events.forEach((e,i)=>{if(ids.has(e.id)||e.sequence!==i+1)ctx.addIssue({code:"custom",message:"事件 ID 必须唯一，sequence 必须从 1 连续递增"});if(e.depends_on?.some(d=>!ids.has(d)))ctx.addIssue({code:"custom",message:"事件依赖必须指向之前的事件"});ids.add(e.id);});
});
export const experimentSchema=z.object({
 run_id:id,benchmark:text,upstream_commit:z.string().regex(/^[a-fA-F0-9]{7,40}$/),model:text,method:text,scorer:text,
 recorded_at:z.string().datetime({offset:true}),scope:z.enum(["subset","full"]),dataset:text,config:z.record(z.union([z.string(),z.number(),z.boolean(),z.null()])),
 summary:text,sources:z.array(z.object({title:text,url}).strict()).min(1),
 counts:z.object({planned:count,succeeded:count,task_failed:count,environment_failed:count,scoring_failed:count,not_run:count}).strict(),
 metrics:z.array(z.object({name:text,value:z.number(),unit:text,denominator:text}).strict()),
 tokens:count.nullable(),cost_usd:z.number().nonnegative().nullable(),
 tasks:z.array(z.object({task_id:id,attempt_id:id,status,summary:text,replay_id:id.nullable()}).strict()).min(1).max(100000),
}).strict().superRefine((r,ctx)=>{
 const c=r.counts;
 if(c.planned!==c.succeeded+c.task_failed+c.environment_failed+c.scoring_failed+c.not_run||c.planned!==r.tasks.length)ctx.addIssue({code:"custom",message:"计划数必须等于全部状态之和及任务条数"});
 for(const key of status.options)if(r.tasks.filter(t=>t.status===key).length!==c[key])ctx.addIssue({code:"custom",message:"逐题状态与汇总数不一致"});
 if(new Set(r.tasks.map(t=>t.task_id)).size!==r.tasks.length)ctx.addIssue({code:"custom",message:"每个任务仅保留本次评分采用的尝试，task_id 不可重复"});
});
export type Experiment=z.infer<typeof experimentSchema>;
export type Replay=z.infer<typeof replaySchema>;
export function validateBundle(input:unknown,articleIds:string[]){
 const data=z.object({experiment:experimentSchema,replays:z.array(replaySchema)}).strict().parse(input);
 const r=data.experiment;
 if(new Set(data.replays.map(p=>p.id)).size!==data.replays.length)throw new Error("回放 ID 重复");
 for(const p of data.replays){
  const task=r.tasks.find(t=>t.task_id===p.task_id&&t.attempt_id===p.attempt_id);
  if(p.origin!=="recorded_run"||p.run_id!==r.run_id||p.benchmark!==r.benchmark||p.model!==r.model||!task||task.replay_id!==p.id)throw new Error("回放与实际评分任务不匹配");
  if(p.article_ids.some(a=>!articleIds.includes(a)))throw new Error("关联文章不存在");
 }
 if(r.tasks.some(t=>t.replay_id&&!data.replays.some(p=>p.id===t.replay_id)))throw new Error("缺少任务引用的回放");
 const serialized=JSON.stringify(data);
 if(/sk-[a-zA-Z0-9]{12,}|Bearer\s+[a-zA-Z0-9._-]{12,}|-----BEGIN .*PRIVATE KEY|(?:api[_-]?key|authorization|password|cookie|access[_-]?token)"\s*:/i.test(serialized))throw new Error("检测到疑似凭证字段；请先脱敏原始记录");
 return data;
}
