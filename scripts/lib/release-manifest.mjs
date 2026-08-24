import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const RELEASE_METADATA_PATHS = new Set([
  "_manifest.sha256",
  "_release.json",
  "_security-gate.json",
]);
const EXPECTED_REPOSITORY = "kim-song-jun/meeting-wrapper";
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PACKAGE_VERSION_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const S3_BUCKET_PATTERN = /^(?![0-9]+(?:\.[0-9]+){3}$)(?!.*\.\.)(?!.*\.-)(?!.*-\.)(?=.{3,63}$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE_CONTROL = "no-cache";
const MAX_RELEASE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_RELEASE_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_AWS_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_ARTIFACT_LIMITS = Object.freeze({
  maxFileBytes: MAX_RELEASE_FILE_BYTES,
  maxTotalBytes: MAX_RELEASE_TOTAL_BYTES,
});

const CONTENT_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(contents, encoding = "hex") {
  return createHash("sha256").update(contents).digest(encoding);
}

function assertCommitSha(value) {
  if (!COMMIT_SHA_PATTERN.test(value)) {
    throw new Error("Release identity must be a 40-character lowercase hexadecimal commit SHA");
  }
}

function assertPackageVersion(value) {
  if (!PACKAGE_VERSION_PATTERN.test(value)) {
    throw new Error("Package version must be a canonical semantic version");
  }
}

function assertSourceDateEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("SOURCE_DATE_EPOCH must be a non-negative safe integer");
  }
}

function assertReleasePath(path) {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\0\r\n]/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe release artifact path: ${JSON.stringify(path)}`);
  }
}

function toReleasePath(root, path) {
  const output = relative(root, path).split(sep).join("/");
  assertReleasePath(output);
  return output;
}

function normalizeArtifactLimits(artifactLimits) {
  if (artifactLimits === undefined) {
    return DEFAULT_ARTIFACT_LIMITS;
  }
  if (
    artifactLimits === null ||
    typeof artifactLimits !== "object" ||
    Array.isArray(artifactLimits) ||
    Object.keys(artifactLimits).sort(comparePaths).join(",") !== "maxFileBytes,maxTotalBytes"
  ) {
    throw new Error("Artifact limits must define exactly maxFileBytes and maxTotalBytes");
  }
  const { maxFileBytes, maxTotalBytes } = artifactLimits;
  if (
    !Number.isSafeInteger(maxFileBytes) ||
    maxFileBytes <= 0 ||
    !Number.isSafeInteger(maxTotalBytes) ||
    maxTotalBytes <= 0 ||
    maxFileBytes > maxTotalBytes
  ) {
    throw new Error("Artifact byte limits must be positive safe integers with maxFileBytes <= maxTotalBytes");
  }
  if (maxFileBytes > MAX_RELEASE_FILE_BYTES || maxTotalBytes > MAX_RELEASE_TOTAL_BYTES) {
    throw new Error("Artifact byte limits must not exceed the release policy");
  }
  return { maxFileBytes, maxTotalBytes };
}

async function readRegularFileNoFollow(
  path,
  { expectedSize, maxFileBytes = MAX_RELEASE_FILE_BYTES } = {},
) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      throw new Error(`Release artifact is not a regular file: ${path}`);
    }
    if (fileStat.size > maxFileBytes) {
      throw new Error(`Release artifact exceeds the per-file byte limit: ${path}`);
    }
    if (expectedSize !== undefined && fileStat.size !== expectedSize) {
      throw new Error(`Release artifact changed after the upload plan was created: ${path}`);
    }
    const contents = await handle.readFile();
    const finalStat = await handle.stat();
    if (finalStat.size !== fileStat.size || contents.length !== fileStat.size) {
      throw new Error(`Release artifact changed while reading: ${path}`);
    }
    return { contents, size: fileStat.size };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ELOOP") {
      throw new Error(`Release artifact must not be a symbolic link: ${path}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function scanArtifactFiles(artifactRoot, artifactLimits) {
  const limits = normalizeArtifactLimits(artifactLimits);
  const resolvedRoot = resolve(artifactRoot);
  let rootStat;
  try {
    rootStat = await lstat(resolvedRoot);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`Release artifact root does not exist: ${artifactRoot}`);
    }
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Release artifact root must be a real directory: ${artifactRoot}`);
  }

  const files = [];
  let totalBytes = 0;
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));

    for (const entry of entries) {
      if (/[\0\r\n\\/]/.test(entry.name)) {
        throw new Error(`Unsafe release artifact name: ${JSON.stringify(entry.name)}`);
      }
      const absolutePath = join(directory, entry.name);
      const releasePath = toReleasePath(resolvedRoot, absolutePath);
      if (entry.isSymbolicLink()) {
        throw new Error(`Release artifact must not be a symbolic link: ${releasePath}`);
      }
      if (RELEASE_METADATA_PATHS.has(releasePath) && !entry.isFile()) {
        throw new Error(`Reserved release metadata path must be a regular file: ${releasePath}`);
      }
      if (entry.isDirectory()) {
        const directoryStat = await lstat(absolutePath);
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
          throw new Error(`Release artifact directory changed while reading: ${releasePath}`);
        }
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const fileStat = await lstat(absolutePath);
        if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
          throw new Error(`Release artifact changed while scanning: ${releasePath}`);
        }
        if (fileStat.size > limits.maxFileBytes) {
          throw new Error(`Release artifact exceeds the per-file byte limit: ${releasePath}`);
        }
        if (fileStat.size > limits.maxTotalBytes - totalBytes) {
          throw new Error(`Release artifacts exceed the aggregate byte limit: ${artifactRoot}`);
        }
        totalBytes += fileStat.size;
        files.push({ absolutePath, path: releasePath, size: fileStat.size });
      } else {
        throw new Error(`Release artifact must be a regular file: ${releasePath}`);
      }
    }
  }

  await visit(resolvedRoot);
  const runtimeFiles = files.filter(({ path }) => !RELEASE_METADATA_PATHS.has(path));
  if (runtimeFiles.length === 0) {
    throw new Error(`Release artifact root contains no runtime files: ${artifactRoot}`);
  }
  return {
    files: files.sort((left, right) => comparePaths(left.path, right.path)),
    limits,
    resolvedRoot,
  };
}

export async function inspectReleaseArtifactTree({ artifactRoot, artifactLimits }) {
  const scan = await scanArtifactFiles(artifactRoot, artifactLimits);
  const files = [];
  for (const descriptor of scan.files) {
    const { contents, size } = await readRegularFileNoFollow(descriptor.absolutePath, {
      expectedSize: descriptor.size,
      maxFileBytes: scan.limits.maxFileBytes,
    });
    files.push({ path: descriptor.path, sha256: digest(contents), size });
  }
  const treeSha256 = digest(files.map(({ path, sha256, size }) => `${sha256}  ${size}  ${path}\n`).join(""));
  return {
    files,
    totalBytes: files.reduce((total, { size }) => total + size, 0),
    treeSha256,
  };
}

export async function compareReleaseArtifactTrees(leftArtifactRoot, rightArtifactRoot, { artifactLimits } = {}) {
  const [left, right] = await Promise.all([
    inspectReleaseArtifactTree({ artifactRoot: leftArtifactRoot, artifactLimits }),
    inspectReleaseArtifactTree({ artifactRoot: rightArtifactRoot, artifactLimits }),
  ]);
  if (
    left.files.length !== right.files.length ||
    left.files.some((file, index) => {
      const candidate = right.files[index];
      return candidate === undefined || file.path !== candidate.path || file.size !== candidate.size || file.sha256 !== candidate.sha256;
    })
  ) {
    throw new Error("Release artifact trees differ");
  }
  return { equal: true, treeSha256: left.treeSha256 };
}

function isHashedAsset(path) {
  return path.startsWith("assets/") && /[-.][0-9A-Za-z_-]{8,64}\.[^/]+$/.test(path);
}

function isServiceWorker(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === "service-worker.js" || name === "sw.js" || /^workbox-[^/]+\.js$/.test(name);
}

export function contentTypeForPath(path) {
  if (path === "_manifest.sha256") {
    return "text/plain; charset=utf-8";
  }
  return CONTENT_TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

export function cacheControlForPath(path) {
  if (
    RELEASE_METADATA_PATHS.has(path) ||
    path === "index.html" ||
    path.endsWith("/index.html") ||
    isServiceWorker(path)
  ) {
    return REVALIDATE_CACHE_CONTROL;
  }
  return isHashedAsset(path) ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL;
}

export async function buildReleaseArtifacts({
  artifactRoot,
  commitSha,
  packageVersion,
  sourceDateEpoch,
  artifactLimits,
}) {
  assertCommitSha(commitSha);
  assertPackageVersion(packageVersion);
  assertSourceDateEpoch(sourceDateEpoch);

  const inspection = await inspectReleaseArtifactTree({ artifactRoot, artifactLimits });
  const entries = inspection.files.filter(({ path }) => !RELEASE_METADATA_PATHS.has(path)).map(({ path, sha256, size }) => ({
    cacheControl: cacheControlForPath(path),
    contentType: contentTypeForPath(path),
    path,
    sha256,
    size,
  }));
  const manifestText = entries.map((entry) => `${entry.sha256}  ${entry.path}\n`).join("");
  const manifestSha256 = digest(manifestText);
  const releaseMetadata = {
    schema_version: 1,
    package_version: packageVersion,
    commit_sha: commitSha,
    commit_timestamp: sourceDateEpoch,
    manifest_sha256: manifestSha256,
  };

  return {
    entries,
    manifestSha256,
    manifestText,
    releaseJson: `${JSON.stringify(releaseMetadata, null, 2)}\n`,
    releaseMetadata,
  };
}

async function existingMetadataStatus(path, expectedContents) {
  try {
    const { contents } = await readRegularFileNoFollow(path);
    if (!contents.equals(Buffer.from(expectedContents))) {
      throw new Error(`Refusing to replace different release metadata: ${path}`);
    }
    return "reused";
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return "written";
    }
    throw error;
  }
}

async function writeMetadataIfMissing(path, contents, status) {
  if (status === "reused") {
    return "reused";
  }
  try {
    await writeFile(path, contents, { flag: "wx", mode: 0o644 });
    return "written";
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") {
      throw error;
    }
    const racedStatus = await existingMetadataStatus(path, contents);
    if (racedStatus !== "reused") {
      throw new Error(`Refusing to replace different release metadata: ${path}`);
    }
    return "reused";
  }
}

export async function writeReleaseMetadata({ artifactRoot, release }) {
  const manifestPath = join(resolve(artifactRoot), "_manifest.sha256");
  const releasePath = join(resolve(artifactRoot), "_release.json");
  const manifestStatus = await existingMetadataStatus(manifestPath, release.manifestText);
  const releaseStatus = await existingMetadataStatus(releasePath, release.releaseJson);

  return {
    manifest: await writeMetadataIfMissing(manifestPath, release.manifestText, manifestStatus),
    release: await writeMetadataIfMissing(releasePath, release.releaseJson, releaseStatus),
  };
}

export function parseStrictJsonBytes(contents, label) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    throw new Error(`${label} must contain valid UTF-8 JSON`);
  }

  let index = 0;
  const invalid = () => {
    throw new Error(`${label} must contain valid JSON`);
  };
  const skipWhitespace = () => {
    while (/[\t\n\r ]/.test(source[index] ?? "")) index += 1;
  };
  const parseStringToken = () => {
    if (source[index] !== '"') invalid();
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch {
          invalid();
        }
      }
      if (character === "\\") {
        index += 1;
        const escape = source[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5))) invalid();
          index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escape ?? "")) invalid();
        index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) invalid();
      index += 1;
    }
    invalid();
  };
  const parseValue = () => {
    skipWhitespace();
    const character = source[index];
    if (character === '"') {
      parseStringToken();
      return;
    }
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (true) {
        skipWhitespace();
        const key = parseStringToken();
        if (keys.has(key)) throw new Error(`${label} contains a duplicate decoded object key`);
        keys.add(key);
        skipWhitespace();
        if (source[index] !== ":") invalid();
        index += 1;
        parseValue();
        skipWhitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") invalid();
        index += 1;
      }
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (true) {
        parseValue();
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") invalid();
        index += 1;
      }
    }
    const remaining = source.slice(index);
    const token = remaining.match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/)?.[0];
    if (token === undefined) invalid();
    index += token.length;
  };

  parseValue();
  skipWhitespace();
  if (index !== source.length) invalid();
  try {
    return JSON.parse(source);
  } catch {
    invalid();
  }
}

function parseJson(contents, label) {
  return parseStrictJsonBytes(contents, label);
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort(comparePaths);
  const expected = [...keys].sort(comparePaths);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains missing or unknown fields`);
  }
}

function assertCanonicalTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO-8601 UTC timestamp`);
  }
}

function validateReleaseMetadata(value, commitSha) {
  assertExactKeys(
    value,
    ["schema_version", "package_version", "commit_sha", "commit_timestamp", "manifest_sha256"],
    "_release.json",
  );
  if (value.schema_version !== 1) {
    throw new Error("_release.json has an unsupported schema version");
  }
  assertPackageVersion(value.package_version);
  assertCommitSha(value.commit_sha);
  assertSourceDateEpoch(value.commit_timestamp);
  if (value.commit_sha !== commitSha) {
    throw new Error("_release.json does not describe the requested commit SHA");
  }
  if (!SHA256_PATTERN.test(value.manifest_sha256)) {
    throw new Error("_release.json manifest SHA-256 is invalid");
  }
  return value;
}

export function validateSecurityGateEvidence(value, commitSha) {
  assertExactKeys(
    value,
    [
      "schema_version",
      "repository",
      "target_sha",
      "manual_review_sha256",
      "deep_security_scan_sha256",
      "scan_tool",
      "scan_version",
      "completed_at",
      "critical_count",
      "high_count",
      "redacted_finding_ids",
      "security_gate_run_id",
      "dispatch_actor",
      "gate_timestamp",
    ],
    "_security-gate.json",
  );
  if (value.schema_version !== 1) {
    throw new Error("_security-gate.json has an unsupported schema version");
  }
  if (value.repository !== EXPECTED_REPOSITORY) {
    throw new Error("_security-gate.json repository is not authorized");
  }
  if (value.target_sha !== commitSha || !COMMIT_SHA_PATTERN.test(value.target_sha)) {
    throw new Error("_security-gate.json does not describe the requested commit SHA");
  }
  if (
    !SHA256_PATTERN.test(value.manual_review_sha256) ||
    !SHA256_PATTERN.test(value.deep_security_scan_sha256)
  ) {
    throw new Error("_security-gate.json report digests are invalid");
  }
  if (value.critical_count !== 0 || value.high_count !== 0) {
    throw new Error("Critical and High counts must both be zero");
  }
  if (
    typeof value.scan_tool !== "string" ||
    !/^[0-9A-Za-z._/-]{1,64}$/.test(value.scan_tool) ||
    typeof value.scan_version !== "string" ||
    !/^[0-9A-Za-z._+-]{1,64}$/.test(value.scan_version)
  ) {
    throw new Error("_security-gate.json scan identity is invalid");
  }
  assertCanonicalTimestamp(value.completed_at, "_security-gate.json completed_at");
  assertCanonicalTimestamp(value.gate_timestamp, "_security-gate.json gate_timestamp");
  if (
    !Array.isArray(value.redacted_finding_ids) ||
    value.redacted_finding_ids.length > 256 ||
    value.redacted_finding_ids.some(
      (identifier) => typeof identifier !== "string" || !/^[0-9A-Za-z._:-]{1,128}$/.test(identifier),
    )
  ) {
    throw new Error("_security-gate.json finding identifiers are invalid");
  }
  if (!Number.isSafeInteger(value.security_gate_run_id) || value.security_gate_run_id <= 0) {
    throw new Error("_security-gate.json workflow run ID is invalid");
  }
  if (typeof value.dispatch_actor !== "string" || !/^[0-9A-Za-z-]{1,39}$/.test(value.dispatch_actor)) {
    throw new Error("_security-gate.json dispatch actor is invalid");
  }
  return value;
}

function objectFromBytes({ path, bytes, commitSha, bucket, manifestSha256 }) {
  const sha256 = digest(bytes);
  return {
    bucket,
    cacheControl: cacheControlForPath(path),
    checksumSha256: Buffer.from(sha256, "hex").toString("base64"),
    contentType: contentTypeForPath(path),
    ifNoneMatch: "*",
    key: `releases/${commitSha}/${path}`,
    metadata: {
      sha256,
      "manifest-sha256": manifestSha256,
    },
    sha256,
    size: bytes.length,
    sourcePath: path,
  };
}

function objectFromRuntimeEntry({ entry, commitSha, bucket, manifestSha256 }) {
  return {
    bucket,
    cacheControl: entry.cacheControl,
    checksumSha256: Buffer.from(entry.sha256, "hex").toString("base64"),
    contentType: entry.contentType,
    ifNoneMatch: "*",
    key: `releases/${commitSha}/${entry.path}`,
    metadata: {
      sha256: entry.sha256,
      "manifest-sha256": manifestSha256,
    },
    sha256: entry.sha256,
    size: entry.size,
    sourcePath: entry.path,
  };
}

export async function planReleasePrefixUpload({ artifactRoot, bucket, commitSha, expectedPackageVersion }) {
  assertCommitSha(commitSha);
  if (expectedPackageVersion !== undefined) assertPackageVersion(expectedPackageVersion);
  if (!S3_BUCKET_PATTERN.test(bucket)) {
    throw new Error("Release bucket must be a valid DNS-compatible S3 bucket name");
  }
  const resolvedRoot = resolve(artifactRoot);
  const scan = await scanArtifactFiles(resolvedRoot);
  const descriptorFor = (path) => {
    const descriptor = scan.files.find((file) => file.path === path);
    if (!descriptor) {
      throw new Error(`Required release metadata is missing: ${path}`);
    }
    return descriptor;
  };
  const readDescriptor = (descriptor) =>
    readRegularFileNoFollow(descriptor.absolutePath, {
      expectedSize: descriptor.size,
      maxFileBytes: scan.limits.maxFileBytes,
    });
  const manifestFile = await readDescriptor(descriptorFor("_manifest.sha256"));
  const releaseFile = await readDescriptor(descriptorFor("_release.json"));
  const gateFile = await readDescriptor(descriptorFor("_security-gate.json"));
  const releaseMetadata = validateReleaseMetadata(parseJson(releaseFile.contents, "_release.json"), commitSha);
  if (expectedPackageVersion !== undefined && releaseMetadata.package_version !== expectedPackageVersion) {
    throw new Error("_release.json package version does not match the requested release");
  }
  validateSecurityGateEvidence(parseJson(gateFile.contents, "_security-gate.json"), commitSha);

  const release = await buildReleaseArtifacts({
    artifactRoot: resolvedRoot,
    commitSha,
    packageVersion: releaseMetadata.package_version,
    sourceDateEpoch: releaseMetadata.commit_timestamp,
  });
  if (!manifestFile.contents.equals(Buffer.from(release.manifestText))) {
    throw new Error("_manifest.sha256 does not match the runtime artifact bytes");
  }
  if (!releaseFile.contents.equals(Buffer.from(release.releaseJson))) {
    throw new Error("_release.json is not the canonical deterministic release metadata");
  }
  if (release.manifestSha256 !== releaseMetadata.manifest_sha256) {
    throw new Error("_release.json manifest SHA-256 does not match _manifest.sha256");
  }

  const runtimeObjects = release.entries.map((entry) =>
    objectFromRuntimeEntry({
      entry,
      commitSha,
      bucket,
      manifestSha256: release.manifestSha256,
    }),
  );

  const metadataObjects = [
    ["_manifest.sha256", manifestFile.contents],
    ["_release.json", releaseFile.contents],
    ["_security-gate.json", gateFile.contents],
  ].map(([path, bytes]) =>
    objectFromBytes({
      path,
      bytes,
      commitSha,
      bucket,
      manifestSha256: release.manifestSha256,
    }),
  );

  return {
    schemaVersion: 1,
    bucket,
    commitSha,
    manifestSha256: release.manifestSha256,
    objects: [...runtimeObjects, ...metadataObjects],
    releasePrefix: `releases/${commitSha}/`,
  };
}

async function defaultRunAws(args, { input } = {}) {
  if (input !== undefined && !Buffer.isBuffer(input)) {
    throw new Error("AWS CLI stdin input must be a Buffer");
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("aws", args, {
      env: { ...process.env, AWS_PAGER: "" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputLimitError;
    let stdinError;

    const collect = (chunks, streamName) => (chunk) => {
      const currentBytes = streamName === "stdout" ? stdoutBytes : stderrBytes;
      if (chunk.length > MAX_AWS_OUTPUT_BYTES - currentBytes) {
        outputLimitError = new Error(`AWS CLI ${streamName} exceeded the bounded output limit`);
        child.kill("SIGTERM");
        return;
      }
      chunks.push(chunk);
      if (streamName === "stdout") {
        stdoutBytes += chunk.length;
      } else {
        stderrBytes += chunk.length;
      }
    };

    child.stdout.on("data", collect(stdoutChunks, "stdout"));
    child.stderr.on("data", collect(stderrChunks, "stderr"));
    child.stdin.on("error", (error) => {
      stdinError = error;
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (outputLimitError) {
        outputLimitError.stdout = stdout;
        outputLimitError.stderr = stderr;
        rejectPromise(outputLimitError);
        return;
      }
      if (stdinError && code === 0) {
        rejectPromise(stdinError);
        return;
      }
      if (code !== 0) {
        const error = new Error(
          `AWS CLI exited unsuccessfully (${signal ? `signal ${signal}` : `code ${code}`}): ${args[0]} ${args[1]}`,
        );
        error.stdout = stdout;
        error.stderr = stderr;
        rejectPromise(error);
        return;
      }
      resolvePromise({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function isPreconditionFailure(error) {
  const message = `${error instanceof Error ? error.message : ""}\n${
    error && typeof error === "object" && typeof error.stderr === "string" ? error.stderr : ""
  }`;
  return /(?:PreconditionFailed|status code: 412|\b412\b)/i.test(message);
}

function normalizeExactMetadata(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {};
  for (const [key, metadataValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (Object.hasOwn(normalized, normalizedKey)) return null;
    normalized[normalizedKey] = metadataValue;
  }
  return normalized;
}

export function validateStoredReleaseObjectHead({
  head,
  object,
  manifestSha256,
  mismatchMessage = `Remote immutable release object headers differ from the plan: ${object?.key ?? "unknown"}`,
}) {
  const metadata = normalizeExactMetadata(head?.Metadata);
  const unexpectedServingHeaders = [
    "ContentEncoding",
    "WebsiteRedirectLocation",
    "ContentDisposition",
    "ContentLanguage",
    "Expires",
  ];
  if (
    head === null || typeof head !== "object" || Array.isArray(head) ||
    head.ContentLength !== object?.size ||
    head.ChecksumSHA256 !== object?.checksumSha256 ||
    head.ContentType !== object?.contentType ||
    head.CacheControl !== object?.cacheControl ||
    head.ServerSideEncryption !== "AES256" ||
    metadata === null ||
    Object.keys(metadata).length !== 2 ||
    metadata.sha256 !== object?.sha256 ||
    metadata["manifest-sha256"] !== manifestSha256 ||
    unexpectedServingHeaders.some((header) => Object.hasOwn(head, header))
  ) {
    throw new Error(mismatchMessage);
  }
  return head;
}

function resolveObjectSource(artifactRoot, sourcePath) {
  assertReleasePath(sourcePath);
  const root = resolve(artifactRoot);
  const source = resolve(root, ...sourcePath.split("/"));
  if (!source.startsWith(`${root}${sep}`)) {
    throw new Error(`Upload source escapes the artifact root: ${sourcePath}`);
  }
  return source;
}

function assertUploadPlanLimits(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.objects)) {
    throw new Error("Upload plan must contain an objects array");
  }
  let totalBytes = 0;
  for (const object of plan.objects) {
    if (!Number.isSafeInteger(object?.size) || object.size < 0) {
      throw new Error("Upload plan object sizes must be non-negative safe integers");
    }
    if (object.size > MAX_RELEASE_FILE_BYTES) {
      throw new Error(`Upload object exceeds the per-file byte limit: ${object.sourcePath}`);
    }
    if (object.size > MAX_RELEASE_TOTAL_BYTES - totalBytes) {
      throw new Error("Upload objects exceed the aggregate byte limit");
    }
    totalBytes += object.size;
  }
}

export async function executeUploadPlan({ artifactRoot, plan, runAws = defaultRunAws }) {
  assertUploadPlanLimits(plan);
  const results = [];
  for (const object of plan.objects) {
    const bodyPath = resolveObjectSource(artifactRoot, object.sourcePath);
    const { contents, size } = await readRegularFileNoFollow(bodyPath, {
      expectedSize: object.size,
      maxFileBytes: MAX_RELEASE_FILE_BYTES,
    });
    const actualSha256 = digest(contents);
    const actualChecksumSha256 = Buffer.from(actualSha256, "hex").toString("base64");
    if (
      size !== object.size ||
      actualSha256 !== object.sha256 ||
      actualChecksumSha256 !== object.checksumSha256
    ) {
      throw new Error(`Release artifact changed after the upload plan was created: ${object.sourcePath}`);
    }
    const metadata = `sha256=${object.sha256},manifest-sha256=${plan.manifestSha256}`;
    const putArguments = [
      "s3api",
      "put-object",
      "--bucket",
      plan.bucket,
      "--key",
      object.key,
      "--body",
      "/dev/stdin",
      "--content-type",
      object.contentType,
      "--cache-control",
      object.cacheControl,
      "--checksum-algorithm",
      "SHA256",
      "--checksum-sha256",
      object.checksumSha256,
      "--metadata",
      metadata,
      "--if-none-match",
      "*",
      "--server-side-encryption",
      "AES256",
    ];

    try {
      await runAws(putArguments, { input: contents });
      results.push({ key: object.key, status: "uploaded" });
      continue;
    } catch (error) {
      if (!isPreconditionFailure(error)) {
        throw error;
      }
    }

    const headResult = await runAws([
      "s3api",
      "head-object",
      "--bucket",
      plan.bucket,
      "--key",
      object.key,
      "--checksum-mode",
      "ENABLED",
      "--output",
      "json",
    ]);
    const head = parseJson(Buffer.from(headResult.stdout), `S3 head-object ${object.key}`);
    validateStoredReleaseObjectHead({
      head,
      object,
      manifestSha256: plan.manifestSha256,
      mismatchMessage: `Immutable release object differs from planned bytes: ${object.key}`,
    });
    results.push({ key: object.key, status: "reused" });
  }
  return results;
}
