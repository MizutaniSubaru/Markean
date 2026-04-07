import { describe, expect, it } from "vitest";
import { workspaceName } from "@markean/domain";

describe("workspace package resolution", () => {
  it("resolves shared packages from the root workspace", () => {
    expect(workspaceName).toBe("markean");
  });
});
