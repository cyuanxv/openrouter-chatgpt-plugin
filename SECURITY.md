# Security Policy

## Secrets

Never commit:
- `OPENROUTER_MANAGEMENT_KEY`
- `OPENROUTER_API_KEY`
- `MCP_AUTH_TOKEN`

Use server-side environment variables.

## Current trust model

Version 0.3 is designed for single-tenant self-hosting. The host operator controls the OpenRouter Management Key and MCP bearer token.

RouterLens does not persist OpenRouter account analytics in its own database.

## Tool safety

All RouterLens 0.3 tools are read-only.

The plugin never returns plaintext OpenRouter API keys. Key creation, rotation, update, disable, and deletion are intentionally excluded from this release.

## Reporting vulnerabilities

Do not include secrets, API keys, or private account data in a public issue. Use a private disclosure channel maintained by the repository owner.
