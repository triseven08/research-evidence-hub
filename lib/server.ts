import { env } from "cloudflare:workers";
import { settings, type Env } from "./settings";
import { identity,digest } from "./identity";
import { ServiceError, type Database } from "./quota";
export async function context(request:Request) {
  const s=settings(env as unknown as Env,new URL(request.url).hostname);
  if(s.model!=="deepseek-flash")throw new ServiceError("SERVER_CONFIGURATION_REQUIRED",503);
  if(!env.DB)throw new ServiceError("QUOTA_STORAGE_UNAVAILABLE",503);
  let who;try{who=await identity(request,s.cookieSecret);}catch{throw new ServiceError("SERVER_CONFIGURATION_REQUIRED",503);}
  const ip=await digest(s.cookieSecret+":"+(request.headers.get("cf-connecting-ip")||"local"));
  return {s,db:env.DB as unknown as Database,...who,ip};
}
export const errorMessages:Record<string,string>={INVALID_INPUT:"请输入 1–2000 字的问题。",USER_QUOTA_EXCEEDED:"今日提问额度已用完，北京时间 00:00 恢复。",IP_QUOTA_EXCEEDED:"当前网络的提问次数较多，请稍后再试。",RATE_LIMITED:"提问有些频繁，请稍后再试。",SITE_QUOTA_EXCEEDED:"本站今日提问额度已用完，北京时间 00:00 恢复。",SITE_BUDGET_EXCEEDED:"本站今日生成预算已用完，明日恢复。",CONCURRENCY_LIMITED:"已有问题正在回答，请稍后再试。",MODEL_UNAVAILABLE:"答疑服务暂不可用，请稍后再试。",UPSTREAM_ERROR:"暂时未能取得回答，请稍后手动重试。",UPSTREAM_TIMEOUT:"回答超时，请稍后手动重试。",QUOTA_STORAGE_UNAVAILABLE:"提问服务暂不可用，知识内容仍可阅读。",INVALID_MODEL_RESPONSE:"回答未通过格式检查，本次没有展示未经核验的内容。",INVALID_MODEL_CITATIONS:"回答的引用未能核对，请稍后重试。",SERVER_CONFIGURATION_REQUIRED:"答疑服务尚未配置完成。",REQUEST_IN_PROGRESS:"这个问题正在处理，请稍候。",REQUEST_ALREADY_ATTEMPTED:"这次请求已经处理过，请重新发起问题。",IDEMPOTENCY_CONFLICT:"请求标识已使用，请重新发起问题。",ORIGIN_REJECTED:"页面环境校验失败，请刷新页面后重试。",BAD_REQUEST:"请求格式不正确，请刷新页面后重试。"};
export function errorResponse(e:unknown,cookie?:string) {const s=e instanceof ServiceError?e:new ServiceError("UPSTREAM_ERROR",503);return Response.json({error:{code:s.code,message:errorMessages[s.code]||"暂时无法完成请求。"},retry_after:s.retryAfter},{status:s.status,headers:{"Cache-Control":"no-store",...(cookie?{"Set-Cookie":cookie}:{}),...(s.status===429?{"Retry-After":String(s.retryAfter)}:{})}});}
