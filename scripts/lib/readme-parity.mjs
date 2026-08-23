import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const README_SECTION_IDS = Object.freeze([
  "release.toolchain", "release.google-oauth", "release.env",
  "release.validation", "release.aws-oidc", "release.first-release",
  "release.rollback", "release.security",
]);
const ENV_KEYS = Object.freeze([
  "VITE_GOOGLE_CLIENT_ID", "VITE_ALLOWED_HD", "GOOGLE_SPIKE_AUTHORIZED_ORIGINS",
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT", "GOOGLE_SPIKE_ADMIN_ACCOUNT",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID", "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
]);
const RECEIPT_KEYS = Object.freeze([
  "schemaVersion", "observation", "appType", "domain", "clientIdSuffix",
  "workspaceEdition", "enabledApis", "initialScopes", "directoryScopeTiming",
  "origins", "accounts", "rooms", "tenantPolicy", "operatorVerified",
]);
const EVIDENCE_COMMAND = "node scripts/google-spike/validate-evidence.mjs docs/spikes/google-workspace/evidence/provisioning.json";
const PROVISIONING_COMMAND = "node scripts/google-spike/validate-provisioning.mjs .env.google-spike.local provisioning-receipt.local";
const SENSITIVE_SCAN_COMMAND = "node scripts/google-spike/scan-sensitive-paths.mjs --redact docs/spikes/google-workspace/provisioning.md docs/spikes/google-workspace/evidence/provisioning.json scripts/google-spike/lib/provisioning.mjs scripts/google-spike/lib/provisioning.test.mjs scripts/google-spike/validate-provisioning.mjs";
const EVIDENCE_PREFIX = "node scripts/google-spike/validate-evidence.mjs";
const PROVISIONING_PREFIX = "node scripts/google-spike/validate-provisioning.mjs";
const SENSITIVE_SCAN_PREFIX = "node scripts/google-spike/scan-sensitive-paths.mjs";
const CLEAN_WORKTREE_COMMAND = "git diff --quiet";
const CLEAN_INDEX_COMMAND = "git diff --cached --quiet";
const FETCH_COMMAND = "git fetch origin main --quiet";
const RELEASE_SHA_COMMAND = 'release_sha="$(git rev-parse HEAD)"';
const CLEAN_STATUS_COMMAND = 'test -z "$(git status --porcelain)"';
const ORIGIN_EQUALITY_COMMAND = 'test "$(git rev-parse origin/main)" = "${release_sha}"';
const ORIGIN_EQUALITY_PREFIX = 'test "$(git rev-parse origin/main)"';
const BUILD_PREFIX = "node scripts/build-release-manifest.mjs";
const UPLOAD_PREFIX = "node scripts/upload-release-prefix.mjs";
const README_BUILD_COMMAND = 'node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha "${release_sha}" --package-version "$(node -p \'require(\\\"./package.json\\\").version\')" --source-date-epoch "$(git show -s --format=%ct "${release_sha}")"';
const RUNBOOK_BUILD_COMMAND = 'node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha "$release_sha" --package-version "$(node -p \'require(\\\"./package.json\\\").version\')" --source-date-epoch "$(git show -s --format=%ct "$release_sha")"';
const README_UPLOAD_COMMAND = 'node scripts/upload-release-prefix.mjs --artifact-root dist --bucket "molroom-<account>-us-east-1-origin" --commit-sha "${release_sha}" --dry-run';
const GOOGLE_VALIDATION_COMMANDS = Object.freeze([
  EVIDENCE_COMMAND, PROVISIONING_COMMAND, SENSITIVE_SCAN_COMMAND,
]);
const GOOGLE_COMMAND_SPECS = Object.freeze([
  Object.freeze({ exact: EVIDENCE_COMMAND, prefix: EVIDENCE_PREFIX }),
  Object.freeze({ exact: PROVISIONING_COMMAND, prefix: PROVISIONING_PREFIX }),
  Object.freeze({ exact: SENSITIVE_SCAN_COMMAND, prefix: SENSITIVE_SCAN_PREFIX }),
]);
const CLEAN_COMMAND_SPECS = Object.freeze([
  Object.freeze({ exact: CLEAN_WORKTREE_COMMAND, prefix: CLEAN_WORKTREE_COMMAND }),
  Object.freeze({ exact: CLEAN_INDEX_COMMAND, prefix: CLEAN_INDEX_COMMAND }),
]);
const FETCH_COMMAND_SPEC = Object.freeze({ exact: FETCH_COMMAND, prefix: FETCH_COMMAND });
const RELEASE_SHA_COMMAND_SPEC = Object.freeze({ exact: RELEASE_SHA_COMMAND, prefix: RELEASE_SHA_COMMAND });
const CLEAN_STATUS_COMMAND_SPEC = Object.freeze({ exact: CLEAN_STATUS_COMMAND, prefix: CLEAN_STATUS_COMMAND });
const ORIGIN_EQUALITY_COMMAND_SPEC = Object.freeze({
  exact: ORIGIN_EQUALITY_COMMAND, prefix: ORIGIN_EQUALITY_PREFIX,
});
const ORIGIN_COMMAND_SPECS = Object.freeze([
  FETCH_COMMAND_SPEC,
  ORIGIN_EQUALITY_COMMAND_SPEC,
]);
const README_BUILD_COMMAND_SPEC = Object.freeze({
  exact: README_BUILD_COMMAND, prefix: BUILD_PREFIX,
});
const RUNBOOK_BUILD_COMMAND_SPEC = Object.freeze({
  exact: RUNBOOK_BUILD_COMMAND, prefix: BUILD_PREFIX,
});
const README_UPLOAD_COMMAND_SPEC = Object.freeze({
  exact: README_UPLOAD_COMMAND, prefix: UPLOAD_PREFIX,
});
const README_RELEASE_COMMAND_SPECS = Object.freeze([
  FETCH_COMMAND_SPEC,
  RELEASE_SHA_COMMAND_SPEC,
  CLEAN_STATUS_COMMAND_SPEC,
  ...CLEAN_COMMAND_SPECS,
  ORIGIN_EQUALITY_COMMAND_SPEC,
  README_BUILD_COMMAND_SPEC,
  README_UPLOAD_COMMAND_SPEC,
]);
const README_RELEASE_COMMANDS = Object.freeze(README_RELEASE_COMMAND_SPECS.map(({ exact }) => exact));
const RUNBOOK_OPERATOR_COMMAND_SPECS = Object.freeze([
  ...GOOGLE_COMMAND_SPECS, ...ORIGIN_COMMAND_SPECS,
]);
const README_DOCUMENT_COMMAND_SPECS = Object.freeze([
  ...GOOGLE_COMMAND_SPECS, ...README_RELEASE_COMMAND_SPECS,
]);
const RUNBOOK_DOCUMENT_COMMAND_SPECS = Object.freeze([
  ...RUNBOOK_OPERATOR_COMMAND_SPECS, RUNBOOK_BUILD_COMMAND_SPEC,
]);
const EXACT_COMMAND_MARKERS = new Set([
  EVIDENCE_COMMAND, PROVISIONING_COMMAND, SENSITIVE_SCAN_COMMAND,
  CLEAN_WORKTREE_COMMAND, CLEAN_INDEX_COMMAND,
]);
const RELEASE_DIFF_WITH_ARGUMENTS = /^git diff --quiet ["']?\$(?:\{release_sha\}|release_sha)\^["']? ["']?\$(?:\{release_sha\}|release_sha)["']?$/;
const FORBIDDEN_CONTRADICTIONS = Object.freeze([
  /(?:workflow|배포 자동화|CloudFormation|CloudFront|GitHub OIDC)[^\n]*(?:does not exist|not implemented|구현되지 않았습니다|없습니다|미완료)/i,
  /(?:upload|업로드|copy|복사)[^\n]*releases\/\$\{release_sha\}/i,
  /--execute\b/i,
]);
const README_SECTION_CONTRACTS = Object.freeze({
  "release.status": Object.freeze(["INCOMPLETE / UNOBSERVED"]),
  "release.toolchain": Object.freeze(["npm run verify:toolchain"]),
  "release.google-oauth": Object.freeze([]),
  "release.env": Object.freeze([
    ...ENV_KEYS, ...RECEIPT_KEYS,
    EVIDENCE_COMMAND, PROVISIONING_COMMAND, SENSITIVE_SCAN_COMMAND,
  ]),
  "release.validation": Object.freeze([
    "npm run typecheck", "npm test", "npm run build",
    "npm run scan:production-bundle", "npm run validate:readmes",
    "npm run build:release-manifest", "npm run upload:release-prefix",
    "npm run verify:release-contract",
  ]),
  "release.aws-oidc": Object.freeze([
    "production", "required reviewer", "OIDC",
    "infra/aws/molroom-bootstrap.yml", "infra/aws/molroom-production.yml",
    ".github/workflows/release.yml", ".github/workflows/security-gate.yml",
  ]),
  "release.first-release": Object.freeze([
    "release_sha", "git fetch origin main --quiet",
    CLEAN_WORKTREE_COMMAND, CLEAN_INDEX_COMMAND,
    "test \"$(git rev-parse origin/main)\" = \"${release_sha}\"", "--dry-run",
    "protected production workflow",
    "node scripts/build-release-manifest.mjs",
    "node scripts/upload-release-prefix.mjs",
  ]),
  "release.rollback": Object.freeze([
    "previous", "releases/${release_sha}/", "CloudFront invalidation", "not re-upload",
  ]),
  "release.security": Object.freeze([]),
});
const RUNBOOK_SECTION_IDS = Object.freeze([
  "runbook.prerequisites", "runbook.sequence", "runbook.rollback",
  "runbook.operator-input",
]);
const RUNBOOK_HEADINGS = Object.freeze({
  ko: Object.freeze({
    "사전 조건": "runbook.prerequisites",
    "실행 순서": "runbook.sequence",
    "롤백": "runbook.rollback",
    "운영 입력 계약": "runbook.operator-input",
  }),
  en: Object.freeze({
    Prerequisites: "runbook.prerequisites",
    Sequence: "runbook.sequence",
    Rollback: "runbook.rollback",
    "Operator input contract": "runbook.operator-input",
  }),
});
const RUNBOOK_SECTION_CONTRACTS = Object.freeze({
  "runbook.status": Object.freeze(["INCOMPLETE / UNOBSERVED"]),
  "runbook.prerequisites": Object.freeze([]),
  "runbook.sequence": Object.freeze([
    "validate-evidence", "validate-provisioning", "--dry-run",
    "infra/aws/molroom-bootstrap.yml", "infra/aws/molroom-production.yml",
    ".github/workflows/release.yml", ".github/workflows/security-gate.yml",
    "production", "OIDC", "required reviewer", "CloudFront invalidation",
    "production smoke", "npm run verify:release-contract",
  ]),
  "runbook.rollback": Object.freeze(["releases/${release_sha}/", "not re-upload"]),
  "runbook.operator-input": Object.freeze([
    ...ENV_KEYS, ...RECEIPT_KEYS,
    "umask 077", "mktemp -d", "chmod 600", "git check-ignore -v",
    EVIDENCE_COMMAND, PROVISIONING_COMMAND, SENSITIVE_SCAN_COMMAND,
    "git fetch origin main --quiet",
    "test \"$(git rev-parse origin/main)\" = \"${release_sha}\"",
  ]),
});
const README_EXACT_COMMAND_CONTRACTS = Object.freeze({
  "release.env": GOOGLE_COMMAND_SPECS,
  "release.first-release": README_RELEASE_COMMAND_SPECS,
});
const RUNBOOK_EXACT_COMMAND_CONTRACTS = Object.freeze({
  "runbook.sequence": Object.freeze([RUNBOOK_BUILD_COMMAND_SPEC]),
  "runbook.operator-input": RUNBOOK_OPERATOR_COMMAND_SPECS,
});
const README_COMMAND_ORDER_CONTRACTS = Object.freeze({
  "release.env": GOOGLE_VALIDATION_COMMANDS,
  "release.first-release": README_RELEASE_COMMANDS,
});
const RUNBOOK_COMMAND_ORDER_CONTRACTS = Object.freeze({
  "runbook.operator-input": GOOGLE_VALIDATION_COMMANDS,
});
const PACKAGE_SCRIPT_CONTRACTS = Object.freeze({
  "build:release-manifest": "release_sha=\"$(git rev-parse HEAD)\" && node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha \"$release_sha\" --source-date-epoch \"$(git show -s --format=%ct \"$release_sha\")\"",
  "upload:release-prefix": "node scripts/upload-release-prefix.mjs --artifact-root dist --bucket \"${MOLROOM_RELEASE_BUCKET:-molroom-000000000000-us-east-1-origin}\" --commit-sha \"$(git rev-parse HEAD)\" --dry-run",
  "verify:release-contract": "vitest run --pool=threads --maxWorkers=1 --minWorkers=1 scripts/lib/release-manifest.test.mjs",
});

function visibleMarkdown(document) {
  const visible = document.replace(/<!--[\s\S]*?-->/g, "");
  return { visible, malformedComment: visible.includes("<!--") || visible.includes("-->") };
}
function levelTwoSections(document) {
  const { visible, malformedComment } = visibleMarkdown(document);
  const headings = [...visible.matchAll(/^##[ \t]+([^\r\n]+?)[ \t]*$/gm)];
  const sections = [{ title: null, body: visible.slice(0, headings[0]?.index ?? visible.length) }];
  for (let index = 0; index < headings.length; index += 1) {
    sections.push({
      title: headings[index][1],
      body: visible.slice(headings[index].index + headings[index][0].length, headings[index + 1]?.index ?? visible.length),
    });
  }
  return { sections, malformedComment };
}
function semanticSections(document, resolveHeading, statusId) {
  const parsed = levelTwoSections(document);
  const sections = new Map([[statusId, parsed.sections[0].body]]);
  const ids = [];
  const errors = parsed.malformedComment ? ["malformed-comment"] : [];
  for (const actual of parsed.sections.slice(1)) {
    const id = resolveHeading(actual.title);
    if (id === undefined) {
      errors.push(`unknown-heading:${actual.title}`);
      continue;
    }
    ids.push(id);
    if (sections.has(id)) errors.push(`duplicate-heading:${id}`);
    else sections.set(id, actual.body);
  }
  return { sections, ids, errors };
}
function readmeSections(document) {
  return semanticSections(document, (title) => {
    const match = /^\[([^\]]+)\](?:\s|$)/.exec(title);
    return match && README_SECTION_IDS.includes(match[1]) ? match[1] : undefined;
  }, "release.status");
}
function runbookSections(document, locale) {
  const headings = RUNBOOK_HEADINGS[locale];
  return semanticSections(document, (title) => Object.hasOwn(headings, title) ? headings[title] : undefined, "runbook.status");
}
function hasSectionMarker(body, marker) {
  if (EXACT_COMMAND_MARKERS.has(marker)) {
    return body.split(/\r?\n/).some((line) => line.trim() === marker);
  }
  const literal = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const localeSuffix = marker === "required reviewer" ? "s?" : "";
  return new RegExp(`(?<![A-Za-z0-9_])${literal}${localeSuffix}(?![A-Za-z0-9_:-])`).test(body);
}
function requireSectionContracts(locale, label, sections, contracts, missing) {
  for (const [id, markers] of Object.entries(contracts)) {
    const body = sections.get(id) ?? "";
    for (const marker of markers) if (!hasSectionMarker(body, marker)) missing.push(`${locale}:${label}:${id}:${marker}`);
  }
}
function sectionLines(sections, id) {
  return (sections.get(id) ?? "").split(/\r?\n/).map((line) => line.trim());
}
function shellCommandTokens(line) {
  return line.trim().split(/[ \t]+/).filter(Boolean);
}
function hasCommandPrefix(line, prefix) {
  const lineTokens = shellCommandTokens(line);
  const prefixTokens = shellCommandTokens(prefix);
  return lineTokens.length >= prefixTokens.length
    && prefixTokens.every((token, index) => lineTokens[index] === token);
}
function containsReleaseCommitRangeDiff(document) {
  return visibleMarkdown(document).visible.split(/\r?\n/)
    .some((line) => RELEASE_DIFF_WITH_ARGUMENTS.test(shellCommandTokens(line).join(" ")));
}
function forbiddenLocalGitActions(document) {
  const errors = new Set();
  for (const line of executableFenceLines(document)) {
    const tokens = shellCommandTokens(line);
    if (tokens[0] !== "git") continue;
    if (tokens[1] === "tag") errors.add("local-git-tag");
    if (tokens[1] === "push") errors.add("local-git-push");
  }
  return [...errors];
}
function markdownFenceOpening(line) {
  const match = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
  if (!match) return null;
  const delimiter = match[2];
  const info = match[3].trim();
  if (delimiter[0] === "`" && info.includes("`")) return null;
  return {
    character: delimiter[0],
    length: delimiter.length,
    executable: /^(?:bash|sh)$/.test(info),
  };
}
function closesMarkdownFence(line, fence) {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
  return match !== null
    && match[2][0] === fence.character
    && match[2].length >= fence.length;
}
function executableFenceLines(document) {
  const lines = visibleMarkdown(document).visible.split(/\r?\n/);
  const executable = [];
  let fence = null;
  for (const line of lines) {
    if (fence === null) {
      fence = markdownFenceOpening(line);
      continue;
    }
    if (closesMarkdownFence(line, fence)) {
      fence = null;
      continue;
    }
    if (fence.executable) executable.push(line.trim());
  }
  return executable;
}
function requireExactCommandContracts(locale, label, sections, contracts, missing) {
  for (const [id, specs] of Object.entries(contracts)) {
    const lines = sectionLines(sections, id);
    for (const { exact, prefix } of specs) {
      if (lines.filter((line) => line === exact).length !== 1) {
        missing.push(`${locale}:${label}:${id}:command-count:${exact}`);
      }
      if (lines.some((line) => line !== exact && hasCommandPrefix(line, prefix))) {
        missing.push(`${locale}:${label}:${id}:noncanonical-command:${prefix}`);
      }
    }
  }
}
function requireDocumentCommandContracts(locale, label, document, specs, missing) {
  const lines = visibleMarkdown(document).visible.split(/\r?\n/).map((line) => line.trim());
  for (const { exact, prefix } of specs) {
    if (lines.filter((line) => line === exact).length !== 1) {
      missing.push(`${locale}:${label}:command-count:${exact}`);
    }
    if (lines.some((line) => line !== exact && hasCommandPrefix(line, prefix))) {
      missing.push(`${locale}:${label}:noncanonical-command:${prefix}`);
    }
  }
}
function requireExecutableCommandContracts(locale, label, sections, contracts, missing) {
  for (const [id, specs] of Object.entries(contracts)) {
    const lines = executableFenceLines(sections.get(id) ?? "");
    for (const { exact } of specs) {
      if (lines.filter((line) => line === exact).length !== 1) {
        missing.push(`${locale}:${label}:${id}:executable-command-count:${exact}`);
      }
    }
  }
}
function requireCommandOrder(locale, label, sections, contracts, missing) {
  for (const [id, commands] of Object.entries(contracts)) {
    const lines = executableFenceLines(sections.get(id) ?? "");
    const positions = commands.map((command) => lines.indexOf(command));
    if (
      positions.every((position) => position >= 0)
      && positions.some((position, index) => index > 0 && positions[index - 1] >= position)
    ) {
      missing.push(`${locale}:${label}:${id}:command-order`);
    }
  }
}
function links(document) { return [...document.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]).filter((x) => !/^(?:https?:|#|mailto:)/.test(x)); }
async function missingLinks(document, path, root) {
  const missing = [];
  for (const link of links(document)) if (!await access(join(root, path, "..", link)).then(() => true, () => false)) missing.push(link);
  return missing;
}
async function packageScriptErrors(root) {
  let document;
  try {
    document = await readFile(join(root, "package.json"), "utf8");
  } catch {
    return ["package:read"];
  }
  let packageJson;
  try {
    packageJson = JSON.parse(document);
  } catch {
    return ["package:json"];
  }
  const scripts = packageJson !== null && typeof packageJson === "object" && !Array.isArray(packageJson)
    && packageJson.scripts !== null && typeof packageJson.scripts === "object" && !Array.isArray(packageJson.scripts)
    ? packageJson.scripts
    : {};
  const errors = [];
  for (const [name, expected] of Object.entries(PACKAGE_SCRIPT_CONTRACTS)) {
    if (scripts[name] !== expected) errors.push(`package:script:${name}`);
  }
  return errors;
}
export async function validateReadmeParity(korean, english, { root, koreanPath = "README.ko.md", englishPath = "README.en.md", koreanRunbook, englishRunbook } = {}) {
  const missing = [];
  for (const [locale, document, path] of [["ko", korean, koreanPath], ["en", english, englishPath]]) {
    const parsed = readmeSections(document);
    for (const id of README_SECTION_IDS) if (!parsed.ids.includes(id)) missing.push(`${locale}:heading:${id}`);
    if (parsed.ids.join("\n") !== README_SECTION_IDS.join("\n")) missing.push(`${locale}:heading-order`);
    for (const error of parsed.errors) missing.push(`${locale}:parse:${error}`);
    requireSectionContracts(locale, "section", parsed.sections, README_SECTION_CONTRACTS, missing);
    requireExactCommandContracts(locale, "section", parsed.sections, README_EXACT_COMMAND_CONTRACTS, missing);
    requireExecutableCommandContracts(locale, "section", parsed.sections, README_EXACT_COMMAND_CONTRACTS, missing);
    requireDocumentCommandContracts(locale, "document", document, README_DOCUMENT_COMMAND_SPECS, missing);
    requireCommandOrder(locale, "section", parsed.sections, README_COMMAND_ORDER_CONTRACTS, missing);
    for (const pattern of FORBIDDEN_CONTRADICTIONS) if (pattern.test(document)) missing.push(`${locale}:forbidden:${pattern}`);
    for (const error of forbiddenLocalGitActions(document)) missing.push(`${locale}:forbidden:${error}`);
    if (containsReleaseCommitRangeDiff(document)) missing.push(`${locale}:forbidden:release-commit-range-diff`);
    if (root) for (const link of await missingLinks(document, path, root)) missing.push(`${locale}:link:${link}`);
  }
  if (koreanRunbook === undefined || englishRunbook === undefined) missing.push("runbook-inputs");
  else for (const [locale, document] of [["ko", koreanRunbook], ["en", englishRunbook]]) {
    const parsed = runbookSections(document, locale);
    for (const id of RUNBOOK_SECTION_IDS) if (!parsed.ids.includes(id)) missing.push(`${locale}:runbook-heading:${id}`);
    if (parsed.ids.join("\n") !== RUNBOOK_SECTION_IDS.join("\n")) missing.push(`${locale}:runbook-heading-order`);
    for (const error of parsed.errors) missing.push(`${locale}:runbook-parse:${error}`);
    requireSectionContracts(locale, "runbook-section", parsed.sections, RUNBOOK_SECTION_CONTRACTS, missing);
    requireExactCommandContracts(locale, "runbook-section", parsed.sections, RUNBOOK_EXACT_COMMAND_CONTRACTS, missing);
    requireExecutableCommandContracts(locale, "runbook-section", parsed.sections, RUNBOOK_EXACT_COMMAND_CONTRACTS, missing);
    requireDocumentCommandContracts(locale, "runbook-document", document, RUNBOOK_DOCUMENT_COMMAND_SPECS, missing);
    requireCommandOrder(locale, "runbook-section", parsed.sections, RUNBOOK_COMMAND_ORDER_CONTRACTS, missing);
    for (const pattern of FORBIDDEN_CONTRADICTIONS) if (pattern.test(document)) missing.push(`${locale}:runbook-forbidden:${pattern}`);
    for (const error of forbiddenLocalGitActions(document)) missing.push(`${locale}:runbook-forbidden:${error}`);
    if (containsReleaseCommitRangeDiff(document)) missing.push(`${locale}:runbook-forbidden:release-commit-range-diff`);
  }
  if (root) missing.push(...await packageScriptErrors(root));
  return { valid: missing.length === 0, missing };
}
