# Markean Cloudflare Worker Deployment

This project deploys as one same-origin Cloudflare Worker:

- `/api/*` runs `apps/api/src/index.ts`.
- All other paths serve the Vite build from `apps/web/dist`.
- The browser calls `/api/*` with same-origin cookies, so production does not need CORS.

Official references:

- Workers Static Assets configuration: https://developers.cloudflare.com/workers/wrangler/configuration/#assets
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/
- D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/

## What Is Already Handled In This Repository

- `apps/api/wrangler.jsonc` serves `../web/dist` through Worker Static Assets.
- `run_worker_first` sends `/api/*` to the Worker before static assets.
- `not_found_handling` is `single-page-application`, so deep links return the SPA.
- The frontend now has a production sign-in screen for Google, Apple, and email magic links.
- `bootstrapApp` detects a `401` bootstrap response and shows the sign-in screen.
- Root scripts now include build, deploy, dry-run deploy, and D1 migration helpers.

## What You Need Outside The Repository

You need:

- A Cloudflare account.
- A domain managed by Cloudflare DNS, for example `markean.example.com`.
- A production D1 database.
- Resend account and a verified sender domain for email magic links.
- Google OAuth credentials if Google sign-in is enabled.
- Apple Developer credentials if Apple sign-in is enabled.

You do not need a VPS for the recommended path. Workers, D1, Durable Objects, and Static Assets replace the server.

## First Production Setup

Log in:

```bash
pnpm --filter @markean/api exec wrangler login
```

Create production D1:

```bash
pnpm --filter @markean/api exec wrangler d1 create markean-api-prod
```

Copy the returned `database_id` into `apps/api/wrangler.jsonc` and change the production values:

```jsonc
"vars": {
  "APP_ENV": "prod",
  "APP_BASE_URL": "https://markean.example.com",
  "API_BASE_URL": "https://markean.example.com",
  "MAGIC_LINK_TTL_MINUTES": "20"
},
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "markean-api-prod",
    "database_id": "the-real-cloudflare-d1-id",
    "migrations_dir": "migrations"
  }
]
```

Do not set `ALLOW_DEV_SESSION` in production.

Set secrets:

```bash
pnpm --filter @markean/api exec wrangler secret put GOOGLE_CLIENT_ID
pnpm --filter @markean/api exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm --filter @markean/api exec wrangler secret put APPLE_CLIENT_ID
pnpm --filter @markean/api exec wrangler secret put APPLE_TEAM_ID
pnpm --filter @markean/api exec wrangler secret put APPLE_KEY_ID
pnpm --filter @markean/api exec wrangler secret put APPLE_PRIVATE_KEY
pnpm --filter @markean/api exec wrangler secret put MAGIC_LINK_SECRET
pnpm --filter @markean/api exec wrangler secret put EMAIL_FROM
pnpm --filter @markean/api exec wrangler secret put RESEND_API_KEY
```

Apply migrations:

```bash
pnpm run d1:migrate:remote
```

Allow your first beta email:

```bash
pnpm --filter @markean/api exec wrangler d1 execute markean-api-prod --remote --command "INSERT OR IGNORE INTO beta_allowed_emails (email, created_at) VALUES ('you@example.com', datetime('now'))"
```

Run a dry run:

```bash
pnpm run deploy:dry-run
```

Deploy:

```bash
pnpm run deploy
```

Attach the custom domain in Cloudflare:

1. Go to Workers & Pages.
2. Open the `markean-api` Worker.
3. Add a custom domain such as `markean.example.com`.
4. Confirm DNS points to the Worker.

Set OAuth callback URLs:

```text
https://markean.example.com/api/auth/google/callback
https://markean.example.com/api/auth/apple/callback
```

## Local Same-Origin Smoke Test

Apply local migrations:

```bash
pnpm run d1:migrate:local
```

Build the web app and run the Worker:

```bash
pnpm run build:web
pnpm --filter @markean/api dev
```

Open:

```text
http://127.0.0.1:8787
```

For a local dev session, create an untracked `apps/api/.dev.vars` with:

```text
ALLOW_DEV_SESSION=true
```

Then run this in the browser console on `http://127.0.0.1:8787`:

```js
await fetch("/api/dev/session", { method: "POST", credentials: "include" });
location.reload();
```

## Release Checklist

Before every deploy:

```bash
pnpm -r typecheck
pnpm test
pnpm run build:web
pnpm run deploy:dry-run
```

After deploy:

```bash
curl https://markean.example.com/api/health
```

Then test:

- Open the site.
- Sign in with a beta-allowed email.
- Create a folder.
- Create a note.
- Refresh the browser and confirm the note remains.
- Open a second browser profile and confirm sync.

## Operations

Monitor:

- Worker errors, CPU time, and request volume in Cloudflare.
- D1 reads, writes, and storage.
- Resend delivery failures.
- Sync conflict rates by checking Worker logs around `/api/sync/push`.

Routine operations:

- Add beta users with `wrangler d1 execute`.
- Rotate OAuth and Resend secrets through `wrangler secret put`.
- Use D1 Time Travel before and after risky migrations.
- Keep `ALLOW_DEV_SESSION` out of production.

Recovery:

- If a migration fails, Wrangler rolls back the failed migration.
- If data is damaged, use D1 Time Travel to inspect a bookmark first, then restore only after confirming the target timestamp.
- If a deploy breaks the app, redeploy the previous git revision with the same `pnpm run deploy` flow.
