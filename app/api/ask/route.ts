import { context,errorResponse } from "../../../lib/server";
import { ask } from "../../../lib/ask";
import { ServiceError } from "../../../lib/quota";
export async function POST(request:Request){let cookie:string|undefined;try{
  // AI Works 反向代理会改写 request.url，浏览器同源请求会被误判为跨站（403）。
  // 同时接受 x-forwarded-host / host 构造的来源；跨站 Origin 仍然拒绝。
  const origin=request.headers.get("origin");
  if(origin){
    const allowed=new Set([new URL(request.url).origin]);
    const host=request.headers.get("x-forwarded-host")||request.headers.get("host");
    const proto=request.headers.get("x-forwarded-proto")||"https";
    if(host)for(const p of [proto,"https","http"])allowed.add(p+"://"+host);
    if(!allowed.has(origin))throw new ServiceError("ORIGIN_REJECTED",403);
  }
  if(!request.headers.get("content-type")?.includes("application/json"))throw new ServiceError("BAD_REQUEST",400);
  const reader=request.body?.getReader();if(!reader)throw new ServiceError("BAD_REQUEST",400);let size=0;const parts:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16000){await reader.cancel();throw new ServiceError("BAD_REQUEST",400);}parts.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const p of parts){all.set(p,offset);offset+=p.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(all));}catch{throw new ServiceError("BAD_REQUEST",400);}
  if(!body||typeof body.question!=="string"||typeof body.request_id!=="string"||!/^[a-zA-Z0-9-]{12,80}$/.test(body.request_id)||body.article_id!==undefined&&typeof body.article_id!=="string")throw new ServiceError("BAD_REQUEST",400);
  const c=await context(request);cookie=c.cookie;
  const result=await ask(c.db,c.s,{question:body.question,articleId:body.article_id,requestId:body.request_id},c.visitor,c.ip);
  return Response.json(result,{headers:{"Set-Cookie":cookie,"Cache-Control":"no-store"}});
}catch(e){return errorResponse(e,cookie);}}
