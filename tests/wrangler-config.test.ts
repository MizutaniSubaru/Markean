import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("api wrangler config", () => {
  it("serves the web app as same-origin Worker static assets", () => {
    const config = JSON.parse(readFileSync("apps/api/wrangler.jsonc", "utf8")) as {
      assets?: {
        directory?: string;
        not_found_handling?: string;
        run_worker_first?: string[];
      };
    };

    expect(config.assets).toMatchObject({
      directory: "../web/dist",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    });
  });
});
