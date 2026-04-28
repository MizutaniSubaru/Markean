# Markean

Markean is a monorepo for a Cloudflare-backed notes app with offline sync.

## Repository Layout

- `apps/api`: Cloudflare Worker API, D1 migrations, Durable Object sync coordinator, route tests
- `apps/web`: Vite/React web app, UI tests, Playwright e2e coverage
- `packages/domain`: shared note/folder/pending-change models
- `packages/api-client`: typed client for bootstrap, sync, trash, and restore routes
- `packages/storage-web`: Dexie storage adapter for browser persistence
- `packages/sync-core`: shared queue/push/pull sync engine
- `docs/superpowers`: design specs and implementation plans kept as project history
- `tests`: workspace-level smoke coverage

## Common Commands

- `pnpm install`
- `pnpm test`
- `pnpm -r typecheck`
- `pnpm --filter @markean/api exec wrangler dev`
- `pnpm --filter @markean/web dev`

## Cloudflare Deployment

The production deployment uses one same-origin Cloudflare Worker:

- `/api/*` runs the Hono Worker API from `apps/api/src/index.ts`
- all other paths serve the Vite SPA from `apps/web/dist`
- auth cookies stay same-origin, so no production CORS setup is required

The Worker entrypoint is `apps/api/src/index.ts` and the Wrangler config is `apps/api/wrangler.jsonc`.

Before a production deploy, update the Wrangler config away from local development values:

- set production `APP_ENV`
- set production `APP_BASE_URL`
- set production `API_BASE_URL`
- bind the production D1 database returned by `wrangler d1 create`
- keep `ALLOW_DEV_SESSION` disabled

Required Worker secrets:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APPLE_CLIENT_ID`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY`
- `MAGIC_LINK_SECRET`
- `EMAIL_FROM`
- `RESEND_API_KEY`

Typical production deploy flow:

1. `pnpm --filter @markean/api exec wrangler login`
2. `pnpm --filter @markean/api exec wrangler d1 create <production-db-name>`
3. update `apps/api/wrangler.jsonc` with the returned production binding details
4. set secrets with `pnpm --filter @markean/api exec wrangler secret put <SECRET_NAME>`
5. apply migrations with `pnpm run d1:migrate:remote`
6. dry-run with `pnpm run deploy:dry-run`
7. deploy with `pnpm run deploy`

Full setup and operations notes: `docs/cloudflare-worker-deployment.md`.
