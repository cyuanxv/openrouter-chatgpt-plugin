import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerRouterLensTools } from '../lib/tools';
import { makeReadClient } from './upstream';
import { page } from './page';

// PLACEHOLDER ONLY: replace for your own deployment behind a trusted identity dispatcher.
// The platform must authenticate and overwrite these headers; never trust public client headers.
const OWNER_EMAIL = 'owner@example.invalid';
const SITE_ORIGIN = 'https://routerlens.example.invalid';
type Env = { OPENROUTER_MANAGEMENT_KEY?: string };
const noStore = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply = (status:number,error:string) => Response.json({error},{status,headers:noStore});
const owner = (request:Request) => Boolean(request.headers.get('oai-authenticated-user-id')?.trim()) && request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase() === OWNER_EMAIL;
async function body(request:Request):Promise<unknown> {
  if(!request.body)throw new Error('parse');
  const reader=request.body.getReader(); const chunks:Uint8Array[]=[];let bytes=0;
  const timeout=AbortSignal.timeout(5000);
  let interrupt:(()=>void)|undefined;
  const stopped=new Promise<never>((_,reject)=>{interrupt=()=>reject(new Error('timeout'));timeout.addEventListener('abort',interrupt,{once:true});});
  try {
    while(true){const {done,value}=await Promise.race([reader.read(),stopped]);if(done)break;bytes+=value.byteLength;if(bytes>256*1024)throw new Error('size');chunks.push(value);}
    const buffer=new Uint8Array(bytes);let position=0;for(const c of chunks){buffer.set(c,position);position+=c.byteLength;}
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
    const pending=[{value:parsed,depth:1}];
    while(pending.length){const item=pending.pop()!;if(item.depth>64||(typeof item.value==='number'&&!Number.isFinite(item.value)))throw new Error('shape');if(item.value&&typeof item.value==='object')for(const value of Object.values(item.value))pending.push({value,depth:item.depth+1});}
    const messages=Array.isArray(parsed)?parsed:[parsed];if(!messages.length||messages.length>100||!messages.every(value=>JSONRPCMessageSchema.safeParse(value).success))throw new Error('shape');
    return parsed;
  } finally {if(interrupt)timeout.removeEventListener('abort',interrupt);void reader.cancel().catch(()=>{});}
}

export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    try {
      const url=new URL(request.url);
      if(url.pathname==='/'){
        if(request.method!=='GET')return reply(405,'method_not_allowed');
        if(!owner(request))return reply(403,'owner_required');
        return new Response(page(Boolean(env.OPENROUTER_MANAGEMENT_KEY)),{headers:{...noStore,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors https://chatgpt.com"}});
      }
      if(url.pathname!=='/mcp')return reply(404,'not_found');
      if(request.method!=='POST')return reply(405,'method_not_allowed');
      const origin=request.headers.get('origin');if(origin&&origin!==SITE_ORIGIN&&origin!=='https://chatgpt.com')return reply(403,'origin_not_allowed');
      if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply(415,'json_required');
      let parsed:any;
      try{parsed=await body(request);}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid or oversized MCP request.'}},{status:400,headers:noStore});}
      const messages=Array.isArray(parsed)?parsed:[parsed];
      // Public protocol discovery contains definitions only. Every tool execution
      // requires a real platform user; service bypass alone cannot read bills.
      const calls=messages.filter(message=>message.method==='tools/call');
      if(calls.length&&!owner(request))return reply(403,'owner_required');
      if(calls.some(message=>message.params?.name!=='routerlens_status'&&message.params?.name!=='compare_models')&&!env.OPENROUTER_MANAGEMENT_KEY)return reply(503,'management_key_not_configured');
      const server=new McpServer({name:'RouterLens Private Billing',version:'0.1.1'});
      const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      // The explicit client prevents the original module's environment fallback.
      registerRouterLensTools(server,makeReadClient(env.OPENROUTER_MANAGEMENT_KEY));
      await server.connect(transport);
      try {
        const response=await transport.handleRequest(request,{parsedBody:parsed});
        const bytes=await response.arrayBuffer();
        const headers=new Headers(response.headers);for(const[k,v]of Object.entries(noStore))headers.set(k,v);
        return new Response(bytes,{status:response.status,headers});
      }finally{await server.close();}
    }catch{return reply(500,'request_failed');}
  }
};
