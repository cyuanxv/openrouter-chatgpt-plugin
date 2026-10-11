import { requiredNumber } from './analytics';
import { decimalCost, decimalCostNumber, compareDecimalCost, sumDecimalCosts } from './decimalCost';
import { validateExactHourlyRows } from './exactRange';
import { PublicError } from './errors';
import type { AnalyticsQuery } from './openrouter';
import { addCalendarDays, dateStringInZone, startOfDayUtc } from './time';
const METRICS=['total_usage','request_count','tokens_prompt','tokens_completion'];
type Totals={total_usage:number;request_count:number;tokens_prompt:number;tokens_completion:number;cost_exact:ReturnType<typeof decimalCost>};
const ratio=(a:number,b:number)=>b>0&&Number.isFinite(a/b)?a/b:null;
const label=(v:unknown)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120):'未标记';
const money=(v:number)=>'$'+v.toFixed(4);
function count(v:unknown){const n=requiredNumber(v);if(!Number.isSafeInteger(n)||n<0)throw new PublicError('INVALID_RESPONSE');return n;}
function summarize(rows:Record<string,unknown>[]):Totals{
 const exact=sumDecimalCosts(rows.map(r=>r.total_usage));
 return {total_usage:decimalCostNumber(exact),cost_exact:exact,request_count:count(rows.reduce((n,r)=>n+count(r.request_count),0)),tokens_prompt:count(rows.reduce((n,r)=>n+count(r.tokens_prompt),0)),tokens_completion:count(rows.reduce((n,r)=>n+count(r.tokens_completion),0))};
}
const publicTotals=({cost_exact,...rest}:Totals)=>rest;
function same(a:Totals,b:Totals){return compareDecimalCost(a.cost_exact,b.cost_exact)===0&&METRICS.slice(1).every(k=>a[k as keyof Totals]===b[k as keyof Totals]);}
function group(rows:Record<string,unknown>[],field:string){const map=new Map<string,Record<string,unknown>[]>();for(const row of rows){const key=typeof row[field]==='string'?row[field] as string:'未标记';map.set(key,[...(map.get(key)??[]),row]);}return new Map([...map].map(([key,rs])=>[key,summarize(rs)]));}
export async function explainCostAnomaly(input:{date:string;timezone:string;baseline_days?:number},run:(q:AnalyticsQuery)=>Promise<any>,now=new Date()){
 const days=input.baseline_days??7,day=input.date,zone=input.timezone;
 if(!['UTC','Asia/Shanghai'].includes(zone)||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||day>=dateStringInZone(now,zone)||!Number.isInteger(days)||days<3||days>30)throw new PublicError('INVALID_RANGE');
 const period=(from:string,to:string)=>({start:startOfDayUtc(from,zone).toISOString(),end:startOfDayUtc(to,zone).toISOString()});
 const target=period(day,addCalendarDays(day,1)),baseline=period(addCalendarDays(day,-days),day);
 let queryCount=0;
 const read=async(range:typeof target,dimensions:string[]=[],filters:AnalyticsQuery['filters']=[])=>{
  const q:AnalyticsQuery={metrics:METRICS,dimensions,filters,granularity:'hour',time_range:range,limit:10000,group_limit:10000};queryCount++;
  const rows=validateExactHourlyRows(q,await run(q));
  for(const row of rows){if(Object.keys(row).some(k=>!['date__hour',...dimensions,...METRICS].includes(k)))throw new PublicError('INVALID_RESPONSE');if(decimalCost(row.total_usage).coefficient<0n)throw new PublicError('INVALID_RESPONSE');}
  // Empty controls do not prove an unused account or an absent model.
  if(!rows.length)throw new PublicError('INCOMPLETE_ANALYTICS');
  summarize(rows);return rows;
 };
 const [currentRows,priorRows,currentModels,priorModels]=await Promise.all([read(target),read(baseline),read(target,['model']),read(baseline,['model'])]);
 const current=summarize(currentRows),prior=summarize(priorRows);
 if(!same(current,summarize(currentModels))||!same(prior,summarize(priorModels)))throw new PublicError('INCOMPLETE_ANALYTICS');
 const curr=group(currentModels,'model'),prev=group(priorModels,'model'),zero=summarize([]),increase=current.total_usage-prior.total_usage/days;
 const drivers=[...new Set([...curr.keys(),...prev.keys()])].map(model=>{
  const a=curr.get(model)??zero,b=prev.get(model)??zero,delta=a.total_usage-b.total_usage/days;
  const unitA=ratio(a.total_usage,a.request_count),unitB=ratio(b.total_usage,b.request_count);
  const volume=unitB===null?null:(a.request_count-b.request_count/days)*unitB;
  return {model:label(model),model_id:model,current:publicTotals(a),baseline_daily:Object.fromEntries(METRICS.map(k=>[k,Number(b[k as keyof Totals])/days])),increase_usd:delta,increase_share:increase>0?delta/increase:null,current_spend_share:ratio(a.total_usage,current.total_usage),request_ratio:ratio(a.request_count,b.request_count/days),input_tokens_per_request:{current:ratio(a.tokens_prompt,a.request_count),baseline:ratio(b.tokens_prompt,b.request_count)},output_tokens_per_request:{current:ratio(a.tokens_completion,a.request_count),baseline:ratio(b.tokens_completion,b.request_count)},cost_per_request:{current:unitA,baseline:unitB},volume_contribution_usd:volume,unit_cost_contribution_usd:volume===null?null:delta-volume};
 }).sort((a,b)=>b.increase_usd-a.increase_usd);
 const top=drivers.find(d=>d.increase_usd>0&&d.current.total_usage>0);
 let apps:any={available:false,reason:'No positive model contribution'};
 if(top){
  try{
   const filter=[{field:'model',operator:'eq',value:top.model_id}];
   const [ar,br]=await Promise.all([read(target,['app'],filter),read(baseline,['app'],filter)]);
   if(!same(summarize(ar),curr.get(top.model_id)!)||!same(summarize(br),prev.get(top.model_id)??zero))throw new PublicError('INCOMPLETE_ANALYTICS');
   const a=group(ar,'app'),b=group(br,'app');
   apps={available:true,model:top.model,identity:'display_labels_not_unique_ids',rows:[...new Set([...a.keys(),...b.keys()])].map(name=>({app:label(name),current_usd:(a.get(name)??zero).total_usage,baseline_daily_usd:(b.get(name)??zero).total_usage/days})).sort((x,y)=>y.current_usd-x.current_usd).slice(0,3)};
  }catch{apps={available:false,reason:'App controls unavailable, empty or mismatched; not zero'};}
 }
 const lines=[`${day} 自动归因：当日 ${money(current.total_usage)}，此前 ${days} 个完整自然日日均 ${money(prior.total_usage/days)}，增加 ${money(increase)}。`];
 if(top){
  lines.push(`主要增量模型 ${top.model}：增加 ${money(top.increase_usd)}${top.increase_share===null?'':`，占净增量 ${(top.increase_share*100).toFixed(1)}%`}。`);
  const ip=top.input_tokens_per_request,op=top.output_tokens_per_request;
  lines.push(`请求 ${top.current.request_count} 次（基线日均 ${top.baseline_daily.request_count.toFixed(1)}）；平均输入 ${ip.current===null?'未知':Math.round(ip.current)} / 基线 ${ip.baseline===null?'未知':Math.round(ip.baseline)} token；平均输出 ${op.current===null?'未知':Math.round(op.current)} / 基线 ${op.baseline===null?'未知':Math.round(op.baseline)} token。`);
  lines.push(apps.available?`该模型主要应用：${apps.rows.map((a:any)=>`${a.app} ${money(a.current_usd)}`).join('；')}。`:'应用归因不足，不能视为零。');
 }else lines.push('未发现正向模型费用增量。');
 lines.push('以上为账单贡献与用量变化，不证明具体用户行为或历史价格变化。');
 return {date:day,timezone:zone,baseline_days:days,target_range:target,baseline_range:baseline,status:apps.available?'complete':'partial',account:{current:publicTotals(current),baseline_daily:Object.fromEntries(METRICS.map(k=>[k,Number(prior[k as keyof Totals])/days])),increase_usd:increase,spend_ratio:ratio(current.total_usage,prior.total_usage/days)},drivers:drivers.slice(0,10).map(({model_id,...d})=>d),apps,upstream_query_count:queryCount,summary_lines:lines,summary_text:lines.join('\n'),evidence_scope:'complete_returned_hourly_records_reconciled_to_account_controls',decomposition_policy:'Volume first at baseline cost per request; remainder is unit cost change. Not causal attribution.',privacy:'No prompt, completion content or credential is read.'};
}
