import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  inspectReleaseArtifactTree,
  parseStrictJsonBytes,
  planReleasePrefixUpload,
  validateSecurityGateEvidence,
  validateStoredReleaseObjectHead,
} from "./release-manifest.mjs";
import { scanProductionBundle } from "./production-bundle-policy.mjs";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_AWS_OUTPUT_BYTES = 1024 * 1024;
const MAX_SMOKE_BODY_BYTES = 1024 * 1024;
const MAX_ZIP_BYTES = 136 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 8192;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 132 * 1024 * 1024;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const STACK_NAME = "molroom-production";
const STACK_NOT_FOUND = "An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id molroom-production does not exist";
const STABLE_STACK_STATUSES = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE"]);
const PRODUCTION_ORIGIN = "https://molroom.molcube.com";
const RECEIPT_KEYS = Object.freeze([
  "artifact_file_count",
  "artifact_total_bytes",
  "artifact_tree_sha256",
  "candidate_sha",
  "npm_version",
  "schema_version",
  "status",
  "steps",
]);
const PUBLIC_VITE_KEYS = Object.freeze([
  "VITE_ADAPTER",
  "VITE_ALLOWED_HD",
  "VITE_DEPLOYMENT",
  "VITE_GOOGLE_CLIENT_ID",
]);
const VERIFIED_ARCHIVE_STEP_NAMES = Object.freeze([
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
]);

export const ARCHIVE_RECEIPT_SCHEMA_VERSION = 1;
export const CANDIDATE_CONTAINER_IMAGE = "node:24.19.0-bookworm@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584";
export const PUBLIC_VITE_ENVIRONMENT_KEYS = PUBLIC_VITE_KEYS;

export class ReleaseControlError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseControlError";
  }
}

function fail(message) {
  throw new ReleaseControlError(message);
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} contains missing or unknown fields`);
  }
}

function assertCommitSha(value, label = "candidate SHA") {
  if (typeof value !== "string" || !COMMIT_SHA_PATTERN.test(value)) fail(`${label} must be a 40-character lowercase SHA`);
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(`${label} must be a SHA-256 digest`);
}

function assertNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
}

function assertStepList(value) {
  if (!Array.isArray(value) || value.length !== VERIFIED_ARCHIVE_STEP_NAMES.length) {
    fail("receipt does not contain the fixed verification sequence");
  }
  for (const [index, step] of value.entries()) {
    assertExactKeys(step, ["name", "status"], "receipt step");
    if (step.name !== VERIFIED_ARCHIVE_STEP_NAMES[index] || step.status !== "passed") {
      fail("receipt does not contain the fixed verification sequence");
    }
  }
}

function validateReceiptShape(receipt, candidateSha) {
  assertExactKeys(receipt, RECEIPT_KEYS, "receipt");
  if (receipt.schema_version !== ARCHIVE_RECEIPT_SCHEMA_VERSION || receipt.status !== "verified") {
    fail("receipt schema or status is invalid");
  }
  assertCommitSha(receipt.candidate_sha, "receipt candidate SHA");
  if (receipt.candidate_sha !== candidateSha) fail("receipt candidate SHA does not match");
  assertSha256(receipt.artifact_tree_sha256, "receipt artifact tree SHA-256");
  assertNonNegativeSafeInteger(receipt.artifact_file_count, "receipt artifact file count");
  assertNonNegativeSafeInteger(receipt.artifact_total_bytes, "receipt artifact total bytes");
  if (typeof receipt.npm_version !== "string" || receipt.npm_version !== "11.17.0") {
    fail("receipt npm version is invalid");
  }
  assertStepList(receipt.steps);
  return receipt;
}

async function readBoundedFileNoFollow(path, label, maxBytes = MAX_JSON_BYTES) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > maxBytes) fail(`${label} must be a bounded regular file`);
    const contents = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || contents.length !== before.size) fail(`${label} changed while reading`);
    return contents;
  } catch (error) {
    if (error instanceof ReleaseControlError) throw error;
    fail(`${label} must be a bounded regular file`);
  } finally {
    await handle?.close();
  }
}

async function readBoundedJsonNoFollow(path, label) {
  const contents = await readBoundedFileNoFollow(path, label);
  try {
    return parseStrictJsonBytes(contents, label);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} `)) fail(error.message);
    throw error;
  }
}

function normalizedReceiptSteps(steps) {
  if (!Array.isArray(steps)) fail("receipt does not contain the fixed verification sequence");
  let previousIndex = -1;
  return VERIFIED_ARCHIVE_STEP_NAMES.map((name) => {
    const index = steps.findIndex((step, candidateIndex) => (
      candidateIndex > previousIndex && step?.name === name && step?.status === "passed"
    ));
    if (index === -1) fail("receipt does not contain the fixed verification sequence");
    previousIndex = index;
    return { name, status: "passed" };
  });
}

export function createArchiveReceipt({ candidateSha, inspection, npmVersion, steps }) {
  assertCommitSha(candidateSha);
  assertPlainObject(inspection, "archive inspection");
  assertSha256(inspection.treeSha256, "archive inspection tree SHA-256");
  if (!Array.isArray(inspection.files)) fail("archive inspection files are invalid");
  assertNonNegativeSafeInteger(inspection.totalBytes, "archive inspection total bytes");
  if (inspection.files.length === 0) fail("archive inspection has no files");
  const receipt = {
    artifact_file_count: inspection.files.length,
    artifact_total_bytes: inspection.totalBytes,
    artifact_tree_sha256: inspection.treeSha256,
    candidate_sha: candidateSha,
    npm_version: npmVersion,
    schema_version: ARCHIVE_RECEIPT_SCHEMA_VERSION,
    status: "verified",
    steps: normalizedReceiptSteps(steps),
  };
  validateReceiptShape(receipt, candidateSha);
  return receipt;
}

export async function validateArchiveReceipt({ artifactRoot, receiptPath, candidateSha }) {
  assertCommitSha(candidateSha);
  const receipt = validateReceiptShape(await readBoundedJsonNoFollow(receiptPath, "receipt"), candidateSha);
  const inspection = await inspectReleaseArtifactTree({ artifactRoot });
  if (
    receipt.artifact_tree_sha256 !== inspection.treeSha256 ||
    receipt.artifact_file_count !== inspection.files.length ||
    receipt.artifact_total_bytes !== inspection.totalBytes
  ) {
    fail("receipt does not match the retained artifact tree");
  }
  return { inspection, receipt };
}

function assertPublicEnvironment(publicEnvironment) {
  assertExactKeys(publicEnvironment, PUBLIC_VITE_KEYS, "candidate public environment");
  for (const key of PUBLIC_VITE_KEYS) {
    const value = publicEnvironment[key];
    if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) {
      fail("candidate public environment value is invalid");
    }
  }
}

async function assertRealDirectory(path, label) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(`${label} must be an absolute directory`);
  let descriptor;
  try {
    descriptor = await lstat(path);
  } catch {
    fail(`${label} must be an existing real directory`);
  }
  if (descriptor.isSymbolicLink() || !descriptor.isDirectory()) fail(`${label} must be an existing real directory`);
  return resolve(path);
}

function zipCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertZipExtraFields(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) fail("candidate ZIP contains malformed extra fields");
    const identifier = bytes.readUInt16LE(offset);
    const size = bytes.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + size > bytes.length) fail("candidate ZIP contains malformed extra fields");
    if (identifier === 0x0001) fail("candidate ZIP64 entries are not supported");
    offset += size;
  }
}

function decodeZipPath(nameBytes) {
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
  } catch {
    fail("candidate ZIP path must be valid UTF-8");
  }
  const normalized = decoded.normalize("NFC");
  if (normalized !== decoded) fail("candidate ZIP path must use canonical UTF-8 normalization");
  const directory = normalized.endsWith("/");
  const path = directory ? normalized.slice(0, -1) : normalized;
  if (
    path.length === 0 ||
    path.length > 1024 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\0\r\n]/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail("candidate ZIP contains an unsafe path");
  }
  return { directory, path };
}

function parseZipDataDescriptor(
  zipBytes,
  { compressedSize, crc32, dataEnd, uncompressedSize, upperBound },
) {
  if (crc32 === ZIP_DATA_DESCRIPTOR_SIGNATURE) {
    fail("candidate ZIP data descriptor is ambiguous");
  }
  if (dataEnd + 12 > upperBound) fail("candidate ZIP data descriptor is truncated");
  const signed = zipBytes.readUInt32LE(dataEnd) === ZIP_DATA_DESCRIPTOR_SIGNATURE;
  const valuesOffset = dataEnd + (signed ? 4 : 0);
  const descriptorEnd = valuesOffset + 12;
  if (descriptorEnd > upperBound) fail("candidate ZIP data descriptor is truncated");
  if (
    zipBytes.readUInt32LE(valuesOffset) !== crc32 ||
    zipBytes.readUInt32LE(valuesOffset + 4) !== compressedSize ||
    zipBytes.readUInt32LE(valuesOffset + 8) !== uncompressedSize
  ) {
    fail("candidate ZIP data descriptor does not match the central directory");
  }
  return descriptorEnd;
}

function parseZipEntries(zipBytes) {
  const minimumEocdOffset = Math.max(0, zipBytes.length - 65_557);
  let eocdOffset = -1;
  for (let offset = zipBytes.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (
      zipBytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + zipBytes.readUInt16LE(offset + 20) === zipBytes.length
    ) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) fail("candidate ZIP end-of-directory record is invalid");
  const disk = zipBytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = zipBytes.readUInt16LE(eocdOffset + 6);
  const diskEntries = zipBytes.readUInt16LE(eocdOffset + 8);
  const entryCount = zipBytes.readUInt16LE(eocdOffset + 10);
  const centralSize = zipBytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = zipBytes.readUInt32LE(eocdOffset + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0 ||
    entryCount === 0xffff ||
    entryCount > MAX_ZIP_ENTRIES ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralOffset + centralSize !== eocdOffset
  ) {
    fail("candidate ZIP central directory is invalid or exceeds entry limits");
  }

  const decoderPaths = new Set();
  const intervals = [];
  const entries = [];
  let declaredTotal = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocdOffset || zipBytes.readUInt32LE(cursor) !== 0x02014b50) {
      fail("candidate ZIP central directory entry is invalid");
    }
    const versionMadeBy = zipBytes.readUInt16LE(cursor + 4);
    const flags = zipBytes.readUInt16LE(cursor + 8);
    const method = zipBytes.readUInt16LE(cursor + 10);
    const crc32 = zipBytes.readUInt32LE(cursor + 16);
    const compressedSize = zipBytes.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBytes.readUInt32LE(cursor + 24);
    const nameLength = zipBytes.readUInt16LE(cursor + 28);
    const extraLength = zipBytes.readUInt16LE(cursor + 30);
    const commentLength = zipBytes.readUInt16LE(cursor + 32);
    const diskStart = zipBytes.readUInt16LE(cursor + 34);
    const externalAttributes = zipBytes.readUInt32LE(cursor + 38);
    const localOffset = zipBytes.readUInt32LE(cursor + 42);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      recordEnd > eocdOffset ||
      nameLength === 0 ||
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      (flags & ~0x080e) !== 0 ||
      ![0, 8].includes(method)
    ) {
      fail("candidate ZIP entry is unsupported or malformed");
    }
    const nameBytes = zipBytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const extraBytes = zipBytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    assertZipExtraFields(extraBytes);
    const decoded = decodeZipPath(nameBytes);
    if (decoderPaths.has(decoded.path)) fail("candidate ZIP contains a duplicate decoded path");
    decoderPaths.add(decoded.path);
    const host = versionMadeBy >>> 8;
    const unixType = host === 3 ? ((externalAttributes >>> 16) & 0xf000) : 0;
    if (
      (decoded.directory && unixType !== 0 && unixType !== 0x4000) ||
      (!decoded.directory && unixType !== 0 && unixType !== 0x8000)
    ) {
      fail("candidate ZIP entries must be regular files or directories");
    }
    if (decoded.directory && (compressedSize !== 0 || uncompressedSize !== 0 || crc32 !== 0)) {
      fail("candidate ZIP directory entry must be empty");
    }
    if (compressedSize > MAX_ZIP_BYTES || uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      fail("candidate ZIP entry exceeds the byte limit");
    }
    if (!decoded.directory) {
      if (uncompressedSize > MAX_ZIP_TOTAL_BYTES - declaredTotal) fail("candidate ZIP exceeds the aggregate byte limit");
      declaredTotal += uncompressedSize;
    }

    if (localOffset + 30 > centralOffset || zipBytes.readUInt32LE(localOffset) !== 0x04034b50) {
      fail("candidate ZIP local entry is invalid");
    }
    const localFlags = zipBytes.readUInt16LE(localOffset + 6);
    const localMethod = zipBytes.readUInt16LE(localOffset + 8);
    const localCrc32 = zipBytes.readUInt32LE(localOffset + 14);
    const localCompressedSize = zipBytes.readUInt32LE(localOffset + 18);
    const localUncompressedSize = zipBytes.readUInt32LE(localOffset + 22);
    const localNameLength = zipBytes.readUInt16LE(localOffset + 26);
    const localExtraLength = zipBytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    const usesDataDescriptor = (flags & 0x0008) !== 0;
    if (
      dataEnd > centralOffset ||
      localFlags !== flags ||
      localMethod !== method ||
      localNameLength !== nameLength ||
      !zipBytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes)
    ) {
      fail("candidate ZIP local and central entries do not match");
    }
    if (usesDataDescriptor) {
      if (localCrc32 !== 0 || localCompressedSize !== 0 || localUncompressedSize !== 0) {
        fail("candidate ZIP data descriptor requires zero local CRC and sizes");
      }
    } else if (
      localCrc32 !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      fail("candidate ZIP local and central entries do not match");
    }
    assertZipExtraFields(zipBytes.subarray(localOffset + 30 + localNameLength, dataStart));
    const localRecordEnd = usesDataDescriptor
      ? parseZipDataDescriptor(zipBytes, {
          compressedSize,
          crc32,
          dataEnd,
          uncompressedSize,
          upperBound: centralOffset,
        })
      : dataEnd;
    intervals.push({ dataDescriptor: usesDataDescriptor, end: localRecordEnd, start: localOffset });
    entries.push({ ...decoded, compressedSize, crc32, dataStart, method, uncompressedSize });
    cursor = recordEnd;
  }
  if (cursor !== eocdOffset) fail("candidate ZIP central directory size does not match its entries");
  intervals.sort((left, right) => left.start - right.start);
  if (intervals.some((interval, index) => index > 0 && interval.start < intervals[index - 1].end)) {
    fail("candidate ZIP local entries overlap");
  }
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    if (interval.dataDescriptor) {
      const nextBoundary = intervals[index + 1]?.start ?? centralOffset;
      if (interval.end !== nextBoundary) {
        fail("candidate ZIP data descriptor has trailing bytes");
      }
    }
  }
  return entries;
}

async function ensureZipDirectory(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const descriptor = await lstat(current);
      if (descriptor.isSymbolicLink() || !descriptor.isDirectory()) fail("candidate ZIP parent must be a real directory");
    } catch (error) {
      if (error instanceof ReleaseControlError) throw error;
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!mkdirError || typeof mkdirError !== "object" || mkdirError.code !== "EEXIST") throw mkdirError;
      }
      const descriptor = await lstat(current);
      if (descriptor.isSymbolicLink() || !descriptor.isDirectory()) fail("candidate ZIP parent must be a real directory");
    }
  }
}

export async function extractReleaseArtifactZip({ zipPath, outputRoot }) {
  const physicalOutput = await assertRealDirectory(outputRoot, "candidate ZIP output root");
  const originalRoot = await lstat(physicalOutput);
  if ((await readdir(physicalOutput)).length !== 0) fail("candidate ZIP output root must be empty");
  let zipHandle;
  let zipBytes;
  try {
    zipHandle = await open(zipPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await zipHandle.stat();
    if (!before.isFile() || before.size < 22 || before.size > MAX_ZIP_BYTES) fail("candidate ZIP must be a bounded regular file");
    zipBytes = await zipHandle.readFile();
    const after = await zipHandle.stat();
    if (after.size !== before.size || zipBytes.length !== before.size) fail("candidate ZIP changed while reading");
  } catch (error) {
    if (error instanceof ReleaseControlError) throw error;
    fail("candidate ZIP must be a bounded regular file");
  } finally {
    await zipHandle?.close();
  }

  const entries = parseZipEntries(zipBytes);
  let actualTotal = 0;
  const materialized = entries.map((entry) => {
    if (entry.directory) return { ...entry, contents: Buffer.alloc(0) };
    const compressed = zipBytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    let contents;
    try {
      contents = entry.method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: Math.min(MAX_ZIP_ENTRY_BYTES, entry.uncompressedSize) + 1 });
    } catch {
      fail("candidate ZIP entry exceeds its declared or actual byte limit");
    }
    if (contents.length !== entry.uncompressedSize) fail("candidate ZIP entry actual size does not match its declaration");
    if (zipCrc32(contents) !== entry.crc32) fail("candidate ZIP entry CRC does not match");
    if (contents.length > MAX_ZIP_TOTAL_BYTES - actualTotal) fail("candidate ZIP actual contents exceed the aggregate byte limit");
    actualTotal += contents.length;
    return { ...entry, contents };
  });

  const currentRoot = await lstat(physicalOutput);
  if (
    currentRoot.isSymbolicLink() ||
    !currentRoot.isDirectory() ||
    currentRoot.dev !== originalRoot.dev ||
    currentRoot.ino !== originalRoot.ino ||
    (await readdir(physicalOutput)).length !== 0
  ) {
    fail("candidate ZIP output root changed before extraction");
  }
  try {
    for (const entry of materialized) {
      const segments = entry.path.split("/");
      const parentSegments = entry.directory ? segments : segments.slice(0, -1);
      await ensureZipDirectory(physicalOutput, parentSegments);
      if (entry.directory) continue;
      const target = join(physicalOutput, ...segments);
      let handle;
      try {
        handle = await open(
          target,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        await handle.writeFile(entry.contents);
        await handle.sync();
      } finally {
        await handle?.close();
      }
      const descriptor = await lstat(target);
      if (descriptor.isSymbolicLink() || !descriptor.isFile() || descriptor.size !== entry.contents.length) {
        fail("candidate ZIP output file changed while writing");
      }
    }
  } catch (error) {
    await Promise.all((await readdir(physicalOutput)).map((name) => rm(join(physicalOutput, name), { force: true, recursive: true })));
    throw error;
  }
  return { entryCount: entries.length, totalBytes: actualTotal };
}

function runCloudFormationAws(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("aws", args, {
      env: { ...process.env, AWS_PAGER: "" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exceeded = false;
    const collect = (chunks, stream) => (chunk) => {
      const next = (stream === "stdout" ? stdoutBytes : stderrBytes) + chunk.length;
      if (next > MAX_AWS_OUTPUT_BYTES) {
        exceeded = true;
        child.kill("SIGTERM");
        return;
      }
      chunks.push(Buffer.from(chunk));
      if (stream === "stdout") stdoutBytes = next;
      else stderrBytes = next;
    };
    child.stdout.on("data", collect(stdout, "stdout"));
    child.stderr.on("data", collect(stderr, "stderr"));
    child.once("error", () => rejectPromise(new ReleaseControlError("CloudFormation observation command failed")));
    child.once("close", (code, signal) => {
      if (exceeded || code === null) {
        rejectPromise(new ReleaseControlError("CloudFormation observation command failed"));
        return;
      }
      resolvePromise({ code, signal, stderr: Buffer.concat(stderr), stdout: Buffer.concat(stdout) });
    });
  });
}

function stackParameter(stack, key) {
  const matches = Array.isArray(stack?.Parameters)
    ? stack.Parameters.filter((entry) => entry?.ParameterKey === key)
    : [];
  if (matches.length !== 1 || typeof matches[0].ParameterValue !== "string") {
    fail("CloudFormation stack parameters are invalid");
  }
  return matches[0].ParameterValue;
}

export async function observeCloudFormationStack({ runAws = runCloudFormationAws } = {}) {
  const result = await runAws([
    "cloudformation",
    "describe-stacks",
    "--stack-name", STACK_NAME,
    "--region", "us-east-1",
    "--output", "json",
  ]);
  if (result.signal !== null) fail("CloudFormation stack observation failed");
  if (result.code !== 0) {
    let stderr;
    try {
      stderr = new TextDecoder("utf-8", { fatal: true }).decode(result.stderr).trim();
    } catch {
      fail("CloudFormation stack observation failed");
    }
    if (result.stdout.length === 0 && stderr === STACK_NOT_FOUND) {
      return { exists: false, activeReleaseSha: "UNRELEASED", distributionEnabled: false };
    }
    fail("CloudFormation stack observation failed");
  }
  if (result.stderr.length !== 0) fail("CloudFormation stack observation failed");
  const response = parseStrictJsonBytes(result.stdout, "CloudFormation stack observation");
  if (!Array.isArray(response?.Stacks) || response.Stacks.length !== 1 || response.Stacks[0]?.StackName !== STACK_NAME) {
    fail("CloudFormation stack observation is invalid");
  }
  const stack = response.Stacks[0];
  if (!STABLE_STACK_STATUSES.has(stack.StackStatus)) {
    fail("CloudFormation stack is not in an exact stable status");
  }
  const activeReleaseSha = stackParameter(stack, "ActiveReleaseSha");
  const enabledText = stackParameter(stack, "DistributionEnabled");
  if (activeReleaseSha !== "UNRELEASED") assertCommitSha(activeReleaseSha, "CloudFormation active release SHA");
  if (!new Set(["true", "false"]).has(enabledText)) fail("CloudFormation distribution state is invalid");
  const distributionEnabled = enabledText === "true";
  if (activeReleaseSha === "UNRELEASED" && distributionEnabled) fail("CloudFormation stack observation is invalid");
  return { exists: true, activeReleaseSha, distributionEnabled };
}

async function writeTrustedJsonOutput(outputPath, value, label) {
  if (typeof outputPath !== "string" || !isAbsolute(outputPath)) fail(`${label} path must be absolute`);
  await assertRealDirectory(dirname(outputPath), `${label} parent`);
  try {
    await writeFile(outputPath, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
  } catch {
    fail(`${label} must be a new regular file`);
  }
}

async function writeCloudFormationState(outputPath, state) {
  await writeTrustedJsonOutput(outputPath, state, "CloudFormation state output");
}

async function requireCloudFormationSuccess(runAws, args) {
  const result = await runAws(args);
  if (result.code !== 0 || result.signal !== null || result.stdout.length !== 0 || result.stderr.length !== 0) {
    fail("CloudFormation restoration command failed");
  }
}

export async function restoreAbsentCloudFormationStack({ outputPath, runAws = runCloudFormationAws }) {
  const before = await observeCloudFormationStack({ runAws });
  if (before.exists) {
    await requireCloudFormationSuccess(runAws, [
      "cloudformation", "delete-stack",
      "--stack-name", STACK_NAME,
      "--region", "us-east-1",
    ]);
    await requireCloudFormationSuccess(runAws, [
      "cloudformation", "wait", "stack-delete-complete",
      "--stack-name", STACK_NAME,
      "--region", "us-east-1",
    ]);
    const after = await observeCloudFormationStack({ runAws });
    if (after.exists) fail("CloudFormation absence restoration was not confirmed");
  }
  const applied = { exists: false, activeReleaseSha: "UNRELEASED", distributionEnabled: false };
  await writeCloudFormationState(outputPath, applied);
  return applied;
}

function runRuntime(runtimeExecutable, args, { captureStdout = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const stdout = [];
    let stdoutBytes = 0;
    const child = spawn(runtimeExecutable, args, {
      env: { PATH: process.env.PATH ?? "" },
      shell: false,
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "ignore"],
      windowsHide: true,
    });
    child.stdout?.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_JSON_BYTES) child.kill("SIGTERM");
      else stdout.push(Buffer.from(chunk));
    });
    child.once("error", () => rejectPromise(new ReleaseControlError("candidate sandbox runtime failed")));
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null && stdoutBytes <= MAX_JSON_BYTES) {
        resolvePromise(captureStdout ? Buffer.concat(stdout).toString("utf8") : undefined);
      }
      else rejectPromise(new ReleaseControlError("candidate sandbox runtime failed"));
    });
  });
}

export async function runCandidateSandbox({
  runtimeExecutable = "/usr/bin/docker",
  containerName,
  candidateRoot,
  candidateSha,
  controllerRoot,
  outputRoot,
  publicEnvironment,
  image = CANDIDATE_CONTAINER_IMAGE,
}) {
  if (typeof runtimeExecutable !== "string" || runtimeExecutable.length === 0) fail("candidate sandbox runtime is invalid");
  if (typeof containerName !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(containerName)) {
    fail("candidate sandbox container name is invalid");
  }
  if (typeof image !== "string" || image.length === 0 || /[\s\0\r\n]/.test(image)) fail("candidate sandbox image is invalid");
  assertCommitSha(candidateSha);
  const [physicalCandidate, physicalController, physicalOutput] = await Promise.all([
    assertRealDirectory(candidateRoot, "candidate root"),
    assertRealDirectory(controllerRoot, "controller root"),
    assertRealDirectory(outputRoot, "candidate output root"),
  ]);
  if (new Set([physicalCandidate, physicalController, physicalOutput]).size !== 3) {
    fail("candidate sandbox roots must be distinct");
  }
  const { copyVerifiedArtifact, validateOutputRoot } = await import("./release-archive.mjs");
  await validateOutputRoot({ outputRoot: physicalOutput, repoRoot: physicalController });
  assertPublicEnvironment(publicEnvironment);
  const argumentsForRun = [
    "run",
    "--detach",
    "--name", containerName,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=256",
    "--memory=2048m",
    "--cpus=2",
    "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=1024m",
    "--tmpfs", "/work:rw,nosuid,nodev,size=2048m",
    "--tmpfs", "/output:rw,nosuid,nodev,size=256m",
    "--mount", `type=bind,src=${physicalCandidate},dst=/candidate,readonly`,
    "--mount", `type=bind,src=${physicalController},dst=/controller,readonly`,
  ];
  for (const key of PUBLIC_VITE_KEYS) argumentsForRun.push("--env", `${key}=${publicEnvironment[key]}`);
  argumentsForRun.push(
    image,
    "sh",
    "-eu",
    "-c",
    `mkdir -p /work/candidate /output; cp -a /candidate/. /work/candidate; cd /work/candidate; exec node /controller/scripts/verify-release-archive.mjs --candidate-root /work/candidate --candidate-sha ${candidateSha} --output-root /output`,
  );

  let started = false;
  let removed = false;
  let promotedArtifact = false;
  const transferRoot = await mkdtemp(join(tmpdir(), "molroom-candidate-transfer-"));
  await chmod(transferRoot, 0o700);
  const transferOutput = join(transferRoot, "output");
  try {
    await runRuntime(runtimeExecutable, argumentsForRun);
    started = true;
    const waitOutput = await runRuntime(runtimeExecutable, ["wait", containerName], { captureStdout: true });
    if (waitOutput.trim() !== "0") fail("candidate sandbox container exited unsuccessfully");
    await runRuntime(runtimeExecutable, ["cp", `${containerName}:/output/.`, transferOutput]);
    await runRuntime(runtimeExecutable, ["rm", "-f", containerName]);
    removed = true;
    const transferredArtifact = join(transferOutput, "artifact");
    const transferFindings = await scanProductionBundle(transferredArtifact);
    if (transferFindings.length !== 0) fail("candidate sandbox trusted bundle scan failed");
    await copyVerifiedArtifact({ sourceRoot: transferredArtifact, outputRoot: physicalOutput });
    promotedArtifact = true;
    const artifactRoot = join(physicalOutput, "artifact");
    const finalFindings = await scanProductionBundle(artifactRoot);
    if (finalFindings.length !== 0) fail("candidate sandbox trusted bundle scan failed");
    const finalInspection = await inspectReleaseArtifactTree({ artifactRoot });
    const receipt = createArchiveReceipt({
      candidateSha,
      inspection: finalInspection,
      npmVersion: "11.17.0",
      steps: VERIFIED_ARCHIVE_STEP_NAMES.map((name) => ({ name, status: "passed" })),
    });
    const evidenceRoot = join(physicalOutput, "evidence");
    await mkdir(evidenceRoot, { mode: 0o700 });
    await writeFile(join(physicalOutput, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(evidenceRoot, "steps.json"), `${JSON.stringify(receipt.steps, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await validateArchiveReceipt({
      artifactRoot: join(physicalOutput, "artifact"),
      receiptPath: join(physicalOutput, "receipt.json"),
      candidateSha,
    });
    return {
      artifactRoot,
      receiptPath: join(physicalOutput, "receipt.json"),
    };
  } catch (error) {
    if (promotedArtifact) {
      await rm(join(physicalOutput, "artifact"), { force: true, recursive: true });
      await rm(join(physicalOutput, "evidence"), { force: true, recursive: true });
      await rm(join(physicalOutput, "receipt.json"), { force: true });
    }
    throw error;
  } finally {
    if (started && !removed) await runRuntime(runtimeExecutable, ["rm", "-f", containerName]);
    await rm(transferRoot, { force: true, recursive: true });
  }
}

export function validateSecurityGateBinding({
  evidence,
  run,
  artifact,
  artifactSha256,
  candidateSha,
  approvedWorkflow,
  targetWorkflow,
}) {
  assertCommitSha(candidateSha);
  validateSecurityGateEvidence(evidence, candidateSha);
  if (
    !Buffer.isBuffer(approvedWorkflow) || approvedWorkflow.length === 0 || approvedWorkflow.length > MAX_JSON_BYTES ||
    !Buffer.isBuffer(targetWorkflow) || targetWorkflow.length === 0 || targetWorkflow.length > MAX_JSON_BYTES ||
    !approvedWorkflow.equals(targetWorkflow)
  ) {
    fail("security gate workflow definition does not match the approved controller definition");
  }
  assertPlainObject(run, "security gate workflow run");
  assertPlainObject(run.repository, "security gate workflow repository");
  if (
    run.id !== evidence.security_gate_run_id ||
    run.repository.full_name !== evidence.repository ||
    run.path !== ".github/workflows/security-gate.yml" ||
    run.head_branch !== "main" ||
    run.event !== "workflow_dispatch" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_sha !== candidateSha
  ) {
    fail("security gate workflow run does not bind repository, workflow path, head branch, event, success, and head SHA");
  }
  assertPlainObject(run.actor, "security gate workflow actor");
  if (run.actor.login !== evidence.dispatch_actor) {
    fail("security gate workflow dispatch actor does not match the evidence");
  }
  assertPlainObject(artifact, "security gate artifact");
  if (
    !Number.isSafeInteger(artifact.id) || artifact.id <= 0 ||
    artifact.name !== `security-gate-${candidateSha}` ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 ||
    typeof artifact.archive_download_url !== "string" || !artifact.archive_download_url.startsWith("https://")
  ) {
    fail("security gate artifact identity is invalid");
  }
  assertSha256(artifactSha256, "security gate artifact SHA-256");
  if (artifact.digest !== `sha256:${artifactSha256}`) {
    fail("security gate artifact server digest does not match the downloaded artifact");
  }
  return { artifactId: artifact.id, artifactSha256, runId: evidence.security_gate_run_id };
}

export function planDeploymentLifecycle({ mode, targetSha, current }) {
  if (!["release", "repair", "rollback"].includes(mode)) fail("deployment mode is invalid");
  assertCommitSha(targetSha, "deployment target SHA");
  assertExactKeys(current, ["activeReleaseSha", "distributionEnabled", "exists"], "current deployment state");
  if (typeof current.exists !== "boolean" || typeof current.distributionEnabled !== "boolean") {
    fail("current deployment state is invalid");
  }
  if (current.activeReleaseSha !== "UNRELEASED") assertCommitSha(current.activeReleaseSha, "current active release SHA");
  const restore = {
    exists: current.exists,
    activeReleaseSha: current.activeReleaseSha,
    distributionEnabled: current.distributionEnabled,
  };
  const target = { activeReleaseSha: targetSha, distributionEnabled: true };
  if (mode === "repair") {
    if (!current.exists || current.activeReleaseSha !== targetSha || current.distributionEnabled !== true) {
      fail("repair target is not the active release");
    }
    return {
      changeSetType: "NONE",
      invalidate: false,
      repairOnly: true,
      restore,
      smoke: false,
      target,
    };
  }
  if (current.exists && current.activeReleaseSha === targetSha && current.distributionEnabled === true) {
    return {
      changeSetType: "NONE",
      invalidate: false,
      restore,
      smoke: true,
      target,
    };
  }
  return {
    changeSetType: current.exists ? "UPDATE" : "CREATE",
    invalidate: true,
    restore,
    smoke: true,
    target,
  };
}

function validateDeploymentState(value, label) {
  assertExactKeys(value, ["activeReleaseSha", "distributionEnabled", "exists"], label);
  if (typeof value.exists !== "boolean" || typeof value.distributionEnabled !== "boolean") fail(`${label} is invalid`);
  if (value.activeReleaseSha !== "UNRELEASED") assertCommitSha(value.activeReleaseSha, `${label} active release SHA`);
  if (value.activeReleaseSha === "UNRELEASED" && value.distributionEnabled !== false) fail(`${label} is invalid`);
  if (!value.exists && (value.activeReleaseSha !== "UNRELEASED" || value.distributionEnabled !== false)) fail(`${label} is invalid`);
  return value;
}

export function validateSmokeObservation({ expectedSha, observation }) {
  assertCommitSha(expectedSha, "expected smoke release SHA");
  assertExactKeys(
    observation,
    ["auth_ok", "http_status", "release_sha", "rooms_ok", "routes_ok", "secrets_absent"],
    "production smoke observation",
  );
  if (
    observation.http_status !== 200 ||
    observation.release_sha !== expectedSha ||
    observation.auth_ok !== true ||
    observation.rooms_ok !== true ||
    observation.routes_ok !== true ||
    observation.secrets_absent !== true
  ) {
    fail("production smoke does not bind the expected release SHA and required checks");
  }
  return observation;
}

async function readBoundedSmokeResponse(response, path) {
  if (response === null || typeof response !== "object" || response.status !== 200) {
    fail(`production smoke response is not exact HTTP 200: ${path}`);
  }
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength) || Number(declaredLength) > MAX_SMOKE_BODY_BYTES) {
      fail(`production smoke response exceeds the body limit: ${path}`);
    }
  }
  if (response.body === null || typeof response.body?.getReader !== "function") {
    fail(`production smoke response body is missing: ${path}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail(`production smoke response body is invalid: ${path}`);
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SMOKE_BODY_BYTES) {
        await reader.cancel();
        fail(`production smoke response exceeds the body limit: ${path}`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof ReleaseControlError) throw error;
    fail(`production smoke response body could not be read: ${path}`);
  }
  if (totalBytes === 0) fail(`production smoke response body is empty: ${path}`);
  return Buffer.concat(chunks, totalBytes);
}

async function fetchProductionSmokePath(path, fetchImplementation) {
  let response;
  try {
    response = await fetchImplementation(`${PRODUCTION_ORIGIN}${path}`, {
      headers: { accept: path === "/_release.json" ? "application/json" : "text/html" },
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof ReleaseControlError) throw error;
    fail(`production smoke request failed: ${path}`);
  }
  return readBoundedSmokeResponse(response, path);
}

export async function collectProductionSmoke({ expectedSha, fetchImplementation = globalThis.fetch }) {
  assertCommitSha(expectedSha, "expected smoke release SHA");
  if (typeof fetchImplementation !== "function") fail("production smoke fetch implementation is invalid");
  const paths = ["/_release.json", "/", "/login", "/rooms"];
  const responses = new Map();
  for (const path of paths) responses.set(path, await fetchProductionSmokePath(path, fetchImplementation));
  const metadata = parseStrictJsonBytes(responses.get("/_release.json"), "production release metadata");
  assertPlainObject(metadata, "production release metadata");
  if (metadata.commit_sha !== expectedSha) {
    fail("production smoke release metadata does not bind the expected release SHA");
  }
  const decodedResponses = [];
  try {
    for (const body of responses.values()) {
      decodedResponses.push(new TextDecoder("utf-8", { fatal: true }).decode(body));
    }
  } catch {
    fail("production smoke response is not valid UTF-8");
  }
  const secretPattern = /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|AWS_SECRET_ACCESS_KEY|refresh_token|client_secret)/i;
  const observation = {
    auth_ok: responses.get("/login").length > 0,
    http_status: 200,
    release_sha: metadata.commit_sha,
    rooms_ok: responses.get("/rooms").length > 0,
    routes_ok: ["/", "/login", "/rooms"].every((path) => responses.get(path).length > 0),
    secrets_absent: decodedResponses.every((body) => !secretPattern.test(body)),
  };
  validateSmokeObservation({ expectedSha, observation });
  return observation;
}

export function validateRestorationOutcome({ restore, applied, smoke }) {
  validateDeploymentState(restore, "restoration target state");
  validateDeploymentState(applied, "restoration applied state");
  if (
    restore.activeReleaseSha !== applied.activeReleaseSha ||
    restore.distributionEnabled !== applied.distributionEnabled ||
    restore.exists !== applied.exists
  ) {
    fail("restoration verification failed");
  }
  if (restore.distributionEnabled) {
    try {
      validateSmokeObservation({ expectedSha: restore.activeReleaseSha, observation: smoke });
    } catch {
      fail("restoration verification failed");
    }
  } else if (smoke !== null) {
    fail("restoration verification failed");
  }
  return { restoredSha: restore.activeReleaseSha };
}

function normalizedPublicationAssets(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail("publication postcheck failed");
  const names = new Set();
  const normalized = value.map((asset) => {
    assertExactKeys(asset, ["digest", "name", "size"], label);
    if (
      typeof asset.name !== "string" ||
      !/^_[a-z0-9.-]{1,63}$/.test(asset.name) ||
      names.has(asset.name) ||
      typeof asset.digest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(asset.digest) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0
    ) {
      fail("publication postcheck failed");
    }
    names.add(asset.name);
    return { digest: asset.digest, name: asset.name, size: asset.size };
  });
  return normalized.sort((left, right) => left.name.localeCompare(right.name));
}

function assertPublicationTag(value, expectedSha, { optional }) {
  if (value === null && optional) return;
  assertExactKeys(value, ["annotated", "target_sha"], "publication tag observation");
  if (value.annotated !== true || value.target_sha !== expectedSha) fail("publication postcheck failed");
}

export function validatePublicationState({ expected, observed }) {
  assertExactKeys(expected, ["assets", "body", "sha", "version"], "expected publication state");
  assertCommitSha(expected.sha, "expected publication SHA");
  if (typeof expected.version !== "string" || !VERSION_PATTERN.test(expected.version) || typeof expected.body !== "string") {
    fail("publication postcheck failed");
  }
  const expectedAssets = normalizedPublicationAssets(expected.assets, "expected publication asset");
  assertExactKeys(observed, ["main_sha", "release", "tag_after", "tag_before"], "observed publication state");
  if (observed.main_sha !== expected.sha) fail("publication postcheck failed");
  assertPublicationTag(observed.tag_before, expected.sha, { optional: true });
  assertPublicationTag(observed.tag_after, expected.sha, { optional: false });
  assertExactKeys(
    observed.release,
    ["assets", "body", "draft", "name", "prerelease", "tag_name", "target_sha"],
    "observed GitHub Release",
  );
  const observedAssets = normalizedPublicationAssets(observed.release.assets, "observed publication asset");
  if (
    observed.release.body !== expected.body ||
    observed.release.draft !== false ||
    observed.release.name !== `MolRoom v${expected.version}` ||
    observed.release.prerelease !== false ||
    observed.release.tag_name !== `v${expected.version}` ||
    observed.release.target_sha !== expected.sha ||
    JSON.stringify(observedAssets) !== JSON.stringify(expectedAssets)
  ) {
    fail("publication postcheck failed");
  }
  return { releaseSha: expected.sha };
}

function runAwsJson(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("aws", args, {
      env: { ...process.env, AWS_PAGER: "" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    let outputBytes = 0;
    const collect = (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_AWS_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        return;
      }
      stdout.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", () => rejectPromise(new ReleaseControlError("remote prefix object lookup failed")));
    child.once("close", (code, signal) => {
      if (code !== 0 || signal !== null || outputBytes > MAX_AWS_OUTPUT_BYTES) {
        rejectPromise(new ReleaseControlError("remote prefix object lookup failed"));
        return;
      }
      try {
        resolvePromise(parseStrictJsonBytes(Buffer.concat(stdout), "AWS CLI output"));
      } catch {
        rejectPromise(new ReleaseControlError("remote prefix object lookup failed"));
      }
    });
  });
}

export async function verifyRemoteReleasePrefix({ artifactRoot, bucket, candidateSha, packageVersion, runAws = runAwsJson }) {
  const plan = await planReleasePrefixUpload({ artifactRoot, bucket, commitSha: candidateSha, expectedPackageVersion: packageVersion });
  const expectedObjects = new Map(plan.objects.map((object) => [object.key, object]));
  const listedKeys = new Set();
  let continuationToken;
  do {
    const listArguments = [
      "s3api", "list-objects-v2",
      "--bucket", bucket,
      "--prefix", plan.releasePrefix,
      "--output", "json",
    ];
    if (continuationToken !== undefined) listArguments.push("--continuation-token", continuationToken);
    const listing = await runAws(listArguments);
    if (
      !Array.isArray(listing?.Contents) ||
      typeof listing.IsTruncated !== "boolean" ||
      !Number.isSafeInteger(listing.KeyCount) ||
      listing.KeyCount !== listing.Contents.length
    ) {
      fail("remote immutable prefix listing is invalid");
    }
    for (const entry of listing.Contents) {
      if (
        typeof entry?.Key !== "string" ||
        !Number.isSafeInteger(entry.Size) ||
        entry.Size < 0 ||
        !expectedObjects.has(entry.Key) ||
        listedKeys.has(entry.Key)
      ) {
        fail("complete immutable prefix contains an unexpected remote object");
      }
      if (expectedObjects.get(entry.Key).size !== entry.Size) {
        fail("remote immutable prefix object does not match size, checksum, and metadata");
      }
      listedKeys.add(entry.Key);
    }
    if (listing.IsTruncated) {
      if (typeof listing.NextContinuationToken !== "string" || listing.NextContinuationToken.length === 0 || listing.NextContinuationToken.length > 2048) {
        fail("remote immutable prefix listing is invalid");
      }
      continuationToken = listing.NextContinuationToken;
    } else {
      continuationToken = undefined;
    }
  } while (continuationToken !== undefined);
  if (listedKeys.size !== expectedObjects.size) fail("remote immutable prefix is missing required objects");
  for (const object of plan.objects) {
    const remote = await runAws([
      "s3api", "head-object",
      "--bucket", bucket,
      "--key", object.key,
      "--checksum-mode", "ENABLED",
      "--output", "json",
    ]);
    try {
      validateStoredReleaseObjectHead({
        head: remote,
        object,
        manifestSha256: plan.manifestSha256,
        mismatchMessage: "remote immutable prefix object headers do not match the release plan",
      });
    } catch {
      fail("remote immutable prefix object headers do not match the release plan");
    }
  }
  return { manifestSha256: plan.manifestSha256, objectCount: plan.objects.length };
}

export async function validatePreparedReleasePackage({ preparedRoot, bucket, candidateSha, packageVersion }) {
  const physicalPreparedRoot = await assertRealDirectory(preparedRoot, "prepared release root");
  const entries = await readdir(physicalPreparedRoot);
  if (entries.length !== 1 || entries[0] !== "artifact") fail("prepared release package layout is invalid");
  const artifactRoot = await assertRealDirectory(join(physicalPreparedRoot, "artifact"), "prepared release artifact root");
  const plan = await planReleasePrefixUpload({ artifactRoot, bucket, commitSha: candidateSha, expectedPackageVersion: packageVersion });
  return { artifactRoot, manifestSha256: plan.manifestSha256, objectCount: plan.objects.length };
}

function parseControlArguments(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["extract-candidate-zip", "observe-cloudformation-stack", "plan-deployment", "restore-absent-cloudformation-stack", "run-candidate-sandbox", "smoke-production", "verify-archive", "verify-prefix", "verify-prepared-package", "verify-publication", "verify-remote-prefix", "verify-restoration", "verify-security-gate"]).has(command)) fail("release control command is invalid");
  const values = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!/^--[a-z][a-z0-9-]*$/.test(key) || values.has(key)) fail("release control arguments are invalid");
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) fail("release control arguments are invalid");
    values.set(key, value);
    index += 1;
  }
  return { command, values };
}

function requiredArgument(values, key) {
  const value = values.get(key);
  if (value === undefined) fail("release control arguments are invalid");
  return value;
}

const CONTROL_ARGUMENTS = Object.freeze({
  "extract-candidate-zip": { required: ["--output-root", "--zip-path"] },
  "observe-cloudformation-stack": { required: ["--output-path"] },
  "plan-deployment": { required: ["--current-path", "--mode", "--target-sha"] },
  "restore-absent-cloudformation-stack": { required: ["--output-path"] },
  "run-candidate-sandbox": { required: ["--candidate-root", "--candidate-sha", "--container-name", "--controller-root", "--output-root"], optional: ["--image"] },
  "smoke-production": { required: ["--expected-sha", "--output-path"] },
  "verify-archive": { required: ["--artifact-root", "--candidate-sha", "--receipt-path"] },
  "verify-prefix": { required: ["--artifact-root", "--bucket", "--candidate-sha", "--package-version"] },
  "verify-prepared-package": { required: ["--bucket", "--candidate-sha", "--package-version", "--prepared-root"] },
  "verify-publication": { required: ["--expected-path", "--observed-path"] },
  "verify-remote-prefix": { required: ["--artifact-root", "--bucket", "--candidate-sha"], optional: ["--package-version"] },
  "verify-restoration": { required: ["--applied-path", "--restore-path", "--smoke-path"] },
  "verify-security-gate": { required: ["--approved-workflow-path", "--artifact-path", "--artifact-sha256", "--candidate-sha", "--evidence-path", "--run-path", "--target-workflow-path"] },
});

function assertControlArguments(command, values) {
  const specification = CONTROL_ARGUMENTS[command];
  const required = new Set(specification.required);
  const allowed = new Set([...specification.required, ...(specification.optional ?? [])]);
  if (
    [...values.keys()].some((key) => !allowed.has(key)) ||
    [...required].some((key) => !values.has(key))
  ) {
    fail("release control arguments are invalid");
  }
}

export async function runReleaseControlCli(argv, {
  environment = process.env,
  fetchImplementation = globalThis.fetch,
} = {}) {
  const { command, values } = parseControlArguments(argv);
  assertControlArguments(command, values);
  if (command === "extract-candidate-zip") {
    const result = await extractReleaseArtifactZip({
      zipPath: requiredArgument(values, "--zip-path"),
      outputRoot: requiredArgument(values, "--output-root"),
    });
    return { entry_count: result.entryCount, schema_version: 1, status: "verified", total_bytes: result.totalBytes };
  }
  if (command === "observe-cloudformation-stack") {
    const state = await observeCloudFormationStack();
    await writeCloudFormationState(requiredArgument(values, "--output-path"), state);
    return { exists: state.exists, schema_version: 1, status: "verified" };
  }
  if (command === "restore-absent-cloudformation-stack") {
    await restoreAbsentCloudFormationStack({ outputPath: requiredArgument(values, "--output-path") });
    return { restored_absent: true, schema_version: 1, status: "verified" };
  }
  if (command === "plan-deployment") {
    const currentWithExists = await readBoundedJsonNoFollow(requiredArgument(values, "--current-path"), "current deployment state");
    const plan = planDeploymentLifecycle({
      mode: requiredArgument(values, "--mode"),
      targetSha: requiredArgument(values, "--target-sha"),
      current: currentWithExists,
    });
    return { ...plan, schema_version: 1, status: "verified" };
  }
  if (command === "run-candidate-sandbox") {
    const publicEnvironment = Object.fromEntries(PUBLIC_VITE_KEYS.map((key) => [key, environment[key]]));
    await runCandidateSandbox({
      candidateRoot: requiredArgument(values, "--candidate-root"),
      candidateSha: requiredArgument(values, "--candidate-sha"),
      containerName: requiredArgument(values, "--container-name"),
      controllerRoot: requiredArgument(values, "--controller-root"),
      image: values.get("--image") ?? CANDIDATE_CONTAINER_IMAGE,
      outputRoot: requiredArgument(values, "--output-root"),
      publicEnvironment,
    });
    return { schema_version: 1, status: "verified" };
  }
  if (command === "verify-archive") {
    const result = await validateArchiveReceipt({
      artifactRoot: requiredArgument(values, "--artifact-root"),
      receiptPath: requiredArgument(values, "--receipt-path"),
      candidateSha: requiredArgument(values, "--candidate-sha"),
    });
    return { artifact_tree_sha256: result.inspection.treeSha256, schema_version: 1, status: "verified" };
  }
  if (command === "verify-prefix") {
    const plan = await planReleasePrefixUpload({
      artifactRoot: requiredArgument(values, "--artifact-root"),
      bucket: requiredArgument(values, "--bucket"),
      commitSha: requiredArgument(values, "--candidate-sha"),
      expectedPackageVersion: requiredArgument(values, "--package-version"),
    });
    return { manifest_sha256: plan.manifestSha256, object_count: plan.objects.length, schema_version: 1, status: "verified" };
  }
  if (command === "verify-prepared-package") {
    const result = await validatePreparedReleasePackage({
      preparedRoot: requiredArgument(values, "--prepared-root"),
      bucket: requiredArgument(values, "--bucket"),
      candidateSha: requiredArgument(values, "--candidate-sha"),
      packageVersion: requiredArgument(values, "--package-version"),
    });
    return { manifest_sha256: result.manifestSha256, object_count: result.objectCount, schema_version: 1, status: "verified" };
  }
  if (command === "verify-remote-prefix") {
    const result = await verifyRemoteReleasePrefix({
      artifactRoot: requiredArgument(values, "--artifact-root"),
      bucket: requiredArgument(values, "--bucket"),
      candidateSha: requiredArgument(values, "--candidate-sha"),
      packageVersion: values.get("--package-version"),
    });
    return { manifest_sha256: result.manifestSha256, object_count: result.objectCount, schema_version: 1, status: "verified" };
  }
  if (command === "smoke-production") {
    const expectedSha = requiredArgument(values, "--expected-sha");
    const observation = await collectProductionSmoke({ expectedSha, fetchImplementation });
    await writeTrustedJsonOutput(
      requiredArgument(values, "--output-path"),
      observation,
      "production smoke output",
    );
    return { release_sha: expectedSha, schema_version: 1, status: "verified" };
  }
  if (command === "verify-restoration") {
    const [restore, applied] = await Promise.all([
      readBoundedJsonNoFollow(requiredArgument(values, "--restore-path"), "restoration target state"),
      readBoundedJsonNoFollow(requiredArgument(values, "--applied-path"), "restoration applied state"),
    ]);
    const smokePath = requiredArgument(values, "--smoke-path");
    const smoke = smokePath === "NONE"
      ? null
      : await readBoundedJsonNoFollow(smokePath, "restoration smoke observation");
    const result = validateRestorationOutcome({ restore, applied, smoke });
    return { restored_sha: result.restoredSha, schema_version: 1, status: "verified" };
  }
  if (command === "verify-publication") {
    const [expected, observed] = await Promise.all([
      readBoundedJsonNoFollow(requiredArgument(values, "--expected-path"), "expected publication state"),
      readBoundedJsonNoFollow(requiredArgument(values, "--observed-path"), "observed publication state"),
    ]);
    const result = validatePublicationState({ expected, observed });
    return { release_sha: result.releaseSha, schema_version: 1, status: "verified" };
  }
  const [evidence, run, artifact, approvedWorkflow, targetWorkflow] = await Promise.all([
    readBoundedJsonNoFollow(requiredArgument(values, "--evidence-path"), "security gate evidence"),
    readBoundedJsonNoFollow(requiredArgument(values, "--run-path"), "security gate workflow run"),
    readBoundedJsonNoFollow(requiredArgument(values, "--artifact-path"), "security gate artifact"),
    readBoundedFileNoFollow(requiredArgument(values, "--approved-workflow-path"), "approved security gate workflow"),
    readBoundedFileNoFollow(requiredArgument(values, "--target-workflow-path"), "target security gate workflow"),
  ]);
  const result = validateSecurityGateBinding({
    evidence,
    run,
    artifact,
    artifactSha256: requiredArgument(values, "--artifact-sha256"),
    candidateSha: requiredArgument(values, "--candidate-sha"),
    approvedWorkflow,
    targetWorkflow,
  });
  return { artifact_id: result.artifactId, schema_version: 1, status: "verified" };
}
