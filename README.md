# Hearthland

Hearthland is a full-stack platform for discovering regenerative communities,
people, land, projects, opportunities, learning resources, and hands-on building
camps. It includes a guided community-starting journey, explainable matching,
personal dashboards, applications, saves, and action tracking.

## Run locally

Requires Node.js 22.13 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

## Verify

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm db:generate
```

The app runs on Vinext and Cloudflare Workers. D1-backed write actions use the
binding declared in `.openai/hosting.json`; local development falls back to a
demo identity while production uses the hosting platform's authenticated user
headers.
