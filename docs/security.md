# Security Architecture

## V0.3 self-hosted mode

The server reads one OpenRouter Management Key from the host environment. This makes V0.3 suitable for a private single-user deployment.

The MCP endpoint is separately protected by `MCP_AUTH_TOKEN`.

## Data retention

RouterLens does not require a database in V0.3. Account usage is fetched from OpenRouter when requested and returned to the connected MCP client.

## Secret handling

- no credential values in MCP results
- no credential values in health responses
- sanitized upstream errors
- no API-key creation in V0.3 because OpenRouter returns the new secret only once
- no destructive key actions in V0.3

## Hosted future version

A public hosted service should add:
- OAuth 2.1 for MCP client authentication
- encrypted per-user OpenRouter credentials
- server-side key encryption
- credential deletion/disconnect flow
- audit logs for write actions
- explicit confirmation for destructive actions
