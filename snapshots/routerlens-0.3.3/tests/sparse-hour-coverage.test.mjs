import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['lib/costAnomalyDays.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {queryAnomalyDays}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const options={timezone:'Asia/Shanghai',days:1,baseline_days:3,ratio_threshold:1.5,absolute_threshold_usd:1,reconcile_sparse_days:true};
const NOW=new Date('2026-10-11T02:00:00Z');
const reply=rows=>({data:{data:rows,metadata:{truncated:false,row_count:rows.length}}});
function source(change=()=>{}) {
 return async q=>{
  const initial=q.metrics.length===1&&q.metrics[0]==='total_usage';
  const all=q.metrics[0]==='total_request_count', hourly=q.granularity==='hour';
  let rows=[];
  for(let t=Date.parse(q.time_range.start);t<Date.parse(q.time_range.end);t+=hourly?3600000:86400000){
   if(hourly && new Date(t).getUTCHours()!==12) continue;
   const key=`${all?'created_at':'date'}__${q.granularity}`;
   rows.push({[key]:new Date(t).toISOString().slice(0,hourly?19:10),...(all?{total_request_count:2}:{total_usage:'0.1',...(initial?{}:{request_count:1})})});
  }
  const response=reply(rows);change(q,response,{initial,all,hourly});return response;
 };
}
test('independent daily controls restore sparse local days without altering exact cost',async()=>{
 const r=await queryAnomalyDays(options,source(),NOW);
 assert.equal(r.upstreamQueryCount,5);assert.equal(r.rows.length,4);assert.equal(r.unknownDays.length,0);
 assert.equal(r.reconciliation.reconciled_zero_hours,92);
 assert.ok(r.rows.every(r=>r.total_usage===0.1));
});
for(const [name,change] of [
 ['money mismatch',(q,r,c)=>{if(!c.initial&&!c.all&&!c.hourly)r.data.data[0].total_usage='0.100001';}],
 ['successful request mismatch',(q,r,c)=>{if(!c.initial&&!c.all&&!c.hourly)r.data.data[0].request_count=2;}],
 ['all request mismatch',(q,r,c)=>{if(c.all&&!c.hourly)r.data.data[0].total_request_count=3;}],
 ['snapshot changed',(q,r,c)=>{if(!c.initial&&!c.all&&c.hourly)r.data.data[0].total_usage='0.2';}],
 ['missing daily control',(q,r,c)=>{if(c.all&&!c.hourly){r.data.data.shift();r.data.metadata.row_count--;}}],
]) test(name+' retains affected days as unknown',async()=>{
 const r=await queryAnomalyDays(options,source(change),NOW);assert.ok(r.unknownDays.length>0);assert.ok(r.reconciliation.rejected_utc_days.length>0);
});
for(const [name,change] of [
 ['truncated',(q,r,c)=>{if(!c.initial)r.data.metadata.truncated=true;}],
 ['duplicate',(q,r,c)=>{if(!c.initial){r.data.data.push(r.data.data[0]);r.data.metadata.row_count++;}}],
 ['unexpected dimension',(q,r,c)=>{if(!c.initial)r.data.data[0].model='hidden';}],
 ['warnings',(q,r,c)=>{if(!c.initial)r.data.warnings=['partial'];}],
 ['negative cost',(q,r,c)=>{if(!c.initial&&!c.all)r.data.data[0].total_usage=-1;}],
 ['invalid count',(q,r,c)=>{if(!c.initial&&!c.all)r.data.data[0].request_count=1.5;}],
]) test(name+' control cannot supply zero hours',async()=>{
 const r=await queryAnomalyDays(options,source(change),NOW);assert.equal(r.rows.length,0);assert.equal(r.reconciliation.reconciled_zero_hours,0);
});
test('request-only missing cost hour remains unknown even with matching daily totals',async()=>{
 const r=await queryAnomalyDays(options,source((q,r,c)=>{if(c.all&&c.hourly){for(const row of r.data.data)row.created_at__hour=row.created_at__hour.replace('T12:','T13:');}}),NOW);
 assert.equal(r.rows.length,0);assert.equal(r.unknownDays.length,4);
});
test('current UTC control day stays incomplete before Shanghai 08:00',async()=>{
 const r=await queryAnomalyDays(options,source(),new Date('2026-10-10T18:00:00Z'));
 assert.ok(r.unknownDays.some(d=>d.date==='2026-10-10'));assert.ok(r.reconciliation.rejected_utc_days.some(d=>d.reason==='incomplete_utc_control_day'));
});
test('strict mode makes one read and retains sparse unknowns',async()=>{
 const r=await queryAnomalyDays({...options,reconcile_sparse_days:false},source(),NOW);assert.equal(r.upstreamQueryCount,1);assert.equal(r.rows.length,0);
});
test('31 local days split expanded UTC controls into bounded chunks',async()=>{
 let max=0;const mock=source();const r=await queryAnomalyDays({...options,days:28},async q=>{if(q.granularity==='hour')max=Math.max(max,(Date.parse(q.time_range.end)-Date.parse(q.time_range.start))/86400000);return mock(q);},NOW);
 assert.equal(r.upstreamQueryCount,9);assert.equal(max,31);assert.equal(r.rows.length,31);
});
test('unavailable auxiliary query preserves unknown rather than failing all analysis',async()=>{
 const mock=source();const r=await queryAnomalyDays(options,async q=>{if(q.metrics.length>1)throw Error('private upstream error');return mock(q);},NOW);
 assert.equal(r.rows.length,0);assert.equal(r.upstreamQueryCount,2);assert.ok(!JSON.stringify(r).includes('private upstream error'));
});
test('reconciled sparse series can detect a real cost spike',async()=>{
 const result=await build({entryPoints:['lib/analytics.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {analyzeCostSeries}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
 const r=await queryAnomalyDays(options,source((q,response,c)=>{if(!c.all)for(const row of response.data.data)if(String(row.date__hour??row.date__day).startsWith('2026-10-10'))row.total_usage='5';}),NOW);
 const analysis=analyzeCostSeries(r.rows,'total_usage','date__day',3,1.5,1,r.targetRange.startDate,r.targetRange.endDateExclusive);
 assert.equal(analysis.evaluatedDays,1);assert.equal(analysis.skippedDays,0);assert.equal(analysis.anomalies[0].value,5);assert.equal(analysis.anomalies[0].baseline,0.1);
});
test('empty responses are not independently verified zero days',async()=>{
 const r=await queryAnomalyDays(options,async()=>reply([]),NOW);assert.equal(r.rows.length,0);assert.equal(r.reconciliation.reconciled_zero_hours,0);
});
