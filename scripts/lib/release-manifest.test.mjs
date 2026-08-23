import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildReleaseArtifacts,
  executeUploadPlan,
  planReleasePrefixUpload,
  writeReleaseMetadata,
} from "./release-manifest.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const commitSha = "0123456789abcdef0123456789abcdef01234567";
const assetSha256 = "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d";
const assetChecksumSha256 = Buffer.from(assetSha256, "hex").toString("base64");
const manifestText = [
  "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  assets/app-a1b2c3d4.js",
  "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  index.html",
  "2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6  service-worker.js",
].join("\n") + "\n";
const manifestSha256 = "cd082c55d30fa51829bca98297f34ea7a2b59efbc67b20254f822b2aa2004f48";
const temporaryRoots = [];

async function readInfrastructureTemplate(name) {
  for (const directory of ["aws", "cloudformation"]) {
    try {
      return await readFile(join(repositoryRoot, "infra", directory, name), "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  throw new Error(`Missing infrastructure template: ${name}`);
}

async function makeArtifactRoot() {
  const root = await mkdtemp(join(tmpdir(), "molroom-release-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "a");
  await writeFile(join(root, "assets", "app-a1b2c3d4.js"), "b");
  await writeFile(join(root, "service-worker.js"), "c");
  return root;
}

function securityGate() {
  return {
    schema_version: 1,
    repository: "kim-song-jun/meeting-wrapper",
    target_sha: commitSha,
    manual_review_sha256: "1".repeat(64),
    deep_security_scan_sha256: "2".repeat(64),
    scan_tool: "codex-security",
    scan_version: "0.1.21",
    completed_at: "2026-08-23T00:00:00.000Z",
    critical_count: 0,
    high_count: 0,
    redacted_finding_ids: [],
    security_gate_run_id: 1234,
    dispatch_actor: "release-operator",
    gate_timestamp: "2026-08-23T00:01:00.000Z",
  };
}

async function prepareReleasePrefix() {
  const artifactRoot = await makeArtifactRoot();
  const release = await buildReleaseArtifacts({
    artifactRoot,
    commitSha,
    packageVersion: "0.1.0",
    sourceDateEpoch: 1_700_000_000,
  });
  await writeReleaseMetadata({ artifactRoot, release });
  await writeFile(
    join(artifactRoot, "_security-gate.json"),
    `${JSON.stringify(securityGate(), null, 2)}\n`,
  );
  return { artifactRoot, release };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("deterministic release metadata", () => {
  it("builds a path-sorted runtime manifest and stable release JSON from content only", async () => {
    const artifactRoot = await makeArtifactRoot();
    const input = {
      artifactRoot,
      commitSha,
      packageVersion: "0.1.0",
      sourceDateEpoch: 1_700_000_000,
    };

    const first = await buildReleaseArtifacts(input);
    await utimes(join(artifactRoot, "index.html"), new Date(), new Date("2030-01-01T00:00:00Z"));
    const second = await buildReleaseArtifacts(input);

    expect(first).toEqual(second);
    expect(first.manifestText).toBe(manifestText);
    expect(first.manifestSha256).toBe(manifestSha256);
    expect(first.entries).toEqual([
      {
        cacheControl: "public, max-age=31536000, immutable",
        contentType: "text/javascript; charset=utf-8",
        path: "assets/app-a1b2c3d4.js",
        sha256: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
        size: 1,
      },
      {
        cacheControl: "no-cache",
        contentType: "text/html; charset=utf-8",
        path: "index.html",
        sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
        size: 1,
      },
      {
        cacheControl: "no-cache",
        contentType: "text/javascript; charset=utf-8",
        path: "service-worker.js",
        sha256: "2e7d2c03a9507ae265ecf5b5356885a53393a2029d241394997265a1a25aefc6",
        size: 1,
      },
    ]);
    expect(first.releaseJson).toBe(
      `${JSON.stringify(
        {
          schema_version: 1,
          package_version: "0.1.0",
          commit_sha: commitSha,
          commit_timestamp: 1_700_000_000,
          manifest_sha256: manifestSha256,
        },
        null,
        2,
      )}\n`,
    );
  });

  it("refuses symlinks and malformed release identities before hashing", async () => {
    const artifactRoot = await makeArtifactRoot();
    await symlink(join(artifactRoot, "index.html"), join(artifactRoot, "assets", "linked.html"));

    await expect(
      buildReleaseArtifacts({
        artifactRoot,
        commitSha,
        packageVersion: "0.1.0",
        sourceDateEpoch: 1_700_000_000,
      }),
    ).rejects.toThrow("symbolic link");
    await expect(
      buildReleaseArtifacts({
        artifactRoot: await makeArtifactRoot(),
        commitSha: "../not-a-commit",
        packageVersion: "0.1.0",
        sourceDateEpoch: 1_700_000_000,
      }),
    ).rejects.toThrow("40-character lowercase hexadecimal commit SHA");
  });

  it("writes metadata idempotently but never replaces different existing bytes", async () => {
    const artifactRoot = await makeArtifactRoot();
    const release = await buildReleaseArtifacts({
      artifactRoot,
      commitSha,
      packageVersion: "0.1.0",
      sourceDateEpoch: 1_700_000_000,
    });

    await expect(writeReleaseMetadata({ artifactRoot, release })).resolves.toEqual({
      manifest: "written",
      release: "written",
    });
    await expect(writeReleaseMetadata({ artifactRoot, release })).resolves.toEqual({
      manifest: "reused",
      release: "reused",
    });
    await writeFile(join(artifactRoot, "_release.json"), "{}\n");
    await expect(writeReleaseMetadata({ artifactRoot, release })).rejects.toThrow(
      "Refusing to replace different release metadata",
    );
  });

  it("rejects per-file and aggregate artifact byte limits before reading file contents", async () => {
    const perFileRoot = await makeArtifactRoot();
    await writeFile(join(perFileRoot, "index.html"), "aa");
    await expect(
      buildReleaseArtifacts({
        artifactRoot: perFileRoot,
        commitSha,
        packageVersion: "0.1.0",
        sourceDateEpoch: 1_700_000_000,
        artifactLimits: { maxFileBytes: 1, maxTotalBytes: 10 },
      }),
    ).rejects.toThrow("per-file byte limit");

    const aggregateRoot = await makeArtifactRoot();
    await expect(
      buildReleaseArtifacts({
        artifactRoot: aggregateRoot,
        commitSha,
        packageVersion: "0.1.0",
        sourceDateEpoch: 1_700_000_000,
        artifactLimits: { maxFileBytes: 2, maxTotalBytes: 2 },
      }),
    ).rejects.toThrow("aggregate byte limit");

    await expect(
      buildReleaseArtifacts({
        artifactRoot: await makeArtifactRoot(),
        commitSha,
        packageVersion: "0.1.0",
        sourceDateEpoch: 1_700_000_000,
        artifactLimits: {
          maxFileBytes: Number.MAX_SAFE_INTEGER,
          maxTotalBytes: Number.MAX_SAFE_INTEGER,
        },
      }),
    ).rejects.toThrow("must not exceed the release policy");
  });
});

describe("immutable release prefix upload", () => {
  it("plans exact release keys with content checksums, conditional writes, and cache metadata", async () => {
    const { artifactRoot } = await prepareReleasePrefix();
    const plan = await planReleasePrefixUpload({
      artifactRoot,
      bucket: "molroom-123456789012-us-east-1-origin",
      commitSha,
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      bucket: "molroom-123456789012-us-east-1-origin",
      commitSha,
      releasePrefix: `releases/${commitSha}/`,
      manifestSha256,
    });
    expect(plan.objects.map((object) => object.key)).toEqual([
      `releases/${commitSha}/assets/app-a1b2c3d4.js`,
      `releases/${commitSha}/index.html`,
      `releases/${commitSha}/service-worker.js`,
      `releases/${commitSha}/_manifest.sha256`,
      `releases/${commitSha}/_release.json`,
      `releases/${commitSha}/_security-gate.json`,
    ]);
    expect(plan.objects[0]).toMatchObject({
      sourcePath: "assets/app-a1b2c3d4.js",
      sha256: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
      checksumSha256: assetChecksumSha256,
      ifNoneMatch: "*",
      cacheControl: "public, max-age=31536000, immutable",
      metadata: {
        sha256: "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d",
        "manifest-sha256": manifestSha256,
      },
    });
    expect(plan.objects.slice(3).every((object) => object.cacheControl === "no-cache")).toBe(true);
    expect(JSON.stringify(plan)).not.toContain(artifactRoot);
  });

  it("rejects a security gate that is not zero-severity evidence for the exact release SHA", async () => {
    const { artifactRoot } = await prepareReleasePrefix();
    await writeFile(
      join(artifactRoot, "_security-gate.json"),
      `${JSON.stringify({ ...securityGate(), high_count: 1 }, null, 2)}\n`,
    );

    await expect(
      planReleasePrefixUpload({
        artifactRoot,
        bucket: "molroom-123456789012-us-east-1-origin",
        commitSha,
      }),
    ).rejects.toThrow("Critical and High counts must both be zero");
  });

  it("uses conditional PutObject and accepts a 412 only when stored checksums match", async () => {
    const { artifactRoot } = await prepareReleasePrefix();
    const fullPlan = await planReleasePrefixUpload({
      artifactRoot,
      bucket: "molroom-123456789012-us-east-1-origin",
      commitSha,
    });
    const plan = { ...fullPlan, objects: [fullPlan.objects[0]] };
    const commands = [];
    let putAttempts = 0;
    const result = await executeUploadPlan({
      artifactRoot,
      plan,
      runAws: async (args, options = {}) => {
        commands.push({ args, options });
        if (args[1] === "put-object") {
          putAttempts += 1;
          const error = new Error("An error occurred (PreconditionFailed): 412");
          error.stderr = "PreconditionFailed 412";
          throw error;
        }
        return {
          stdout: JSON.stringify({
            ContentLength: 1,
            ChecksumSHA256: assetChecksumSha256,
            Metadata: {
              sha256: plan.objects[0].sha256,
              "manifest-sha256": manifestSha256,
            },
          }),
          stderr: "",
        };
      },
    });

    expect(putAttempts).toBe(1);
    expect(commands[0].args).toContain("--if-none-match");
    expect(commands[0].args).toContain("*");
    expect(commands[0].args).toContain("--checksum-sha256");
    expect(commands[0].args).toContain("/dev/stdin");
    expect(commands[0].options.input).toEqual(Buffer.from("b"));
    expect(commands[1].args.slice(0, 2)).toEqual(["s3api", "head-object"]);
    expect(result).toEqual([{ key: plan.objects[0].key, status: "reused" }]);
  });

  it("refuses a same-size content mutation after planning before invoking AWS", async () => {
    const { artifactRoot } = await prepareReleasePrefix();
    const fullPlan = await planReleasePrefixUpload({
      artifactRoot,
      bucket: "molroom-123456789012-us-east-1-origin",
      commitSha,
    });
    const plan = { ...fullPlan, objects: [fullPlan.objects[0]] };
    await writeFile(join(artifactRoot, plan.objects[0].sourcePath), "x");
    let awsCalls = 0;

    await expect(
      executeUploadPlan({
        artifactRoot,
        plan,
        runAws: async () => {
          awsCalls += 1;
          return { stdout: "", stderr: "" };
        },
      }),
    ).rejects.toThrow("changed after the upload plan was created");
    expect(awsCalls).toBe(0);
  });

  it("refuses a source-path symlink swap after planning before invoking AWS", async () => {
    const { artifactRoot } = await prepareReleasePrefix();
    const fullPlan = await planReleasePrefixUpload({
      artifactRoot,
      bucket: "molroom-123456789012-us-east-1-origin",
      commitSha,
    });
    const plan = { ...fullPlan, objects: [fullPlan.objects[0]] };
    const sourcePath = join(artifactRoot, plan.objects[0].sourcePath);
    const replacementPath = join(artifactRoot, "assets", "planned.js");
    await rename(sourcePath, replacementPath);
    await symlink(replacementPath, sourcePath);
    let awsCalls = 0;

    await expect(
      executeUploadPlan({
        artifactRoot,
        plan,
        runAws: async () => {
          awsCalls += 1;
          return { stdout: "", stderr: "" };
        },
      }),
    ).rejects.toThrow("symbolic link");
    expect(awsCalls).toBe(0);
  });

  it("fails closed when a pre-existing object differs from the planned bytes", async () => {
    const { artifactRoot } = await prepareReleasePrefix();
    const fullPlan = await planReleasePrefixUpload({
      artifactRoot,
      bucket: "molroom-123456789012-us-east-1-origin",
      commitSha,
    });
    const plan = { ...fullPlan, objects: [fullPlan.objects[0]] };

    await expect(
      executeUploadPlan({
        artifactRoot,
        plan,
        runAws: async (args) => {
          if (args[1] === "put-object") {
            const error = new Error("PreconditionFailed 412");
            error.stderr = "PreconditionFailed 412";
            throw error;
          }
          return {
            stdout: JSON.stringify({
              ContentLength: 1,
              ChecksumSHA256: "YQ==",
              Metadata: {
                sha256: "0".repeat(64),
                "manifest-sha256": manifestSha256,
              },
            }),
            stderr: "",
          };
        },
      }),
    ).rejects.toThrow("Immutable release object differs");
  });
});

describe("CloudFront release routing", () => {
  async function loadHandler() {
    const template = await readInfrastructureTemplate("molroom-production.yml");
    const marker = "FunctionCode: !Sub |\n";
    const start = template.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const lines = template.slice(start + marker.length).split("\n");
    const end = lines.findIndex((line) => line !== "" && !line.startsWith("        "));
    const source = lines
      .slice(0, end === -1 ? lines.length : end)
      .map((line) => line.slice(8))
      .join("\n");
    const context = {};
    vm.runInNewContext(
      `${source.replaceAll("${ActiveReleaseSha}", commitSha)}\nthis.cloudFrontHandler = handler;`,
      context,
    );
    return context.cloudFrontHandler;
  }

  it("rewrites extensionless SPA routes to the active index without hiding asset/file 404s", async () => {
    const handler = await loadHandler();
    const cases = [
      ["/", `/releases/${commitSha}/index.html`],
      ["/login", `/releases/${commitSha}/index.html`],
      ["/r/room-a", `/releases/${commitSha}/index.html`],
      ["/nested/", `/releases/${commitSha}/index.html`],
      ["/assets/app-a1b2c3d4.js", `/releases/${commitSha}/assets/app-a1b2c3d4.js`],
      ["/assets/missing", `/releases/${commitSha}/assets/missing`],
      ["/robots.txt", `/releases/${commitSha}/robots.txt`],
    ];

    for (const [uri, expected] of cases) {
      const request = { uri, querystring: { source: { value: "redacted" } } };
      const output = handler({ request });
      expect(output.uri).toBe(expected);
      expect(JSON.stringify(output.querystring)).toBe(JSON.stringify(request.querystring));
    }
  });

  it("uses only the canonical AWS templates and has no duplicate FunctionCode source", async () => {
    await expect(
      Promise.all([
        access(join(repositoryRoot, "infra", "aws", "molroom-bootstrap.yml")),
        access(join(repositoryRoot, "infra", "aws", "molroom-production.yml")),
      ]),
    ).resolves.toEqual([undefined, undefined]);
    await expect(access(join(repositoryRoot, "infra", "cloudfront-function.js"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("credential-free infrastructure and release gates", () => {
  async function readOwned(path) {
    return readFile(join(repositoryRoot, path), "utf8");
  }

  it("scopes the bootstrap OIDC trust to the exact repository production environment", async () => {
    const bootstrap = await readInfrastructureTemplate("molroom-bootstrap.yml");

    expect(bootstrap).toContain("https://token.actions.githubusercontent.com");
    expect(bootstrap).toContain("sts.amazonaws.com");
    expect(bootstrap).toContain("sts:AssumeRoleWithWebIdentity");
    expect(bootstrap).toContain("repo:kim-song-jun/meeting-wrapper:environment:production");
    expect(bootstrap).toContain("ExistingGitHubOidcProviderArn");
    expect(bootstrap).not.toMatch(/AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)/);
  });

  it("keeps the hosting origin private, immutable, versioned, and CloudFront-only", async () => {
    const production = await readInfrastructureTemplate("molroom-production.yml");

    for (const required of [
      "ActiveReleaseSha",
      "UNRELEASED",
      "DistributionEnabled",
      "BucketOwnerEnforced",
      "BlockPublicAcls: true",
      "Status: Enabled",
      "s3:if-none-match",
      "s3:ObjectCreationOperation",
      "AWS::CloudFront::OriginAccessControl",
      "AWS::CloudFront::Function",
      "viewer-request",
      "AWS::CertificateManager::Certificate",
      "AWS::Route53::RecordSet",
      "ExpirationInDays: 30",
      "ErrorCode: 403",
      "ResponseCode: 404",
    ]) {
      expect(production).toContain(required);
    }
    expect(production).toMatch(
      /Sid: DenyMissingConditionalWriteHeader[\s\S]*?Null:[\s\S]*?s3:if-none-match: "true"/,
    );
    expect(production).toMatch(
      /Sid: DenyWrongConditionalWriteHeader[\s\S]*?StringNotEquals:[\s\S]*?s3:if-none-match: "\*"/,
    );
    expect(production).not.toContain("WebsiteConfiguration");
  });

  it("configures the exact response security headers and bounded cache contract", async () => {
    const production = await readInfrastructureTemplate("molroom-production.yml");

    for (const required of [
      "AccessControlMaxAgeSec: 63072000",
      "IncludeSubdomains: true",
      "Preload: true",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' https://accounts.google.com; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://lh3.googleusercontent.com; connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com; frame-src https://accounts.google.com; form-action 'self' https://accounts.google.com; manifest-src 'self'; worker-src 'self'",
      "strict-origin-when-cross-origin",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "same-origin-allow-popups",
      "MinTTL: 0",
      "MaxTTL: 31536000",
      "QueryStringBehavior: none",
      "CookieBehavior: none",
    ]) {
      expect(production).toContain(required);
    }
  });

  it("splits unavoidable create permissions from account-scoped tagged resource management", async () => {
    const bootstrap = await readInfrastructureTemplate("molroom-bootstrap.yml");
    const production = await readInfrastructureTemplate("molroom-production.yml");

    for (const required of [
      "Sid: CreateTaggedCloudFrontResources",
      "Sid: CreateUnscopedCloudFrontPolicies",
      "Sid: ManageTaggedDistribution",
      "Sid: ManageTaggedFunction",
      "Sid: ManageAccountCloudFrontPolicies",
      "Sid: RequestTaggedProductionCertificate",
      "Sid: TagRequestedProductionCertificate",
      "Sid: ManageTaggedProductionCertificate",
      "aws:RequestTag/Project: MolRoom",
      "aws:ResourceTag/Project: MolRoom",
      "acm:DomainNames:",
      "- molroom.molcube.com",
      "route53:ChangeResourceRecordSetsNormalizedRecordNames",
      "route53:ChangeResourceRecordSetsRecordTypes",
      "route53:ChangeResourceRecordSetsActions",
      "cloudfront::${AWS::AccountId}:distribution/*",
      "cloudfront::${AWS::AccountId}:function/molroom-release-router",
      "acm:us-east-1:${AWS::AccountId}:certificate/*",
    ]) {
      expect(bootstrap).toContain(required);
    }
    expect(bootstrap).not.toContain("Sid: ManageCloudFrontResources");
    expect(bootstrap).not.toContain("aws:TagKeys:");
    const requestedCertificateTagging = bootstrap.slice(
      bootstrap.indexOf("Sid: TagRequestedProductionCertificate"),
      bootstrap.indexOf("Sid: ManageTaggedProductionCertificate"),
    );
    expect(requestedCertificateTagging).toContain("Action: acm:AddTagsToCertificate");
    expect(requestedCertificateTagging).toContain(
      "arn:${AWS::Partition}:acm:us-east-1:${AWS::AccountId}:certificate/*",
    );
    expect(requestedCertificateTagging).toContain("aws:RequestTag/Project: MolRoom");
    const managedCertificate = bootstrap.slice(
      bootstrap.indexOf("Sid: ManageTaggedProductionCertificate"),
      bootstrap.indexOf("Sid: ManageProductionDnsRecords"),
    );
    expect(managedCertificate).not.toContain("acm:AddTagsToCertificate");
    expect(managedCertificate).toContain("aws:ResourceTag/Project: MolRoom");
    expect(production.match(/Key: Project\n\s+Value: MolRoom/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("keeps security attestation and release mutation behind manual protected gates", async () => {
    const securityGateWorkflow = await readOwned(".github/workflows/security-gate.yml");
    const releaseWorkflow = await readOwned(".github/workflows/release.yml");

    for (const workflow of [securityGateWorkflow, releaseWorkflow]) {
      expect(workflow).toContain("workflow_dispatch:");
      expect(workflow).toContain("environment: production");
      expect(workflow).not.toMatch(/AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)\s*:/);
      for (const line of workflow.split("\n").filter((entry) => entry.trim().startsWith("uses:"))) {
        expect(line).toMatch(/uses: [^@]+@[0-9a-f]{40}(?:\s+#.*)?$/);
      }
    }
    expect(securityGateWorkflow).toContain("target_sha:");
    expect(securityGateWorkflow).toContain("attestation_base64:");
    expect(securityGateWorkflow).toContain("security-gate-${{ inputs.target_sha }}");
    expect(releaseWorkflow).toContain("id-token: write");
    expect(releaseWorkflow).toContain("contents: write");
    expect(releaseWorkflow).toContain("mode:");
    expect(releaseWorkflow).toContain("- release");
    expect(releaseWorkflow).toContain("- rollback");
    expect(releaseWorkflow).toContain("execute_cutover:");
    expect(releaseWorkflow).toContain("security_gate_run_id:");
    expect(releaseWorkflow).toContain("aws-actions/configure-aws-credentials@");
    expect(releaseWorkflow).toContain("node scripts/upload-release-prefix.mjs");
    expect(releaseWorkflow).toContain("infra/aws/molroom-production.yml");
    expect(releaseWorkflow).not.toContain("infra/cloudformation/");
    for (const required of [
      "known_asset_status",
      "known_asset_sha256",
      "missing_asset_status",
      "missing_asset_is_spa",
      "https://accounts.google.com/gsi/client",
      "initTokenClient",
      "production-smoke-evidence.json",
      "Upload production smoke evidence",
    ]) {
      expect(releaseWorkflow).toContain(required);
    }
    expect(releaseWorkflow).not.toContain("aws s3 sync");
    expect(releaseWorkflow).not.toContain("cloudfront update-function");
    expect(releaseWorkflow.indexOf("Verify security gate evidence")).toBeLessThan(
      releaseWorkflow.indexOf("Upload immutable release prefix"),
    );
    expect(releaseWorkflow.indexOf("Verify production runtime gates")).toBeLessThan(
      releaseWorkflow.indexOf("Create promote change set"),
    );
    const initialReleaseGate = releaseWorkflow.slice(
      releaseWorkflow.indexOf("Validate dispatch identity and explicit confirmation"),
      releaseWorkflow.indexOf("Pin npm"),
    );
    const tagCreationGate = releaseWorkflow.slice(
      releaseWorkflow.indexOf("Create immutable annotated tag and GitHub Release"),
      releaseWorkflow.indexOf("Summarize non-mutating plan"),
    );
    const freshMainCheck =
      /git fetch origin main --quiet\n\s+test "\$\(git rev-parse origin\/main\)" = "\$TARGET_SHA"/;
    expect(initialReleaseGate).toMatch(freshMainCheck);
    expect(tagCreationGate).toMatch(freshMainCheck);
    expect(tagCreationGate.search(freshMainCheck)).toBeLessThan(
      tagCreationGate.indexOf('if git show-ref --verify --quiet "refs/tags/v$VERSION"'),
    );
    expect(releaseWorkflow.match(/git fetch origin main --quiet/g)).toHaveLength(2);
    expect(releaseWorkflow).not.toContain("FETCH_HEAD");
    expect(releaseWorkflow).not.toContain("refs/heads/main");
    expect(releaseWorkflow).toContain("Create rollback change set");
    expect(releaseWorkflow).toContain("cancel-in-progress: false");
  });
});
