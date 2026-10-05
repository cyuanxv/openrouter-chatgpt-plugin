# Deployment

## Vercel

1. Create or link a Vercel project.
2. Add Production environment variables:
   - `OPENROUTER_MANAGEMENT_KEY`
   - `MCP_AUTH_TOKEN`
3. Deploy with `vercel deploy --prod`.
4. Verify `/api/health`.
5. Point the plugin's RouterLens MCP server entry to `https://YOUR_DOMAIN/api/mcp`.

## Local validation

```bash
npm run typecheck
npm run build
```

Production secrets configured as Vercel encrypted variables may not be downloadable in plaintext for local testing. Validate private OpenRouter connectivity inside the deployed environment without exposing secrets.
