import { access } from "node:fs/promises";
import { join } from "node:path";

const CONTRACTS = Object.freeze([
  ["toolchain", "release.toolchain"], ["oauth", "release.google-oauth"],
  ["env", "release.env"], ["validation", "release.validation"],
  ["aws", "release.aws-oidc"], ["release", "release.first-release"],
  ["rollback", "release.rollback"], ["security", "release.security"],
]);
const CRITICAL_COMMANDS = Object.freeze([
  "npm run verify:toolchain", "npm run typecheck", "npm test", "npm run build",
  "npm run scan:production-bundle", "npm run validate:readmes",
  "node scripts/google-spike/validate-evidence.mjs",
  "node scripts/google-spike/validate-provisioning.mjs",
  "node scripts/google-spike/scan-sensitive-paths.mjs",
  "git fetch origin main --quiet", "test \"$(git rev-parse origin/main)\" = \"${release_sha}\"",
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
const RUNBOOK_CONTRACT = Object.freeze([
  "VITE_GOOGLE_CLIENT_ID", "VITE_ALLOWED_HD", "GOOGLE_SPIKE_AUTHORIZED_ORIGINS",
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT", "GOOGLE_SPIKE_ADMIN_ACCOUNT",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID", "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
  "schemaVersion", "observation", "appType", "domain", "clientIdSuffix",
  "workspaceEdition", "enabledApis", "initialScopes", "directoryScopeTiming",
  "origins", "accounts", "rooms", "tenantPolicy", "operatorVerified",
  "umask 077", "mktemp -d", "chmod 600", "git check-ignore -v",
  "validate-evidence", "validate-provisioning", "scan-sensitive-paths",
  "INCOMPLETE / UNOBSERVED", "git fetch origin main --quiet",
  "origin/main == release_sha",
]);
function headings(document) { return [...document.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]); }
function links(document) { return [...document.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]).filter((x) => !/^(?:https?:|#|mailto:)/.test(x)); }
async function missingLinks(document, path, root) {
  const missing = [];
  for (const link of links(document)) if (!await access(join(root, path, "..", link)).then(() => true, () => false)) missing.push(link);
  return missing;
}
export async function validateReadmeParity(korean, english, { root, koreanPath = "README.ko.md", englishPath = "README.en.md", koreanRunbook, englishRunbook } = {}) {
  const missing = [];
  const expected = CONTRACTS.map(([, id]) => id);
  for (const [locale, document, path] of [["ko", korean, koreanPath], ["en", english, englishPath]]) {
    const actual = headings(document);
    for (const id of expected) if (!actual.includes(id)) missing.push(`${locale}:heading:${id}`);
    for (const command of CRITICAL_COMMANDS) if (!document.includes(command)) missing.push(`${locale}:command:${command}`);
    for (const key of ENV_KEYS) if (!document.includes(key)) missing.push(`${locale}:env:${key}`);
    for (const key of RECEIPT_KEYS) if (!document.includes(key)) missing.push(`${locale}:receipt:${key}`);
    if (!document.includes("INCOMPLETE / UNOBSERVED")) missing.push(`${locale}:state`);
    if (root) for (const link of await missingLinks(document, path, root)) missing.push(`${locale}:link:${link}`);
  }
  if (headings(korean).join("\n") !== headings(english).join("\n")) missing.push("heading-order");
  if (koreanRunbook === undefined || englishRunbook === undefined) missing.push("runbook-inputs");
  else for (const marker of RUNBOOK_CONTRACT) {
    if (!koreanRunbook.includes(marker)) missing.push(`ko:runbook:${marker}`);
    if (!englishRunbook.includes(marker)) missing.push(`en:runbook:${marker}`);
  }
  return { valid: missing.length === 0, missing };
}
export { CONTRACTS, CRITICAL_COMMANDS, ENV_KEYS, RECEIPT_KEYS, RUNBOOK_CONTRACT };
