# Hearthland

Hearthland is a full-stack platform for discovering regenerative communities,
people, land, projects, opportunities, learning resources, and hands-on building
camps. It includes a guided community-starting journey, explainable matching,
personal dashboards, applications, saves, and action tracking. Production
identity, persistence, permissions, and file ownership use Supabase.

## Run locally

Requires Node.js 22.13 or newer and pnpm.

Copy `.env.example` to `.env.local` and set the public Supabase values. Never
put a service-role or secret key in a `NEXT_PUBLIC_` variable.

```bash
pnpm install
pnpm dev
```

The browser receives only:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

The application uses Supabase Auth sessions and the separately exposed
`hearthland` Data API schema. Database changes live in `supabase/migrations`.
The curated launch catalog is generated from `app/demo-data.ts` by
`scripts/generate-hearthland-seed.mjs`; seeded and user-created entities then
flow through the same repository.

## Verify

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
```

The app runs on Vinext and Cloudflare Workers, but no longer uses D1 in its
production data path. Public discovery is RLS-filtered; account data, drafts,
private locations, manager notes, saves, applications, dashboard tasks, and
notifications require an authenticated Supabase session and the corresponding
ownership or role policy.
