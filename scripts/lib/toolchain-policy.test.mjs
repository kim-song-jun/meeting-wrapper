import { describe, expect, it } from "vitest";
import { verifyToolchain } from "./toolchain-policy.mjs";

describe("toolchain policy", () => {
  it("accepts the exact pinned Node and npm versions", () => {
    expect(() =>
      verifyToolchain(
        { node: "24.19.0", npm: "11.17.0" },
        { node: "24.19.0", npm: "11.17.0" },
      ),
    ).not.toThrow();
  });

  it.each([
    [{ node: "24.18.0", npm: "11.17.0" }, "Node 24.19.0 is required; received 24.18.0"],
    [{ node: "24.19.0", npm: "11.16.0" }, "npm 11.17.0 is required; received 11.16.0"],
  ])("rejects a patch-level mismatch", (actual, message) => {
    expect(() => verifyToolchain({ node: "24.19.0", npm: "11.17.0" }, actual)).toThrow(message);
  });
});
