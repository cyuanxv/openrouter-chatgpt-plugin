import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/costAttribution.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {explainCostAnomaly}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now=new Date('2026-10-11T02:00:00Z'),input={date:'2026-10-09',timezone:'Asia/Shanghai',baseline_days:7};
function source(change=()=>{}) {return async q=>{
 const baseline=Date.parse(q.time_range.end)-Date.parse(q.time_range.start)>86400000;
 const n=baseline?7:1,dim=q.dimensions?.[0];let rows=[];
 for(let i=0;i<n;i++){
  const stamp=new Date(Date.parse(q.time_range.start)+i*86400000).toISOString();
  const a={total_usage:baseline?1:10,request_count:baseline?1:4,tokens_prompt:baseline?100:4000,tokens_completion:baseline?10:40};
  const b={total_usage:baseline?1:2,request_count:1,tokens_prompt:100,tokens_completion:10};
  const add=(values,labels={})=>rows.push({date__hour:stamp,...values,...labels});
  if(dim==='model'){add(a,{model:'test/a'});add(b,{model:'test/b'});}
  else if(dim==='app')add(a,{app:'Example App'});
  else add(Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+b[k]])));
 }
 const response={data:{data:rows,metadata:{truncated:false,row_count:rows.length}}};change(q,response);return response;
};}
test('attributes spend to model, application, volume and input length using previous seven local days',async()=>{
 const r=await explainCostAnomaly(input,source(),now);assert.equal(r.status,'complete');assert.equal(r.account.current.total_usage,12);assert.equal(r.account.baseline_daily.total_usage,2);assert.equal(r.account.spend_ratio,6);
 const d=r.drivers[0];assert.equal(d.model,'test/a');assert.equal(d.increase_usd,9);assert.equal(d.request_ratio,4);assert.equal(d.input_tokens_per_request.current,1000);assert.equal(d.input_tokens_per_request.baseline,100);assert.equal(d.volume_contribution_usd,3);assert.equal(d.unit_cost_contribution_usd,6);
 assert.equal(r.apps.rows[0].app,'Example App');assert.equal(r.upstream_query_count,6);assert.equal(r.baseline_range.start,'2026-10-01T16:00:00.000Z');assert.match(r.summary_text,/此前 7 个完整自然日/);assert.doesNotThrow(()=>JSON.stringify(r));
});
for(const [name,mutate] of [
 ['model cost mismatch',(q,r)=>{if(q.dimensions?.[0]==='model')r.data.data[0].total_usage+=0.01;}],
 ['model token mismatch',(q,r)=>{if(q.dimensions?.[0]==='model')r.data.data[0].tokens_prompt++;}],
 ['truncated',(q,r)=>{r.data.metadata.truncated=true;}],
 ['empty',(q,r)=>{r.data.data=[];r.data.metadata.row_count=0;}],
 ['negative',(q,r)=>{r.data.data[0].total_usage=-1;}],
 ['fractional count',(q,r)=>{r.data.data[0].request_count=1.5;}],
 ['duplicate hour',(q,r)=>{r.data.data.push(r.data.data[0]);r.data.metadata.row_count++;}],
 ['unexpected field',(q,r)=>{r.data.data[0].prompt='must not leak';}],
 ['warning',(q,r)=>{r.data.warnings=['unresolved filter'];}],
 ['row count mismatch',(q,r)=>{r.data.metadata.row_count++;}],
])test(name+' cannot become a complete explanation',async()=>{await assert.rejects(explainCostAnomaly(input,source(mutate),now));});
test('application-only failure preserves reconciled model evidence and labels missing attribution',async()=>{
 const r=await explainCostAnomaly(input,source((q,r)=>{if(q.dimensions?.[0]==='app')r.data.metadata.truncated=true;}),now);
 assert.equal(r.status,'partial');assert.equal(r.apps.available,false);assert.equal(r.drivers[0].increase_usd,9);assert.match(r.summary_text,/应用归因不足/);
});
test('invalid or current dates and unsupported ranges reject before queries',async()=>{
 for(const bad of [{date:'2026-02-30'},{date:'2026-10-11'},{timezone:'America/New_York'},{baseline_days:31}])await assert.rejects(explainCostAnomaly({...input,...bad},async()=>{assert.fail('must not query')},now));
});
test('zero request denominators remain null, never Infinity',async()=>{
 const r=await explainCostAnomaly(input,source((q,r)=>{for(const row of r.data.data)row.request_count=0;}),now);assert.equal(r.drivers[0].request_ratio,null);assert.equal(r.drivers[0].cost_per_request.current,null);assert.ok(!JSON.stringify(r).includes('Infinity'));
});
test('application mismatch does not become attribution evidence',async()=>{
 const r=await explainCostAnomaly(input,source((q,r)=>{if(q.dimensions?.[0]==='app')r.data.data[0].total_usage=1e-9;}),now);assert.equal(r.apps.available,false);
});
test('thirty-day baselines stay within exact hourly window',async()=>{
 const r=await explainCostAnomaly({...input,baseline_days:30},source(),now);assert.equal(r.baseline_days,30);assert.equal(r.baseline_range.start,'2026-09-08T16:00:00.000Z');
});
