const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, options) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External fetch disabled for isolated MCP smoke test');
  return originalFetch(input, { ...options, redirect: "error" });
};
