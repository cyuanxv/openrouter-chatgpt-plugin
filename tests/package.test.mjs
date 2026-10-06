import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('both default manifests contain only the verified official MCP without credentials', () => {
  for (const path of ['mcp.json', '.mcp.json']) {
    const config = json(path);
    assert.deepEqual(Object.keys(config.mcpServers), ['openrouter']);
    assert.equal(config.mcpServers.openrouter.url, 'https://mcp.openrouter.ai/mcp');
    assert.equal(config.mcpServers.openrouter.type, 'streamable-http');
    assert.deepEqual(config.mcpServers.openrouter.headers ?? {}, {});
  }
});

test('portable and compatibility plugin identity and metadata stay synchronized', () => {
  const root = json('plugin.json');
  const overlay = json('.codex-plugin/plugin.json');
  assert.equal(root.name, 'openrouter-mcp');
  assert.equal(root.version, '0.3.1');
  for (const key of ['name', 'version', 'description', 'author']) assert.deepEqual(root[key], overlay[key]);
  assert.deepEqual(root.extensions['com.openai'].interface, overlay.interface);
  assert.ok(root.extensions['com.openai'].interface.shortDescription.length <= 30);
  assert.equal(root.license, 'Apache-2.0');
  assert.match(root.description, /temporarily unavailable/);
  assert.deepEqual(root.extensions['com.openai'].interface.defaultPrompt, [
    'How much did I spend on OpenRouter yesterday, and what drove the cost?',
    'Analyze my last 30 days of OpenRouter usage and find cost optimization opportunities.',
    'Compare these OpenRouter models by live price, context, providers, and benchmark evidence.'
  ]);
});

test('release versions are consistent', () => {
  const version = json('package.json').version;
  assert.equal(version, json('plugin.json').version);
  assert.equal(version, json('package-lock.json').version);
  assert.equal(version, json('package-lock.json').packages[''].version);
});

test('skill gates private workflows and keeps billable actions opt-in', () => {
  const skill = readFileSync(new URL('../skills/openrouter/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /not a restoration of Analytics/);
  assert.match(skill, /verify its tools are actually present and authenticated/);
  assert.match(skill, /only when the user explicitly asks/);
});
