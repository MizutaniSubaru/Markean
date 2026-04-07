export type Env = {
  DB: D1Database;
  SYNC_COORDINATOR: DurableObjectNamespace;
  EXPORTS: R2Bucket;
};
