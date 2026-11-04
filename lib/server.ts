import { env } from "cloudflare:workers";
import { settings, type Env } from "./settings";
import { identity,digest } from "./identity";
import { ServiceError, type Database } from "./quota";
import { store as memoryStore } from "./store";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
// 本地开发默认密钥：仅在 localhost 且未配置 COOKIE_SECRET 时生效，生产环境不受影响。
const LOCAL_DEV_COOKIE_SECRET = "yanzhi-local-dev-cookie-secret-2026";
export async function context(request:Request) {
  const hostname=new URL(request.url).hostname;
  const local=LOCAL_HOSTS.includes(hostname)||process.env.NODE_ENV!=="production";
  const s=settings(env as unknown as Env,hostname);
  if(s.model!=="deepseek-flash")throw new ServiceError("SERVER_CONFIGURATION_REQUIRED",503);
  // 本地运行通常没有执行 D1 迁移；此时改用进程内存储，页面与提问都能直接跑通。
  // 需要与生产一致的 D1 行为时，在 .dev.vars 设置 QUOTA_STORE=d1。
  const quotaStore=(env as unknown as Record<string,string|undefined>).QUOTA_STORE;
  const useD1=!!env.DB&&(!local||quotaStore==="d1");
  const db:Database=useD1?(env.DB as unknown as Database):memoryStore;
  const cookieSecret=s.cookieSecret||(local?LOCAL_DEV_COOKIE_SECRET:"");
  let who;try{who=await identity(request,cookieSecret);}catch{throw new ServiceError("SERVER_CONFIGURATION_REQUIRED",503);}
  const ip=await digest(cookieSecret+":"+(request.headers.get("cf-connecting-ip")||"local"));
  return {s,db,...who,ip};
}
export const errorMessages:Record<string,string>={INVALID_INPUT:"请输入 1–2000 字的问题。",INPUT_CONTEXT_TOO_LONG:"问题超出当前上下文预算，请缩短后重试。",USER_QUOTA_EXCEEDED:"今日提问额度已用完，北京时间 00:00 恢复。",IP_QUOTA_EXCEEDED:"当前网络的提问次数较多，请稍后再试。",RATE_LIMITED:"提问有些频繁，请稍后再试。",SITE_QUOTA_EXCEEDED:"本站今日提问额度已用完，北京时间 00:00 恢复。",SITE_BUDGET_EXCEEDED:"本站今日生成预算已用完，明日恢复。",CONCURRENCY_LIMITED:"已有问题正在回答，请稍后再试。",MODEL_UNAVAILABLE:"答疑服务暂不可用，请稍后再试。",UPSTREAM_ERROR:"暂时没有拿到回答，请重试。",UPSTREAM_TIMEOUT:"回答超时，请重试。",QUOTA_STORAGE_UNAVAILABLE:"提问服务暂不可用，知识内容仍可阅读。",INVALID_MODEL_RESPONSE:"回答格式异常，请重试。",INVALID_MODEL_CITATIONS:"回答的引用无法核对，请重试。",SERVER_CONFIGURATION_REQUIRED:"答疑服务尚未配置完成。",REQUEST_IN_PROGRESS:"这个问题正在处理，请稍候。",REQUEST_ALREADY_ATTEMPTED:"这次请求已经处理过，请重新发起问题。",IDEMPOTENCY_CONFLICT:"请求标识已使用，请重新发起问题。",ORIGIN_REJECTED:"页面环境校验失败，请刷新页面后重试。",BAD_REQUEST:"请求格式不正确，请刷新页面后重试。"};
export function errorResponse(e:unknown,cookie?:string) {const s=e instanceof ServiceError?e:new ServiceError("UPSTREAM_ERROR",503);return Response.json({error:{code:s.code,message:errorMessages[s.code]||"暂时无法完成请求。"},retry_after:s.retryAfter},{status:s.status,headers:{"Cache-Control":"no-store",...(cookie?{"Set-Cookie":cookie}:{}),...(s.status===429?{"Retry-After":String(s.retryAfter)}:{})}});}
