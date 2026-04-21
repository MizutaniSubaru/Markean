import type { SyncCoordinator } from "./durable/SyncCoordinator";

export type Env = {
  APP_ENV: "dev" | "prod";
  APP_BASE_URL: string;
  API_BASE_URL: string;
  ALLOW_DEV_SESSION?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APPLE_CLIENT_ID: string;
  APPLE_TEAM_ID: string;
  APPLE_KEY_ID: string;
  APPLE_PRIVATE_KEY: string;
  MAGIC_LINK_SECRET: string;
  MAGIC_LINK_TTL_MINUTES: string;
  EMAIL_FROM: string;
  RESEND_API_KEY: string;
  DB: D1Database;
  SYNC_COORDINATOR: DurableObjectNamespace<SyncCoordinator>;
  EXPORTS: R2Bucket;
};
