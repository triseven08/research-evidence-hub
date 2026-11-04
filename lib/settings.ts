export type Settings = ReturnType<typeof settings>;
export type Env = Record<string, string | undefined>;
const bounded=(value:string|undefined,fallback:number,min:number,max:number)=>{const n=Number(value);return value!==undefined&&Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback;};
export function settings(env:Env={},hostname="") {
  const testing=env.APP_ENV==="testing" && ["localhost","127.0.0.1","[::1]"].includes(hostname);
  const choose=(prod:string,test:string,fallback:number,testFallback:number)=>bounded(env[testing?test:prod],testing?testFallback:fallback,1,100000);
  return {
    testing, key:env.DEEPSEEK_API_KEY||"",cookieSecret:env.COOKIE_SECRET||"",model:env.DEEPSEEK_MODEL||"deepseek-flash",
    userDay:choose("API_USER_DAILY_LIMIT","API_TEST_USER_DAILY_LIMIT",100,1000), userMinute:choose("API_USER_MINUTE_LIMIT","API_TEST_USER_MINUTE_LIMIT",3,20),
    ipDay:choose("API_IP_DAILY_LIMIT","API_TEST_IP_DAILY_LIMIT",500,3000),ipMinute:choose("API_IP_MINUTE_LIMIT","API_TEST_IP_MINUTE_LIMIT",10,60),siteDay:choose("API_SITE_DAILY_LIMIT","API_TEST_SITE_DAILY_LIMIT",1000,3000),
    userConcurrency:bounded(env.API_USER_CONCURRENCY,1,1,2),siteConcurrency:bounded(env.API_SITE_CONCURRENCY,2,1,5),
    budgetMicro: Math.round(Math.max(0,Math.min(5,Number(env.API_SITE_DAILY_BUDGET_USD||5)||0))*1_000_000),
    inputBudget:bounded(env.API_CONTEXT_MAX_TOKENS,12000,512,12000),outputCap:bounded(env.DEEPSEEK_MAX_OUTPUT_TOKENS,2000,128,2000),
    maxQuestion:bounded(env.API_QUESTION_MAX_CHARS,2000,50,2000),timeoutMs:bounded(env.API_TIMEOUT_SECONDS,30,5,30)*1000,
  };
}
export function dayBucket(now=Date.now()) { return new Date(now+8*60*60*1000).toISOString().slice(0,10); }
export function resetAt(now=Date.now()) { const shifted=new Date(now+8*60*60*1000); return new Date(Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate()+1)-8*60*60*1000).toISOString(); }
export function reservation(s:Settings) { return Math.ceil(s.inputBudget*0.30 + s.outputCap*1.20); }
