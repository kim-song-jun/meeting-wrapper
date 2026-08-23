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
const FORBIDDEN_CONTRADICTIONS = Object.freeze([
  /(?:workflow|배포 자동화|CloudFormation|CloudFront|GitHub OIDC)[^\n]*(?:does not exist|not implemented|구현되지 않았습니다|없습니다|미완료)/i,
  /git tag\s+-a/i, /git push\s+(?:--atomic\s+)?origin/i,
  /(?:upload|업로드|copy|복사)[^\n]*releases\/\$\{release_sha\}/i,
  /--execute\b/i,
]);
const README_SECTION_CONTRACTS = Object.freeze({
  "release.status": Object.freeze(["INCOMPLETE / UNOBSERVED"]),
  "release.toolchain": Object.freeze(["npm run verify:toolchain"]),
  "release.google-oauth": Object.freeze([]),
  "release.env": Object.freeze([
    ...ENV_KEYS, ...RECEIPT_KEYS,
    "node scripts/google-spike/validate-evidence.mjs",
    "node scripts/google-spike/validate-provisioning.mjs",
    "node scripts/google-spike/scan-sensitive-paths.mjs",
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
    "test \"$(git rev-parse origin/main)\" = \"${release_sha}\"", "--dry-run",
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
    "scan-sensitive-paths", "git fetch origin main --quiet",
    "test \"$(git rev-parse origin/main)\" = \"${release_sha}\"",
  ]),
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
  const readmeIds = [];
  for (const [locale, document, path] of [["ko", korean, koreanPath], ["en", english, englishPath]]) {
    const parsed = readmeSections(document);
    readmeIds.push(parsed.ids);
    for (const id of README_SECTION_IDS) if (!parsed.ids.includes(id)) missing.push(`${locale}:heading:${id}`);
    for (const error of parsed.errors) missing.push(`${locale}:parse:${error}`);
    requireSectionContracts(locale, "section", parsed.sections, README_SECTION_CONTRACTS, missing);
    for (const pattern of FORBIDDEN_CONTRADICTIONS) if (pattern.test(document)) missing.push(`${locale}:forbidden:${pattern}`);
    if (root) for (const link of await missingLinks(document, path, root)) missing.push(`${locale}:link:${link}`);
  }
  if (readmeIds[0].join("\n") !== readmeIds[1].join("\n")) missing.push("heading-order");
  if (koreanRunbook === undefined || englishRunbook === undefined) missing.push("runbook-inputs");
  else for (const [locale, document] of [["ko", koreanRunbook], ["en", englishRunbook]]) {
    const parsed = runbookSections(document, locale);
    for (const id of RUNBOOK_SECTION_IDS) if (!parsed.ids.includes(id)) missing.push(`${locale}:runbook-heading:${id}`);
    for (const error of parsed.errors) missing.push(`${locale}:runbook-parse:${error}`);
    requireSectionContracts(locale, "runbook-section", parsed.sections, RUNBOOK_SECTION_CONTRACTS, missing);
    for (const pattern of FORBIDDEN_CONTRADICTIONS) if (pattern.test(document)) missing.push(`${locale}:runbook-forbidden:${pattern}`);
  }
  if (root) missing.push(...await packageScriptErrors(root));
  return { valid: missing.length === 0, missing };
}
