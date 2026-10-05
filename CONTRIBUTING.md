# Contributing

Contributions are welcome.

## Development

1. Install Node.js 20+.
2. Run `npm ci`.
3. Run `npm run check` before opening a pull request. Offline tests use synthetic fixtures and require no OpenRouter credentials or network calls.
4. For separately authorized live testing only, configure credentials through the host's secure environment controls. Never put real credentials in fixtures, output, or public code.

## Design principles

- Prefer OpenRouter's official MCP for capabilities it already exposes.
- Keep RouterLens focused on analytics, workflow, governance, and cost intelligence.
- Keep tools small and composable. Put multi-step behavior in skills.
- Query live OpenRouter metadata instead of hard-coding model prices or Analytics fields.
- Never log or return credentials.
- Keep destructive operations out of the default read-only release.

## Pull requests

Describe:
- the user problem
- affected tools/skills
- API changes
- tests or validation performed
- security impact

