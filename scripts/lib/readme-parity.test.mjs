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
const EVIDENCE_COMMAND = "node scripts/google-spike/validate-evidence.mjs docs/spikes/google-workspace/evidence/provisioning.json";
const PROVISIONING_COMMAND = "node scripts/google-spike/validate-provisioning.mjs .env.google-spike.local provisioning-receipt.local";
const SENSITIVE_SCAN_ARGUMENTS = "--redact docs/spikes/google-workspace/provisioning.md docs/spikes/google-workspace/evidence/provisioning.json scripts/google-spike/lib/provisioning.mjs scripts/google-spike/lib/provisioning.test.mjs scripts/google-spike/validate-provisioning.mjs";
const SENSITIVE_SCAN_COMMAND = `node scripts/google-spike/scan-sensitive-paths.mjs ${SENSITIVE_SCAN_ARGUMENTS}`;
const VALIDATOR_COMMANDS = Object.freeze([
  [EVIDENCE_COMMAND, "node scripts/google-spike/validate-evidence.mjs"],
  [PROVISIONING_COMMAND, "node scripts/google-spike/validate-provisioning.mjs"],
  [SENSITIVE_SCAN_COMMAND, "node scripts/google-spike/scan-sensitive-paths.mjs --redact"],
]);
const CLEAN_WORKTREE_COMMAND = "git diff --quiet";
const CLEAN_INDEX_COMMAND = "git diff --cached --quiet";
const RELEASE_RANGE_DIFF = 'git diff --quiet "${release_sha}^" "${release_sha}"';
const REPEATED_SPACE_RELEASE_RANGE_DIFF = 'git  diff --quiet "${release_sha}^" "${release_sha}"';
const EVIDENCE_PREFIX = "node scripts/google-spike/validate-evidence.mjs";
const PROVISIONING_PREFIX = "node scripts/google-spike/validate-provisioning.mjs";
const SENSITIVE_SCAN_PREFIX = "node scripts/google-spike/scan-sensitive-paths.mjs";
const VALIDATOR_PREFIX_COLLISIONS = Object.freeze([
  [EVIDENCE_PREFIX, EVIDENCE_COMMAND, `${EVIDENCE_COMMAND} --kind provisioning`],
  [PROVISIONING_PREFIX, PROVISIONING_COMMAND, `${PROVISIONING_COMMAND} unexpected`],
  [SENSITIVE_SCAN_PREFIX, SENSITIVE_SCAN_COMMAND, `${SENSITIVE_SCAN_COMMAND} docs/spikes/google-workspace/provisioning.md`],
]);
const CLEAN_PREFIX_COLLISIONS = Object.freeze([
  [CLEAN_WORKTREE_COMMAND, CLEAN_WORKTREE_COMMAND, `${CLEAN_WORKTREE_COMMAND} -- README.ko.md`],
  [CLEAN_INDEX_COMMAND, CLEAN_INDEX_COMMAND, `${CLEAN_INDEX_COMMAND} -- README.ko.md`],
]);
const EVIDENCE_TAB_COLLISION = "node scripts/google-spike/validate-evidence.mjs\tdocs/spikes/google-workspace/evidence/provisioning.json";
const INTERNAL_NODE_TAB_COLLISION = "node\tscripts/google-spike/validate-evidence.mjs docs/spikes/google-workspace/evidence/provisioning.json";
const FETCH_COMMAND = "git fetch origin main --quiet";
const RELEASE_SHA_COMMAND = 'release_sha="$(git rev-parse HEAD)"';
const CLEAN_STATUS_COMMAND = 'test -z "$(git status --porcelain)"';
const ORIGIN_EQUALITY_COMMAND = 'test "$(git rev-parse origin/main)" = "${release_sha}"';
const README_BUILD_COMMAND = 'node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha "${release_sha}" --package-version "$(node -p \'require(\\\"./package.json\\\").version\')" --source-date-epoch "$(git show -s --format=%ct "${release_sha}")"';
const RUNBOOK_BUILD_COMMAND = 'node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha "$release_sha" --package-version "$(node -p \'require(\\\"./package.json\\\").version\')" --source-date-epoch "$(git show -s --format=%ct "$release_sha")"';

const README_UPLOAD_PREFIX = "node scripts/upload-release-prefix.mjs";
const README_UPLOAD_COMMAND = 'node scripts/upload-release-prefix.mjs --artifact-root dist --bucket "molroom-<account>-us-east-1-origin" --commit-sha "${release_sha}" --dry-run';
const README_UPLOAD_WITHOUT_DRY_RUN = README_UPLOAD_COMMAND.replace(" --dry-run", "");
const README_PLAN_COMMANDS = Object.freeze([
  FETCH_COMMAND,
  RELEASE_SHA_COMMAND,
  CLEAN_STATUS_COMMAND,
  CLEAN_WORKTREE_COMMAND,
  CLEAN_INDEX_COMMAND,
  ORIGIN_EQUALITY_COMMAND,
  README_BUILD_COMMAND,
  README_UPLOAD_COMMAND,
]);
const README_PLAN_NEW_COMMAND_SPECS = Object.freeze([
  [RELEASE_SHA_COMMAND, RELEASE_SHA_COMMAND, `${RELEASE_SHA_COMMAND} unexpected`],
  [CLEAN_STATUS_COMMAND, CLEAN_STATUS_COMMAND, `${CLEAN_STATUS_COMMAND} unexpected`],
  [README_UPLOAD_PREFIX, README_UPLOAD_COMMAND, `${README_UPLOAD_COMMAND} unexpected`],
]);
const FORBIDDEN_LOCAL_TAG_COMMANDS = Object.freeze([
  'git\ttag\tv0.1.0\t"${release_sha}"',
  'git  tag -s -m "MolRoom release" v0.1.0 "${release_sha}"',
  'git\ttag\t-u\tA1B2C3D4\t-F\trelease-message.txt\tv0.1.0',
  'git  tag --trailer "Release: true" v0.1.0 "${release_sha}"',
  'git\ttag\t-a\tv0.1.0\t"${release_sha}"',
]);
const FORBIDDEN_LOCAL_PUSH_COMMANDS = Object.freeze([
  "git\tpush",
  "git\tpush\tupstream\t--tags",
  "git  push --tags  upstream",
  "git\tpush\t--atomic\tfork\tmain",
]);
const SECURITY_DOCUMENT_TARGETS = Object.freeze([
  ["Korean README", "ko", "readme"],
  ["English README", "en", "readme"],
  ["Korean runbook", "ko", "runbook"],
  ["English runbook", "en", "runbook"],
]);

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

function appendMarkerToSection(document, heading, marker) {
  const section = sectionBounds(document, heading);
  return `${document.slice(0, section.end)}\n${marker}${document.slice(section.end)}`;
}

function moveCommandOutsideFence(document, heading, command) {
  const section = sectionBounds(document, heading);
  const body = document.slice(section.start, section.end);
  const commandLine = `\n${command}\n`;
  if (!body.includes(commandLine)) throw new Error(`missing fenced test fixture command: ${command}`);
  const withoutCommand = `${document.slice(0, section.start)}${body.replace(commandLine, "\n")}${document.slice(section.end)}`;
  return appendMarkerToSection(withoutCommand, heading, command);
}

function replaceCommandFence(document, heading, command, openingFence, closingFence) {
  const section = sectionBounds(document, heading);
  const body = document.slice(section.start, section.end);
  const commandIndex = body.indexOf(`\n${command}\n`);
  if (commandIndex < 0) throw new Error(`missing fenced test fixture command: ${command}`);
  const opening = "\n```bash\n";
  const closing = "\n```\n";
  const openingIndex = body.lastIndexOf(opening, commandIndex);
  const closingIndex = body.indexOf(closing, commandIndex);
  if (openingIndex < 0 || closingIndex < 0) throw new Error(`missing test fixture fence for command: ${command}`);
  const mutatedBody = `${body.slice(0, openingIndex)}\n${openingFence}\n${body.slice(openingIndex + opening.length, closingIndex)}\n${closingFence}\n${body.slice(closingIndex + closing.length)}`;
  return `${document.slice(0, section.start)}${mutatedBody}${document.slice(section.end)}`;
}

function insertLineBeforeCommand(document, command, line) {
  const commandLine = `\n${command}\n`;
  if (!document.includes(commandLine)) throw new Error(`missing test fixture command: ${command}`);
  return document.replace(commandLine, `\n${line}\n${command}\n`);
}

function moveCommandAfterLongerFenceClose(document, heading, command) {
  const section = sectionBounds(document, heading);
  const body = document.slice(section.start, section.end);
  const commandLine = `\n${command}\n`;
  const commandIndex = body.indexOf(commandLine);
  if (commandIndex < 0) throw new Error(`missing fenced test fixture command: ${command}`);
  const withoutCommand = body.replace(commandLine, "\n");
  const openingIndex = withoutCommand.lastIndexOf("\n```bash\n", commandIndex);
  const closing = "\n```\n";
  const closingIndex = withoutCommand.indexOf(closing, openingIndex);
  if (openingIndex < 0 || closingIndex < 0) throw new Error(`missing test fixture fence for command: ${command}`);
  const mutatedBody = `${withoutCommand.slice(0, closingIndex)}\n\`\`\`\`\n${command}\n\`\`\`\n${withoutCommand.slice(closingIndex + closing.length)}`;
  return `${document.slice(0, section.start)}${mutatedBody}${document.slice(section.end)}`;
}

function swapExactLines(document, first, second) {
  const lines = document.split("\n");
  const firstIndex = lines.indexOf(first);
  const secondIndex = lines.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0) throw new Error("missing exact test fixture command");
  [lines[firstIndex], lines[secondIndex]] = [lines[secondIndex], lines[firstIndex]];
  return lines.join("\n");
}

function swapAdjacentSections(document, firstHeading, secondHeading) {
  const first = sectionBounds(document, firstHeading);
  const second = sectionBounds(document, secondHeading);
  if (first.end + 1 !== second.start) throw new Error("test fixture sections are not adjacent");
  const separator = document.slice(first.end, second.start);
  return `${document.slice(0, first.start)}${document.slice(second.start, second.end)}${separator}${document.slice(first.start, first.end)}${document.slice(second.end)}`;
}

function withExecutableRunbookCommands(document) {
  return document
    .replace(/^node scripts\/google-spike\/validate-evidence\.mjs.*$/m, EVIDENCE_COMMAND)
    .replace(/^node scripts\/google-spike\/validate-provisioning\.mjs.*$/m, PROVISIONING_COMMAND)
    .replace(/^node scripts\/google-spike\/scan-sensitive-paths\.mjs.*$/m, SENSITIVE_SCAN_COMMAND);
}

function withSafeReleaseDiffCommands(document) {
  return document.replace(RELEASE_RANGE_DIFF, `${CLEAN_WORKTREE_COMMAND}\n${CLEAN_INDEX_COMMAND}`);
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
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects the release commit-range diff in %s", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const result = await validateReadmeParity(
      locale === "ko" ? `${korean}\n${RELEASE_RANGE_DIFF}\n` : korean,
      locale === "en" ? `${english}\n${RELEASE_RANGE_DIFF}\n` : english,
      { root, koreanRunbook, englishRunbook },
    );
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(`${locale}:forbidden:release-commit-range-diff`);
  });

  it.each([
    ["Korean worktree", "ko", CLEAN_WORKTREE_COMMAND],
    ["Korean index", "ko", CLEAN_INDEX_COMMAND],
    ["English worktree", "en", CLEAN_WORKTREE_COMMAND],
    ["English index", "en", CLEAN_INDEX_COMMAND],
  ])("requires the clean %s command in the first-release section", async (_label, locale, command) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const safeKorean = withSafeReleaseDiffCommands(korean);
    const safeEnglish = withSafeReleaseDiffCommands(english);
    const result = await validateReadmeParity(
      locale === "ko" ? safeKorean.replace(command, "clean check removed") : safeKorean,
      locale === "en" ? safeEnglish.replace(command, "clean check removed") : safeEnglish,
      { root, koreanRunbook, englishRunbook },
    );
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(`${locale}:section:release.first-release:${command}`);
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects naked or incomplete Google validation commands in the %s README", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    for (const [command, incomplete] of VALIDATOR_COMMANDS) {
      const result = await validateReadmeParity(
        locale === "ko" ? korean.replace(command, incomplete) : korean,
        locale === "en" ? english.replace(command, incomplete) : english,
        { root, koreanRunbook, englishRunbook },
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(`${locale}:section:release.env:${command}`);
    }
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects naked or incomplete Google validation commands in the %s runbook", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const executableKorean = withExecutableRunbookCommands(koreanRunbook);
    const executableEnglish = withExecutableRunbookCommands(englishRunbook);
    for (const [command, incomplete] of VALIDATOR_COMMANDS) {
      const result = await validateReadmeParity(korean, english, {
        root,
        koreanRunbook: locale === "ko" ? executableKorean.replace(command, incomplete) : executableKorean,
        englishRunbook: locale === "en" ? executableEnglish.replace(command, incomplete) : executableEnglish,
      });
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(`${locale}:runbook-section:runbook.operator-input:${command}`);
    }
  });

  it.each([
    ["Korean README", "ko", "readme"],
    ["English README", "en", "readme"],
    ["Korean runbook", "ko", "runbook"],
    ["English runbook", "en", "runbook"],
  ])("rejects a TAB-delimited command-prefix collision in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const readmeHeading = locale === "ko" ? "[release.env] 3. 운영 env와 검증" : "[release.env] 3. Operator env and validation";
    const runbookHeading = locale === "ko" ? "운영 입력 계약" : "Operator input contract";
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? appendMarkerToSection(korean, readmeHeading, EVIDENCE_TAB_COLLISION) : korean,
      kind === "readme" && locale === "en" ? appendMarkerToSection(english, readmeHeading, EVIDENCE_TAB_COLLISION) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? appendMarkerToSection(koreanRunbook, runbookHeading, EVIDENCE_TAB_COLLISION) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? appendMarkerToSection(englishRunbook, runbookHeading, EVIDENCE_TAB_COLLISION) : englishRunbook,
      },
    );
    expect(result.valid).toBe(false);
    const section = kind === "readme" ? "section:release.env" : "runbook-section:runbook.operator-input";
    expect(result.missing).toContain(`${locale}:${section}:noncanonical-command:${EVIDENCE_PREFIX}`);
  });

  it.each([
    ["Korean README", "ko", "readme"],
    ["English README", "en", "readme"],
    ["Korean runbook", "ko", "runbook"],
    ["English runbook", "en", "runbook"],
  ])("rejects exact commands duplicated outside their required section in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const readmeHeading = locale === "ko" ? "[release.toolchain] 1. 고정 도구와 안전한 시작" : "[release.toolchain] 1. Pinned tools and safe start";
    const runbookHeading = locale === "ko" ? "사전 조건" : "Prerequisites";
    const specs = kind === "readme"
      ? [...VALIDATOR_PREFIX_COLLISIONS, ...CLEAN_PREFIX_COLLISIONS, ...README_PLAN_NEW_COMMAND_SPECS]
      : VALIDATOR_PREFIX_COLLISIONS;
    for (const [, exact] of specs) {
      const result = await validateReadmeParity(
        kind === "readme" && locale === "ko" ? appendMarkerToSection(korean, readmeHeading, exact) : korean,
        kind === "readme" && locale === "en" ? appendMarkerToSection(english, readmeHeading, exact) : english,
        {
          root,
          koreanRunbook: kind === "runbook" && locale === "ko" ? appendMarkerToSection(koreanRunbook, runbookHeading, exact) : koreanRunbook,
          englishRunbook: kind === "runbook" && locale === "en" ? appendMarkerToSection(englishRunbook, runbookHeading, exact) : englishRunbook,
        },
      );
      expect(result.valid).toBe(false);
      const label = kind === "readme" ? "document" : "runbook-document";
      expect(result.missing).toContain(`${locale}:${label}:command-count:${exact}`);
    }
  });

  it.each([
    ["Korean README", "ko", "readme"],
    ["English README", "en", "readme"],
    ["Korean runbook", "ko", "runbook"],
    ["English runbook", "en", "runbook"],
  ])("rejects noncanonical command prefixes outside their required section in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const readmeHeading = locale === "ko" ? "[release.toolchain] 1. 고정 도구와 안전한 시작" : "[release.toolchain] 1. Pinned tools and safe start";
    const runbookHeading = locale === "ko" ? "사전 조건" : "Prerequisites";
    const specs = kind === "readme"
      ? [...VALIDATOR_PREFIX_COLLISIONS, ...CLEAN_PREFIX_COLLISIONS, ...README_PLAN_NEW_COMMAND_SPECS]
      : VALIDATOR_PREFIX_COLLISIONS;
    for (const [prefix, , collision] of specs) {
      const result = await validateReadmeParity(
        kind === "readme" && locale === "ko" ? appendMarkerToSection(korean, readmeHeading, collision) : korean,
        kind === "readme" && locale === "en" ? appendMarkerToSection(english, readmeHeading, collision) : english,
        {
          root,
          koreanRunbook: kind === "runbook" && locale === "ko" ? appendMarkerToSection(koreanRunbook, runbookHeading, collision) : koreanRunbook,
          englishRunbook: kind === "runbook" && locale === "en" ? appendMarkerToSection(englishRunbook, runbookHeading, collision) : englishRunbook,
        },
      );
      expect(result.valid).toBe(false);
      const label = kind === "readme" ? "document" : "runbook-document";
      expect(result.missing).toContain(`${locale}:${label}:noncanonical-command:${prefix}`);
    }
  });

  it.each([
    ["Korean README", "ko", "readme"],
    ["English README", "en", "readme"],
    ["Korean runbook", "ko", "runbook"],
    ["English runbook", "en", "runbook"],
  ])("rejects an internal node-to-script TAB separator in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const readmeHeading = locale === "ko" ? "[release.env] 3. 운영 env와 검증" : "[release.env] 3. Operator env and validation";
    const runbookHeading = locale === "ko" ? "운영 입력 계약" : "Operator input contract";
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? appendMarkerToSection(korean, readmeHeading, INTERNAL_NODE_TAB_COLLISION) : korean,
      kind === "readme" && locale === "en" ? appendMarkerToSection(english, readmeHeading, INTERNAL_NODE_TAB_COLLISION) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? appendMarkerToSection(koreanRunbook, runbookHeading, INTERNAL_NODE_TAB_COLLISION) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? appendMarkerToSection(englishRunbook, runbookHeading, INTERNAL_NODE_TAB_COLLISION) : englishRunbook,
      },
    );
    expect(result.valid).toBe(false);
    const section = kind === "readme" ? "section:release.env" : "runbook-section:runbook.operator-input";
    expect(result.missing).toContain(`${locale}:${section}:noncanonical-command:${EVIDENCE_PREFIX}`);
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects repeated internal spaces in the %s release commit-range diff", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const heading = locale === "ko" ? "[release.first-release] 6. 첫 릴리즈와 smoke" : "[release.first-release] 6. First release and smoke";
    const result = await validateReadmeParity(
      locale === "ko" ? appendMarkerToSection(korean, heading, REPEATED_SPACE_RELEASE_RANGE_DIFF) : korean,
      locale === "en" ? appendMarkerToSection(english, heading, REPEATED_SPACE_RELEASE_RANGE_DIFF) : english,
      { root, koreanRunbook, englishRunbook },
    );
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(`${locale}:section:release.first-release:noncanonical-command:${CLEAN_WORKTREE_COMMAND}`);
    expect(result.missing).toContain(`${locale}:forbidden:release-commit-range-diff`);
  });

  it.each([
    ["Korean README", "ko", "readme"],
    ["English README", "en", "readme"],
    ["Korean runbook", "ko", "runbook"],
    ["English runbook", "en", "runbook"],
  ])("requires Google commands inside executable fences in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const heading = kind === "readme"
      ? (locale === "ko" ? "[release.env] 3. 운영 env와 검증" : "[release.env] 3. Operator env and validation")
      : (locale === "ko" ? "운영 입력 계약" : "Operator input contract");
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? moveCommandOutsideFence(korean, heading, SENSITIVE_SCAN_COMMAND) : korean,
      kind === "readme" && locale === "en" ? moveCommandOutsideFence(english, heading, SENSITIVE_SCAN_COMMAND) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? moveCommandOutsideFence(koreanRunbook, heading, SENSITIVE_SCAN_COMMAND) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? moveCommandOutsideFence(englishRunbook, heading, SENSITIVE_SCAN_COMMAND) : englishRunbook,
      },
    );
    expect(result.valid).toBe(false);
    const section = kind === "readme" ? "section:release.env" : "runbook-section:runbook.operator-input";
    expect(result.missing).toContain(`${locale}:${section}:executable-command-count:${SENSITIVE_SCAN_COMMAND}`);
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("requires every first-release PLAN command inside an executable fence in the %s README", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const heading = locale === "ko" ? "[release.first-release] 6. 첫 릴리즈와 smoke" : "[release.first-release] 6. First release and smoke";
    for (const command of README_PLAN_COMMANDS) {
      const result = await validateReadmeParity(
        locale === "ko" ? moveCommandOutsideFence(korean, heading, command) : korean,
        locale === "en" ? moveCommandOutsideFence(english, heading, command) : english,
        { root, koreanRunbook, englishRunbook },
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(`${locale}:section:release.first-release:executable-command-count:${command}`);
    }
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects a removed exact first-release PLAN command in the %s README", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const heading = locale === "ko" ? "[release.first-release] 6. 첫 릴리즈와 smoke" : "[release.first-release] 6. First release and smoke";
    for (const command of [RELEASE_SHA_COMMAND, CLEAN_STATUS_COMMAND, README_UPLOAD_COMMAND]) {
      const source = locale === "ko" ? korean : english;
      let mutated = source.replace(`\n${command}\n`, "\n");
      if (command === README_UPLOAD_COMMAND) {
        mutated = appendMarkerToSection(mutated, heading, `${README_UPLOAD_PREFIX}\n--dry-run`);
      }
      const result = await validateReadmeParity(
        locale === "ko" ? mutated : korean,
        locale === "en" ? mutated : english,
        { root, koreanRunbook, englishRunbook },
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(`${locale}:section:release.first-release:command-count:${command}`);
    }
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects duplicate and prefixed first-release PLAN commands in the %s README", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const heading = locale === "ko" ? "[release.first-release] 6. 첫 릴리즈와 smoke" : "[release.first-release] 6. First release and smoke";
    for (const [prefix, exact, collision] of README_PLAN_NEW_COMMAND_SPECS) {
      const duplicate = locale === "ko"
        ? [appendMarkerToSection(korean, heading, exact), english]
        : [korean, appendMarkerToSection(english, heading, exact)];
      const duplicateResult = await validateReadmeParity(duplicate[0], duplicate[1], { root, koreanRunbook, englishRunbook });
      expect(duplicateResult.valid).toBe(false);
      expect(duplicateResult.missing).toContain(`${locale}:section:release.first-release:command-count:${exact}`);

      const prefixed = locale === "ko"
        ? [appendMarkerToSection(korean, heading, collision), english]
        : [korean, appendMarkerToSection(english, heading, collision)];
      const prefixedResult = await validateReadmeParity(prefixed[0], prefixed[1], { root, koreanRunbook, englishRunbook });
      expect(prefixedResult.valid).toBe(false);
      expect(prefixedResult.missing).toContain(`${locale}:section:release.first-release:noncanonical-command:${prefix}`);
    }
  });

  it.each([
    ["Korean fetch/assignment", "ko", FETCH_COMMAND, RELEASE_SHA_COMMAND],
    ["Korean manifest/upload", "ko", README_BUILD_COMMAND, README_UPLOAD_COMMAND],
    ["English fetch/assignment", "en", FETCH_COMMAND, RELEASE_SHA_COMMAND],
    ["English manifest/upload", "en", README_BUILD_COMMAND, README_UPLOAD_COMMAND],
  ])("rejects out-of-order first-release PLAN commands in %s", async (_label, locale, first, second) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const result = await validateReadmeParity(
      locale === "ko" ? swapExactLines(korean, first, second) : korean,
      locale === "en" ? swapExactLines(english, first, second) : english,
      { root, koreanRunbook, englishRunbook },
    );
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(`${locale}:section:release.first-release:command-order`);
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("binds --dry-run to the exact upload command in the %s README", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const heading = locale === "ko" ? "[release.first-release] 6. 첫 릴리즈와 smoke" : "[release.first-release] 6. First release and smoke";
    const source = locale === "ko" ? korean : english;
    const mutated = appendMarkerToSection(source.replace(README_UPLOAD_COMMAND, README_UPLOAD_WITHOUT_DRY_RUN), heading, "--dry-run");
    const result = await validateReadmeParity(
      locale === "ko" ? mutated : korean,
      locale === "en" ? mutated : english,
      { root, koreanRunbook, englishRunbook },
    );
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(`${locale}:section:release.first-release:command-count:${README_UPLOAD_COMMAND}`);
    expect(result.missing).toContain(`${locale}:section:release.first-release:noncanonical-command:${README_UPLOAD_PREFIX}`);
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("requires origin and build commands inside executable fences in the %s runbook", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const operatorHeading = locale === "ko" ? "운영 입력 계약" : "Operator input contract";
    const sequenceHeading = locale === "ko" ? "실행 순서" : "Sequence";
    for (const [heading, section, command] of [
      [operatorHeading, "runbook.operator-input", FETCH_COMMAND],
      [operatorHeading, "runbook.operator-input", ORIGIN_EQUALITY_COMMAND],
      [sequenceHeading, "runbook.sequence", RUNBOOK_BUILD_COMMAND],
    ]) {
      const result = await validateReadmeParity(korean, english, {
        root,
        koreanRunbook: locale === "ko" ? moveCommandOutsideFence(koreanRunbook, heading, command) : koreanRunbook,
        englishRunbook: locale === "en" ? moveCommandOutsideFence(englishRunbook, heading, command) : englishRunbook,
      });
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(`${locale}:runbook-section:${section}:executable-command-count:${command}`);
    }
  });

  it.each([
    ["Korean README four-backtick fence", "ko", "readme", "   ````bash\t", "  ````   "],
    ["English README tilde fence", "en", "readme", "~~~sh\t", " ~~~~  "],
    ["Korean runbook tilde fence", "ko", "runbook", "  ~~~bash  ", "~~~\t"],
    ["English runbook four-backtick fence", "en", "runbook", "````sh  ", "   `````"],
  ])("accepts a bounded CommonMark executable %s", async (_label, locale, kind, opening, closing) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const readmeHeading = locale === "ko" ? "[release.env] 3. 운영 env와 검증" : "[release.env] 3. Operator env and validation";
    const runbookHeading = locale === "ko" ? "운영 입력 계약" : "Operator input contract";
    const mutate = (document) => replaceCommandFence(
      document,
      kind === "readme" ? readmeHeading : runbookHeading,
      SENSITIVE_SCAN_COMMAND,
      opening,
      closing,
    );
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? mutate(korean) : korean,
      kind === "readme" && locale === "en" ? mutate(english) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? mutate(koreanRunbook) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? mutate(englishRunbook) : englishRunbook,
      },
    );
    expect(result).toEqual({ valid: true, missing: [] });
  });

  it.each([
    ["shorter backtick delimiter", "ko", "````bash", "````", "```"],
    ["mismatched backtick delimiter", "en", "~~~sh", "~~~~", "```"],
  ])("does not close an executable fence with a %s", async (_label, locale, opening, closing, embeddedDelimiter) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const heading = locale === "ko" ? "[release.env] 3. 운영 env와 검증" : "[release.env] 3. Operator env and validation";
    const source = locale === "ko" ? korean : english;
    const fenced = replaceCommandFence(source, heading, SENSITIVE_SCAN_COMMAND, opening, closing);
    const mutated = insertLineBeforeCommand(fenced, SENSITIVE_SCAN_COMMAND, embeddedDelimiter);
    const result = await validateReadmeParity(
      locale === "ko" ? mutated : korean,
      locale === "en" ? mutated : english,
      { root, koreanRunbook, englishRunbook },
    );
    expect(result).toEqual({ valid: true, missing: [] });
  });

  it.each([
    ["Korean README", "ko", "readme"],
    ["English README", "en", "readme"],
    ["Korean runbook", "ko", "runbook"],
    ["English runbook", "en", "runbook"],
  ])("treats a four-backtick delimiter as the close of a triple-backtick fence in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const readmeHeading = locale === "ko" ? "[release.env] 3. 운영 env와 검증" : "[release.env] 3. Operator env and validation";
    const runbookHeading = locale === "ko" ? "운영 입력 계약" : "Operator input contract";
    const mutate = (document) => moveCommandAfterLongerFenceClose(
      document,
      kind === "readme" ? readmeHeading : runbookHeading,
      SENSITIVE_SCAN_COMMAND,
    );
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? mutate(korean) : korean,
      kind === "readme" && locale === "en" ? mutate(english) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? mutate(koreanRunbook) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? mutate(englishRunbook) : englishRunbook,
      },
    );
    expect(result.valid).toBe(false);
    const section = kind === "readme" ? "section:release.env" : "runbook-section:runbook.operator-input";
    expect(result.missing).toContain(`${locale}:${section}:executable-command-count:${SENSITIVE_SCAN_COMMAND}`);
  });

  it.each([
    ["Korean README", "ko", "readme"],
    ["English README", "en", "readme"],
    ["Korean runbook", "ko", "runbook"],
    ["English runbook", "en", "runbook"],
  ])("rejects scanner arguments moved out of the executable section in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const executableKorean = withExecutableRunbookCommands(koreanRunbook);
    const executableEnglish = withExecutableRunbookCommands(englishRunbook);
    const moveReadmeArguments = (document, from, to) => moveMarker(document, { from, to, marker: SENSITIVE_SCAN_ARGUMENTS });
    const moveRunbookArguments = (document, from, to) => moveMarker(document, { from, to, marker: SENSITIVE_SCAN_ARGUMENTS });
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? moveReadmeArguments(korean, "[release.env] 3. 운영 env와 검증", "[release.toolchain] 1. 고정 도구와 안전한 시작") : korean,
      kind === "readme" && locale === "en" ? moveReadmeArguments(english, "[release.env] 3. Operator env and validation", "[release.toolchain] 1. Pinned tools and safe start") : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? moveRunbookArguments(executableKorean, "운영 입력 계약", "사전 조건") : executableKorean,
        englishRunbook: kind === "runbook" && locale === "en" ? moveRunbookArguments(executableEnglish, "Operator input contract", "Prerequisites") : executableEnglish,
      },
    );
    expect(result.valid).toBe(false);
    const section = kind === "readme" ? "section:release.env" : "runbook-section:runbook.operator-input";
    expect(result.missing).toContain(`${locale}:${section}:${SENSITIVE_SCAN_COMMAND}`);
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects duplicate standalone exact commands in the %s documents", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const readmeEnvHeading = locale === "ko" ? "[release.env] 3. 운영 env와 검증" : "[release.env] 3. Operator env and validation";
    const readmeReleaseHeading = locale === "ko" ? "[release.first-release] 6. 첫 릴리즈와 smoke" : "[release.first-release] 6. First release and smoke";
    const runbookInputHeading = locale === "ko" ? "운영 입력 계약" : "Operator input contract";
    for (const [kind, heading, command, expectedError] of [
      ["readme", readmeEnvHeading, EVIDENCE_COMMAND, `${locale}:section:release.env:command-count:${EVIDENCE_COMMAND}`],
      ["readme", readmeReleaseHeading, CLEAN_WORKTREE_COMMAND, `${locale}:section:release.first-release:command-count:${CLEAN_WORKTREE_COMMAND}`],
      ["runbook", runbookInputHeading, EVIDENCE_COMMAND, `${locale}:runbook-section:runbook.operator-input:command-count:${EVIDENCE_COMMAND}`],
    ]) {
      const result = await validateReadmeParity(
        kind === "readme" && locale === "ko" ? appendMarkerToSection(korean, heading, command) : korean,
        kind === "readme" && locale === "en" ? appendMarkerToSection(english, heading, command) : english,
        {
          root,
          koreanRunbook: kind === "runbook" && locale === "ko" ? appendMarkerToSection(koreanRunbook, heading, command) : koreanRunbook,
          englishRunbook: kind === "runbook" && locale === "en" ? appendMarkerToSection(englishRunbook, heading, command) : englishRunbook,
        },
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(expectedError);
    }
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects noncanonical command-prefix collisions in the %s documents", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const readmeEnvHeading = locale === "ko" ? "[release.env] 3. 운영 env와 검증" : "[release.env] 3. Operator env and validation";
    const readmeReleaseHeading = locale === "ko" ? "[release.first-release] 6. 첫 릴리즈와 smoke" : "[release.first-release] 6. First release and smoke";
    const runbookInputHeading = locale === "ko" ? "운영 입력 계약" : "Operator input contract";
    for (const [prefix, , collision] of VALIDATOR_PREFIX_COLLISIONS) {
      for (const [kind, heading, expectedError] of [
        ["readme", readmeEnvHeading, `${locale}:section:release.env:noncanonical-command:${prefix}`],
        ["runbook", runbookInputHeading, `${locale}:runbook-section:runbook.operator-input:noncanonical-command:${prefix}`],
      ]) {
        const result = await validateReadmeParity(
          kind === "readme" && locale === "ko" ? appendMarkerToSection(korean, heading, collision) : korean,
          kind === "readme" && locale === "en" ? appendMarkerToSection(english, heading, collision) : english,
          {
            root,
            koreanRunbook: kind === "runbook" && locale === "ko" ? appendMarkerToSection(koreanRunbook, heading, collision) : koreanRunbook,
            englishRunbook: kind === "runbook" && locale === "en" ? appendMarkerToSection(englishRunbook, heading, collision) : englishRunbook,
          },
        );
        expect(result.valid).toBe(false);
        expect(result.missing).toContain(expectedError);
      }
    }
    for (const [command, , collision] of CLEAN_PREFIX_COLLISIONS) {
      const result = await validateReadmeParity(
        locale === "ko" ? appendMarkerToSection(korean, readmeReleaseHeading, collision) : korean,
        locale === "en" ? appendMarkerToSection(english, readmeReleaseHeading, collision) : english,
        { root, koreanRunbook, englishRunbook },
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(`${locale}:section:release.first-release:noncanonical-command:${command}`);
    }
  });

  it.each([
    ["Korean README", "ko", "readme"],
    ["English README", "en", "readme"],
    ["Korean runbook", "ko", "runbook"],
    ["English runbook", "en", "runbook"],
  ])("rejects out-of-order Google validation commands in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? swapExactLines(korean, EVIDENCE_COMMAND, PROVISIONING_COMMAND) : korean,
      kind === "readme" && locale === "en" ? swapExactLines(english, EVIDENCE_COMMAND, PROVISIONING_COMMAND) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? swapExactLines(koreanRunbook, EVIDENCE_COMMAND, PROVISIONING_COMMAND) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? swapExactLines(englishRunbook, EVIDENCE_COMMAND, PROVISIONING_COMMAND) : englishRunbook,
      },
    );
    expect(result.valid).toBe(false);
    const section = kind === "readme" ? "section:release.env" : "runbook-section:runbook.operator-input";
    expect(result.missing).toContain(`${locale}:${section}:command-order`);
  });

  it("rejects a shared noncanonical README heading order", async () => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const result = await validateReadmeParity(
      swapAdjacentSections(korean, "[release.env] 3. 운영 env와 검증", "[release.validation] 4. 검증과 빌드 gate"),
      swapAdjacentSections(english, "[release.env] 3. Operator env and validation", "[release.validation] 4. Verification and build gate"),
      { root, koreanRunbook, englishRunbook },
    );
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ko:heading-order");
    expect(result.missing).toContain("en:heading-order");
  });

  it.each([
    ["Korean", "ko"],
    ["English", "en"],
  ])("rejects a noncanonical %s runbook heading order", async (_label, locale) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const result = await validateReadmeParity(korean, english, {
      root,
      koreanRunbook: locale === "ko" ? swapAdjacentSections(koreanRunbook, "사전 조건", "실행 순서") : koreanRunbook,
      englishRunbook: locale === "en" ? swapAdjacentSections(englishRunbook, "Prerequisites", "Sequence") : englishRunbook,
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(`${locale}:runbook-heading-order`);
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

  it("rejects contradictory implementation status", async () => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    expect((await validateReadmeParity(korean.replace("AWS CloudFormation·CloudFront·GitHub OIDC 배포 경로는 committed/defined 되어\n있지만 아직 configured/deployed/live 상태가 아닙니다.", "AWS CloudFormation·CloudFront·GitHub OIDC 배포는 아직 구현되지 않았습니다."), english, { root, koreanRunbook, englishRunbook })).valid).toBe(false);
  });

  it.each(SECURITY_DOCUMENT_TARGETS.flatMap(([label, locale, kind]) => (
    FORBIDDEN_LOCAL_TAG_COMMANDS.map((command) => [`${label}: ${command}`, locale, kind, command])
  )))("rejects token-normalized local tag command in %s", async (_label, locale, kind, command) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const anchor = kind === "readme" ? README_UPLOAD_COMMAND : RUNBOOK_BUILD_COMMAND;
    const mutate = (document) => insertLineBeforeCommand(document, anchor, command);
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? mutate(korean) : korean,
      kind === "readme" && locale === "en" ? mutate(english) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? mutate(koreanRunbook) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? mutate(englishRunbook) : englishRunbook,
      },
    );
    expect(result.valid).toBe(false);
    const errorLabel = kind === "readme" ? "forbidden" : "runbook-forbidden";
    expect(result.missing).toContain(`${locale}:${errorLabel}:local-git-tag`);
    expect(result.missing).not.toContain(`${locale}:${errorLabel}:local-git-push`);
  });

  it.each(SECURITY_DOCUMENT_TARGETS.flatMap(([label, locale, kind]) => (
    FORBIDDEN_LOCAL_PUSH_COMMANDS.map((command) => [`${label}: ${command}`, locale, kind, command])
  )))("rejects token-normalized local push command in %s", async (_label, locale, kind, command) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const anchor = kind === "readme" ? README_UPLOAD_COMMAND : RUNBOOK_BUILD_COMMAND;
    const mutate = (document) => insertLineBeforeCommand(document, anchor, command);
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? mutate(korean) : korean,
      kind === "readme" && locale === "en" ? mutate(english) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? mutate(koreanRunbook) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? mutate(englishRunbook) : englishRunbook,
      },
    );
    expect(result.valid).toBe(false);
    const errorLabel = kind === "readme" ? "forbidden" : "runbook-forbidden";
    expect(result.missing).toContain(`${locale}:${errorLabel}:local-git-push`);
    expect(result.missing).not.toContain(`${locale}:${errorLabel}:local-git-tag`);
  });

  it.each(SECURITY_DOCUMENT_TARGETS)("ignores local tag/push prose and shell comments in the %s", async (_label, locale, kind) => {
    const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
      readFile(join(root, "README.ko.md"), "utf8"), readFile(join(root, "README.en.md"), "utf8"),
      readFile(join(root, "docs/ops/release-ko.md"), "utf8"), readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    ]);
    const heading = kind === "readme"
      ? (locale === "ko" ? "[release.first-release] 6. 첫 릴리즈와 smoke" : "[release.first-release] 6. First release and smoke")
      : (locale === "ko" ? "실행 순서" : "Sequence");
    const anchor = kind === "readme" ? README_UPLOAD_COMMAND : RUNBOOK_BUILD_COMMAND;
    const mutate = (document) => {
      const withComments = insertLineBeforeCommand(
        insertLineBeforeCommand(document, anchor, "# git tag -s v0.1.0"),
        anchor,
        "#\tgit push upstream --tags",
      );
      return appendMarkerToSection(
        withComments,
        heading,
        "git tag -a v0.1.0 is a forbidden prose example; do not run it.\ngit push origin main is a forbidden prose example; do not run it.",
      );
    };
    const result = await validateReadmeParity(
      kind === "readme" && locale === "ko" ? mutate(korean) : korean,
      kind === "readme" && locale === "en" ? mutate(english) : english,
      {
        root,
        koreanRunbook: kind === "runbook" && locale === "ko" ? mutate(koreanRunbook) : koreanRunbook,
        englishRunbook: kind === "runbook" && locale === "en" ? mutate(englishRunbook) : englishRunbook,
      },
    );
    expect(result).toEqual({ valid: true, missing: [] });
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
