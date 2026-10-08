import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
async function moduleFrom(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { queryExactRange } = await moduleFrom('lib/exactRange.ts');
const { requireCompleteAnalytics } = await moduleFrom('lib/analytics.ts');
const { registerRouterLensTools } = await moduleFrom('lib/tools.ts');
const range = { start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z' };
const query = { metrics: ['total_usage'], time_range: range };
const rows = [{ total_usage: 4 }];
const reply = (metadata, data = rows) => ({ data: { data, metadata } });
const invalid = e => e.code === 'INVALID_RESPONSE';

for (const count of [0, 2, -1, 1.5, null, true, '', {}, Number.MAX_SAFE_INTEGER + 1]) {
  test(`UTC query rejects contradictory/invalid row_count ${JSON.stringify(count)}`, async () => {
    await assert.rejects(queryExactRange(query, async () => reply({ truncated: false, row_count: count }), () => true), invalid);
  });
}
test('nested and flat envelopes accept matching numeric or numeric-string counts', async () => {
  for (const count of [1, '1']) for (const response of [reply({ row_count: count, truncated: false }), { data: rows, metadata: { row_count: count, truncated: false } }]) {
    assert.equal(await queryExactRange(query, async input => { assert.deepEqual(input, query); return response; }, () => true), response);
    assert.doesNotThrow(() => requireCompleteAnalytics(response));
  }
});
test('matching zero count validates an empty result without inventing coverage', async () => {
  const response = reply({ truncated: false, row_count: 0 }, []);
  assert.equal(await queryExactRange(query, async () => response, () => true), response);
});
test('missing/null truncation stays unknown, true stays partial', async () => {
  for (const metadata of [undefined, null, {}, { truncated: null }, { truncated: true, row_count: 1 }]) {
    const response = reply(metadata);
    assert.equal(await queryExactRange(query, async () => response, () => true), response);
    assert.throws(() => requireCompleteAnalytics(response), e => e.code === 'INCOMPLETE_ANALYTICS');
  }
});
test('malformed metadata or truncation values fail closed', async () => {
  for (const metadata of [[], 'private-upstream-value', 4, { truncated: 'false' }, { truncated: 0 }]) {
    await assert.rejects(queryExactRange(query, async () => reply(metadata), () => true), invalid);
  }
});
test('direct completeness checks also reject contradictory counts', () => {
  assert.throws(() => requireCompleteAnalytics(reply({ truncated: false, row_count: 2 })), invalid);
});
function toolHarness(response) {
  const tools = new Map(); let publicReads = 0;
  registerRouterLensTools({ registerTool: (name, schema, handler) => tools.set(name, handler) }, {
    queryAnalytics: async () => response,
    getAnalyticsMeta: async () => ({ data: { metrics: [{name:'total_usage',is_rate:false,display_format:'currency'}], dimensions:[{name:'model'}], operators:[], granularities:[] } }),
    getCredits: async () => ({ data: { total_credits: 10, total_usage: 4 } }),
    listModels: async () => { publicReads++; return { data: [] }; },
    getModelEndpoints: async () => { publicReads++; return {}; },
    listKeys: async () => ({ data: [] }),
    status: () => ({ management_key_configured: false, mode: 'synthetic' })
  });
  return { tools, publicReads: () => publicReads };
}
for (const [name, input] of [
  ['query_usage', {metrics:['total_usage'],timezone:'UTC',time_range:range}],
  ['get_account_summary', {timezone:'UTC',include_spend_windows:true}],
  ['analyze_cost_optimization', {timezone:'UTC',preset:'7d',top_models:5,include_provider_evidence:true}]
]) test(`${name} cannot report complete results from contradictory UTC metadata`, async () => {
  const h=toolHarness(reply({truncated:false,row_count:2},[{model:'synthetic/model',total_usage:4}]));
  const result=await h.tools.get(name)(input);
  assert.equal(result.isError,true);
  assert.equal(result.structuredContent,undefined);
  assert.doesNotMatch(JSON.stringify(result), /synthetic\/model|row_count|total_credits/);
  assert.equal(h.publicReads(),0);
});
test('query_usage preserves complete, partial and unknown distinctions', async () => {
  for (const truncated of [false, true, undefined, null]) {
    const h=toolHarness(reply({truncated,row_count:1}));
    const result=await h.tools.get('query_usage')({metrics:['total_usage'],timezone:'UTC',time_range:range});
    assert.equal(result.isError,undefined);
    assert.equal(result.structuredContent.totals_complete,truncated===false);
    assert.equal(result.structuredContent.totals.total_usage,4);
    assert.equal(result.structuredContent.totals_scope,'returned_rows');
  }
});

test('truncated row_count still means returned rows under the official contract', async () => {
  await assert.rejects(queryExactRange(query, async () => reply({truncated:true,row_count:2}), () => true), invalid);
});
