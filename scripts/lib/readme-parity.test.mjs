import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateReadmeParity } from "./readme-parity.mjs";

const root = join(import.meta.dirname, "../..");

describe("bilingual release documentation parity", () => {
  it("requires the same release-critical contract in Korean and English", async () => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"),
      readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"),
      readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);

    expect(await validateReadmeParity(korean, english, { root, koreanRunbook, englishRunbook })).toEqual({ valid: true, missing: [] });
  });

  it("reports missing critical content instead of accepting a partial translation", async () => {
    const result = await validateReadmeParity("# Korean\n", "# English\n", { root, koreanRunbook: "", englishRunbook: "" });

    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing).toContain("ko:heading:release.toolchain");
  });

  it.each([
    ["heading", (text) => text.replace("## [release.env]", "## Environment")],
    ["command", (text) => text.replace("npm run build", "npm run compile")],
    ["link", (text) => text.replace("(SECURITY.md)", "(missing-security.md)")],
    ["env key", (text) => text.replace("VITE_ALLOWED_HD", "VITE_REMOVED")],
    ["receipt key", (text) => text.replace("tenantPolicy", "removedPolicy")],
    ["state", (text) => text.replaceAll("INCOMPLETE / UNOBSERVED", "READY")],
    ["origin fetch", (text) => text.replace("git fetch origin main --quiet", "git fetch removed")],
    ["origin equality", (text) => text.replace("test \"$(git rev-parse origin/main)\" = \"${release_sha}\"", "test true")],
  ])("rejects a mutated %s contract", async (_label, mutate) => {
    const korean = await readFile(join(root, "README.ko.md"), "utf8");
    const english = await readFile(join(root, "README.en.md"), "utf8");
    expect((await validateReadmeParity(mutate(korean), english, { root })).valid).toBe(false);
  });

  it.each([
    ["runbook env key", (text) => text.replace("VITE_ALLOWED_HD", "VITE_REMOVED")],
    ["runbook receipt", (text) => text.replace("tenantPolicy", "removedPolicy")],
    ["origin equality", (text) => text.replace("origin/main == release_sha", "origin/main check removed")],
  ])("rejects a mutated runbook %s contract", async (_label, mutate) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    expect((await validateReadmeParity(korean, english, { root, koreanRunbook: mutate(koreanRunbook), englishRunbook })).valid).toBe(false);
  });
});
