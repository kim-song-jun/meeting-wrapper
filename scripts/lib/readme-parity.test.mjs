import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHIVE_VERIFIER_COMMAND, validateReadmeParity } from "./readme-parity.mjs";

const root = join(import.meta.dirname, "../..");

async function documents() {
  const [
    korean,
    english,
    koreanRunbook,
    englishRunbook,
    releaseWorkflow,
    productionSpec,
    publicEnvExample,
    privateEnvExample,
  ] = await Promise.all([
    readFile(join(root, "README.ko.md"), "utf8"),
    readFile(join(root, "README.en.md"), "utf8"),
    readFile(join(root, "docs/ops/release-ko.md"), "utf8"),
    readFile(join(root, "docs/ops/release-en.md"), "utf8"),
    readFile(join(root, ".github/workflows/release.yml"), "utf8"),
    readFile(join(root, "docs/superpowers/specs/2026-08-21-molroom-production-readiness-program-design.md"), "utf8"),
    readFile(join(root, ".env.example"), "utf8"),
    readFile(join(root, ".env.google-spike.example"), "utf8"),
  ]);
  return {
    english,
    englishRunbook,
    korean,
    koreanRunbook,
    privateEnvExample,
    productionSpec,
    publicEnvExample,
    releaseWorkflow,
  };
}

function validationOptions(documentSet, overrides = {}) {
  return {
    root,
    englishRunbook: documentSet.englishRunbook,
    koreanRunbook: documentSet.koreanRunbook,
    privateEnvExample: documentSet.privateEnvExample,
    productionSpec: documentSet.productionSpec,
    publicEnvExample: documentSet.publicEnvExample,
    releaseWorkflow: documentSet.releaseWorkflow,
    ...overrides,
  };
}

const CONTROLLER_SHA = "7ba2814f491dccee9462c7bf01958dd28600b048";
const CONTROLLER_TAG = "molroom-release-controller-v1";
const EXACT_CONTRACT_LINES = Object.freeze([
  "public.env.keys=VITE_DEPLOYMENT,VITE_ADAPTER,VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD",
  "private.env.keys=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD,GOOGLE_SPIKE_AUTHORIZED_ORIGINS,GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
  "task5.env.keys=GOOGLE_SPIKE_ORDINARY_ACCOUNT,GOOGLE_SPIKE_ADMIN_ACCOUNT,GOOGLE_SPIKE_ROOM_A_CALENDAR_ID,GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
  "github.repository.variables=VITE_GOOGLE_CLIENT_ID,VITE_ALLOWED_HD",
  "github.production_environment.variables=AWS_ACCOUNT_ID,AWS_DEPLOY_ROLE_ARN,CLOUDFORMATION_ROLE_ARN,HOSTED_ZONE_ID",
  `release.controller.ref=refs/tags/${CONTROLLER_TAG}`,
  `release.controller.sha=${CONTROLLER_SHA}`,
  "release.controller.inputs=mode,version,target_sha,candidate_run_id,security_gate_run_id,execute_cutover,confirmation",
]);

const PINNED_GOOGLE_COMMANDS = Object.freeze([
  'MOLROOM_NODE_ROOT="${MOLROOM_NODE_ROOT:?set to the Node 24.19.0 installation root}"',
  'MOLROOM_NODE="$MOLROOM_NODE_ROOT/bin/node"',
  'MOLROOM_NPM_CLI="$MOLROOM_NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"',
  'test "$("$MOLROOM_NODE" --version)" = "v24.19.0"',
  'test "$("$MOLROOM_NODE" "$MOLROOM_NPM_CLI" --version)" = "11.17.0"',
  '"$MOLROOM_NODE" scripts/google-spike/validate-evidence.mjs',
  '"$MOLROOM_NODE" scripts/google-spike/validate-provisioning.mjs',
  '"$MOLROOM_NODE" scripts/google-spike/validate-account-matrix.mjs',
  '"$MOLROOM_NODE" scripts/google-spike/scan-sensitive-paths.mjs --redact',
]);

const GOOGLE_SETUP_MARKERS = Object.freeze([
  "http://localhost:5184",
  "https://molroom.molcube.com",
  "Calendar API",
  "Drive API",
  "People API",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
  "ordinary-chrome-desktop",
  "ordinary-safari-desktop",
  "admin-chrome-desktop",
  "admin-safari-desktop",
  "room-a",
  "room-b",
  "ACL",
  "auto-accept",
  "UNOBSERVED",
]);
const README_SECTION_CONTRACT = "release.readme.sections=release.toolchain,release.google-oauth,release.env,release.validation,release.aws-oidc,release.first-release,release.rollback,release.security";
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

function addExecutableLine(document, line) {
  return `${document.trimEnd()}\n\n\`\`\`bash\n${line}\n\`\`\`\n`;
}

describe("bilingual release documentation parity", () => {
  it("keeps one byte-identical closed archive command in each locale runbook and none in the README", async () => {
    const { korean, english, koreanRunbook, englishRunbook } = await documents();
    const commandBytes = Buffer.from(`${ARCHIVE_VERIFIER_COMMAND}\n`);

    for (const document of [korean, english]) {
      expect(document.match(new RegExp(ARCHIVE_VERIFIER_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).toHaveLength(0);
    }
    for (const runbook of [koreanRunbook, englishRunbook]) {
      const matches = runbook.match(new RegExp(`^${ARCHIVE_VERIFIER_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "gm")) ?? [];
      expect(matches).toHaveLength(1);
      expect(Buffer.from(`${matches[0]}\n`)).toEqual(commandBytes);
    }
    const documentSet = await documents();
    await expect(validateReadmeParity(korean, english, validationOptions(documentSet))).resolves.toEqual({
      valid: true,
      missing: [],
    });
  });

  it("fails closed for a missing, changed, or duplicated archive command", async () => {
    const { korean, english, koreanRunbook, englishRunbook } = await documents();
    for (const [runbook, expected] of [
      [koreanRunbook.replace(ARCHIVE_VERIFIER_COMMAND, "archive command removed"), "ko:runbook:archive-command"],
      [englishRunbook.replace(ARCHIVE_VERIFIER_COMMAND, `${ARCHIVE_VERIFIER_COMMAND} --unsafe`), "en:runbook:archive-command"],
      [`${koreanRunbook}\n\`\`\`bash\n${ARCHIVE_VERIFIER_COMMAND}\n\`\`\`\n`, "ko:runbook:archive-command-count"],
    ]) {
      const result = await validateReadmeParity(korean, english, {
        root,
        koreanRunbook: expected.startsWith("ko:") ? runbook : koreanRunbook,
        englishRunbook: expected.startsWith("en:") ? runbook : englishRunbook,
      });
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(expected);
    }
  });

  it.each([
    ["tag", "git -c core.pager=cat tag -a v0.1.0", "local-git-tag"],
    ["push", "sh -c 'command git push origin main'", "local-git-push"],
    ["ref", "gh api --method POST repos/example/repo/git/refs", "local-git-ref"],
    ["native ref", "git update-ref refs/tags/v0.1.0 deadbeef", "local-git-ref"],
  ])("keeps local %s mutation examples fail-closed", async (_label, injected, code) => {
    const { korean, english, koreanRunbook, englishRunbook } = await documents();
    const result = await validateReadmeParity(korean, english, {
      root,
      koreanRunbook: addExecutableLine(koreanRunbook, injected),
      englishRunbook,
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(`ko:runbook-forbidden:${code}`);
  });

  it("uses section counts and closed commands instead of the retired shell-command allowlist", async () => {
    const source = await readFile(join(root, "scripts/lib/readme-parity.mjs"), "utf8");
    expect(source).not.toContain("requireArchiveCommandAllowlist");
    expect(source).not.toContain("shellLex(");
    expect(source).toContain("ARCHIVE_VERIFIER_COMMAND");
    expect(source).toContain("archive-command-count");
  });

  it("rejects a heading/section-count mismatch and keeps the local AWS identity separate from the GitHub deploy role", async () => {
    const documentSet = await documents();
    const { korean, english, koreanRunbook, englishRunbook } = documentSet;
    const result = await validateReadmeParity(
      korean.replace("## [release.rollback]", "## [release.renamed]"),
      english,
      validationOptions(documentSet),
    );
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("ko:heading:release.rollback");
    for (const document of [korean, english, koreanRunbook, englishRunbook]) {
      expect(document).toContain("AWS SSO");
      expect(document).not.toContain("assumed-role/molroom-github-deploy");
    }
  });

  it("pins the candidate-only workflow to the exact protected annotated controller tag and SHA", async () => {
    const documentSet = await documents();
    const workflow = documentSet.releaseWorkflow;
    expect(workflow).toContain(`ref: refs/tags/${CONTROLLER_TAG}`);
    expect(workflow).toContain(`expected_controller_sha="${CONTROLLER_SHA}"`);
    expect(workflow).toContain(`git -C controller cat-file -t refs/tags/${CONTROLLER_TAG}`);
    expect(workflow).not.toContain("PHASE_1_CONTROLLER_SHA");
    expect(workflow).not.toContain("github.workflow_sha");
    expect(workflow).not.toMatch(/^\s*environment\s*:/m);
    expect(workflow).not.toMatch(/\b(?:id-token|actions|contents|deployments|packages)\s*:\s*write\b/);
    expect(workflow).not.toContain("aws-actions/configure-aws-credentials");
    expect(workflow).not.toContain("secrets.");

    const jobNames = [...workflow.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]);
    expect(jobNames).toEqual(["verify-candidate"]);

    for (const [mutatedWorkflow, error] of [
      [workflow.replace(CONTROLLER_SHA, "PHASE_1_CONTROLLER_SHA"), "workflow:controller-sha"],
      [workflow.replace(`refs/tags/${CONTROLLER_TAG}`, "refs/heads/main"), "workflow:controller-tag"],
      [workflow.replace("contents: read", "contents: write"), "workflow:permissions"],
      [workflow.replace("contents: read", "contents: read\n      id-token: write"), "workflow:permissions"],
      [workflow.replace("timeout-minutes: 60", "timeout-minutes: 60\n    environment: production"), "workflow:environment"],
      [workflow.replace("      VITE_ADAPTER: google\n", ""), "workflow:public-env"],
      [workflow.replace(`test "$(git -C controller cat-file -t refs/tags/${CONTROLLER_TAG})" = tag\n`, ""), "workflow:annotated-tag"],
      [`${workflow}\n# github.workflow_sha\n`, "workflow:forbidden:github.workflow_sha"],
      [`${workflow}\n# \${{ secrets.PRIVATE_TOKEN }}\n`, "workflow:secrets"],
    ]) {
      const result = await validateReadmeParity(documentSet.korean, documentSet.english, validationOptions(documentSet, {
        releaseWorkflow: mutatedWorkflow,
      }));
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(error);
    }
  });

  it("accepts exactly target_sha as the candidate dispatch input and exactly four public job env bindings", async () => {
    const documentSet = await documents();
    const workflow = documentSet.releaseWorkflow;
    const mutations = [
      [
        workflow.replace(
          "\nconcurrency:",
          "      extra_input:\n        description: Must be rejected\n        required: false\n        type: string\n\nconcurrency:",
        ),
        "workflow:dispatch-inputs",
      ],
      [
        workflow.replace(
          /      target_sha:\n        description:[^\n]+\n        required: true\n        type: string\n/,
          "",
        ),
        "workflow:dispatch-inputs",
      ],
      [
        workflow.replace(
          "      VITE_GOOGLE_CLIENT_ID: ${{ vars.VITE_GOOGLE_CLIENT_ID }}",
          "      VITE_GOOGLE_CLIENT_ID: ${{ vars.VITE_GOOGLE_CLIENT_ID }}\n      VITE_EXTRA: unexpected",
        ),
        "workflow:public-env",
      ],
      [
        workflow.replace("      VITE_DEPLOYMENT: production", "      VITE_DEPLOYMENT: preview"),
        "workflow:public-env",
      ],
    ];
    for (const [releaseWorkflow, expected] of mutations) {
      const result = await validateReadmeParity(
        documentSet.korean,
        documentSet.english,
        validationOptions(documentSet, { releaseWorkflow }),
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(expected);
    }
  });

  it("enforces exact public/private environment examples and bilingual operator inventories", async () => {
    const documentSet = await documents();
    const publicAssignments = documentSet.publicEnvExample.match(/^[A-Z][A-Z0-9_]*=.*$/gm) ?? [];
    expect(publicAssignments).toEqual([
      "VITE_DEPLOYMENT=production",
      "VITE_ADAPTER=google",
      "VITE_GOOGLE_CLIENT_ID=<google-oauth-web-client-id>",
      "VITE_ALLOWED_HD=<workspace-hosted-domain>",
    ]);
    const privateKeys = (documentSet.privateEnvExample.match(/^[A-Z][A-Z0-9_]*=/gm) ?? []).map((entry) => entry.slice(0, -1));
    expect(privateKeys).toEqual([
      "VITE_GOOGLE_CLIENT_ID",
      "VITE_ALLOWED_HD",
      "GOOGLE_SPIKE_AUTHORIZED_ORIGINS",
      "GOOGLE_SPIKE_ORDINARY_ACCOUNT",
      "GOOGLE_SPIKE_ADMIN_ACCOUNT",
      "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID",
      "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
    ]);

    for (const document of [documentSet.korean, documentSet.english, documentSet.koreanRunbook, documentSet.englishRunbook]) {
      for (const line of EXACT_CONTRACT_LINES) expect(document.split(/\r?\n/)).toContain(line);
      expect(document).toContain("cp .env.example .env");
      expect(document).toContain("chmod 600 .env .env.google-spike.local provisioning-receipt.local");
      expect(document).toContain("git check-ignore -v .env .env.google-spike.local provisioning-receipt.local");
      for (const marker of PINNED_GOOGLE_COMMANDS) expect(document).toContain(marker);
    }

    for (const [mutatedDocument, key, expected] of [
      [documentSet.korean.replace(EXACT_CONTRACT_LINES[0], `${EXACT_CONTRACT_LINES[0]},EXTRA`), "korean", "ko:exact:public.env.keys"],
      [documentSet.englishRunbook.replace(EXACT_CONTRACT_LINES[4], `${EXACT_CONTRACT_LINES[4]},EXTRA`), "englishRunbook", "en:runbook-exact:github.production_environment.variables"],
      [documentSet.english.replace('"$MOLROOM_NODE" scripts/google-spike/validate-account-matrix.mjs', "validator removed"), "english", "en:section:release.env:validate-account-matrix.mjs"],
    ]) {
      const result = await validateReadmeParity(
        key === "korean" ? mutatedDocument : documentSet.korean,
        key === "english" ? mutatedDocument : documentSet.english,
        validationOptions(documentSet, key.endsWith("Runbook") ? { [key]: mutatedDocument } : {}),
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(expected);
    }
  });

  it("keeps the Google setup operator-followable and preserves honest blocked states", async () => {
    const documentSet = await documents();
    for (const document of [documentSet.korean, documentSet.english, documentSet.koreanRunbook, documentSet.englishRunbook]) {
      expect(document).toContain("Internal");
      expect(document).toContain("Web application");
      for (const marker of GOOGLE_SETUP_MARKERS) expect(document).toContain(marker);
      expect(document).toContain("INCOMPLETE / UNOBSERVED");
      expect(document).toContain("operatorVerified=false");
      expect(document).toContain("TENANT_POLICY_BLOCKED");
    }

    const swapped = documentSet.englishRunbook
      .replace("cp .env.example .env", "ORDER_SWAP_A")
      .replace("cp .env.google-spike.example .env.google-spike.local", "cp .env.example .env")
      .replace("ORDER_SWAP_A", "cp .env.google-spike.example .env.google-spike.local");
    const result = await validateReadmeParity(documentSet.korean, documentSet.english, validationOptions(documentSet, {
      englishRunbook: swapped,
    }));
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("en:runbook:operator-order");
  });

  it("treats Google origins/scopes as exact tokens and requires imperative, unobserved operator wording", async () => {
    const documentSet = await documents();
    for (const document of [documentSet.korean, documentSet.koreanRunbook]) {
      for (const marker of OPERATOR_WORDING.ko) expect(document).toContain(marker);
    }
    for (const document of [documentSet.english, documentSet.englishRunbook]) {
      for (const marker of OPERATOR_WORDING.en) expect(document).toContain(marker);
    }

    for (const [overrides, expected] of [
      [
        { english: documentSet.english.replace("http://localhost:5184", "http://localhost:5184.evil.example") },
        "en:section:release.google-oauth:http://localhost:5184",
      ],
      [
        { koreanRunbook: documentSet.koreanRunbook.replace(
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.events.extra",
        ) },
        "ko:runbook-section:runbook.prerequisites:https://www.googleapis.com/auth/calendar.events",
      ],
      [
        { korean: documentSet.korean.replace(OPERATOR_WORDING.ko[0], "운영 설정이 존재합니다.") },
        "ko:operator-wording",
      ],
      [
        { englishRunbook: documentSet.englishRunbook.replace(OPERATOR_WORDING.en[1], "The state is successful.") },
        "en:runbook:operator-wording",
      ],
    ]) {
      const result = await validateReadmeParity(
        overrides.korean ?? documentSet.korean,
        overrides.english ?? documentSet.english,
        validationOptions(documentSet, {
          ...(overrides.koreanRunbook === undefined ? {} : { koreanRunbook: overrides.koreanRunbook }),
          ...(overrides.englishRunbook === undefined ? {} : { englishRunbook: overrides.englishRunbook }),
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(expected);
    }
  });

  it("documents the protected GitHub/AWS bootstrap and trusted controller sequence without live claims", async () => {
    const documentSet = await documents();
    const releaseMarkers = [
      "infra/aws/molroom-bootstrap.yml",
      "ControllerTag=molroom-release-controller-v1",
      "HostedZoneId",
      "ProductionStackName",
      "ExistingGitHubOidcProviderArn",
      "repo:kim-song-jun/meeting-wrapper:environment:production",
      "required reviewer",
      "self-approval",
      "v*",
      ".github/workflows/security-gate.yml",
      ".github/workflows/release-controller.yml",
      "candidate_run_id",
      "security_gate_run_id",
      "execute_cutover",
      "PLAN",
      "repair",
      "rollback",
      "smoke",
      "restore",
    ];
    for (const document of [documentSet.korean, documentSet.english, documentSet.koreanRunbook, documentSet.englishRunbook]) {
      for (const marker of releaseMarkers) expect(document).toContain(marker);
      expect(document).toContain("AWS SSO");
      expect(document).toContain("us-east-1");
      expect(document).toContain("no long-lived AWS");
      expect(document).not.toContain("github.workflow_sha");
    }
    expect(documentSet.productionSpec).toContain(`refs/tags/${CONTROLLER_TAG}`);
    expect(documentSet.productionSpec).toContain(CONTROLLER_SHA);
    expect(documentSet.productionSpec).toContain("approved security-gate workflow blob");
    expect(documentSet.productionSpec).toContain("dispatch_actor");
    expect(documentSet.productionSpec).not.toContain("github.workflow_sha");

    for (const [productionSpec, error] of [
      [documentSet.productionSpec.replace(CONTROLLER_SHA, "PHASE_1_CONTROLLER_SHA"), "spec:controller-sha"],
      [`${documentSet.productionSpec}\n\`\${{ github.workflow_sha }}\`\n`, "spec:forbidden:github.workflow_sha"],
      [documentSet.productionSpec.replace("dispatch_actor", "actor binding removed"), "spec:security-gate-actor"],
    ]) {
      const result = await validateReadmeParity(documentSet.korean, documentSet.english, validationOptions(documentSet, { productionSpec }));
      expect(result.valid).toBe(false);
      expect(result.missing).toContain(error);
    }
  });

  it("binds spec section 11 to the actual canonical eight README sections", async () => {
    const documentSet = await documents();
    const section = documentSet.productionSpec.slice(
      documentSet.productionSpec.indexOf("## 11. 한영 문서 구조"),
      documentSet.productionSpec.indexOf("## 12. Wave 계획"),
    );
    expect(section.split(/\r?\n/)).toContain(README_SECTION_CONTRACT);
    expect([...section.matchAll(/^\d+\. \[([^\]]+)]/gm)].map((match) => match[1])).toEqual([
      "release.toolchain",
      "release.google-oauth",
      "release.env",
      "release.validation",
      "release.aws-oidc",
      "release.first-release",
      "release.rollback",
      "release.security",
    ]);
    expect(section).not.toMatch(/^\d{2,}\. /m);

    const productionSpec = documentSet.productionSpec.replace(
      README_SECTION_CONTRACT,
      README_SECTION_CONTRACT + "\n9. [release.extra] stale chapter",
    );
    const result = await validateReadmeParity(
      documentSet.korean,
      documentSet.english,
      validationOptions(documentSet, { productionSpec }),
    );
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("spec:readme-sections");
  });
});
