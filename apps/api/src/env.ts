export type Env = {
  ALLOW_DEV_SESSION?: string;
  DB: D1Database;
  SYNC_COORDINATOR: DurableObjectNamespace;
  EXPORTS: R2Bucket;
};
