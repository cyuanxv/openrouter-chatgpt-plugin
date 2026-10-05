# Private self-hosted validation

Use an authorized cloud host for this workflow. These instructions do not require operating the user's computer or switching to another execution mode.

## Validate source without credentials

Use the repository's Node.js/Next.js-compatible cloud runtime:

```sh
npm ci
npm run check
npm run test:transport
```

`test:transport` requires the production build produced by `check`. It starts a temporary server bound only to loopback, passes synthetic credentials in a clean process environment, blocks non-loopback fetches and redirects, tests MCP discovery/status and auth failure modes, then stops the server. It does not query OpenRouter accounts or models.

## Prepare the plugin archive

Python 3.9+ is needed only for the standard-library package helper:

```sh
python3 scripts/package_plugin.py --output ../openrouter-mcp-0.3.1.zip
```

Optional packaging-only positive/negative tests: `python3 scripts/test_package_plugin.py`.

The archive is unpublished and contains only the portable/compatibility manifests, skill, and license under one `openrouter-mcp` directory. The fixed allowlist excludes server source, dependencies, build files, environment files, and hosted-auth modules. Do not upload or install it as a workaround for missing Analytics authentication. Packaging does not update the existing account plugin.

## Real private server setup is a separate step

After authorization, use the host's secure secret controls for the existing static-bearer single-tenant server. Never put credentials in chat, shared manifests, repository files, logs, screenshots, or fixtures. Keep MCP authentication enabled. A client must have an approved secure authentication path; the default 0.3.1 plugin intentionally does not connect the private bridge.

The hosted OAuth modules in `lib/hosted` are not a configuration switch. They require the remaining integration and release gates in [acceptance.md](acceptance.md). Adding an issuer variable or removing the bearer check does not enable a safe multi-user service.

## Current architecture

Retain the Next.js app routes and mcp-handler implementation in this repository. The product plan's conceptual `server/` component is implemented by `app/api` and `lib`; do not create a duplicate server tree merely to match an illustrative folder diagram.
