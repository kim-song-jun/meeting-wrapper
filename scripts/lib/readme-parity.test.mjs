import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateReadmeParity } from "./readme-parity.mjs";

const root = join(import.meta.dirname, "../..");
const VALID_PACKAGE_SCRIPTS = Object.freeze({
  "build:release-manifest": "release_sha=\"$(git rev-parse HEAD)\" && node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha \"$release_sha\" --source-date-epoch \"$(git show -s --format=%ct \"$release_sha\")\"",
  "upload:release-prefix": "node scripts/upload-release-prefix.mjs --artifact-root dist --bucket \"${MOLROOM_RELEASE_BUCKET:-molroom-000000000000-us-east-1-origin}\" --commit-sha \"$(git rev-parse HEAD)\" --dry-run",
  "verify:release-contract": "vitest run --pool=threads --maxWorkers=1 --minWorkers=1 scripts/lib/release-manifest.test.mjs",
});

function sectionBounds(document, heading) {
  const marker = `## ${heading}`;
  const start = document.indexOf(marker);
  if (start < 0) throw new Error(`missing test fixture heading: ${heading}`);
  const next = document.indexOf("\n## ", start + marker.length);
  return { start, end: next < 0 ? document.length : next };
}

function moveMarker(document, { from, to, marker, asComment = false }) {
  const source = from === null
    ? { start: 0, end: document.indexOf("\n## ") }
    : sectionBounds(document, from);
  const sourceBody = document.slice(source.start, source.end);
  if (!sourceBody.includes(marker)) throw new Error(`missing test fixture marker: ${marker}`);
  const withoutSourceMarker = `${document.slice(0, source.start)}${sourceBody.replaceAll(marker, "")}${document.slice(source.end)}`;
  const target = sectionBounds(withoutSourceMarker, to);
  const movedMarker = asComment ? `<!-- ${marker} -->` : marker;
  return `${withoutSourceMarker.slice(0, target.end)}\n${movedMarker}\n${withoutSourceMarker.slice(target.end)}`;
}

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
    ["heading", (text) => text.replace("## [release.env]", "## Environment"), "ko:heading:release.env"],
    ["command", (text) => text.replace("npm run build", "npm run compile"), "ko:section:release.validation:npm run build"],
    ["link", (text) => text.replace("(SECURITY.md)", "(missing-security.md)"), "ko:link:missing-security.md"],
    ["env key", (text) => text.replace("VITE_ALLOWED_HD", "VITE_REMOVED"), "ko:section:release.env:VITE_ALLOWED_HD"],
    ["receipt key", (text) => text.replace("tenantPolicy", "removedPolicy"), "ko:section:release.env:tenantPolicy"],
    ["state", (text) => text.replaceAll("INCOMPLETE / UNOBSERVED", "READY"), "ko:section:release.status:INCOMPLETE / UNOBSERVED"],
    ["origin fetch", (text) => text.replace("git fetch origin main --quiet", "git fetch removed"), "ko:section:release.first-release:git fetch origin main --quiet"],
    ["origin equality", (text) => text.replace("test \"$(git rev-parse origin/main)\" = \"${release_sha}\"", "test true"), "ko:section:release.first-release:test \"$(git rev-parse origin/main)\" = \"${release_sha}\""],
  ])("rejects a mutated %s contract", async (_label, mutate, expectedError) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const result = await validateReadmeParity(mutate(korean), english, { root, koreanRunbook, englishRunbook });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(expectedError);
  });

  it.each([
    ["runbook env key", (text) => text.replace("VITE_ALLOWED_HD", "VITE_REMOVED"), "ko:runbook-section:runbook.operator-input:VITE_ALLOWED_HD"],
    ["runbook receipt", (text) => text.replace("tenantPolicy", "removedPolicy"), "ko:runbook-section:runbook.operator-input:tenantPolicy"],
    ["origin equality", (text) => text.replace("test \"$(git rev-parse origin/main)\" = \"${release_sha}\"", "origin/main check removed"), "ko:runbook-section:runbook.operator-input:test \"$(git rev-parse origin/main)\" = \"${release_sha}\""],
  ])("rejects a mutated runbook %s contract", async (_label, mutate, expectedError) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const result = await validateReadmeParity(korean, english, { root, koreanRunbook: mutate(koreanRunbook), englishRunbook });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(expectedError);
  });

  it("rejects contradictory implementation status and local tag mutation recipes", async () => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    expect((await validateReadmeParity(korean.replace("AWS CloudFormation·CloudFront·GitHub OIDC 배포 경로는 committed/defined 되어\n있지만 아직 configured/deployed/live 상태가 아닙니다.", "AWS CloudFormation·CloudFront·GitHub OIDC 배포는 아직 구현되지 않았습니다."), english, { root, koreanRunbook, englishRunbook })).valid).toBe(false);
    expect((await validateReadmeParity(korean, english, { root, koreanRunbook: `${koreanRunbook}\ngit tag -a v0.1.0 HEAD\ngit push --atomic origin v0.1.0`, englishRunbook })).valid).toBe(false);
  });

  it("keeps plan-only release and immutable rollback contracts section-local", async () => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    expect((await validateReadmeParity(korean, english, { root, koreanRunbook: koreanRunbook.replace("releases/${release_sha}/", "upload/copy releases/${release_sha}/"), englishRunbook })).valid).toBe(false);
    expect((await validateReadmeParity(korean, english, { root, koreanRunbook: `${koreanRunbook}\nnpm run upload:release-prefix -- --execute`, englishRunbook })).valid).toBe(false);
  });

  it.each([
    [
      "env key",
      { from: "[release.env] 3. 운영 env와 검증", to: "[release.toolchain] 1. 고정 도구와 안전한 시작", marker: "VITE_GOOGLE_CLIENT_ID" },
      "ko:section:release.env:VITE_GOOGLE_CLIENT_ID",
    ],
    [
      "receipt key",
      { from: "[release.env] 3. 운영 env와 검증", to: "[release.toolchain] 1. 고정 도구와 안전한 시작", marker: "tenantPolicy", asComment: true },
      "ko:section:release.env:tenantPolicy",
    ],
    [
      "readiness state",
      { from: null, to: "[release.toolchain] 1. 고정 도구와 안전한 시작", marker: "INCOMPLETE / UNOBSERVED" },
      "ko:section:release.status:INCOMPLETE / UNOBSERVED",
    ],
    [
      "dry-run mode",
      { from: "[release.first-release] 6. 첫 릴리즈와 smoke", to: "[release.rollback] 7. 롤백과 사고 대응", marker: "--dry-run" },
      "ko:section:release.first-release:--dry-run",
    ],
    [
      "executable origin equality",
      { from: "[release.first-release] 6. 첫 릴리즈와 smoke", to: "[release.env] 3. 운영 env와 검증", marker: "test \"$(git rev-parse origin/main)\" = \"${release_sha}\"" },
      "ko:section:release.first-release:test \"$(git rev-parse origin/main)\" = \"${release_sha}\"",
    ],
    [
      "release contract verification",
      { from: "[release.validation] 4. 검증과 빌드 gate", to: "[release.first-release] 6. 첫 릴리즈와 smoke", marker: "npm run verify:release-contract" },
      "ko:section:release.validation:npm run verify:release-contract",
    ],
  ])("rejects a %s marker moved into the wrong README section", async (_label, movement, expectedError) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const result = await validateReadmeParity(moveMarker(korean, movement), english, { root, koreanRunbook, englishRunbook });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(expectedError);
  });

  it("rejects a marker moved between runbook Prerequisites and Operator input sections", async () => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const moved = moveMarker(koreanRunbook, { from: "운영 입력 계약", to: "사전 조건", marker: "umask 077" });
    const result = await validateReadmeParity(korean, english, { root, koreanRunbook: moved, englishRunbook });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ko:runbook-section:runbook.operator-input:umask 077");
  });

  it.each([
    [
      "current double symbolic HEAD build",
      { ...VALID_PACKAGE_SCRIPTS, "build:release-manifest": "node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha \"$(git rev-parse HEAD)\" --source-date-epoch \"$(git show -s --format=%ct HEAD)\"" },
      "package:script:build:release-manifest",
    ],
    [
      "mixed build SHA source",
      { ...VALID_PACKAGE_SCRIPTS, "build:release-manifest": VALID_PACKAGE_SCRIPTS["build:release-manifest"].replace("$(git rev-parse HEAD)", "$GITHUB_SHA") },
      "package:script:build:release-manifest",
    ],
    [
      "upload without dry-run",
      { ...VALID_PACKAGE_SCRIPTS, "upload:release-prefix": VALID_PACKAGE_SCRIPTS["upload:release-prefix"].replace(" --dry-run", "") },
      "package:script:upload:release-prefix",
    ],
    [
      "upload execute mode",
      { ...VALID_PACKAGE_SCRIPTS, "upload:release-prefix": VALID_PACKAGE_SCRIPTS["upload:release-prefix"].replace("--dry-run", "--execute") },
      "package:script:upload:release-prefix",
    ],
    [
      "broadened release test scope",
      { ...VALID_PACKAGE_SCRIPTS, "verify:release-contract": VALID_PACKAGE_SCRIPTS["verify:release-contract"].replace("scripts/lib/release-manifest.test.mjs", "scripts/**/*.test.mjs") },
      "package:script:verify:release-contract",
    ],
  ])("rejects a mutated package script: %s", async (_label, scripts, expectedError) => {
    const packageRoot = await mkdtemp(join(tmpdir(), "molroom-readme-parity-"));
    try {
      await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ scripts })}\n`, { mode: 0o600 });
      const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
        readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
        readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
      ]);
      const result = await validateReadmeParity(korean, english, { root: packageRoot, koreanRunbook, englishRunbook });
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(expectedError);
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });
});
