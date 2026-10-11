import { z } from 'zod';
import type { DB } from './storage';
import type { RouterLensToolClient } from './tools';

const modelId = z.string().regex(/^[A-Za-z0-9_.:-]+\/[A-Za-z0-9_./:-]+$/).max(160);
const slug = z.string().regex(/^[A-Za-z0-9_./:-]+$/).max(100);
const unique = (items:string[]) => new Set(items).size === items.length;
export const presetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  purpose: z.string().trim().max(240).default(''),
  enabled: z.boolean().default(true),
  model: modelId,
  fallback_models: z.array(modelId).max(3).default([]),
  temperature: z.number().finite().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(1000000).optional(),
  provider: z.object({
    order: z.array(slug).max(8).refine(unique).default([]),
    allow_fallbacks: z.boolean().default(true),
    sort: z.enum(['price','latency','throughput']).optional(),
    require_parameters: z.boolean().default(true),
    data_collection: z.enum(['allow','deny']).default('deny'),
    zdr: z.boolean().default(false)
  }).strict().default({})
}).strict().superRefine((p,ctx)=>{
  if (!unique([p.model,...p.fallback_models])) ctx.addIssue({code:'custom',message:'主模型和备用模型不能重复'});
  if (p.provider.order.length && p.provider.sort) ctx.addIssue({code:'custom',message:'供应商顺序与自动排序只能选择一种'});
  if (!p.provider.allow_fallbacks && !p.provider.order.length) ctx.addIssue({code:'custom',message:'限制供应商时至少指定一个供应商'});
});
export type Preset = z.infer<typeof presetSchema>;
export class RoutingError extends Error {}
const boundary = {production_change_performed:false,paid_inference_performed:false,scope:'routerlens_saved_configuration'};
export function compilePreset(p:Preset){
  const provider:any={...p.provider};if(!provider.order.length)delete provider.order;
  return {...(p.fallback_models.length?{models:[p.model,...p.fallback_models]}:{model:p.model}),
    ...(p.temperature===undefined?{}:{temperature:p.temperature}),...(p.max_tokens===undefined?{}:{max_tokens:p.max_tokens}),provider};
}
export class PresetStore {
  constructor(private db?:DB){}
  private database(){if(!this.db)throw new RoutingError('预设存储不可用，未保存。');return this.db;}
  async get(id:string,revision?:number){
    const row=await this.database().prepare(revision===undefined?'SELECT * FROM routing_presets WHERE id=? ORDER BY revision DESC LIMIT 1':'SELECT * FROM routing_presets WHERE id=? AND revision=?').bind(...(revision===undefined?[id]:[id,revision])).first();
    return row?{...row,config:presetSchema.parse(JSON.parse(row.config)),...boundary}:null;
  }
  async list(){const r=await this.database().prepare('SELECT p.* FROM routing_presets p WHERE revision=(SELECT MAX(revision) FROM routing_presets WHERE id=p.id) ORDER BY updated_at DESC LIMIT 100').all();return r.results.map((r:any)=>({id:r.id,revision:r.revision,updated_at:r.updated_at,config:presetSchema.parse(JSON.parse(r.config))}));}
  async history(id:string){const r=await this.database().prepare('SELECT revision,updated_at FROM routing_presets WHERE id=? ORDER BY revision DESC LIMIT 100').bind(id).all();return r.results;}
  async save(id:string,expected:number,config:Preset){
    // One atomic append prevents stale editors or concurrent MCP calls overwriting changes.
    const r=await this.database().prepare('INSERT INTO routing_presets(id,revision,updated_at,config) SELECT ?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM routing_presets WHERE id=?),0)=? ON CONFLICT(id,revision) DO NOTHING').bind(id,expected+1,new Date().toISOString(),JSON.stringify(config),id,expected).run();
    if(r.meta.changes!==1)throw new RoutingError('预设已被其他操作更新，请重新载入后再保存。');
    return this.get(id,expected+1);
  }
}
export async function previewPreset(p:Preset,client:RouterLensToolClient){
  const errors:string[]=[],warnings:string[]=[],models:any[]=[];
  if(!p.enabled)errors.push('此预设已停用，请启用并保存后再导出。');
  let catalog:any[];
  try {const r=await client.listModels();if(!Array.isArray(r?.data))throw new Error();catalog=r.data;}
  catch {return {...boundary,valid:false,validation_status:'unavailable',errors:['模型目录暂不可用，无法完成校验。'],warnings,request_fragment:null,models};}
  for(const id of [p.model,...p.fallback_models]){
    const m=catalog.find((r:any)=>r.id===id);
    if(!m){errors.push(id+' 不在当前模型目录中。');continue;}
    const params=Array.isArray(m.supported_parameters)?m.supported_parameters:null;
    for(const key of ['temperature','max_tokens'] as const)if(p[key]!==undefined){
      if(!params)warnings.push(id+' 未提供参数能力元数据。');
      else if(!params.includes(key))errors.push(id+' 未声明支持 '+key+'。');
    }
    const max=m.top_provider?.max_completion_tokens;
    if(p.max_tokens!==undefined&&typeof max==='number'&&p.max_tokens>max)errors.push(id+' 的输出上限低于设定值。');
    models.push({id,context_length:m.context_length??null,max_completion_tokens:max??null,supported_parameters:params});
  }
  if(p.provider.order.length){
    for(const model of models){
      try {
        const r=await client.getModelEndpoints(model.id);
        if(!Array.isArray(r?.data?.endpoints))throw new Error();
        const endpoints=r.data.endpoints;
        const matches=endpoints.filter((e:any)=>typeof e.tag==='string'&&p.provider.order.some(s=>e.tag===s||e.tag.startsWith(s+'/')));
        model.matched_provider_slugs=matches.map((e:any)=>e.tag);
        if(!matches.length){
          (p.provider.allow_fallbacks?warnings:errors).push(model.id+' 在指定供应商列表中没有匹配端点。');
        }else if(!p.provider.allow_fallbacks && p.provider.require_parameters){
          const eligible=matches.some((e:any)=>['temperature','max_tokens'].every(k=>p[k as 'temperature'|'max_tokens']===undefined||(Array.isArray(e.supported_parameters)&&e.supported_parameters.includes(k)))&&(p.max_tokens===undefined||typeof e.max_completion_tokens!=='number'||p.max_tokens<=e.max_completion_tokens));
          if(!eligible)errors.push(model.id+' 的指定供应商未提供满足参数的端点。');
        }
      }catch {errors.push(model.id+' 的供应商目录不可用，不能确认路由。');}
    }
  }
  warnings.push('校验只检查目录和参数，不保证账户权限、供应商可用性或调用成功；不会发送模型请求。');
  warnings.push('导出内容需由聊天后端与 messages 合并后使用；保存预设不会自动切换线上路由。');
  return {...boundary,valid:errors.length===0,validation_status:errors.length?'invalid':'metadata_checked',errors,warnings,models,request_fragment:errors.length?null:compilePreset(p)};
}
export function registerRouting(add:any,client:RouterLensToolClient,db?:DB){
  const store=new PresetStore(db),id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),revision=z.number().int().min(1).max(1000000);
  add('save_model_preset','Save a versioned personal routing preset; expected_revision=0 creates. No provider writes or inference. To restore, read an old revision and save it against the current revision.',{preset_id:id,expected_revision:z.number().int().min(0).max(999999),config:presetSchema},async(i:any)=>store.save(i.preset_id,i.expected_revision,i.config),true);
  add('list_model_presets','List the latest saved personal presets, including disabled presets.',{},async()=>({presets:await store.list(),...boundary}));
  add('get_model_preset','Read a preset or historical revision and revision history.',{preset_id:id,revision:revision.optional()},async(i:any)=>{const p=await store.get(i.preset_id,i.revision);if(!p)throw new RoutingError('未找到该预设或版本。');return {...p,history:await store.history(i.preset_id)};});
  add('preview_model_routing','Validate a configuration against current public model metadata and return an OpenRouter request fragment. Never executes the request or changes routing.',{config:presetSchema},async(i:any)=>previewPreset(i.config,client));
  add('export_model_preset','Validate and export an exact saved revision. No messages, credentials, inference or production routing changes.',{preset_id:id,revision},async(i:any)=>{const p=await store.get(i.preset_id,i.revision);if(!p)throw new RoutingError('未找到该版本。');return {preset_id:i.preset_id,revision:i.revision,...await previewPreset(p.config,client)};});
  add('get_routing_providers','Read current provider slugs and parameter support for a selected model.',{model_id:modelId},async(i:any)=>{
    const r=await client.getModelEndpoints(i.model_id);if(!Array.isArray(r?.data?.endpoints))throw new RoutingError('供应商目录暂不可用。');
    return {model_id:i.model_id,providers:r.data.endpoints.filter((e:any)=>typeof e.tag==='string').map((e:any)=>({slug:e.tag,name:e.provider_name,supported_parameters:e.supported_parameters??[],max_completion_tokens:e.max_completion_tokens??null})),...boundary};
  });
  add('search_routing_models','Search current public model IDs to configure a preset.',{query:z.string().trim().min(1).max(100),limit:z.number().int().min(1).max(30).default(15)},async(i:any)=>{const r=await client.listModels();if(!Array.isArray(r?.data))throw new RoutingError('模型目录暂不可用。');return {models:r.data.filter((m:any)=>typeof m.id==='string'&&m.id.toLowerCase().includes(i.query.toLowerCase())).slice(0,i.limit).map((m:any)=>({id:m.id,name:m.name,context_length:m.context_length??null})),...boundary};});
}
