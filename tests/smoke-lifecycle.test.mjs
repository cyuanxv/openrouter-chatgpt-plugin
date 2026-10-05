import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stopOwnedChild, waitUntilReady } from '../scripts/smoke-lifecycle.mjs';

test('startup timeout reaps its owned child even when that child ignores SIGTERM', async (t) => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); console.log('synthetic-child-ready'); setInterval(()=>{},1000)"], { env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
  const cleanup = { graceMs: 30, killWaitMs: 1500, pollMs: 10 };
  t.after(async () => { await stopOwnedChild(child, cleanup); });
  await once(child.stdout, 'data');
  const pid = child.pid;
  await assert.rejects(waitUntilReady(child, async () => false, { attempts: 1, intervalMs: 1, startupMs: 100, stopOptions: cleanup }), /did not become ready/);
  assert.equal(child.signalCode, 'SIGKILL');
  assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
});

test('a ready child is returned to the caller for normal owned cleanup', async (t) => {
  const child = spawn(process.execPath, ['-e', "console.log('synthetic-child-ready'); setInterval(()=>{},1000)"], { env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
  const cleanup = { graceMs: 100, killWaitMs: 1000, pollMs: 10 };
  t.after(async () => { await stopOwnedChild(child, cleanup); });
  await once(child.stdout, 'data');
  assert.equal(await waitUntilReady(child, async () => true), child);
  await stopOwnedChild(child, cleanup);
  assert.ok(child.signalCode !== null || child.exitCode !== null);
});
