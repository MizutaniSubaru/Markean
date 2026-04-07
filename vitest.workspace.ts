import { createRequire } from "node:module";
import { defineWorkspace } from "vitest/config";

const require = createRequire(new URL("./apps/api/package.json", import.meta.url));
const { defineWorkersProject } = require("@cloudflare/vitest-pool-workers/config") as typeof import("@cloudflare/vitest-pool-workers/config");

export default defineWorkspace([
  defineWorkersProject({
    test: {
      name: "@markean/api",
      root: "./apps/api",
      include: ["test/**/*.test.ts"],
      pool: "@cloudflare/vitest-pool-workers",
      poolOptions: {
        workers: {
          wrangler: {
            configPath: "./apps/api/wrangler.jsonc",
          },
        },
      },
    },
  }),
  "packages/*",
  {
    test: {
      name: "tests",
      root: "./tests",
      include: ["**/*.test.ts"],
      environment: "node",
    },
  },
]);
