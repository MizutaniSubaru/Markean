import type { SyncCoordinator } from "./durable/SyncCoordinator";

export type Env = {
  ALLOW_DEV_SESSION?: string;
  DB: D1Database;
  SYNC_COORDINATOR: DurableObjectNamespace<SyncCoordinator>;
  EXPORTS: R2Bucket;
};
