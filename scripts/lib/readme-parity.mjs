import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export const ARCHIVE_VERIFIER_COMMAND = "node scripts/verify-release-archive.mjs";

const README_SECTION_IDS = Object.freeze([
  "release.toolchain", "release.google-oauth", "release.env", "release.validation",
  "release.aws-oidc", "release.first-release", "release.rollback", "release.security",
]);
const RUNBOOK_SECTION_IDS = Object.freeze([
  "runbook.prerequisites", "runbook.sequence", "runbook.archive", "runbook.rollback", "runbook.operator-input",
]);
const RUNBOOK_HEADINGS = Object.freeze({
  ko: Object.freeze({
    "사전 조건": "runbook.prerequisites",
    "실행 순서": "runbook.sequence",
    "커밋 archive clean-room 검증": "runbook.archive",
    "롤백": "runbook.rollback",
    "운영 입력 계약": "runbook.operator-input",
  }),
  en: Object.freeze({
    Prerequisites: "runbook.prerequisites",
    Sequence: "runbook.sequence",
    "Committed archive clean-room verification": "runbook.archive",
    Rollback: "runbook.rollback",
    "Operator input contract": "runbook.operator-input",
  }),
});
const ENV_KEYS = Object.freeze([
  "VITE_GOOGLE_CLIENT_ID", "VITE_ALLOWED_HD", "GOOGLE_SPIKE_AUTHORIZED_ORIGINS",
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT", "GOOGLE_SPIKE_ADMIN_ACCOUNT",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID", "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
]);
const PUBLIC_ENV_ASSIGNMENTS = Object.freeze([
  "VITE_DEPLOYMENT=production",
  "VITE_ADAPTER=google",
  "VITE_GOOGLE_CLIENT_ID=<google-oauth-web-client-id>",
  "VITE_ALLOWED_HD=<workspace-hosted-domain>",
]);
const PRIVATE_ENV_KEYS = ENV_KEYS;
const CONTROLLER_TAG = "molroom-release-controller-v1";
const CONTROLLER_SHA = "7ba2814f491dccee9462c7bf01958dd28600b048";
const README_SECTION_CONTRACT = `release.readme.sections=${README_SECTION_IDS.join(",")}`;
const OPERATOR_WORDING = Object.freeze({
  ko: Object.freeze([
    "권한 있는 운영자가 직접 수행하십시오.",
    "사람이 관찰하기 전에는 성공으로 기록하지 마십시오.",
  ]),
  en: Object.freeze([
    "An authorized operator must perform these steps.",
    "Do not record success until a human has observed it.",
  ]),
});
const EXACT_CONTRACT_LINES = Object.freeze([
  "public.env.keys=VITE_DEPLOYMENT,VITE_ADAPTER,VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD",
  `private.env.keys=${PRIVATE_ENV_KEYS.join(",")}`,
  "task5.env.keys=GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
  "github.repository.variables=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD",
  "github.production_environment.variables=AWS_ACCOUNT_ID,AWS_DEPLOY_ROLE_ARN,CLOUDFORMATION_ROLE_ARN,HOSTED_ZONE_ID",
  `release.controller.ref=refs/tags/${CONTROLLER_TAG}`,
  `release.controller.sha=${CONTROLLER_SHA}`,
  "release.controller.inputs=mode,version,target_sha,candidate_run_id,security_gate_run_id,execute_cutover,confirmation",
]);
const RECEIPT_KEYS = Object.freeze([
  "schemaVersion", "observation", "appType", "domain", "clientIdSuffix", "workspaceEdition",
  "enabledApis", "initialScopes", "directoryScopeTiming", "origins", "accounts", "rooms",
  "tenantPolicy", "operatorVerified",
]);
const GOOGLE_COMMANDS = Object.freeze([
  'MOLROOM_NODE_ROOT="${MOLROOM_NODE_ROOT:?set to the Node 24.19.0 installation root}"',
  'MOLROOM_NODE="$MOLROOM_NODE_ROOT/bin/node"',
  'MOLROOM_NPM_CLI="$MOLROOM_NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"',
  'test "$("$MOLROOM_NODE" --version)" = "v24.19.0"',
  'test "$("$MOLROOM_NODE" "$MOLROOM_NPM_CLI" --version)" = "11.17.0"',
  "validate-evidence.mjs",
  "validate-provisioning.mjs",
  "validate-account-matrix.mjs",
  "scan-sensitive-paths.mjs --redact",
]);
const GOOGLE_SETUP_MARKERS = Object.freeze([
  "Internal", "Web application", "http://localhost:5184", "https://molroom.molcube.com",
  "Calendar API", "Drive API", "People API",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
  "ordinary-chrome-desktop", "ordinary-safari-desktop",
  "admin-chrome-desktop", "admin-safari-desktop",
  "room-a", "room-b", "ACL", "auto-accept", "TENANT_POLICY_BLOCKED",
  "operatorVerified=false",
]);
const RELEASE_SETUP_MARKERS = Object.freeze([
  "infra/aws/molroom-bootstrap.yml", "ControllerTag=molroom-release-controller-v1",
  "HostedZoneId", "ProductionStackName", "ExistingGitHubOidcProviderArn",
  "repo:kim-song-jun/meeting-wrapper:environment:production", "required reviewer",
  "self-approval", "v*", ".github/workflows/security-gate.yml",
  ".github/workflows/release-controller.yml", "candidate_run_id",
  "security_gate_run_id", "execute_cutover", "PLAN", "repair", "rollback",
  "smoke", "restore", "AWS SSO", "us-east-1", "no long-lived AWS",
]);
const OPERATOR_COMMAND_ORDER = Object.freeze([
  "cp .env.example .env",
  "cp .env.google-spike.example .env.google-spike.local",
  "chmod 600 .env .env.google-spike.local provisioning-receipt.local",
  "git check-ignore -v .env .env.google-spike.local provisioning-receipt.local",
  '"$MOLROOM_NODE" scripts/google-spike/validate-evidence.mjs',
  '"$MOLROOM_NODE" scripts/google-spike/validate-provisioning.mjs',
  '"$MOLROOM_NODE" scripts/google-spike/validate-account-matrix.mjs',
  '"$MOLROOM_NODE" scripts/google-spike/scan-sensitive-paths.mjs --redact',
]);
const PACKAGE_SCRIPT_CONTRACTS = Object.freeze({
  "build:release-manifest": "release_sha=\"$(git rev-parse HEAD)\" && node scripts/build-release-manifest.mjs --artifact-root dist --commit-sha \"$release_sha\" --source-date-epoch \"$(git show -s --format=%ct \"$release_sha\")\"",
  "upload:release-prefix": "node scripts/upload-release-prefix.mjs --artifact-root dist --bucket \"${MOLROOM_RELEASE_BUCKET:-molroom-000000000000-us-east-1-origin}\" --commit-sha \"$(git rev-parse HEAD)\" --dry-run",
  "verify:release-contract": "vitest run --pool=threads --maxWorkers=1 --minWorkers=1 scripts/lib/release-manifest.test.mjs",
});

function visibleMarkdown(document) {
  const visible = document.replace(/<!--[\s\S]*?-->/g, "");
  return { malformedComment: visible.includes("<!--") || visible.includes("-->"), visible };
}

function levelTwoSections(document, resolveHeading, statusId) {
  const { malformedComment, visible } = visibleMarkdown(document);
  const headings = [...visible.matchAll(/^##[ \t]+([^\r\n]+?)[ \t]*$/gm)];
  const sections = new Map([[statusId, visible.slice(0, headings[0]?.index ?? visible.length)]]);
  const ids = [];
  const errors = malformedComment ? ["malformed-comment"] : [];
  for (let index = 0; index < headings.length; index += 1) {
    const id = resolveHeading(headings[index][1]);
    if (id === undefined) {
      errors.push(`unknown-heading:${headings[index][1]}`);
      continue;
    }
    ids.push(id);
    if (sections.has(id)) errors.push(`duplicate-heading:${id}`);
    else sections.set(id, visible.slice(headings[index].index + headings[index][0].length, headings[index + 1]?.index ?? visible.length));
  }
  return { errors, ids, sections };
}

function readmeSections(document) {
  return levelTwoSections(document, (heading) => {
    const match = /^\[([^\]]+)\](?:\s|$)/.exec(heading);
    return match && README_SECTION_IDS.includes(match[1]) ? match[1] : undefined;
  }, "release.status");
}

function runbookSections(document, locale) {
  return levelTwoSections(document, (heading) => RUNBOOK_HEADINGS[locale][heading], "runbook.status");
}

function executableFenceLines(document) {
  const lines = visibleMarkdown(document).visible.split(/\r?\n/);
  const result = [];
  let fence = null;
  for (const line of lines) {
    if (fence === null) {
      const opening = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
      if (opening) {
        fence = { character: opening[2][0], executable: /^(?:bash|sh)$/.test(opening[3].trim()), length: opening[2].length };
      }
      continue;
    }
    const closing = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
    if (closing && closing[2][0] === fence.character && closing[2].length >= fence.length) {
      fence = null;
      continue;
    }
    if (fence.executable) result.push(line.trim());
  }
  return result;
}

function addSectionRequirements(locale, label, parsed, ids, contracts, missing) {
  const prefix = label === "" ? `${locale}:` : `${locale}:${label}-`;
  for (const id of ids) if (!parsed.ids.includes(id)) missing.push(`${prefix}heading:${id}`);
  if (parsed.ids.join("\n") !== ids.join("\n")) missing.push(`${prefix}heading-order`);
  for (const error of parsed.errors) missing.push(`${prefix}parse:${error}`);
  for (const [id, markers] of Object.entries(contracts)) {
    const body = parsed.sections.get(id) ?? "";
    for (const marker of markers) if (!hasExactMarker(body, marker)) missing.push(`${prefix}section:${id}:${marker}`);
  }
}

function urlTokens(document) {
  return (document.match(/https?:\/\/[^\s<>"',)\]}\x60]+/g) ?? [])
    .map((token) => token.replace(/[.;:]+$/, ""));
}

function hasExactMarker(document, marker) {
  return marker.startsWith("http://") || marker.startsWith("https://")
    ? urlTokens(document).includes(marker)
    : document.includes(marker);
}

function exactLineCount(document, line) {
  return visibleMarkdown(document).visible.split(/\r?\n/).filter((entry) => entry.trim() === line).length;
}

function exactContractErrors(locale, label, document) {
  const prefix = label === "" ? `${locale}:exact:` : `${locale}:${label}-exact:`;
  const lines = visibleMarkdown(document).visible.split(/\r?\n/).map((line) => line.trim());
  const errors = [];
  for (const expected of EXACT_CONTRACT_LINES) {
    const key = expected.slice(0, expected.indexOf("="));
    const declarations = lines.filter((line) => line.startsWith(`${key}=`));
    if (declarations.length !== 1 || declarations[0] !== expected) errors.push(`${prefix}${key}`);
  }
  return errors;
}

function operatorOrderErrors(locale, label, document) {
  const lines = executableFenceLines(document);
  let cursor = -1;
  for (const marker of OPERATOR_COMMAND_ORDER) {
    const next = lines.findIndex((line, index) => index > cursor && line.includes(marker));
    if (next === -1) return [`${locale}:${label === "" ? "" : `${label}:`}operator-order`];
    cursor = next;
  }
  return [];
}

function bareToolErrors(locale, label, document) {
  const offending = executableFenceLines(document)
    .filter((line) => /^(?:node|npm)(?:\s|$)/.test(line) && line !== ARCHIVE_VERIFIER_COMMAND);
  return offending.length === 0 ? [] : [`${locale}:${label === "" ? "" : `${label}:`}unpinned-tool`];
}

function operatorWordingErrors(locale, label, document) {
  const valid = OPERATOR_WORDING[locale].every((marker) => document.includes(marker));
  return valid ? [] : [`${locale}:${label === "" ? "" : `${label}:`}operator-wording`];
}

function workflowDispatchInputKeys(workflow) {
  const match = /^on:\n  workflow_dispatch:\n    inputs:\n([\s\S]*?)^concurrency:/m.exec(workflow);
  if (!match) return [];
  return [...match[1].matchAll(/^      ([a-z][a-z0-9_]*):\s*$/gm)].map((entry) => entry[1]);
}

function candidateJobEnvironment(workflow) {
  const match = /^    env:\n((?:^      [A-Z][A-Z0-9_]*:[^\n]*\n?)+)/m.exec(workflow);
  if (!match) return [];
  return [...match[1].matchAll(/^      ([A-Z][A-Z0-9_]*):[ \t]*(.+)$/gm)]
    .map((entry) => [entry[1], entry[2]]);
}

function releaseWorkflowErrors(workflow) {
  if (typeof workflow !== "string") return ["workflow:input"];
  const errors = [];
  const jobNames = [...workflow.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]);
  if (jobNames.length !== 1 || jobNames[0] !== "verify-candidate") errors.push("workflow:candidate-only");
  if (workflowDispatchInputKeys(workflow).join("\n") !== "target_sha") errors.push("workflow:dispatch-inputs");
  if (!workflow.includes(`ref: refs/tags/${CONTROLLER_TAG}`)) errors.push("workflow:controller-tag");
  if (!workflow.includes(`expected_controller_sha="${CONTROLLER_SHA}"`) || workflow.includes("PHASE_1_CONTROLLER_SHA")) {
    errors.push("workflow:controller-sha");
  }
  if (!workflow.includes(`test "$(git -C controller cat-file -t refs/tags/${CONTROLLER_TAG})" = tag`)
    || !workflow.includes(`test "$(git -C controller rev-parse 'refs/tags/${CONTROLLER_TAG}^{}')" = "$expected_controller_sha"`)) {
    errors.push("workflow:annotated-tag");
  }
  if ((workflow.match(/^    permissions:\n      contents: read\n/gm) ?? []).length !== 1
    || /\b(?:id-token|actions|contents|deployments|packages)\s*:\s*write\b/.test(workflow)) {
    errors.push("workflow:permissions");
  }
  const expectedPublicEnv = [
    ["VITE_ADAPTER", "google"],
    ["VITE_ALLOWED_HD", "${{ vars.VITE_ALLOWED_HD }}"],
    ["VITE_DEPLOYMENT", "production"],
    ["VITE_GOOGLE_CLIENT_ID", "${{ vars.VITE_GOOGLE_CLIENT_ID }}"],
  ];
  if (JSON.stringify(candidateJobEnvironment(workflow)) !== JSON.stringify(expectedPublicEnv)) {
    errors.push("workflow:public-env");
  }
  if (/^\s*environment\s*:/m.test(workflow)) errors.push("workflow:environment");
  if (/\$\{\{\s*secrets\./.test(workflow)) errors.push("workflow:secrets");
  if (workflow.includes("github.workflow_sha")) errors.push("workflow:forbidden:github.workflow_sha");
  if (/aws-actions\/configure-aws-credentials|\bgh\s+release\b|(?:^|\n)\s*aws\s+/m.test(workflow)) {
    errors.push("workflow:privileged-action");
  }
  return [...new Set(errors)];
}

function productionSpecErrors(spec) {
  if (typeof spec !== "string") return ["spec:input"];
  const errors = [];
  if (!spec.includes(CONTROLLER_SHA) || spec.includes("PHASE_1_CONTROLLER_SHA")) errors.push("spec:controller-sha");
  if (!spec.includes(`refs/tags/${CONTROLLER_TAG}`)) errors.push("spec:controller-tag");
  if (!spec.includes("approved security-gate workflow blob")) errors.push("spec:security-gate-blob");
  if (!spec.includes("dispatch_actor")) errors.push("spec:security-gate-actor");
  if (spec.includes("github.workflow_sha")) errors.push("spec:forbidden:github.workflow_sha");
  for (const line of EXACT_CONTRACT_LINES) if (exactLineCount(spec, line) !== 1) errors.push(`spec:exact:${line.slice(0, line.indexOf("="))}`);
  for (const marker of RELEASE_SETUP_MARKERS) if (!spec.includes(marker)) errors.push(`spec:marker:${marker}`);
  const sectionStart = spec.indexOf("## 11. 한영 문서 구조");
  const sectionEnd = spec.indexOf("## 12. Wave 계획", sectionStart + 1);
  const section = sectionStart >= 0 && sectionEnd > sectionStart ? spec.slice(sectionStart, sectionEnd) : "";
  const declaredSections = section.split(/\r?\n/).filter((line) => line.startsWith("release.readme.sections="));
  const numberedSections = [...section.matchAll(/^\d+\. \[([^\]]+)]/gm)].map((match) => match[1]);
  const numberedLines = section.match(/^\d+\. /gm) ?? [];
  if (declaredSections.length !== 1 || declaredSections[0] !== README_SECTION_CONTRACT
    || numberedSections.join("\n") !== README_SECTION_IDS.join("\n")
    || numberedLines.length !== README_SECTION_IDS.length) {
    errors.push("spec:readme-sections");
  }
  return errors;
}

function assignmentLines(document) {
  return document.split(/\r?\n/).filter((line) => /^[A-Z][A-Z0-9_]*=.*$/.test(line));
}

function environmentExampleErrors(publicExample, privateExample) {
  const errors = [];
  if (typeof publicExample !== "string" || assignmentLines(publicExample).join("\n") !== PUBLIC_ENV_ASSIGNMENTS.join("\n")) {
    errors.push("env-example:public");
  }
  const privateKeys = typeof privateExample === "string"
    ? assignmentLines(privateExample).map((line) => line.slice(0, line.indexOf("=")))
    : [];
  if (privateKeys.join("\n") !== PRIVATE_ENV_KEYS.join("\n")) errors.push("env-example:private");
  return errors;
}

async function repositoryDocument(root, provided, path) {
  if (typeof provided === "string") return provided;
  if (!root) return undefined;
  return readFile(join(root, path), "utf8").catch(() => undefined);
}

function forbiddenReleaseActions(document) {
  const source = executableFenceLines(document).join("\n");
  const actions = [];
  if (/\bgit\b[\s\S]{0,256}\btag\b/i.test(source)) actions.push("local-git-tag");
  if (/\bgit\b[\s\S]{0,256}\b(?:push|send-pack)\b/i.test(source)) actions.push("local-git-push");
  if (/\bgit\b[\s\S]{0,256}\b(?:update-ref|symbolic-ref|replace)\b/i.test(source) || /\bgh\b[\s\S]{0,256}\bapi\b[\s\S]{0,256}\/git\/(?:refs|tags)\b/i.test(source)) {
    actions.push("local-git-ref");
  }
  return [...new Set(actions)];
}

function archiveCommandErrors(locale, document, parsed, missing) {
  const archive = parsed.sections.get("runbook.archive") ?? "";
  const archiveLines = executableFenceLines(archive).filter((line) => line.length > 0);
  if (archiveLines.length !== 1 || archiveLines[0] !== ARCHIVE_VERIFIER_COMMAND) {
    missing.push(`${locale}:runbook:archive-command`);
  }
  if (exactLineCount(document, ARCHIVE_VERIFIER_COMMAND) !== 1) {
    missing.push(`${locale}:runbook:archive-command-count`);
  }
  if (/#!\/usr\/bin\/env bash|\bgit archive\b|\bnpm ci\b/.test(archive)) {
    missing.push(`${locale}:runbook:archive-shell-debt`);
  }
}

function links(document) {
  return [...document.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].split("#", 1)[0])
    .filter((link) => link.length > 0 && !/^(?:https?:|mailto:)/.test(link));
}

async function packageScriptErrors(root) {
  if (!root) return [];
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch {
    return ["package:read"];
  }
  const scripts = packageJson?.scripts;
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) return ["package:scripts"];
  return Object.entries(PACKAGE_SCRIPT_CONTRACTS)
    .filter(([name, expected]) => scripts[name] !== expected)
    .map(([name]) => `package:script:${name}`);
}

async function linkErrors(document, path, root, locale) {
  if (!root) return [];
  const errors = [];
  for (const link of links(document)) {
    if (!await access(join(root, path, "..", link)).then(() => true, () => false)) errors.push(`${locale}:link:${link}`);
  }
  return errors;
}

const README_CONTRACTS = Object.freeze({
  "release.status": Object.freeze(["INCOMPLETE / UNOBSERVED"]),
  "release.toolchain": Object.freeze(["24.19.0", "11.17.0", ...GOOGLE_COMMANDS.slice(0, 5)]),
  "release.google-oauth": Object.freeze(GOOGLE_SETUP_MARKERS),
  "release.env": Object.freeze([...ENV_KEYS, ...RECEIPT_KEYS, ...GOOGLE_COMMANDS.slice(5)]),
  "release.validation": Object.freeze(["typecheck", "test", "build", "scan:production-bundle", "validate:readmes", "verify:release-contract"]),
  "release.aws-oidc": Object.freeze([
    "infra/aws/molroom-bootstrap.yml", "ControllerTag=molroom-release-controller-v1",
    "HostedZoneId", "ProductionStackName", "ExistingGitHubOidcProviderArn",
    "repo:kim-song-jun/meeting-wrapper:environment:production", "required reviewer",
    "self-approval", "v*", ".github/workflows/release-controller.yml",
    "AWS SSO", "us-east-1", "no long-lived AWS",
  ]),
  "release.first-release": Object.freeze([
    "origin/main", ".github/workflows/security-gate.yml", "protected release workflow",
    ".github/workflows/release-controller.yml", "candidate_run_id", "security_gate_run_id",
    "execute_cutover", "PLAN", "repair", "rollback", "smoke", "restore",
  ]),
  "release.rollback": Object.freeze(["releases/${release_sha}/", "not re-upload"]),
  "release.security": Object.freeze(["SECURITY.md"]),
});

const RUNBOOK_CONTRACTS = Object.freeze({
  "runbook.status": Object.freeze(["INCOMPLETE / UNOBSERVED"]),
  "runbook.prerequisites": Object.freeze(["24.19.0", "11.17.0", ...GOOGLE_SETUP_MARKERS, ...RELEASE_SETUP_MARKERS]),
  "runbook.sequence": Object.freeze(["origin/main", "security-gate-<sha>", "protected release workflow", CONTROLLER_SHA, CONTROLLER_TAG]),
  "runbook.archive": Object.freeze(["shared worktree", "redacted", "artifact", "AWS SSO"]),
  "runbook.rollback": Object.freeze(["releases/${release_sha}/", "not re-upload"]),
  "runbook.operator-input": Object.freeze([...ENV_KEYS, ...RECEIPT_KEYS, ...GOOGLE_COMMANDS]),
});

export async function validateReadmeParity(korean, english, {
  root,
  koreanPath = "README.ko.md",
  englishPath = "README.en.md",
  koreanRunbook,
  englishRunbook,
  releaseWorkflow,
  productionSpec,
  publicEnvExample,
  privateEnvExample,
} = {}) {
  const missing = [];
  const [resolvedWorkflow, resolvedSpec, resolvedPublicEnv, resolvedPrivateEnv] = await Promise.all([
    repositoryDocument(root, releaseWorkflow, ".github/workflows/release.yml"),
    repositoryDocument(root, productionSpec, "docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md"),
    repositoryDocument(root, publicEnvExample, ".env.example"),
    repositoryDocument(root, privateEnvExample, ".env.google-spike.example"),
  ]);
  const readmes = [["ko", korean, koreanPath], ["en", english, englishPath]];
  for (const [locale, document, path] of readmes) {
    const parsed = readmeSections(document);
    addSectionRequirements(locale, "", parsed, README_SECTION_IDS, README_CONTRACTS, missing);
    missing.push(...exactContractErrors(locale, "", document));
    missing.push(...operatorOrderErrors(locale, "", document));
    missing.push(...operatorWordingErrors(locale, "", document));
    missing.push(...bareToolErrors(locale, "", document));
    if (exactLineCount(document, ARCHIVE_VERIFIER_COMMAND) !== 0) missing.push(`${locale}:readme:archive-command-count`);
    if (document.includes("github.workflow_sha")) missing.push(`${locale}:forbidden:github.workflow_sha`);
    for (const action of forbiddenReleaseActions(document)) missing.push(`${locale}:forbidden:${action}`);
    missing.push(...await linkErrors(document, path, root, locale));
  }
  if (koreanRunbook === undefined || englishRunbook === undefined) {
    missing.push("runbook-inputs");
  } else {
    for (const [locale, document] of [["ko", koreanRunbook], ["en", englishRunbook]]) {
      const parsed = runbookSections(document, locale);
      addSectionRequirements(locale, "runbook", parsed, RUNBOOK_SECTION_IDS, RUNBOOK_CONTRACTS, missing);
      missing.push(...exactContractErrors(locale, "runbook", document));
      missing.push(...operatorOrderErrors(locale, "runbook", document));
      missing.push(...operatorWordingErrors(locale, "runbook", document));
      missing.push(...bareToolErrors(locale, "runbook", document));
      archiveCommandErrors(locale, document, parsed, missing);
      if (document.includes("github.workflow_sha")) missing.push(`${locale}:runbook-forbidden:github.workflow_sha`);
      for (const action of forbiddenReleaseActions(document)) missing.push(`${locale}:runbook-forbidden:${action}`);
    }
  }
  missing.push(...releaseWorkflowErrors(resolvedWorkflow));
  missing.push(...productionSpecErrors(resolvedSpec));
  missing.push(...environmentExampleErrors(resolvedPublicEnv, resolvedPrivateEnv));
  missing.push(...await packageScriptErrors(root));
  return { valid: missing.length === 0, missing: [...new Set(missing)] };
}
