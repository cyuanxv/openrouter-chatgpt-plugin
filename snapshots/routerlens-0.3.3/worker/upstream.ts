import { OpenRouterError, PublicError } from '../lib/errors';
import type { AnalyticsQuery } from '../lib/openrouter';
import type { RouterLensToolClient } from '../lib/tools';

export function makeReadClient(key: string | undefined, transport: typeof fetch = fetch): RouterLensToolClient {
  async function call(path: string, options: { private?: boolean; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {}) {
    if (options.private && (!key || /\s/.test(key))) throw new PublicError('MISSING_MANAGEMENT_KEY');
    const url = new URL(`https://openrouter.ai/api/v1${path}`);
    for (const [name,value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(name,String(value));
    const response = await transport(url, { method: options.body === undefined ? 'GET' : 'POST',
      headers: { Accept:'application/json', ...(options.private ? { Authorization:`Bearer ${key}` } : {}), ...(options.body === undefined ? {} : {'Content-Type':'application/json'}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body), signal:AbortSignal.timeout(20_000), redirect:'manual', cache:'no-store' });
    if (!response.ok) throw new OpenRouterError(response.status);
    // Bound upstream memory independently of an untrusted Content-Length.
    if (!response.body) throw new PublicError('INVALID_RESPONSE');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const {done,value} = await reader.read(); if(done) break; size += value.byteLength; if(size > 4*1024*1024) throw new PublicError('INVALID_RESPONSE'); chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const result = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if (!result || typeof result !== 'object') throw new Error('shape');
      return result;
    } catch (error) { if(error instanceof PublicError) throw error; throw new PublicError('INVALID_RESPONSE'); }
    finally { void reader.cancel().catch(()=>{}); }
  }
  return Object.freeze({
    getCredits:()=>call('/credits',{private:true}),
    getAnalyticsMeta:()=>call('/analytics/meta',{private:true}),
    queryAnalytics:(query:AnalyticsQuery)=>call('/analytics/query',{private:true,body:query}),
    listKeys:(input={})=>call('/keys',{private:true,query:input}),
    listModels:(input={})=>call('/models',{query:input}),
    getModelEndpoints:(modelId:string)=>{const [author,...parts]=modelId.split('/');if(!author||!parts.length)throw new PublicError('INVALID_MODEL_ID');return call(`/models/${encodeURIComponent(author)}/${encodeURIComponent(parts.join('/'))}/endpoints`);},
    status:()=>({management_key_configured:Boolean(key),mode:'sites-owner-private',authentication_verified:true})
  });
}
