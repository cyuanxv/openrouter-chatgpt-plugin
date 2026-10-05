import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildQueryRecipes } = require('../.test-build/lib/queryRecipes.js');
const { validateAnalyticsQuery } = require('../.test-build/lib/queryPlanning.js');
const metricNames = ['total_usage', 'request_count', 'tokens_total', 'tokens_prompt', 'tokens_completion', 'cached_tokens', 'reasoning_tokens', 'credits_usage', 'byok_usage', 'byok_fees', 'usage_upstream', 'usage_cache', 'usage_data'];
const schema = { metrics: [...metricNames.map((name) => ({ name, is_rate: false, display_format: name.includes('usage') || name.includes('fees') ? 'currency' : 'number' })), { name: 'cache_hit_rate', is_rate: true, display_format: 'percent' }], dimensions: ['model', 'provider', 'api_key_id'].map((name) => ({ name })), operators: [], granularities: [{ name: 'day' }] };

test('all prepared recipes use only discovered fields and pass the query preflight', () => {
  const recipes = buildQueryRecipes(schema);
  assert.equal(recipes.length, 7);
  for (const recipe of recipes) {
    assert.equal(recipe.status, 'ready');
    assert.equal(recipe.query_executed, false);
    assert.doesNotThrow(() => validateAnalyticsQuery(recipe.parameters, schema));
    assert.ok(recipe.interpretation.length > 0);
  }
});
test('missing provider, key, cache or time capabilities remain explicitly unavailable', () => {
  const recipes = buildQueryRecipes({ metrics: [{ name: 'total_usage', is_rate: false }], dimensions: [{ name: 'model' }], operators: [], granularities: [] });
  for (const id of ['top_providers', 'top_api_keys', 'token_breakdown', 'daily_spend', 'cache_evidence', 'cost_components']) {
    const recipe = recipes.find((entry) => entry.id === id);
    assert.equal(recipe.status, 'unavailable');
    assert.equal(recipe.parameters, undefined);
    assert.ok(recipe.missing_fields.length > 0);
  }
});
test('recipes preserve critical interpretation limits without claiming actual costs or savings', () => {
  const recipes = buildQueryRecipes(schema);
  assert.match(recipes.find((entry) => entry.id === 'top_api_keys').interpretation.join(' '), /filter IDs/);
  assert.match(recipes.find((entry) => entry.id === 'token_breakdown').interpretation.join(' '), /overlapping/);
  assert.match(recipes.find((entry) => entry.id === 'daily_spend').interpretation.join(' '), /UTC/);
  assert.match(recipes.find((entry) => entry.id === 'cost_components').interpretation.join(' '), /negative/);
  assert.doesNotMatch(JSON.stringify(recipes), /estimated_savings|remaining_credits|\$[0-9]/);
});
