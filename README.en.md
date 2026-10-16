# Kelu（客路）

> From first visit to loyal customer, one path.

**An open-source, AI-first HubSpot alternative that runs entirely on Cloudflare**, covering the whole journey from first visit to service delivery:

```
Visitor ──form──▶ Lead ──convert──▶ Client ──sign──▶ Service delivery
```

- **Serverless**: runs on Cloudflare Workers, D1, R2 and Queues. Fork the repository, connect it to Workers Builds and it deploys itself; no GitHub secrets are needed, and small teams pay close to nothing.
- **AI-first**: a built-in AI assistant plus an MCP server, so AI tools such as Claude Code, Cursor and Claude Desktop can read and maintain leads and clients with the same permissions as the UI. Every call is recorded in an audit log.
- **Generic core + industry templates**: the core is industry-neutral. At first-time setup you choose "General" or an industry template (currently "Assisted reproduction"), which presets service flows, options and the AI business background.
- **You own the data**: everything lives in your own Cloudflare account.

## Features

- Leads: capture, rule-based assignment, follow-ups, conversion to clients
- Clients: profiles, service milestones, next-contact reminders, attachments
- Products & services: services with price, delivery steps and documents
- Activities, visual workflows (including scheduled runs), field-level policies, recycle bin
- AI analysis and assistant (OpenAI, Anthropic, Workers AI or any compatible API) with a configurable business background
- AI access: MCP server (`/api/mcp`), scoped API keys, audit log
- Public API for pushing leads (`POST /api/v1/leads`), with a machine-readable reference at `/api/v1/llms.txt`
- Visitor analytics: websites connect through a same-origin `/_t/*` proxy (the CRM URL is never exposed), recording channels, journeys and key actions; set up with the in-app guide under Visitor analytics → Sites, which can check the connection automatically
- Client portal (`/portal`) for profiles, services, resources and progress
- Chinese and English UI

**Planned**: visitor-to-lead linking, channel reports, custom fields, lead scoring, unified timeline.

## Deploy

Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**, select this repository, set the deploy command to `pnpm run cf:deploy` and leave the build command empty. The first build creates the database, bucket, queues and signing secrets; then open the Worker URL and create the admin account. See [DEPLOY.md](./DEPLOY.md) (Chinese) for details.

## Development

Node.js 22+ and pnpm 9. `pnpm install`, then `pnpm dev:web` and `pnpm dev:workers`. Run `pnpm -r typecheck` and `pnpm test` before committing. Contribution rules for people and coding agents are in [AGENTS.md](./AGENTS.md) (Chinese).

## License

[AGPL-3.0](./LICENSE). If you modify the software and offer it to others as a network service, you must make your modified source code available under the same license.
