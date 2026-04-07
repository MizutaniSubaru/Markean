import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
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
