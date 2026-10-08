import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, createFetchMock } from 'miniflare';
const ownerHeaders={'oai-authenticated-user-id':'synthetic-site-owner','oai-authenticated-user-email':'owner@example.invalid'};
const base='https://routerlens.example.invalid';
async function runtime(t,key){
 const mock=createFetchMock();mock.disableNetConnect();
 const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-07-30',fetchMock:mock,bindings:key?{OPENROUTER_MANAGEMENT_KEY:'synthetic-key-only'}:{}});
 t.after(()=>mf.dispose());return{mf,mock};
}
function message(name,args={}){return {jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}};}
async function rpc(mf,body,headers=ownerHeaders){return mf.dispatchFetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-03-26',...headers},body:typeof body==='string'?body:JSON.stringify(body)});}

test('Worker discovery has eight tools and contains no account/configuration secrets',async t=>{
 const {mf}=await runtime(t,false);
 const list=await rpc(mf,{jsonrpc:'2.0',id:1,method:'tools/list'},{});
 assert.equal(list.status,200);const json=await list.json();assert.equal(json.result.tools.length,8);
 assert.doesNotMatch(JSON.stringify(json),/synthetic-key|example-owner-marker|total_credits/);
 const init=await rpc(mf,{jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic',version:'0'}}},{});
 assert.equal(init.status,200);
});
test('Worker rejects anonymous, service-only, and wrong-owner calls before upstream; missing Key is closed',async t=>{
 const {mf}=await runtime(t,false);
 for(const headers of [{},{'OAI-Sites-Authorization':'Bearer synthetic-service'},{...ownerHeaders,'oai-authenticated-user-email':'other@example.test'},{'oai-authenticated-user-email':ownerHeaders['oai-authenticated-user-email']}])assert.equal((await rpc(mf,message('get_account_summary'),headers)).status,403);
 const noKey=await rpc(mf,message('get_account_summary'));assert.equal(noKey.status,503);assert.equal(noKey.headers.get('cache-control'),'no-store');
 const status=await rpc(mf,message('routerlens_status'));assert.equal(status.status,200);assert.equal((await status.json()).result.structuredContent.management_key_configured,false);
 const page=await mf.dispatchFetch(base,{headers:ownerHeaders});assert.equal(page.status,200);assert.match(await page.text(),/等待配置服务密钥/);
 assert.equal((await mf.dispatchFetch(base)).status,403);
});
test('Worker owner credits and exact Beijing interval use only the fixed read allowlist',async t=>{
 const {mf,mock}=await runtime(t,true);const pool=mock.get('https://openrouter.ai');let credits=0,queries=0;
 pool.intercept({path:'/api/v1/credits',method:'GET',headers:{authorization:'Bearer synthetic-key-only'}}).reply(200,()=>{credits++;return {data:{total_credits:100,total_usage:15}};});
 pool.intercept({path:'/api/v1/analytics/meta',method:'GET'}).reply(200,{data:{metrics:[{name:'total_usage',display_format:'currency',is_rate:false}],dimensions:[],operators:[],granularities:[]}});
 pool.intercept({path:'/api/v1/analytics/query',method:'POST'}).reply(200,()=>{queries++;return {data:{data:[{date__hour:'2026-10-06 16:00:00',total_usage:2.5}],metadata:{truncated:false}}};});
 const account=await rpc(mf,message('get_account_summary',{include_spend_windows:false}));assert.equal(account.status,200);assert.equal((await account.json()).result.structuredContent.remaining_credits,85);
 const usage=await rpc(mf,message('query_usage',{time_range:{start:'2026-10-06T16:00:00Z',end:'2026-10-07T16:00:00Z'},timezone:'Asia/Shanghai'}));const result=await usage.json();assert.equal(result.result.structuredContent.totals.total_usage,2.5);assert.equal(credits,1);assert.equal(queries,1);
 mock.assertNoPendingInterceptors();
});
test('Worker Key tool returns allowlisted metadata and never echoes upstream diagnostics',async t=>{
 const {mf,mock}=await runtime(t,true);const pool=mock.get('https://openrouter.ai');
 pool.intercept({path:'/api/v1/keys?include_disabled=true&offset=0',method:'GET'}).reply(200,{data:[{hash:'synthetic-hash',usage:7,key:'synthetic-private-response-field'}]});
 const r=await rpc(mf,message('list_api_keys'));const text=await r.text();assert.doesNotMatch(text,/synthetic-private-response-field|synthetic-key-only/);assert.match(text,/synthetic-hash/);
 pool.intercept({path:'/api/v1/credits',method:'GET'}).reply(403,'synthetic-secret-diagnostic');
 const failed=await rpc(mf,message('get_account_summary',{include_spend_windows:false}));const error=await failed.text();assert.doesNotMatch(error,/synthetic-secret|synthetic-key/);assert.match(error,/rejected/);
 mock.assertNoPendingInterceptors();
});
test('Worker refuses malformed/deep/oversized input, unsupported methods and hostile browser origins',async t=>{
 const {mf}=await runtime(t,true);
 for(const body of ['{','[]','{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"x":'+ '['.repeat(20000)+'0'+']'.repeat(20000)+'}}',' '.repeat(256*1024+1)])assert.equal((await rpc(mf,body)).status,400);
 for(const method of ['HEAD','GET','DELETE'])assert.equal((await mf.dispatchFetch(base+'/mcp',{method,headers:ownerHeaders})).status,405);
 assert.equal((await rpc(mf,message('get_account_summary'),{...ownerHeaders,origin:'https://attacker.example.test'})).status,403);
 const batch=await rpc(mf,[{jsonrpc:'2.0',id:1,method:'ping'},message('get_account_summary')],{});assert.equal(batch.status,403);
});
test('Worker cannot follow upstream redirects or expose a secret through failed reads',async t=>{
 const {mf,mock}=await runtime(t,true);
 mock.get('https://openrouter.ai').intercept({path:'/api/v1/credits',method:'GET'}).reply(302,'',{headers:{location:'https://attacker.example.test/leak'}});
 const r=await rpc(mf,message('get_account_summary',{include_spend_windows:false}));const json=await r.json();assert.equal(json.result.isError,true);assert.doesNotMatch(JSON.stringify(json),/attacker|synthetic-key/);
 mock.assertNoPendingInterceptors();
});
