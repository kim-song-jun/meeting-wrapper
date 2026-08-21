import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_PRODUCTION_MARKERS,
  scanProductionBundle,
} from "./production-bundle-policy.mjs";

const temporaryRoots = [];

async function makeBundleRoot() {
  const root = await mkdtemp(join(tmpdir(), "molroom-production-bundle-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("production bundle policy", () => {
  it("accepts public configuration without treating it as a mock runtime marker", async () => {
    const cleanRoot = await makeBundleRoot();
    await mkdir(join(cleanRoot, "assets"));
    await writeFile(
      join(cleanRoot, "assets", "policy.json"),
      '{"allowedHostedDomain":"molcube.com","admin":"sungjun@molcube.com"}',
    );

    expect(await scanProductionBundle(cleanRoot)).toEqual([]);
  });

  it("reports each forbidden marker once per file in stable path and marker order", async () => {
    const dirtyRoot = await makeBundleRoot();
    await mkdir(join(dirtyRoot, "assets"));
    await writeFile(
      join(dirtyRoot, "assets", "app.js"),
      '"__declined" "__declined" "molroom.mock.identity"',
    );
    await writeFile(join(dirtyRoot, "index.html"), '"molroom.mockAuth.session"');

    expect(await scanProductionBundle(dirtyRoot)).toEqual([
      { marker: "__declined", path: "assets/app.js" },
      { marker: "molroom.mock.identity", path: "assets/app.js" },
      { marker: "molroom.mockAuth.session", path: "index.html" },
    ]);
  });

  it("scans nested files and tolerates binary assets", async () => {
    const root = await makeBundleRoot();
    await mkdir(join(root, "assets", "nested"), { recursive: true });
    await writeFile(join(root, "assets", "nested", "runtime.js"), 'const now = "mockNow";');
    await writeFile(join(root, "assets", "logo.bin"), Buffer.from([0, 255, 254, 128]));

    expect(await scanProductionBundle(root)).toEqual([
      { marker: "mockNow", path: "assets/nested/runtime.js" },
    ]);
  });

  it("exposes the complete forbidden marker policy", () => {
    expect(FORBIDDEN_PRODUCTION_MARKERS).toEqual([
      "molroom.mock.identity",
      "molroom.mockAuth.session",
      "[MolRoom QA]",
      "QA fixture:",
      "mockSaveDelayMs",
      "mockReadError",
      "mockPrefsSaveError",
      "mockNow",
      "__taken",
      "__declined",
    ]);
  });
});
