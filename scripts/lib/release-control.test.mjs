import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import * as releaseControlModule from "./release-control.mjs";
import {
  buildReleaseArtifacts,
  inspectReleaseArtifactTree,
  planReleasePrefixUpload,
  writeReleaseMetadata,
} from "./release-manifest.mjs";
import {
  ARCHIVE_RECEIPT_SCHEMA_VERSION,
  CANDIDATE_CONTAINER_IMAGE,
  createArchiveReceipt,
  observeCloudFormationStack,
  planDeploymentLifecycle,
  runCandidateSandbox,
  runReleaseControlCli,
  validateArchiveReceipt,
  validateSecurityGateBinding,
  verifyRemoteReleasePrefix,
} from "./release-control.mjs";

const { extractReleaseArtifactZip } = releaseControlModule;

const commitSha = "0123456789abcdef0123456789abcdef01234567";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots = [];
const verifiedArchiveSteps = [
  "node-version",
  "npm-version",
  "repository-pins",
  "capture-standalone",
  "npm-ci",
  "design-build",
  "standalone-compare",
  "design-validate",
  "vitest",
  "typecheck",
  "vite-build",
  "bundle-scan",
  "readme-parity",
  "retain-artifact",
].map((name) => ({ name, status: "passed" }));

async function temporaryRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function executable(path, source) {
  await writeFile(path, source, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function runExecutable(executablePath, args, { environment = {} } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executablePath, args, {
      env: { ...process.env, ...environment },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({
      code,
      signal,
      stderr: Buffer.concat(stderr).toString("utf8"),
      stdout: Buffer.concat(stdout).toString("utf8"),
    }));
  });
}

async function fakeCloudFormationAws(root, scenario) {
  const fakeBin = join(root, "bin");
  const logPath = join(root, "aws.log");
  const counterPath = join(root, "describe-count");
  await mkdir(fakeBin);
  await writeFile(logPath, "");
  await executable(join(fakeBin, "aws"), [
    "#!/usr/bin/env node",
    'import { appendFile, readFile, writeFile } from "node:fs/promises";',
    "const args = process.argv.slice(2);",
    `const logPath = ${JSON.stringify(logPath)};`,
    `const counterPath = ${JSON.stringify(counterPath)};`,
    `const scenario = ${JSON.stringify(scenario)};`,
    'await appendFile(logPath, `${args.join(" ")}\\n`);',
    'if (args[0] !== "cloudformation") process.exit(90);',
    'if (args[1] === "describe-stacks") {',
    '  let count = 0;',
    '  try { count = Number(await readFile(counterPath, "utf8")); } catch {}',
    '  count += 1;',
    '  await writeFile(counterPath, String(count));',
    '  if (scenario === "absent") {',
    '    process.stderr.write("An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id molroom-production does not exist\\n");',
    '    process.exit(254);',
    '  }',
    '  if (scenario === "transient" || (scenario === "restore-fails" && count > 1)) {',
    '    process.stderr.write("An error occurred (Throttling) when calling the DescribeStacks operation: Rate exceeded\\n");',
    '    process.exit(254);',
    '  }',
    '  if (scenario === "auth") {',
    '    process.stderr.write("An error occurred (AccessDenied) when calling the DescribeStacks operation: denied\\n");',
    '    process.exit(254);',
    '  }',
    '  if (scenario === "network") {',
    '    process.stderr.write("Could not connect to the endpoint URL\\n");',
    '    process.exit(255);',
    '  }',
    '  if (scenario === "other-validation") {',
    '    process.stderr.write("An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id another-stack does not exist\\n");',
    '    process.exit(254);',
    '  }',
    `  process.stdout.write(${JSON.stringify(`${JSON.stringify({ Stacks: [{ StackName: "molroom-production", StackStatus: "CREATE_COMPLETE", Parameters: [{ ParameterKey: "ActiveReleaseSha", ParameterValue: commitSha }, { ParameterKey: "DistributionEnabled", ParameterValue: "true" }] }] })}\n`)});`,
    '  process.exit(0);',
    '}',
    'if (args[1] === "delete-stack") process.exit(0);',
    'if (args[1] === "wait" && args[2] === "stack-delete-complete") process.exit(0);',
    'process.exit(91);',
  ].join("\n"));
  return { fakeBin, logPath };
}

async function writeValidProductionArtifact(artifactRoot) {
  await Promise.all([
    mkdir(join(artifactRoot, "assets"), { recursive: true }),
    mkdir(join(artifactRoot, "licenses", "pretendard"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(artifactRoot, "index.html"), "<!doctype html><title>MolRoom</title>"),
    writeFile(
      join(artifactRoot, "assets/release.css"),
      '@font-face{font-family:"Pretendard Variable";font-style:normal;font-weight:400 700;font-display:optional;src:url("/assets/PretendardVariable-v1.3.9-release.woff2") format("woff2-variations")}\n',
    ),
    copyFile(
      join(repositoryRoot, "src/assets/fonts/PretendardVariable-v1.3.9.woff2"),
      join(artifactRoot, "assets/PretendardVariable-v1.3.9-release.woff2"),
    ),
    copyFile(
      join(repositoryRoot, "public/licenses/pretendard/SIL-OFL-1.1.txt"),
      join(artifactRoot, "licenses/pretendard/SIL-OFL-1.1.txt"),
    ),
  ]);
}

function sha256(contents, encoding = "hex") {
  return createHash("sha256").update(contents).digest(encoding);
}

function fixtureCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFixture(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = entry.nameBytes ?? Buffer.from(entry.name, "utf8");
    const contents = Buffer.from(entry.contents ?? "");
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(contents) : contents;
    const declaredSize = entry.declaredUncompressedSize ?? contents.length;
    const crc = entry.centralCrc32 ?? fixtureCrc32(contents);
    const dataDescriptor = entry.dataDescriptor;
    const flags = 0x0800 | (dataDescriptor ? 0x0008 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(dataDescriptor ? 0 : crc, 14);
    local.writeUInt32LE(dataDescriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(dataDescriptor ? 0 : declaredSize, 22);
    local.writeUInt16LE(name.length, 26);
    let descriptorRecord = Buffer.alloc(0);
    if (dataDescriptor) {
      const signed = dataDescriptor.signed !== false;
      descriptorRecord = Buffer.alloc(signed ? 16 : 12);
      let descriptorOffset = 0;
      if (signed) {
        descriptorRecord.writeUInt32LE(0x08074b50, 0);
        descriptorOffset = 4;
      }
      descriptorRecord.writeUInt32LE(dataDescriptor.crc32 ?? crc, descriptorOffset);
      descriptorRecord.writeUInt32LE(
        dataDescriptor.compressedSize ?? compressed.length,
        descriptorOffset + 4,
      );
      descriptorRecord.writeUInt32LE(
        dataDescriptor.uncompressedSize ?? declaredSize,
        descriptorOffset + 8,
      );
      if (dataDescriptor.truncateBytes) {
        descriptorRecord = descriptorRecord.subarray(
          0,
          descriptorRecord.length - dataDescriptor.truncateBytes,
        );
      }
      descriptorRecord = Buffer.concat([
        descriptorRecord,
        Buffer.from(dataDescriptor.trailingBytes ?? []),
      ]);
    }
    const localRecord = Buffer.concat([local, name, compressed, descriptorRecord]);
    localParts.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) * 0x10000) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([central, name]));
    localOffset += localRecord.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function overlappingDataDescriptorZipFixture() {
  const firstName = Buffer.from("a");
  const firstCompressed = Buffer.alloc(20);
  const firstCrc32 = 0x04034b50;
  const firstLocal = Buffer.alloc(30);
  firstLocal.writeUInt32LE(0x04034b50, 0);
  firstLocal.writeUInt16LE(20, 4);
  firstLocal.writeUInt16LE(0x0808, 6);
  firstLocal.writeUInt16LE(8, 8);
  firstLocal.writeUInt16LE(firstName.length, 26);

  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(firstCrc32, 4);
  descriptor.writeUInt32LE(firstCompressed.length, 8);
  descriptor.writeUInt32LE(0, 12);
  const descriptorStart = firstLocal.length + firstName.length + firstCompressed.length;
  const secondLocalOffset = descriptorStart + 4;

  const secondName = Buffer.from("b");
  const secondContents = Buffer.from("ok");
  const secondCrc32 = fixtureCrc32(secondContents);
  const secondLocal = Buffer.alloc(30);
  secondLocal.writeUInt32LE(0x04034b50, 0);
  secondLocal.writeUInt16LE(20, 4);
  secondLocal.writeUInt32LE(secondCrc32, 14);
  secondLocal.writeUInt32LE(secondContents.length, 18);
  secondLocal.writeUInt32LE(secondContents.length, 22);
  secondLocal.writeUInt16LE(secondName.length, 26);
  if (!descriptor.subarray(4).equals(secondLocal.subarray(0, 12))) {
    throw new Error("overlap fixture does not encode the second local-header prefix");
  }

  const localArea = Buffer.concat([
    firstLocal,
    firstName,
    firstCompressed,
    descriptor,
    secondLocal.subarray(12),
    secondName,
    secondContents,
  ]);
  const centralEntries = [
    {
      compressedSize: firstCompressed.length,
      crc32: firstCrc32,
      flags: 0x0808,
      localOffset: 0,
      method: 8,
      name: firstName,
      uncompressedSize: 0,
    },
    {
      compressedSize: secondContents.length,
      crc32: secondCrc32,
      flags: 0,
      localOffset: secondLocalOffset,
      method: 0,
      name: secondName,
      uncompressedSize: secondContents.length,
    },
  ].map((entry) => {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(entry.crc32, 16);
    central.writeUInt32LE(entry.compressedSize, 20);
    central.writeUInt32LE(entry.uncompressedSize, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    central.writeUInt32LE(entry.localOffset, 42);
    return Buffer.concat([central, entry.name]);
  });
  const centralDirectory = Buffer.concat(centralEntries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centralEntries.length, 8);
  eocd.writeUInt16LE(centralEntries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localArea.length, 16);
  return Buffer.concat([localArea, centralDirectory, eocd]);
}

function gateEvidence() {
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
    security_gate_run_id: 451,
    dispatch_actor: "release-operator",
    gate_timestamp: "2026-08-23T00:01:00.000Z",
  };
}

function exactStoredHead(object, manifestDigest) {
  return {
    CacheControl: object.cacheControl,
    ChecksumSHA256: object.checksumSha256,
    ContentLength: object.size,
    ContentType: object.contentType,
    Metadata: {
      sha256: object.sha256,
      "manifest-sha256": manifestDigest,
    },
    ServerSideEncryption: "AES256",
  };
}

function logicalShellCommands(run) {
  return run.replace(/\\\n\s*/g, " ").split("\n").map((command) => command.trim()).filter(Boolean);
}

function validateUploadInvocationSemantics(source) {
  const jobs = parseWorkflowJobs(source);
  const invocations = [...jobs.values()].flatMap(({ steps }) => (
    steps.flatMap(({ run }) => logicalShellCommands(run))
  )).filter((command) => command.includes("node controller/scripts/upload-release-prefix.mjs"));
  if (invocations.length !== 1) throw new Error("controller must contain exactly one release upload invocation");
  const tokens = invocations[0].match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  if (tokens.filter((token) => token === "--execute").length !== 1 || tokens.includes("--dry-run")) {
    throw new Error("controller release upload invocation must execute explicitly");
  }
}

function validateRollbackObserverSemantics(source) {
  const rollbackJob = parseWorkflowJobs(source).get("rollback");
  if (!rollbackJob) throw new Error("controller rollback job is missing");
  const rollback = rollbackJob.steps.map(({ run }) => run).join("\n");
  const observers = logicalShellCommands(rollback).filter((command) => (
    command.includes("node controller/scripts/release-control.mjs observe-cloudformation-stack")
  ));
  if (observers.length !== 2) throw new Error("rollback must use the common stack observer exactly twice");
  if (rollback.includes("Stacks?.[0]") || /describe-stacks[^\n]*>\s*"\$rollback_root\/stack-/.test(rollback)) {
    throw new Error("rollback must not parse raw stack state");
  }
}

function parseWorkflowJobs(source) {
  const lines = source.split("\n");
  const jobs = new Map();
  let job;
  let step;
  let section;
  for (let index = lines.indexOf("jobs:") + 1; index > 0 && index < lines.length; index += 1) {
    const line = lines[index];
    const jobMatch = line.match(/^  ([a-z][a-z0-9-]*):$/);
    if (jobMatch) {
      job = { permissions: {}, steps: [] };
      jobs.set(jobMatch[1], job);
      step = undefined;
      section = undefined;
      continue;
    }
    if (!job) continue;
    if (line === "    permissions:") {
      section = "permissions";
      continue;
    }
    if (line === "    steps:") {
      section = "steps";
      continue;
    }
    if (section === "permissions") {
      const permission = line.match(/^      ([a-z-]+): (.+)$/);
      if (permission) job.permissions[permission[1]] = permission[2];
    }
    const stepMatch = line.match(/^      - name: (.+)$/);
    if (stepMatch) {
      section = "steps";
      step = { name: stepMatch[1], run: "" };
      job.steps.push(step);
      continue;
    }
    if (!step) continue;
    const uses = line.match(/^        uses: (.+)$/);
    if (uses) step.uses = uses[1];
    if (line === "        run: |") {
      const body = [];
      while (lines[index + 1]?.startsWith("          ")) body.push(lines[index += 1].slice(10));
      step.run = body.join("\n");
    }
  }
  return jobs;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("trusted release controller", () => {
  it("produces and consumes one artifact_tree_sha256 receipt contract", async () => {
    const root = await temporaryRoot("molroom-release-receipt-");
    const artifactRoot = join(root, "artifact");
    const receiptPath = join(root, "receipt.json");
    await mkdir(artifactRoot);
    await writeFile(join(artifactRoot, "index.html"), "release");
    const inspection = await inspectReleaseArtifactTree({ artifactRoot });
    const receipt = createArchiveReceipt({
      candidateSha: commitSha,
      inspection,
      npmVersion: "11.17.0",
      steps: verifiedArchiveSteps,
    });
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`);

    await expect(validateArchiveReceipt({ artifactRoot, receiptPath, candidateSha: commitSha })).resolves.toMatchObject({
      receipt: {
        schema_version: ARCHIVE_RECEIPT_SCHEMA_VERSION,
        artifact_tree_sha256: inspection.treeSha256,
        candidate_sha: commitSha,
      },
      inspection: { treeSha256: inspection.treeSha256 },
    });
    expect(receipt).not.toHaveProperty("archive_tree_sha256");

    await writeFile(receiptPath, `${JSON.stringify({ ...receipt, archive_tree_sha256: inspection.treeSha256 })}\n`);
    await expect(validateArchiveReceipt({ artifactRoot, receiptPath, candidateSha: commitSha })).rejects.toThrow(
      "receipt contains missing or unknown fields",
    );

    await writeFile(receiptPath, `${JSON.stringify({
      ...receipt,
      steps: [{ name: "vite-build", status: "passed" }],
    })}\n`);
    await expect(validateArchiveReceipt({ artifactRoot, receiptPath, candidateSha: commitSha })).rejects.toThrow(
      "fixed verification sequence",
    );
  });

  it("binds security evidence to the exact successful workflow-dispatch actor, workflow bytes, and server artifact", async () => {
    const evidence = gateEvidence();
    const run = {
      id: evidence.security_gate_run_id,
      actor: { login: evidence.dispatch_actor },
      repository: { full_name: "kim-song-jun/meeting-wrapper" },
      path: ".github/workflows/security-gate.yml",
      head_branch: "main",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      head_sha: commitSha,
    };
    const artifact = {
      id: 9001,
      name: `security-gate-${commitSha}`,
      expired: false,
      size_in_bytes: 321,
      archive_download_url: "https://api.github.invalid/artifacts/9001/zip",
      digest: `sha256:${"a".repeat(64)}`,
    };
    const approvedWorkflow = Buffer.from("name: trusted security gate\n");
    const targetWorkflow = Buffer.from(approvedWorkflow);

    expect(validateSecurityGateBinding({
      evidence,
      run,
      artifact,
      artifactSha256: "a".repeat(64),
      candidateSha: commitSha,
      approvedWorkflow,
      targetWorkflow,
    })).toEqual({ artifactId: 9001, artifactSha256: "a".repeat(64), runId: evidence.security_gate_run_id });
    expect(() => validateSecurityGateBinding({
      evidence,
      run: { ...run, head_sha: "b".repeat(40) },
      artifact,
      artifactSha256: "a".repeat(64),
      candidateSha: commitSha,
      approvedWorkflow,
      targetWorkflow,
    })).toThrow("head SHA");
    expect(() => validateSecurityGateBinding({
      evidence,
      run,
      artifact: { ...artifact, expired: true },
      artifactSha256: "a".repeat(64),
      candidateSha: commitSha,
      approvedWorkflow,
      targetWorkflow,
    })).toThrow("artifact");
    const { digest: _digest, ...artifactWithoutDigest } = artifact;
    expect(() => validateSecurityGateBinding({
      evidence,
      run,
      artifact: artifactWithoutDigest,
      artifactSha256: "a".repeat(64),
      candidateSha: commitSha,
      approvedWorkflow,
      targetWorkflow,
    })).toThrow("server digest");
    expect(() => validateSecurityGateBinding({
      evidence,
      run: { ...run, head_branch: "release-candidate" },
      artifact,
      artifactSha256: "a".repeat(64),
      candidateSha: commitSha,
      approvedWorkflow,
      targetWorkflow,
    })).toThrow("head branch");
    expect(() => validateSecurityGateBinding({
      evidence,
      run: { ...run, actor: { login: "different-operator" } },
      artifact,
      artifactSha256: "a".repeat(64),
      candidateSha: commitSha,
      approvedWorkflow,
      targetWorkflow,
    })).toThrow("dispatch actor");
    expect(() => validateSecurityGateBinding({
      evidence,
      run,
      artifact,
      artifactSha256: "a".repeat(64),
      candidateSha: commitSha,
      approvedWorkflow,
      targetWorkflow: Buffer.from("name: candidate changed gate\n"),
    })).toThrow("workflow definition");

    const root = await temporaryRoot("molroom-security-gate-binding-");
    const evidencePath = join(root, "evidence.json");
    const runPath = join(root, "run.json");
    const artifactPath = join(root, "artifact.json");
    const approvedWorkflowPath = join(root, "approved-security-gate.yml");
    const targetWorkflowPath = join(root, "target-security-gate.yml");
    await Promise.all([
      writeFile(evidencePath, `${JSON.stringify(evidence)}\n`),
      writeFile(runPath, `${JSON.stringify(run)}\n`),
      writeFile(artifactPath, `${JSON.stringify(artifact)}\n`),
      writeFile(approvedWorkflowPath, approvedWorkflow),
      writeFile(targetWorkflowPath, targetWorkflow),
    ]);
    await expect(runReleaseControlCli([
      "verify-security-gate",
      "--approved-workflow-path", approvedWorkflowPath,
      "--artifact-path", artifactPath,
      "--artifact-sha256", "a".repeat(64),
      "--candidate-sha", commitSha,
      "--evidence-path", evidencePath,
      "--run-path", runPath,
      "--target-workflow-path", targetWorkflowPath,
    ])).resolves.toMatchObject({ artifact_id: 9001, status: "verified" });
    await writeFile(targetWorkflowPath, "name: changed after checkout\n");
    await expect(runReleaseControlCli([
      "verify-security-gate",
      "--approved-workflow-path", approvedWorkflowPath,
      "--artifact-path", artifactPath,
      "--artifact-sha256", "a".repeat(64),
      "--candidate-sha", commitSha,
      "--evidence-path", evidencePath,
      "--run-path", runPath,
      "--target-workflow-path", targetWorkflowPath,
    ])).rejects.toThrow("workflow definition");
  });

  it("rejects an unexpected object in the complete remote release prefix", async () => {
    const root = await temporaryRoot("molroom-remote-prefix-");
    const artifactRoot = join(root, "artifact");
    await mkdir(artifactRoot);
    await writeFile(join(artifactRoot, "index.html"), "release");
    const release = await buildReleaseArtifacts({
      artifactRoot,
      commitSha,
      packageVersion: "0.1.0",
      sourceDateEpoch: 1_700_000_000,
    });
    await writeReleaseMetadata({ artifactRoot, release });
    await writeFile(join(artifactRoot, "_security-gate.json"), `${JSON.stringify(gateEvidence())}\n`);
    const plan = await planReleasePrefixUpload({ artifactRoot, bucket: "molroom-release-test", commitSha });
    const listedObjects = [
      ...plan.objects.map(({ key, size }) => ({ Key: key, Size: size })),
      { Key: `releases/${commitSha}/unexpected.txt`, Size: 1 },
    ];
    const runAws = async (args) => {
      if (args[1] === "list-objects-v2") {
        return { Contents: listedObjects, IsTruncated: false, KeyCount: listedObjects.length };
      }
      const key = args[args.indexOf("--key") + 1];
      const object = plan.objects.find((candidate) => candidate.key === key);
      return {
        ContentLength: object.size,
        ChecksumSHA256: object.checksumSha256,
        Metadata: { sha256: object.sha256, "manifest-sha256": plan.manifestSha256 },
      };
    };

    await expect(verifyRemoteReleasePrefix({
      artifactRoot,
      bucket: "molroom-release-test",
      candidateSha: commitSha,
      runAws,
    })).rejects.toThrow("unexpected remote object");
  });

  it("rejects every mismatched or unsafe S3 HEAD field during final-prefix verification", async () => {
    const root = await temporaryRoot("molroom-remote-head-");
    const artifactRoot = join(root, "artifact");
    await mkdir(artifactRoot);
    await writeFile(join(artifactRoot, "index.html"), "release");
    const release = await buildReleaseArtifacts({
      artifactRoot,
      commitSha,
      packageVersion: "0.1.0",
      sourceDateEpoch: 1_700_000_000,
    });
    await writeReleaseMetadata({ artifactRoot, release });
    await writeFile(join(artifactRoot, "_security-gate.json"), `${JSON.stringify(gateEvidence())}\n`);
    const plan = await planReleasePrefixUpload({ artifactRoot, bucket: "molroom-release-test", commitSha });
    const listedObjects = plan.objects.map(({ key, size }) => ({ Key: key, Size: size }));
    const mutations = [
      ["content length", (head) => { head.ContentLength += 1; }],
      ["checksum", (head) => { head.ChecksumSHA256 = "A".repeat(44); }],
      ["content type", (head) => { head.ContentType = "application/octet-stream"; }],
      ["cache control", (head) => { head.CacheControl = "no-store"; }],
      ["server-side encryption", (head) => { head.ServerSideEncryption = "aws:kms"; }],
      ["object digest metadata", (head) => { head.Metadata.sha256 = "0".repeat(64); }],
      ["manifest digest metadata", (head) => { head.Metadata["manifest-sha256"] = "0".repeat(64); }],
      ["unexpected metadata", (head) => { head.Metadata.candidate = "controlled"; }],
      ["content encoding", (head) => { head.ContentEncoding = "gzip"; }],
      ["website redirect", (head) => { head.WebsiteRedirectLocation = "/candidate"; }],
      ["content disposition", (head) => { head.ContentDisposition = "attachment"; }],
      ["content language", (head) => { head.ContentLanguage = "en"; }],
      ["expiry", (head) => { head.Expires = "2038-01-19T03:14:07Z"; }],
    ];

    for (const [label, mutation] of mutations) {
      await expect(verifyRemoteReleasePrefix({
        artifactRoot,
        bucket: "molroom-release-test",
        candidateSha: commitSha,
        packageVersion: "0.1.0",
        runAws: async (args) => {
          if (args[1] === "list-objects-v2") {
            return { Contents: listedObjects, IsTruncated: false, KeyCount: listedObjects.length };
          }
          const key = args[args.indexOf("--key") + 1];
          const object = plan.objects.find((candidate) => candidate.key === key);
          const head = exactStoredHead(object, plan.manifestSha256);
          if (object === plan.objects[0]) mutation(head);
          return head;
        },
      }), label).rejects.toThrow(/remote immutable prefix object/);
    }
  });

  it("rejects a mismatched requested package version before invoking AWS", async () => {
    const root = await temporaryRoot("molroom-remote-version-");
    const artifactRoot = join(root, "artifact");
    await mkdir(artifactRoot);
    await writeFile(join(artifactRoot, "index.html"), "release");
    const release = await buildReleaseArtifacts({
      artifactRoot,
      commitSha,
      packageVersion: "0.1.0",
      sourceDateEpoch: 1_700_000_000,
    });
    await writeReleaseMetadata({ artifactRoot, release });
    await writeFile(join(artifactRoot, "_security-gate.json"), `${JSON.stringify(gateEvidence())}\n`);
    let awsCalls = 0;

    await expect(verifyRemoteReleasePrefix({
      artifactRoot,
      bucket: "molroom-release-test",
      candidateSha: commitSha,
      packageVersion: "9.9.9",
      runAws: async () => {
        awsCalls += 1;
        throw new Error("AWS must not be reached");
      },
    })).rejects.toThrow("package version");
    expect(awsCalls).toBe(0);
  });

  it("verifies only the canonical prepared-root artifact path", async () => {
    const root = await temporaryRoot("molroom-prepared-path-");
    const preparedRoot = join(root, "prepared-release");
    const artifactRoot = join(preparedRoot, "artifact");
    await mkdir(preparedRoot);
    await mkdir(artifactRoot);
    await writeFile(join(artifactRoot, "index.html"), "release");
    const release = await buildReleaseArtifacts({
      artifactRoot,
      commitSha,
      packageVersion: "0.1.0",
      sourceDateEpoch: 1_700_000_000,
    });
    await writeReleaseMetadata({ artifactRoot, release });
    await writeFile(join(artifactRoot, "_security-gate.json"), `${JSON.stringify(gateEvidence())}\n`);

    await expect(runReleaseControlCli([
      "verify-prepared-package",
      "--prepared-root", preparedRoot,
      "--bucket", "molroom-release-test",
      "--candidate-sha", commitSha,
      "--package-version", "0.1.0",
    ])).resolves.toMatchObject({ status: "verified", object_count: 4 });
    await expect(runReleaseControlCli([
      "verify-prepared-package",
      "--prepared-root", preparedRoot,
      "--bucket", "molroom-release-test",
      "--candidate-sha", commitSha,
      "--package-version", "9.9.9",
    ])).rejects.toThrow("package version");

    const misplacedRoot = join(root, "misplaced");
    await mkdir(join(misplacedRoot, "candidate-archive", "artifact"), { recursive: true });
    await expect(runReleaseControlCli([
      "verify-prepared-package",
      "--prepared-root", misplacedRoot,
      "--bucket", "molroom-release-test",
      "--candidate-sha", commitSha,
      "--package-version", "0.1.0",
    ])).rejects.toThrow("prepared release package layout");
  });

  it("plans CREATE or UPDATE, smoke, invalidation, and automatic restoration from prior state", () => {
    expect(planDeploymentLifecycle({
      mode: "release",
      targetSha: commitSha,
      current: { exists: false, activeReleaseSha: "UNRELEASED", distributionEnabled: false },
    })).toEqual({
      changeSetType: "CREATE",
      invalidate: true,
      restore: { exists: false, activeReleaseSha: "UNRELEASED", distributionEnabled: false },
      smoke: true,
      target: { activeReleaseSha: commitSha, distributionEnabled: true },
    });
    expect(planDeploymentLifecycle({
      mode: "rollback",
      targetSha: "f".repeat(40),
      current: { exists: true, activeReleaseSha: commitSha, distributionEnabled: true },
    })).toMatchObject({
      changeSetType: "UPDATE",
      invalidate: true,
      restore: { exists: true, activeReleaseSha: commitSha, distributionEnabled: true },
      smoke: true,
      target: { activeReleaseSha: "f".repeat(40), distributionEnabled: true },
    });
    expect(planDeploymentLifecycle({
      mode: "repair",
      targetSha: commitSha,
      current: { exists: true, activeReleaseSha: commitSha, distributionEnabled: true },
    })).toEqual({
      changeSetType: "NONE",
      invalidate: false,
      repairOnly: true,
      restore: { exists: true, activeReleaseSha: commitSha, distributionEnabled: true },
      smoke: false,
      target: { activeReleaseSha: commitSha, distributionEnabled: true },
    });
    expect(() => planDeploymentLifecycle({
      mode: "repair",
      targetSha: "f".repeat(40),
      current: { exists: true, activeReleaseSha: commitSha, distributionEnabled: true },
    })).toThrow("repair target is not the active release");
    expect(planDeploymentLifecycle({
      mode: "release",
      targetSha: commitSha,
      current: { exists: true, activeReleaseSha: commitSha, distributionEnabled: true },
    })).toMatchObject({ changeSetType: "NONE", invalidate: false, smoke: true });
  });

  it("rejects unknown CLI options instead of silently widening a command contract", async () => {
    const root = await temporaryRoot("molroom-control-options-");
    const currentPath = join(root, "current.json");
    await writeFile(currentPath, `${JSON.stringify({ activeReleaseSha: "UNRELEASED", distributionEnabled: false, exists: false })}\n`);
    await expect(runReleaseControlCli([
      "plan-deployment",
      "--current-path", currentPath,
      "--mode", "release",
      "--target-sha", commitSha,
      "--ignored-option", "candidate-controlled",
    ])).rejects.toThrow("arguments are invalid");
  });

  it("rejects duplicate decoded keys at a control JSON boundary", async () => {
    const root = await temporaryRoot("molroom-control-json-duplicate-");
    const currentPath = join(root, "current.json");
    await writeFile(currentPath, `{"activeReleaseSha":"UNRELEASED","distributionEnabled":false,"exists":false,"ex\\u0069sts":false}\n`);
    await expect(runReleaseControlCli([
      "plan-deployment",
      "--current-path", currentPath,
      "--mode", "release",
      "--target-sha", commitSha,
    ])).rejects.toThrow("duplicate");
  });

  it("rejects malformed UTF-8 before publication JSON can be interpreted", async () => {
    const root = await temporaryRoot("molroom-control-json-utf8-");
    const expectedPath = join(root, "expected.json");
    const observedPath = join(root, "observed.json");
    const assets = [{ digest: `sha256:${"a".repeat(64)}`, name: "_release.json", size: 1 }];
    const expectedPrefix = Buffer.from(`{"assets":${JSON.stringify(assets)},"body":"`);
    const expectedSuffix = Buffer.from(`","sha":"${commitSha}","version":"0.1.0"}\n`);
    await writeFile(expectedPath, Buffer.concat([expectedPrefix, Buffer.from([0xc0, 0xaf]), expectedSuffix]));
    await writeFile(observedPath, `${JSON.stringify({
      main_sha: commitSha,
      release: {
        assets,
        body: "��",
        draft: false,
        name: "MolRoom v0.1.0",
        prerelease: false,
        tag_name: "v0.1.0",
        target_sha: commitSha,
      },
      tag_after: { annotated: true, target_sha: commitSha },
      tag_before: null,
    })}\n`);
    await expect(runReleaseControlCli([
      "verify-publication",
      "--expected-path", expectedPath,
      "--observed-path", observedPath,
    ])).rejects.toThrow("UTF-8");
  });

  it("collects target-SHA smoke from bounded manual-redirect HTTP responses and treats failed restoration as fatal", async () => {
    const root = await temporaryRoot("molroom-release-smoke-");
    const targetSmokePath = join(root, "target-smoke.json");
    const restoreStatePath = join(root, "restore-state.json");
    const appliedStatePath = join(root, "applied-state.json");
    const restoreSmokePath = join(root, "restore-smoke.json");
    const priorSha = "f".repeat(40);
    const smoke = (releaseSha) => ({
      auth_ok: true,
      http_status: 200,
      release_sha: releaseSha,
      rooms_ok: true,
      routes_ok: true,
      secrets_absent: true,
    });
    const calls = [];
    const bodies = new Map([
      ["/_release.json", JSON.stringify({ commit_sha: commitSha })],
      ["/", "<!doctype html><title>MolRoom</title>"],
      ["/login", "<!doctype html><title>MolRoom login</title>"],
      ["/rooms", "<!doctype html><title>MolRoom rooms</title>"],
    ]);
    await expect(runReleaseControlCli([
      "smoke-production",
      "--expected-sha", commitSha,
      "--output-path", targetSmokePath,
    ], {
      fetchImplementation: async (url, options) => {
        calls.push({ options, path: new URL(url).pathname });
        return new Response(bodies.get(new URL(url).pathname), { status: 200 });
      },
    })).resolves.toMatchObject({ release_sha: commitSha, status: "verified" });
    expect(calls.map(({ path }) => path)).toEqual(["/_release.json", "/", "/login", "/rooms"]);
    expect(calls.every(({ options }) => options.redirect === "manual")).toBe(true);
    expect(JSON.parse(await readFile(targetSmokePath, "utf8"))).toEqual(smoke(commitSha));

    await Promise.all([
      writeFile(restoreStatePath, `${JSON.stringify({ exists: true, activeReleaseSha: priorSha, distributionEnabled: true })}\n`),
      writeFile(appliedStatePath, `${JSON.stringify({ exists: true, activeReleaseSha: priorSha, distributionEnabled: true })}\n`),
      writeFile(restoreSmokePath, `${JSON.stringify(smoke(commitSha))}\n`),
    ]);
    await expect(runReleaseControlCli([
      "verify-restoration",
      "--restore-path", restoreStatePath,
      "--applied-path", appliedStatePath,
      "--smoke-path", restoreSmokePath,
    ])).rejects.toThrow("restoration verification failed");

    await writeFile(restoreSmokePath, `${JSON.stringify(smoke(priorSha))}\n`);
    await expect(runReleaseControlCli([
      "verify-restoration",
      "--restore-path", restoreStatePath,
      "--applied-path", appliedStatePath,
      "--smoke-path", restoreSmokePath,
    ])).resolves.toMatchObject({ restored_sha: priorSha, status: "verified" });

    await Promise.all([
      writeFile(restoreStatePath, `${JSON.stringify({ exists: true, activeReleaseSha: priorSha, distributionEnabled: false })}\n`),
      writeFile(appliedStatePath, `${JSON.stringify({ exists: true, activeReleaseSha: priorSha, distributionEnabled: false })}\n`),
    ]);
    await expect(runReleaseControlCli([
      "verify-restoration",
      "--restore-path", restoreStatePath,
      "--applied-path", appliedStatePath,
      "--smoke-path", "NONE",
    ])).resolves.toMatchObject({ restored_sha: priorSha, status: "verified" });
    await writeFile(restoreSmokePath, `${JSON.stringify(smoke(priorSha))}\n`);
    await expect(runReleaseControlCli([
      "verify-restoration",
      "--restore-path", restoreStatePath,
      "--applied-path", appliedStatePath,
      "--smoke-path", restoreSmokePath,
    ])).rejects.toThrow("restoration verification failed");

    await Promise.all([
      writeFile(restoreStatePath, `${JSON.stringify({ exists: false, activeReleaseSha: "UNRELEASED", distributionEnabled: false })}\n`),
      writeFile(appliedStatePath, `${JSON.stringify({ exists: false, activeReleaseSha: "UNRELEASED", distributionEnabled: false })}\n`),
    ]);
    await expect(runReleaseControlCli([
      "verify-restoration",
      "--restore-path", restoreStatePath,
      "--applied-path", appliedStatePath,
      "--smoke-path", "NONE",
    ])).resolves.toMatchObject({ restored_sha: "UNRELEASED", status: "verified" });
    await writeFile(appliedStatePath, `${JSON.stringify({ exists: true, activeReleaseSha: "UNRELEASED", distributionEnabled: false })}\n`);
    await expect(runReleaseControlCli([
      "verify-restoration",
      "--restore-path", restoreStatePath,
      "--applied-path", appliedStatePath,
      "--smoke-path", "NONE",
    ])).rejects.toThrow("restoration verification failed");
  });

  it("rejects 204, redirect, empty app, and wrong release-SHA smoke responses without evidence", async () => {
    const root = await temporaryRoot("molroom-release-smoke-negative-");
    const cases = [
      ["status-204", { path: "/", status: 204 }],
      ["redirect", { path: "/login", status: 302 }],
      ["empty", { body: "", path: "/rooms", status: 200 }],
      ["wrong-sha", { body: JSON.stringify({ commit_sha: "f".repeat(40) }), path: "/_release.json", status: 200 }],
    ];
    for (const [name, mutation] of cases) {
      const outputPath = join(root, `${name}.json`);
      await expect(runReleaseControlCli([
        "smoke-production",
        "--expected-sha", commitSha,
        "--output-path", outputPath,
      ], {
        fetchImplementation: async (url, options) => {
          expect(options.redirect).toBe("manual");
          const path = new URL(url).pathname;
          const defaultBody = path === "/_release.json"
            ? JSON.stringify({ commit_sha: commitSha })
            : "<!doctype html><title>MolRoom</title>";
          const status = path === mutation.path ? mutation.status : 200;
          const body = path === mutation.path && Object.hasOwn(mutation, "body") ? mutation.body : defaultBody;
          return new Response(status === 204 ? null : body, { status });
        },
      }), name).rejects.toThrow(/production smoke/);
      await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("postchecks origin main, annotated tag, and exact existing Release body and assets", async () => {
    const root = await temporaryRoot("molroom-publication-");
    const expectedPath = join(root, "expected.json");
    const observedPath = join(root, "observed.json");
    const expected = {
      assets: [
        { digest: `sha256:${"a".repeat(64)}`, name: "_manifest.sha256", size: 72 },
        { digest: `sha256:${"b".repeat(64)}`, name: "_release.json", size: 220 },
        { digest: `sha256:${"c".repeat(64)}`, name: "_security-gate.json", size: 512 },
      ],
      body: "MolRoom v0.1.0\nSHA: 0123456789abcdef0123456789abcdef01234567\n",
      sha: commitSha,
      version: "0.1.0",
    };
    const tag = { annotated: true, target_sha: commitSha };
    const observed = {
      main_sha: commitSha,
      release: {
        assets: expected.assets,
        body: expected.body,
        draft: false,
        name: "MolRoom v0.1.0",
        prerelease: false,
        tag_name: "v0.1.0",
        target_sha: commitSha,
      },
      tag_after: tag,
      tag_before: null,
    };
    await Promise.all([
      writeFile(expectedPath, `${JSON.stringify(expected)}\n`),
      writeFile(observedPath, `${JSON.stringify(observed)}\n`),
    ]);
    await expect(runReleaseControlCli([
      "verify-publication",
      "--expected-path", expectedPath,
      "--observed-path", observedPath,
    ])).resolves.toMatchObject({ release_sha: commitSha, status: "verified" });

    await writeFile(observedPath, `${JSON.stringify({
      ...observed,
      release: { ...observed.release, body: `${expected.body}unexpected\n` },
    })}\n`);
    await expect(runReleaseControlCli([
      "verify-publication",
      "--expected-path", expectedPath,
      "--observed-path", observedPath,
    ])).rejects.toThrow("publication postcheck failed");
  });

  it("copies output only after a zero container exit and invokes only the read-only trusted verifier", async () => {
    const root = await temporaryRoot("molroom-release-sandbox-");
    const candidateRoot = join(root, "candidate");
    const controllerRoot = join(root, "controller");
    const outputRoot = join(root, "output");
    const containerOutput = join(root, "container-output");
    const containerArtifact = join(containerOutput, "artifact");
    const stateRoot = join(root, "state");
    const marker = join(outputRoot, "late-mutation");
    const invocationPath = join(root, "invocation.json");
    const operationPath = join(root, "operations");
    await Promise.all([
      mkdir(candidateRoot),
      mkdir(controllerRoot),
      mkdir(outputRoot),
      mkdir(containerOutput),
      mkdir(stateRoot),
    ]);
    await mkdir(containerArtifact);
    await writeValidProductionArtifact(containerArtifact);
    await writeFile(join(containerOutput, "receipt.json"), '{"candidate_controlled":true}\n');
    const runtime = await executable(join(root, "deterministic-docker.mjs"), [
      "#!/usr/bin/env node",
      'import { spawn } from "node:child_process";',
      'import { appendFile, cp, readFile, writeFile } from "node:fs/promises";',
      "const operation = process.argv[2];",
      "const args = process.argv.slice(3);",
      `const stateRoot = ${JSON.stringify(stateRoot)};`,
      `const containerOutput = ${JSON.stringify(containerOutput)};`,
      `const marker = ${JSON.stringify(marker)};`,
      `const invocationPath = ${JSON.stringify(invocationPath)};`,
      `const operationPath = ${JSON.stringify(operationPath)};`,
      'await appendFile(operationPath, `${operation}\\n`);',
      'if (operation === "run") {',
      '  const name = args[args.indexOf("--name") + 1];',
      '  const escaped = spawn(process.execPath, ["-e", `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "mutated"), 300)`], { detached: true, stdio: "ignore" });',
      '  escaped.unref();',
      '  await writeFile(`${stateRoot}/${name}.pid`, String(escaped.pid));',
      '  await writeFile(invocationPath, JSON.stringify(args));',
      '  process.stdout.write(`${name}\\n`);',
      '} else if (operation === "wait") {',
      '  const name = args[args.length - 1];',
      '  const pid = Number(await readFile(`${stateRoot}/${name}.pid`, "utf8"));',
      '  try { process.kill(pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }',
      '  process.stdout.write("0\\n");',
      '} else if (operation === "cp") {',
      '  await cp(containerOutput, args[1], { recursive: true, force: false });',
      '} else if (operation !== "rm") {',
      '  process.exitCode = 2;',
      '}',
    ].join("\n"));

    await runCandidateSandbox({
      runtimeExecutable: runtime,
      containerName: "candidate-boundary",
      candidateRoot,
      candidateSha: commitSha,
      controllerRoot,
      outputRoot,
      publicEnvironment: {
        VITE_DEPLOYMENT: "production",
        VITE_ADAPTER: "google",
        VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        VITE_ALLOWED_HD: "molcube.com",
      },
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 450));

    await expect(readFile(marker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readFile(operationPath, "utf8")).trim().split("\n")).toEqual(["run", "wait", "cp", "rm"]);
    await expect(readFile(join(outputRoot, "artifact", "index.html"), "utf8")).resolves.toContain("MolRoom");
    const hostReceipt = JSON.parse(await readFile(join(outputRoot, "receipt.json"), "utf8"));
    expect(hostReceipt.steps).toEqual(verifiedArchiveSteps);
    expect(hostReceipt.candidate_sha).toBe(commitSha);
    expect(hostReceipt.artifact_tree_sha256).toBe((await inspectReleaseArtifactTree({ artifactRoot: join(outputRoot, "artifact") })).treeSha256);
    const invocation = JSON.parse(await readFile(invocationPath, "utf8"));
    expect(invocation).toContain(CANDIDATE_CONTAINER_IMAGE);
    for (const required of ["--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=256", "--memory=2048m", "--cpus=2"]) {
      expect(invocation).toContain(required);
    }
    expect(invocation).not.toContain("/var/run/docker.sock");
    expect(invocation.some((value) => value.includes(`src=${outputRoot}`))).toBe(false);
    expect(invocation).toContain(`type=bind,src=${controllerRoot},dst=/controller,readonly`);
    expect(invocation.join(" ")).toContain("/controller/scripts/verify-release-archive.mjs");
    expect(invocation.join(" ")).not.toContain("/candidate/scripts/verify-release-archive.mjs");
    expect(invocation.filter((value, index) => invocation[index - 1] === "--env")).toEqual([
      "VITE_ADAPTER=google",
      "VITE_ALLOWED_HD=molcube.com",
      "VITE_DEPLOYMENT=production",
      "VITE_GOOGLE_CLIENT_ID=client.apps.googleusercontent.com",
    ]);
  });

  it("rejects a delayed detached bundle mutation even when the candidate forges a matching receipt", async () => {
    const root = await temporaryRoot("molroom-release-sandbox-mutation-");
    const candidateRoot = join(root, "candidate");
    const controllerRoot = join(root, "controller");
    const outputRoot = join(root, "output");
    const containerOutput = join(root, "container-output");
    const containerArtifact = join(containerOutput, "artifact");
    const forgedArtifact = join(root, "forged-artifact");
    const stateRoot = join(root, "state");
    const operationPath = join(root, "operations");
    await Promise.all([
      mkdir(candidateRoot),
      mkdir(controllerRoot),
      mkdir(outputRoot),
      mkdir(containerArtifact, { recursive: true }),
      mkdir(forgedArtifact),
      mkdir(stateRoot),
    ]);
    await Promise.all([
      writeValidProductionArtifact(containerArtifact),
      writeValidProductionArtifact(forgedArtifact),
    ]);
    await writeFile(join(forgedArtifact, "assets/late.js"), "[MolRoom QA]");
    const forgedReceipt = createArchiveReceipt({
      candidateSha: commitSha,
      inspection: await inspectReleaseArtifactTree({ artifactRoot: forgedArtifact }),
      npmVersion: "11.17.0",
      steps: verifiedArchiveSteps,
    });
    await writeFile(join(containerOutput, "receipt.json"), '{"candidate_controlled":true}\n');
    const donePath = join(stateRoot, "mutation.done");
    const latePath = join(containerArtifact, "assets/late.js");
    const receiptPath = join(containerOutput, "receipt.json");
    const runtime = await executable(join(root, "detached-mutation-docker.mjs"), [
      "#!/usr/bin/env node",
      'import { spawn } from "node:child_process";',
      'import { appendFile, cp, readFile, writeFile } from "node:fs/promises";',
      'const operation = process.argv[2];',
      'const args = process.argv.slice(3);',
      `const containerOutput = ${JSON.stringify(containerOutput)};`,
      `const donePath = ${JSON.stringify(donePath)};`,
      `const latePath = ${JSON.stringify(latePath)};`,
      `const operationPath = ${JSON.stringify(operationPath)};`,
      `const receiptPath = ${JSON.stringify(receiptPath)};`,
      `const forgedReceipt = ${JSON.stringify(`${JSON.stringify(forgedReceipt)}\n`)};`,
      'await appendFile(operationPath, `${operation}\n`);',
      'if (operation === "run") {',
      '  const source = `setTimeout(() => { const fs = require("node:fs"); fs.writeFileSync(${JSON.stringify(latePath)}, "[MolRoom QA]"); fs.writeFileSync(${JSON.stringify(receiptPath)}, ${JSON.stringify(forgedReceipt)}); fs.writeFileSync(${JSON.stringify(donePath)}, "done"); }, 100);`;',
      '  const escaped = spawn(process.execPath, ["-e", source], { detached: true, stdio: "ignore" });',
      '  escaped.unref();',
      '} else if (operation === "wait") {',
      '  for (let attempt = 0; attempt < 80; attempt += 1) {',
      '    try { await readFile(donePath); process.stdout.write("0\\n"); process.exit(0); } catch {}',
      '    await new Promise((resolve) => setTimeout(resolve, 25));',
      '  }',
      '  process.exitCode = 3;',
      '} else if (operation === "cp") {',
      '  await cp(containerOutput, args[1], { recursive: true, force: false });',
      '} else if (operation !== "rm") {',
      '  process.exitCode = 2;',
      '}',
    ].join("\n"));

    await expect(runCandidateSandbox({
      runtimeExecutable: runtime,
      containerName: "candidate-delayed-mutation",
      candidateRoot,
      candidateSha: commitSha,
      controllerRoot,
      outputRoot,
      publicEnvironment: {
        VITE_DEPLOYMENT: "production",
        VITE_ADAPTER: "google",
        VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        VITE_ALLOWED_HD: "molcube.com",
      },
    })).rejects.toThrow("trusted bundle scan failed");
    expect((await readFile(operationPath, "utf8")).trim().split("\n")).toEqual(["run", "wait", "cp", "rm"]);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects a nonzero docker wait result before copying candidate output", async () => {
    const root = await temporaryRoot("molroom-release-sandbox-exit-");
    const candidateRoot = join(root, "candidate");
    const controllerRoot = join(root, "controller");
    const outputRoot = join(root, "output");
    const operationPath = join(root, "operations");
    await Promise.all([mkdir(candidateRoot), mkdir(controllerRoot), mkdir(outputRoot)]);
    const runtime = await executable(join(root, "failing-docker.mjs"), [
      "#!/usr/bin/env node",
      'import { appendFile } from "node:fs/promises";',
      "const operation = process.argv[2];",
      `await appendFile(${JSON.stringify(operationPath)}, \`${"${operation}"}\\n\`);`,
      'if (operation === "wait") process.stdout.write("23\\n");',
      'else if (operation !== "run" && operation !== "rm") process.exitCode = 2;',
    ].join("\n"));

    await expect(runCandidateSandbox({
      runtimeExecutable: runtime,
      containerName: "candidate-nonzero",
      candidateRoot,
      candidateSha: commitSha,
      controllerRoot,
      outputRoot,
      publicEnvironment: {
        VITE_DEPLOYMENT: "production",
        VITE_ADAPTER: "google",
        VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        VITE_ALLOWED_HD: "molcube.com",
      },
    })).rejects.toThrow("container exited unsuccessfully");
    expect((await readFile(operationPath, "utf8")).trim().split("\n")).toEqual(["run", "wait", "rm"]);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("observes only CREATE_COMPLETE and UPDATE_COMPLETE as stable CloudFormation state", async () => {
    const observeStatus = (stackStatus) => observeCloudFormationStack({
      runAws: async () => ({
        code: 0,
        signal: null,
        stderr: Buffer.alloc(0),
        stdout: Buffer.from(`${JSON.stringify({
          Stacks: [{
            StackName: "molroom-production",
            StackStatus: stackStatus,
            Parameters: [
              { ParameterKey: "ActiveReleaseSha", ParameterValue: commitSha },
              { ParameterKey: "DistributionEnabled", ParameterValue: "true" },
            ],
          }],
        })}\n`),
      }),
    });

    await expect(observeStatus("CREATE_COMPLETE")).resolves.toEqual({
      exists: true,
      activeReleaseSha: commitSha,
      distributionEnabled: true,
    });
    await expect(observeStatus("UPDATE_COMPLETE")).resolves.toEqual({
      exists: true,
      activeReleaseSha: commitSha,
      distributionEnabled: true,
    });
    for (const status of [
      "CREATE_IN_PROGRESS",
      "CREATE_FAILED",
      "ROLLBACK_IN_PROGRESS",
      "ROLLBACK_COMPLETE",
      "DELETE_IN_PROGRESS",
      "DELETE_COMPLETE",
      "UPDATE_IN_PROGRESS",
      "UPDATE_FAILED",
      "UPDATE_ROLLBACK_IN_PROGRESS",
      "UPDATE_ROLLBACK_COMPLETE",
      "IMPORT_COMPLETE",
      "CANDIDATE_DEFINED_STATUS",
    ]) {
      await expect(observeStatus(status), status).rejects.toThrow("stable");
    }
  });

  it("treats throttling auth network and nonexact ValidationError observations as fatal without delete or create", async () => {
    for (const scenario of ["transient", "auth", "network", "other-validation"]) {
      const root = await temporaryRoot(`molroom-cloudformation-${scenario}-`);
      const outputPath = join(root, "current.json");
      const { fakeBin, logPath } = await fakeCloudFormationAws(root, scenario);
      const result = await runExecutable(process.execPath, [
        join(repositoryRoot, "scripts/release-control.mjs"),
        "observe-cloudformation-stack",
        "--output-path", outputPath,
      ], { environment: { PATH: `${fakeBin}:${process.env.PATH}` } });

      expect(result).toMatchObject({ code: 1, signal: null });
      await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
      const operations = await readFile(logPath, "utf8");
      expect(operations).toContain("cloudformation describe-stacks");
      expect(operations).not.toMatch(/\b(?:delete-stack|create-change-set)\b/);
    }
  });

  it("classifies only the exact stack-not-found response as absence and permits a CREATE plan", async () => {
    const root = await temporaryRoot("molroom-cloudformation-absent-");
    const outputPath = join(root, "current.json");
    const { fakeBin, logPath } = await fakeCloudFormationAws(root, "absent");
    const result = await runExecutable(process.execPath, [
      join(repositoryRoot, "scripts/release-control.mjs"),
      "observe-cloudformation-stack",
      "--output-path", outputPath,
    ], { environment: { PATH: `${fakeBin}:${process.env.PATH}` } });

    expect(result).toMatchObject({ code: 0, signal: null });
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual({
      exists: false,
      activeReleaseSha: "UNRELEASED",
      distributionEnabled: false,
    });
    await expect(runReleaseControlCli([
      "plan-deployment",
      "--current-path", outputPath,
      "--mode", "release",
      "--target-sha", commitSha,
    ])).resolves.toMatchObject({ changeSetType: "CREATE" });
    expect(await readFile(logPath, "utf8")).not.toMatch(/\b(?:delete-stack|create-change-set)\b/);
  });

  it("exits 97 and retains no fabricated applied state when absence restoration cannot be confirmed", async () => {
    const root = await temporaryRoot("molroom-cloudformation-restore-");
    const outputPath = join(root, "applied.json");
    const { fakeBin, logPath } = await fakeCloudFormationAws(root, "restore-fails");
    const result = await runExecutable(process.execPath, [
      join(repositoryRoot, "scripts/release-control.mjs"),
      "restore-absent-cloudformation-stack",
      "--output-path", outputPath,
    ], { environment: { PATH: `${fakeBin}:${process.env.PATH}` } });

    expect(result).toMatchObject({ code: 97, signal: null });
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readFile(logPath, "utf8")).trim().split("\n").map((line) => line.split(" ").slice(0, 3).join(" "))).toEqual([
      "cloudformation describe-stacks --stack-name",
      "cloudformation delete-stack --stack-name",
      "cloudformation wait stack-delete-complete",
      "cloudformation describe-stacks --stack-name",
    ]);
  });

  it("extracts only bounded regular files and directories from a trusted ZIP boundary", async () => {
    const root = await temporaryRoot("molroom-safe-zip-");
    const zipPath = join(root, "candidate.zip");
    const outputRoot = join(root, "output");
    await mkdir(outputRoot);
    await writeFile(zipPath, zipFixture([
      { name: "artifact/", mode: 0o040755 },
      { name: "artifact/index.html", contents: "release", method: 8 },
      { name: "receipt.json", contents: "{}\n" },
    ]));

    await expect(runReleaseControlCli([
      "extract-candidate-zip",
      "--zip-path", zipPath,
      "--output-root", outputRoot,
    ])).resolves.toMatchObject({ entry_count: 3, status: "verified" });
    await expect(readFile(join(outputRoot, "artifact/index.html"), "utf8")).resolves.toBe("release");
  });

  it("extracts streaming ZIP entries with signed and unsigned data descriptors", async () => {
    const root = await temporaryRoot("molroom-streaming-zip-");
    const zipPath = join(root, "candidate.zip");
    const outputRoot = join(root, "output");
    await mkdir(outputRoot);
    await writeFile(zipPath, zipFixture([
      {
        name: "artifact/signed.txt",
        contents: "signed streaming release",
        method: 8,
        dataDescriptor: { signed: true },
      },
      {
        name: "artifact/unsigned.txt",
        contents: "unsigned streaming release",
        dataDescriptor: { signed: false },
      },
    ]));

    await expect(extractReleaseArtifactZip({ zipPath, outputRoot })).resolves.toEqual({
      entryCount: 2,
      totalBytes: 50,
    });
    await expect(readFile(join(outputRoot, "artifact/signed.txt"), "utf8")).resolves.toBe(
      "signed streaming release",
    );
    await expect(readFile(join(outputRoot, "artifact/unsigned.txt"), "utf8")).resolves.toBe(
      "unsigned streaming release",
    );
  });

  it.each([
    ["CRC mismatch", { dataDescriptor: { signed: true, crc32: 0 } }],
    ["compressed-size mismatch", { method: 8, dataDescriptor: { signed: false, compressedSize: 0 } }],
    ["uncompressed-size mismatch", { dataDescriptor: { signed: true, uncompressedSize: 0 } }],
    ["truncated descriptor", { dataDescriptor: { signed: true, truncateBytes: 1 } }],
    [
      "ambiguous unsigned descriptor",
      {
        centralCrc32: 0x08074b50,
        dataDescriptor: { signed: false, crc32: 0x08074b50 },
      },
    ],
    [
      "trailing descriptor bytes",
      { dataDescriptor: { signed: false, trailingBytes: Buffer.from([0]) } },
    ],
  ])("rejects a streaming ZIP with a %s", async (_case, entry) => {
    const root = await temporaryRoot("molroom-invalid-streaming-zip-");
    const zipPath = join(root, "candidate.zip");
    const outputRoot = join(root, "output");
    await mkdir(outputRoot);
    await writeFile(zipPath, zipFixture([{
      name: "artifact/release.txt",
      contents: "streaming release payload",
      ...entry,
    }]));

    await expect(extractReleaseArtifactZip({ zipPath, outputRoot })).rejects.toThrow(/data descriptor/);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("includes signed data-descriptor bytes in local-record overlap rejection", async () => {
    const root = await temporaryRoot("molroom-overlapping-streaming-zip-");
    const zipPath = join(root, "candidate.zip");
    const outputRoot = join(root, "output");
    await mkdir(outputRoot);
    await writeFile(zipPath, overlappingDataDescriptorZipFixture());

    await expect(extractReleaseArtifactZip({ zipPath, outputRoot })).rejects.toThrow(
      "candidate ZIP local entries overlap",
    );
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects traversal and malformed UTF-8 ZIP names without writing outside the extraction root", async () => {
    for (const [name, entry] of [
      ["traversal", { name: "../escaped.txt", contents: "owned" }],
      ["utf8", { nameBytes: Buffer.from([0xc0, 0xaf]), contents: "owned" }],
    ]) {
      const root = await temporaryRoot(`molroom-${name}-zip-`);
      const zipPath = join(root, "candidate.zip");
      const outputRoot = join(root, "output");
      await mkdir(outputRoot);
      await writeFile(zipPath, zipFixture([entry]));
      await expect(extractReleaseArtifactZip({ zipPath, outputRoot })).rejects.toThrow(/ZIP|UTF-8|path/);
      await expect(readFile(join(root, "escaped.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(outputRoot)).toEqual([]);
    }
  });

  it("rejects symlink and duplicate decoded ZIP entries before extraction", async () => {
    for (const [name, entries] of [
      ["symlink", [{ name: "artifact/link", contents: "../../outside", mode: 0o120777 }]],
      ["duplicate", [
        { name: "artifact/index.html", contents: "one" },
        { name: "artifact/index.html", contents: "two" },
      ]],
    ]) {
      const root = await temporaryRoot(`molroom-${name}-zip-`);
      const zipPath = join(root, "candidate.zip");
      const outputRoot = join(root, "output");
      await mkdir(outputRoot);
      await writeFile(zipPath, zipFixture(entries));
      await expect(extractReleaseArtifactZip({ zipPath, outputRoot })).rejects.toThrow(/regular|duplicate/);
      expect(await readdir(outputRoot)).toEqual([]);
    }
  });

  it("rejects ZIP bombs from declared and actual inflated sizes before retaining output", async () => {
    const oversized = Buffer.alloc((16 * 1024 * 1024) + 1);
    for (const [name, entry] of [
      ["declared", { name: "artifact/bomb.bin", contents: "x", declaredUncompressedSize: oversized.length }],
      ["actual", { name: "artifact/bomb.bin", contents: oversized, declaredUncompressedSize: 1, method: 8 }],
    ]) {
      const root = await temporaryRoot(`molroom-${name}-bomb-`);
      const zipPath = join(root, "candidate.zip");
      const outputRoot = join(root, "output");
      await mkdir(outputRoot);
      await writeFile(zipPath, zipFixture([entry]));
      await expect(extractReleaseArtifactZip({ zipPath, outputRoot })).rejects.toThrow(/byte limit|size/);
      expect(await readdir(outputRoot)).toEqual([]);
    }
  });

  it("separates the credential-free candidate producer from the immutable tagged release controller", async () => {
    const [securityGateWorkflow, releaseControllerWorkflow, bootstrap] = await Promise.all([
      readFile(join(repositoryRoot, ".github/workflows/security-gate.yml"), "utf8"),
      readFile(join(repositoryRoot, ".github/workflows/release-controller.yml"), "utf8"),
      readFile(join(repositoryRoot, "infra/aws/molroom-bootstrap.yml"), "utf8"),
    ]);

    expect(securityGateWorkflow).toContain("workflow_dispatch:");
    expect(securityGateWorkflow).toContain("environment: production");
    expect(securityGateWorkflow).not.toMatch(/AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)\s*:/);
    const jobs = parseWorkflowJobs(releaseControllerWorkflow);
    expect(() => validateUploadInvocationSemantics(releaseControllerWorkflow)).not.toThrow();
    const uploadFlagRemoved = releaseControllerWorkflow.replace(
      /(node controller\/scripts\/upload-release-prefix\.mjs[\s\S]{0,500}?)\s+--execute\b/,
      "$1",
    );
    expect(uploadFlagRemoved).not.toBe(releaseControllerWorkflow);
    expect(() => validateUploadInvocationSemantics(uploadFlagRemoved)).toThrow("execute explicitly");
    expect(() => validateRollbackObserverSemantics(releaseControllerWorkflow)).not.toThrow();
    const rollbackObserverRemoved = releaseControllerWorkflow.replace(
      /node controller\/scripts\/release-control\.mjs observe-cloudformation-stack \\\n\s+--output-path "\$rollback_root\/current\.json"/,
      "true",
    );
    expect(rollbackObserverRemoved).not.toBe(releaseControllerWorkflow);
    expect(() => validateRollbackObserverSemantics(rollbackObserverRemoved)).toThrow("exactly twice");
    for (const job of jobs.values()) {
      for (const step of job.steps.filter(({ uses }) => uses !== undefined)) {
        expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}(?:\s+#.*)?$/);
      }
    }

    expect([...jobs.keys()]).toEqual([
      "classify",
      "prepare-release",
      "deploy",
      "publish",
      "rollback",
    ]);
    const classify = jobs.get("classify").steps.map(({ run }) => run).join("\n");
    const prepare = jobs.get("prepare-release").steps.map(({ run }) => run).join("\n");
    expect(classify).toContain("/^[0-9a-f]{40}$/");
    expect(classify).toContain("/^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)$/");
    expect(releaseControllerWorkflow).toContain("refs/tags/molroom-release-controller-v1");
    expect(releaseControllerWorkflow).toContain("node controller/scripts/release-control.mjs verify-prepared-package");
    const extractionSteps = [...jobs.values()].flatMap(({ steps }) => steps).filter(({ run }) => (
      run.includes("release-control.mjs extract-candidate-zip")
    ));
    const extractionInvocations = extractionSteps.flatMap(({ run }) => (
      [...run.replace(/\\\n\s*/g, " ").matchAll(
        /node controller\/scripts\/release-control\.mjs extract-candidate-zip\s+--zip-path (\S+)\s+--output-root (\S+)/g,
      )].map((match) => ({ zipPath: match[1], outputRoot: match[2] }))
    ));
    expect(extractionInvocations).toEqual([
      {
        zipPath: '"$candidate_root/candidate.zip"',
        outputRoot: '"$RUNNER_TEMP/candidate-archive"',
      },
      {
        zipPath: '"$gate_root/evidence.zip"',
        outputRoot: '"$gate_root/evidence"',
      },
    ]);
    for (const { run } of extractionSteps) {
      const [, zipPath] = [...run.replace(/\\\n\s*/g, " ").matchAll(
        /extract-candidate-zip\s+--zip-path (\S+)\s+--output-root (\S+)/g,
      )][0];
      const unquotedZipPath = zipPath.slice(1, -1);
      const metadataPath = zipPath.includes("candidate_root")
        ? "/candidate-metadata/artifact.json"
        : "/security-gate/artifact.json";
      expect(run).toContain(`actions/artifacts/$artifact_id/zip" > "${unquotedZipPath}"`);
      expect(run).toContain(
        `expected_digest="$(node -e 'console.log(require(process.env.RUNNER_TEMP + "${metadataPath}").digest)')"`,
      );
      expect(run).toContain(`actual_digest="sha256:$(sha256sum "${unquotedZipPath}"`);
      expect(run.indexOf(`actions/artifacts/$artifact_id/zip" > "${unquotedZipPath}"`)).toBeLessThan(
        run.indexOf(`actual_digest="sha256:$(sha256sum "${unquotedZipPath}"`),
      );
      expect(run.indexOf('test "$actual_digest" = "$expected_digest"')).toBeLessThan(
        run.indexOf("release-control.mjs extract-candidate-zip"),
      );
    }
    expect(new Set(extractionInvocations.map(({ outputRoot }) => outputRoot)).size).toBe(2);
    expect(prepare).not.toMatch(/\bunzip\b/);
    expect(prepare).not.toContain("actions/download-artifact@");
    const deployJob = jobs.get("deploy");
    const publishJob = jobs.get("publish");
    const rollbackJob = jobs.get("rollback");
    const deploy = deployJob.steps.map(({ run }) => run).join("\n");
    const publish = publishJob.steps.map(({ run }) => run).join("\n");
    const rollback = rollbackJob.steps.map(({ run }) => run).join("\n");
    expect(deployJob.permissions["id-token"]).toBe("write");
    expect(deployJob.permissions.contents).toBe("read");
    expect(publishJob.permissions.contents).toBe("write");
    expect(publishJob.permissions["id-token"]).toBeUndefined();
    expect(publish).toContain("publication-release.json");
    expect(publish).toContain("publication-main-after.json");
    expect(publish).toContain("publication-tag-after.json");
    expect(publish).toContain("const actualRelease = JSON.parse");
    expect(rollbackJob.permissions["id-token"]).toBe("write");
    expect(rollback).toContain("aws cloudformation execute-change-set");
    expect(rollback).toContain('if [ "$change_type" = CREATE ]');
    expect(rollback).toContain("aws cloudformation wait stack-create-complete");
    expect(rollback).toContain('elif [ "$change_type" = UPDATE ]');
    expect(rollback).toContain("aws cloudformation wait stack-update-complete");
    expect(rollback).toContain("aws cloudfront create-invalidation");
    const smokeInvocations = [...jobs.values()].flatMap(({ steps }) => (
      steps.flatMap(({ run }) => logicalShellCommands(run))
    )).filter((command) => command.includes("node controller/scripts/release-control.mjs smoke-production"));
    expect(smokeInvocations).toHaveLength(4);
    expect(releaseControllerWorkflow).not.toContain("smoke_sha()");
    expect(releaseControllerWorkflow).not.toMatch(/\bcurl\b/);
    expect(releaseControllerWorkflow).not.toContain("auth_ok: true");
    expect(releaseControllerWorkflow).not.toContain("release-control.mjs verify-smoke");
    expect(rollback).toContain("verify-restoration --restore-path");
    expect(rollback).toContain("verify-remote-prefix --artifact-root \"$rollback_root/prior-prefix/artifact\"");
    expect(deploy).toContain("release-control.mjs observe-cloudformation-stack");
    expect(deploy).toContain("release-control.mjs restore-absent-cloudformation-stack");
    expect(deploy).not.toContain("if aws cloudformation describe-stacks");
    expect(deploy).not.toContain("'{\"exists\":false");
    expect(deploy.indexOf("release-control.mjs observe-cloudformation-stack")).toBeLessThan(deploy.indexOf("release-control.mjs plan-deployment"));
    expect(deploy.indexOf("release-control.mjs plan-deployment")).toBeLessThan(deploy.indexOf("upload-release-prefix.mjs"));
    expect(deploy).toContain('if [ "$prior_exists" = false ]');
    expect(rollback).toContain('if [ "$prior_exists" = false ]');
    expect(deploy).not.toContain("restore_release ||");
    expect(rollback).not.toContain("restore_rollback ||");
    expect(deploy).toContain('--package-version "$VERSION"');
    expect(releaseControllerWorkflow).not.toContain("ref: ${{ inputs.target_sha }}");
    expect(releaseControllerWorkflow).not.toContain("node candidate/");
    expect(releaseControllerWorkflow).not.toContain("github.workflow_sha");
    expect(prepare).toContain('repos/$GITHUB_REPOSITORY/contents/.github/workflows/security-gate.yml?ref=$TARGET_SHA');
    expect(prepare).toContain('--approved-workflow-path "controller/.github/workflows/security-gate.yml"');
    expect(prepare).toContain('--target-workflow-path "$gate_root/target-security-gate.yml"');

    expect(bootstrap).toContain("token.actions.githubusercontent.com:workflow_ref");
    expect(bootstrap).toContain(".github/workflows/release-controller.yml@refs/tags/${ControllerTag}");
    expect(bootstrap).toContain("cloudformation:DeleteStack");
    expect(bootstrap).not.toContain("github.workflow_sha");
  });
});
