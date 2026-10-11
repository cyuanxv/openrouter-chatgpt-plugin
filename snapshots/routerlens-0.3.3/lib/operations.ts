import { registerRouting, RoutingError } from './routing';
import { z } from 'zod';
import { registerRouterLensTools, type RouterLensToolClient } from './tools';
import { Store, type DB } from './storage';
import { addCalendarDays, dateStringInZone, startOfDayUtc } from './time';
import { publicErrorMessage, PublicError, OpenRouterError } from './errors';
import { requiredNumber } from './analytics';
import { explainCostAnomaly } from './costAttribution';

const zone=z.enum(['UTC','Asia/Shanghai']).default('Asia/Shanghai');
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{try{return new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v}catch{return false}},'Invalid calendar date');
const id=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/);
const model=z.string().regex(/^[A-Za-z0-9_.:-]+\/[A-Za-z0-9_./:-]+$/).max(160);
const finite=z.number().finite().nonnegative();
const common={timezone:zone,end_date:date.optional()};
const ro={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
function errorResult(error:any){return {isError:true,content:[{type:'text',text:error instanceof RoutingError?error.message:error instanceof z.ZodError?'Invalid input. Check dates, identifiers and numeric bounds.':error?.message==='STORAGE_UNAVAILABLE'?'Persistent storage is unavailable. No record was saved.':(error instanceof PublicError||error instanceof OpenRouterError)?publicErrorMessage(error):'Operation failed. No successful result is inferred.'}]};}
export function completedRange(days:number,timezone:string,endDate?:string,now=new Date()){
 const today=dateStringInZone(now,timezone),end=endDate??today;
 date.parse(end);if(end>today)throw new PublicError('INVALID_RANGE');
 const start=addCalendarDays(end,-days);
 return {start:startOfDayUtc(start,timezone).toISOString(),end:startOfDayUtc(end,timezone).toISOString(),start_date:start,end_date:end,timezone,period_complete:true};
}
function boundedRange(start:string,end:string,timezone:string){const d=(Date.parse(end)-Date.parse(start))/86400000;if(!Number.isInteger(d)||d<1||d>31)throw new PublicError('INVALID_RANGE');return {start:startOfDayUtc(start,timezone).toISOString(),end:startOfDayUtc(end,timezone).toISOString()};}
function total(x:any,metric:string){return x?.totals_complete===true&&x.rows.length>0&&typeof x.totals?.[metric]==='number'?x.totals[metric]:null;}
function change(current:number|null,previous:number|null){return {current,previous,increase:current===null||previous===null?null:current-previous,percent:current===null||previous===null||previous<=0?null:(current-previous)/previous*100};}
function money(v:any){return typeof v==='number'?'$'+v.toFixed(4):'未知';}
export function normalizeGeneration(response:any,id:string){
 const row=response?.data??response;if(!row||row.id!==id)throw new PublicError('INVALID_RESPONSE');
 const out:any={id};
 for(const k of ['created_at','model','provider_name','finish_reason','native_finish_reason','api_type'])if(typeof row[k]==='string')out[k]=row[k].slice(0,240);
 for(const k of ['total_cost','usage','tokens_prompt','tokens_completion','native_tokens_prompt','native_tokens_completion','native_tokens_reasoning','native_tokens_cached','latency','generation_time'])if(row[k]!=null)out[k]=requiredNumber(row[k]);
 for(const k of ['cancelled','streamed','is_byok'])if(typeof row[k]==='boolean')out[k]=row[k];
 return {...out,content_included:false,source:'generation_metadata'};
}
export function summarizeExperiment(experiment:any){
 const {plan,observations}=experiment;
 const variants=[plan.baseline_model,...plan.candidate_models];
 const common=observations.filter((r:any)=>r.variant===variants[0]).map((r:any)=>r.case_id).filter((c:string)=>variants.every(v=>observations.some((r:any)=>r.case_id===c&&r.variant===v)));
 const summaries=variants.map(v=>{
  const all=observations.filter((r:any)=>r.variant===v),rows=all.filter((r:any)=>common.includes(r.case_id));
  const accepted=rows.filter((r:any)=>r.success&&r.quality_pass).length,cost=rows.reduce((s:number,r:any)=>s+r.cost_usd,0);
  return {model:v,recorded_cases:all.length,paired_cases:rows.length,quality_accepted_cases:accepted,quality_acceptance_rate:rows.length?accepted/rows.length:null,total_cost_usd:cost,cost_per_accepted_case:accepted?cost/accepted:null,latency_ms_mean:rows.length&&rows.every((r:any)=>r.latency_ms!==null)?rows.reduce((s:number,r:any)=>s+r.latency_ms,0)/rows.length:null};
 });
 const spent=observations.reduce((s:number,r:any)=>s+r.cost_usd,0);
 return {id:experiment.id,plan,observations,summaries,paired_case_count:common.length,unpaired_observations:observations.filter((r:any)=>!common.includes(r.case_id)).length,total_recorded_cost_usd:spent,budget_exceeded:spent>plan.budget_usd,comparison_ready:common.length>=plan.minimum_cases,quality_source:'owner_manual_review',cost_sources:[...new Set(observations.map((r:any)=>r.source))],production_change_performed:false,paid_inference_performed:false,recommendation:common.length<plan.minimum_cases?'Collect matched cases before comparing.':'Review quality acceptance and cost per accepted case together. No automatic production switch.'};
}
export function createOperations(client:RouterLensToolClient,db?:DB,now:()=>Date=()=>new Date()){
 const legacy=new Map<string,any>();registerRouterLensTools({registerTool:(n:string,s:any,h:any)=>legacy.set(n,{s,h})},client);
 const invoke=async(n:string,input:any)=>{const t=legacy.get(n);const r=await t.h(z.object(t.s.inputSchema).parse(input));if(r.isError)throw new PublicError('INCOMPLETE_ANALYTICS');return r.structuredContent;};
 const store=new Store(db);const tools=new Map<string,any>();
 const add=(name:string,description:string,schema:any,run:any,write=false)=>tools.set(name,{name,description,inputSchema:schema,annotations:{...ro,readOnlyHint:!write},run});
 const query=(range:any,dimensions:string[]=[],limit=1000,filters:any[]=[])=>invoke('query_usage',{time_range:{start:range.start,end:range.end},metrics:['total_usage','request_count','tokens_prompt','tokens_completion'],dimensions,filters,limit,order_by:{field:'total_usage',direction:'desc'}});
 const optional=async(fn:()=>Promise<any>)=>{try{return {available:true,data:await fn()}}catch{return {available:false,reason:'Upstream access, completeness or schema unavailable; not zero.'}}};
 const generation=async(gid:string)=>{if(!client.getGeneration)throw new Error('UNAVAILABLE');return normalizeGeneration(await client.getGeneration(gid),gid);};
 add('list_call_records','List bounded OpenRouter request metadata by generation ID. Dates are start inclusive/end exclusive; defaults to yesterday. No prompt content, no inferred zero, no invented pagination.',{timezone:zone,start_date:date.optional(),end_date:date.optional(),model:model.optional(),provider:z.string().min(1).max(160).optional(),api_key_id:id.optional(),finish_reason:z.string().min(1).max(80).optional(),limit:z.number().int().min(1).max(100).default(30)},async(i:any)=>{
  const end=i.end_date??dateStringInZone(now(),i.timezone),start=i.start_date??addCalendarDays(end,-1);const range=boundedRange(start,end,i.timezone);
  const filters=['model','provider','api_key_id','finish_reason'].filter(k=>i[k]).map(k=>({field:k,operator:'eq',value:i[k]}));
  const result=await invoke('query_usage',{time_range:range,metrics:['total_usage','request_count','tokens_prompt','tokens_completion'],dimensions:['generation_id','model'],granularity:'hour',filters,limit:i.limit,order_by:{field:'total_usage',direction:'desc'}});
  const records=result.rows.map((row:any)=>({generation_id:typeof row.generation_id==='string'?row.generation_id.slice(0,160):null,model:typeof row.model==='string'?row.model.slice(0,160):null,total_usage:requiredNumber(row.total_usage),request_count:requiredNumber(row.request_count),tokens_prompt:requiredNumber(row.tokens_prompt),tokens_completion:requiredNumber(row.tokens_completion),timestamp_utc_hour:typeof (row.date__hour??row.created_at__hour)==='string'?(row.date__hour??row.created_at__hour).slice(0,40):null}));
  return {range:result.range,totals:result.totals,totals_scope:result.totals_scope,totals_complete:result.totals_complete,truncated:result.truncated,time_bucket_timezone:'UTC',timezone:i.timezone,records,scope:'bounded_returned_records',pagination_supported:false,content_included:false,next_step:result.truncated?'Narrow the time range or use exact model/provider/API-key filters.':'Use a generation_id for metadata details.'};
 });
 add('get_call_detail','Read allowlisted metadata for one existing generation. Returns cost, tokens, timing and finish reason; never prompt/reply text. Credential-specific access may be unavailable.',{generation_id:id},async(i:any)=>generation(i.generation_id));
 add('investigate_spend','Compare a completed day with another completed day; attribute changes to model/provider. API-key labels are returned per hour and must not be treated as unique IDs.',{timezone:zone,date:date.optional(),compare_date:date.optional()},async(i:any)=>{
  const day=i.date??addCalendarDays(dateStringInZone(now(),i.timezone),-1),previous=i.compare_date??addCalendarDays(day,-1);
  const r=completedRange(1,i.timezone,addCalendarDays(day,1),now()),p=completedRange(1,i.timezone,addCalendarDays(previous,1),now());
  const [a,b,models,providers,keys]=await Promise.all([query(r),query(p),optional(()=>query(r,['model'])),optional(()=>invoke('query_usage',{time_range:{start:r.start,end:r.end},granularity:'hour',dimensions:['provider'],metrics:['total_usage','request_count'],limit:100,order_by:{field:'total_usage',direction:'desc'}})),optional(()=>invoke('query_usage',{time_range:r,granularity:'hour',dimensions:['api_key_id'],metrics:['total_usage','request_count'],limit:100,order_by:{field:'total_usage',direction:'desc'}}))]);
  return {range:r,comparison_range:p,spend:change(total(a,'total_usage'),total(b,'total_usage')),requests:change(total(a,'request_count'),total(b,'request_count')),models,providers,api_key_hourly_evidence:keys,key_identity_warning:'Returned key labels may be shared; use verified key IDs for filters. Hourly rows are not account-wide key rankings.',cause_status:'attribution_evidence_not_proven_cause',next_step:'Filter list_call_records by the high-cost model/provider or verified API-key ID, then get_call_detail.'};
 });
 add('explain_cost_anomaly','Explain a completed day against the preceding complete-day mean using reconciled model and app contributions plus request/input/output changes. Read-only metadata, no proven causal claims.',{timezone:zone,date:date.optional(),baseline_days:z.number().int().min(3).max(30).default(7)},async(i:any)=>explainCostAnomaly({...i,date:i.date??addCalendarDays(dateStringInZone(now(),i.timezone),-1)},client.queryAnalytics,now()));
 add('generate_cost_report','Generate and save an idempotent weekly report or daily alert from completed periods. Returns message text for approved Telegram delivery. Saving does not send; claim and record delivery separately.',{...common,kind:z.enum(['weekly','daily_alert']).default('weekly')},async(i:any)=>{
  const range=completedRange(i.kind==='weekly'?7:1,i.timezone,i.end_date,now());const rid=`${i.kind}:${i.timezone.replace('/','_')}:${range.end_date}`;
  const existing=await store.report(rid);if(existing)return existing;
  const previous=completedRange(i.kind==='weekly'?7:1,i.timezone,range.start_date,now());
  const [current,prior,models,providers,anomalies]=await Promise.all([optional(()=>query(range)),optional(()=>query(previous)),optional(()=>query(range,['model'],10)),optional(()=>invoke('query_usage',{time_range:{start:range.start,end:range.end},granularity:'hour',dimensions:['provider'],metrics:['total_usage','request_count'],limit:100,order_by:{field:'total_usage',direction:'desc'}})),optional(()=>invoke('analyze_cost_anomalies',{timezone:i.timezone,days:i.kind==='weekly'?7:1,baseline_days:7}))]);
  // The anomaly tool uses current time, so historical reports must not attach a different window's anomalies.
  const anomalyEvidence=range.end_date===dateStringInZone(now(),i.timezone)?anomalies:{available:false,reason:'Historical anomaly window not queried.'};
  const spend=change(current.available?total(current.data,'total_usage'):null,prior.available?total(prior.data,'total_usage'):null);
  const assessment=!anomalyEvidence.available||!anomalyEvidence.data.evaluated_days?'unknown':anomalyEvidence.data.anomalies.length?'candidate':'no_candidates';
  const candidates=anomalyEvidence.available?[...anomalyEvidence.data.anomalies].sort((a:any,b:any)=>b.absoluteIncrease-a.absoluteIncrease):[];
  const attributions=[];
  // Bound report latency. Failure to attribute never hides an anomaly.
  for(const candidate of candidates.slice(0,3)){attributions.push({date:candidate.date,...await optional(()=>explainCostAnomaly({date:candidate.date,timezone:i.timezone,baseline_days:7},client.queryAnalytics,now()))});}
  const priorAlert=i.kind==='daily_alert'?await store.report(`daily_alert:${i.timezone.replace('/','_')}:${range.start_date}`):null;
  const notify=i.kind==='weekly'||assessment==='candidate'||((assessment==='unknown'||spend.current===null)&&priorAlert?.payload?.assessment!=='unknown');
  const lines=[`RouterLens ${i.kind==='weekly'?'费用周报':'异常检查'}`,`${range.start_date} 至 ${range.end_date}（结束日不含，${i.timezone}）`,`费用：${money(spend.current)}；上期：${money(spend.previous)}`,`变化：${money(spend.increase)}${spend.percent===null?'':`（${spend.percent.toFixed(1)}%）`}`,`异常状态：${assessment==='unknown'?'数据不足，无法判断':assessment==='candidate'?'发现费用上涨候选，需排查':'本次可评估日期未发现候选异常'}`];
  if(models.available){lines.push(`主要模型（${models.data.totals_complete?'返回结果完整':'仅返回的部分记录'}）：`);for(const row of models.data.rows.slice(0,3))lines.push(`${row.model}: ${money(row.total_usage)}`);}
  if(anomalyEvidence.available)lines.push(`已评估 ${anomalyEvidence.data.evaluated_days} 天，跳过 ${anomalyEvidence.data.skipped_days} 天。`);
  for(const item of attributions)lines.push(item.available?item.data.summary_text:`${item.date} 归因数据不足，异常候选仍需排查。`);
  if(candidates.length>3)lines.push(`另有 ${candidates.length-3} 个异常日期，可按日期查询归因。`);
  lines.push('缺失数据不视为零；金额为查询时观察值，非最终结算。');
  return store.saveReport(rid,i.kind,{range,comparison_range:previous,spend,current,prior,models,providers,anomalies:anomalyEvidence,attributions,attribution_omitted_days:Math.max(0,candidates.length-3),assessment,should_notify:notify,telegram_text:lines.join('\n').slice(0,3500),generated_at:now().toISOString()});
 },true);
 add('list_cost_reports','List saved reports and delivery states. No query or notification is executed.',{limit:z.number().int().min(1).max(50).default(20)},async(i:any)=>({reports:await store.reports(i.limit)}));
 add('get_cost_report','Read a saved report including its completeness and delivery evidence.',{report_id:id},async(i:any)=>{const r=await store.report(i.report_id);if(!r)throw new Error('NOT_FOUND');return r;});
 add('claim_report_delivery','Atomically claim a pending report before its approved Telegram send. Send only if claimed=true and should_notify=true. A stuck/unknown send must not be retried automatically.',{report_id:id},async(i:any)=>{const r=await store.report(i.report_id);if(!r?.payload.should_notify)return {claimed:false,reason:'No notification required'};return store.claim(i.report_id);},true);
 add('record_report_delivery','Record an actual Telegram send receipt or uncertain failure for a claimed report. Does not send; never mark sent without a real receipt.',{report_id:id,state:z.enum(['sent','unknown']),message_id:id.optional()},async(i:any)=>{if(i.state==='sent'&&!i.message_id)throw new Error('RECEIPT_REQUIRED');return store.delivered(i.report_id,i.state,i.message_id??null);},true);
 add('create_cost_experiment','Save a bounded experiment plan. Runs no model and changes no routing. Record results only after separately authorized trials or existing request review.',{experiment_id:id,baseline_model:model,candidate_models:z.array(model).min(1).max(3),budget_usd:finite.max(100),minimum_cases:z.number().int().min(5).max(100).default(20),quality_criteria:z.string().min(5).max(1000)},async(i:any)=>{
  if(new Set([i.baseline_model,...i.candidate_models]).size!==i.candidate_models.length+1)throw new Error('DUPLICATE');
  const existing=await store.experiment(i.experiment_id);if(existing){if(JSON.stringify(existing.plan)!==JSON.stringify({...i,paid_inference_requires_separate_approval:true}))throw new Error('EXPERIMENT_ID_CONFLICT');return summarizeExperiment(existing);}
  return summarizeExperiment(await store.saveExperiment(i.experiment_id,{...i,paid_inference_requires_separate_approval:true}));
 },true);
 add('record_experiment_result','Save metadata and owner-reviewed quality for a matched case. A generation ID reads actual cost/model; without it, supplied costs are explicitly manual evidence. Does not run inference.',{experiment_id:id,case_id:id,variant:model,generation_id:id.optional(),cost_usd:finite.max(10000).optional(),latency_ms:finite.max(3600000).optional(),quality_pass:z.boolean(),success:z.boolean()},async(i:any)=>{
  const ex=await store.experiment(i.experiment_id);if(!ex||![ex.plan.baseline_model,...ex.plan.candidate_models].includes(i.variant))throw new Error('INVALID_EXPERIMENT');
  const row={...i,source:'manual_reported'};
  if(i.generation_id){const g=await generation(i.generation_id);if(g.model!==i.variant||g.total_cost==null||g.total_cost<0)throw new Error('INVALID_GENERATION');Object.assign(row,{cost_usd:g.total_cost,latency_ms:g.latency??null,source:'generation_metadata'});}
  if(row.cost_usd===undefined)throw new Error('COST_REQUIRED');
  if(ex.observations.length>=400&&!ex.observations.some((r:any)=>r.case_id===i.case_id&&r.variant===i.variant))throw new Error('RECORD_LIMIT');
  await store.observation(i.experiment_id,row);return summarizeExperiment(await store.experiment(i.experiment_id));
 },true);
 add('get_cost_experiment','Compare matched cases by owner-reviewed quality, actual/manual costs and latency. Includes unmatched cases and budget status; never performs a production switch.',{experiment_id:id},async(i:any)=>{const ex=await store.experiment(i.experiment_id);if(!ex)throw new Error('NOT_FOUND');return summarizeExperiment(ex);});
 add('list_cost_experiments','List saved experiment plans.',{},async()=>({experiments:await store.experiments()}));
 registerRouting(add,client,db);
 return {tools,async call(name:string,args:unknown){const t=tools.get(name);if(!t)return {isError:true,content:[{type:'text',text:'Unknown operation.'}]};try{const data=await t.run(z.object(t.inputSchema).strict().parse(args));return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}catch(e){return errorResult(e);}}};
}
export function registerOperations(server:any,ops:ReturnType<typeof createOperations>){for(const t of ops.tools.values())server.registerTool(t.name,{title:t.name,description:t.description,inputSchema:t.inputSchema,annotations:t.annotations},(i:any)=>ops.call(t.name,i));}
