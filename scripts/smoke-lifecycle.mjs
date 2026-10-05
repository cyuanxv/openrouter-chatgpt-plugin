import { setTimeout as delay } from 'node:timers/promises';
const alive = (child) => child.exitCode === null && child.signalCode === null;

/** Stop only the child process created by this smoke harness. */
export async function stopOwnedChild(child, { graceMs = 5000, killWaitMs = 2000, pollMs = 100 } = {}) {
  if (!alive(child)) return;
  child.kill('SIGTERM');
  const graceEnd = Date.now() + graceMs;
  while (alive(child) && Date.now() < graceEnd) await delay(pollMs);
  if (!alive(child)) return;
  child.kill('SIGKILL');
  const killEnd = Date.now() + killWaitMs;
  while (alive(child) && Date.now() < killEnd) await delay(pollMs);
  if (alive(child)) throw new Error('Smoke child failed to stop after SIGKILL');
}

/** Own cleanup even when startup fails before the caller receives the child. */
export async function waitUntilReady(child, isReady, { attempts = 100, intervalMs = 100, startupMs = 10000, stopOptions } = {}) {
  let spawnError;
  const onError = (error) => { spawnError = error; };
  child.once('error', onError);
  const deadline = Date.now() + startupMs;
  try {
    for (let index = 0; index < attempts && Date.now() < deadline; index++) {
      if (spawnError || !alive(child)) throw new Error('Smoke server exited before readiness');
      try { if (await isReady()) return child; } catch {}
      await delay(intervalMs);
    }
    throw new Error('Test server did not become ready');
  } catch (error) {
    await stopOwnedChild(child, stopOptions);
    throw error;
  } finally {
    child.removeListener('error', onError);
  }
}
