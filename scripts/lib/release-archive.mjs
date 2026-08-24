import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  compareReleaseArtifactTrees,
  inspectReleaseArtifactTree,
} from "./release-manifest.mjs";
import { createArchiveReceipt, PUBLIC_VITE_ENVIRONMENT_KEYS } from "./release-control.mjs";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const NODE_VERSION = "v24.19.0";
const NPM_VERSION = "11.17.0";
const MAX_CAPTURE_BYTES = 64 * 1024;
const STEP_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINATION_WAIT_MS = 1_000;
const SAFE_CONTROLLER_ENVIRONMENT_KEYS = Object.freeze(["LANG", "LC_ALL", "PATH", "TMPDIR"]);

export class ReleaseArchiveError extends Error {
  constructor(code, { evidencePath, outputRoot } = {}) {
    super(code);
    this.name = "ReleaseArchiveError";
    this.code = code;
    if (typeof evidencePath === "string") this.evidencePath = evidencePath;
    if (typeof outputRoot === "string") this.outputRoot = outputRoot;
  }
}

function fail(code) {
  throw new ReleaseArchiveError(code);
}

function isInside(root, candidate) {
  const output = relative(root, candidate);
  return output === "" || (!output.startsWith(`..${sep}`) && output !== ".." && !isAbsolute(output));
}

function safeEnvironmentValue(value) {
  return typeof value === "string" && !/[\0\r\n]/.test(value) ? value : undefined;
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export function parseReleaseArchiveArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!new Set(["--candidate-root", "--candidate-sha", "--output-root"]).has(argument) || values.has(argument)) {
      fail("RELEASE_ARCHIVE_ARGUMENTS_INVALID");
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail("RELEASE_ARCHIVE_ARGUMENTS_INVALID");
    values.set(argument, value);
    index += 1;
  }
  const candidateRoot = values.get("--candidate-root");
  const candidateSha = values.get("--candidate-sha");
  const outputRoot = values.get("--output-root");
  if ((candidateRoot === undefined) !== (candidateSha === undefined) || (candidateRoot !== undefined && outputRoot === undefined)) {
    fail("RELEASE_ARCHIVE_ARGUMENTS_INVALID");
  }
  if (
    (candidateRoot !== undefined && !isAbsolute(candidateRoot)) ||
    (candidateSha !== undefined && !COMMIT_SHA_PATTERN.test(candidateSha))
  ) {
    fail("RELEASE_ARCHIVE_ARGUMENTS_INVALID");
  }
  return { candidateRoot, candidateSha, outputRoot };
}

export async function validateOutputRoot({ outputRoot, repoRoot }) {
  if (typeof outputRoot !== "string" || !isAbsolute(outputRoot)) fail("RELEASE_ARCHIVE_OUTPUT_ROOT_INVALID");
  let outputStat;
  try {
    outputStat = await lstat(outputRoot);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") fail("RELEASE_ARCHIVE_OUTPUT_ROOT_INVALID");
    throw error;
  }
  if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) fail("RELEASE_ARCHIVE_OUTPUT_ROOT_INVALID");
  const [physicalOutput, physicalRepository] = await Promise.all([realpath(outputRoot), realpath(repoRoot)]);
  if (isInside(physicalRepository, physicalOutput) || (await readdir(physicalOutput)).length !== 0) {
    fail("RELEASE_ARCHIVE_OUTPUT_ROOT_INVALID");
  }
  await chmod(physicalOutput, 0o700);
  return physicalOutput;
}

export function createCredentialFreeEnvironment({ inheritedEnv, privateHome, cacheRoot }) {
  const environment = {};
  for (const key of SAFE_CONTROLLER_ENVIRONMENT_KEYS) {
    const value = safeEnvironmentValue(inheritedEnv?.[key]);
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(inheritedEnv ?? {})) {
    const safeValue = safeEnvironmentValue(value);
    if (PUBLIC_VITE_ENVIRONMENT_KEYS.includes(key) && safeValue !== undefined) environment[key] = safeValue;
  }
  environment.HOME = privateHome;
  environment.npm_config_audit = "false";
  environment.npm_config_cache = cacheRoot;
  environment.npm_config_fund = "false";
  environment.npm_config_ignore_scripts = "true";
  environment.npm_config_update_notifier = "false";
  environment.npm_config_userconfig = join(privateHome, ".npmrc");
  return environment;
}

async function physicalFile(path) {
  const resolved = await realpath(path);
  const fileStat = await stat(resolved);
  if (!fileStat.isFile()) fail("RELEASE_ARCHIVE_TOOL_INVALID");
  return resolved;
}

async function findPhysicalExecutable(name, { inheritedPath, excludedRoots }) {
  for (const segment of (inheritedPath ?? "").split(delimiter)) {
    if (segment.length === 0) continue;
    const candidate = join(segment, name);
    try {
      const physical = await physicalFile(candidate);
      if (excludedRoots.some((root) => isInside(root, physical))) continue;
      return physical;
    } catch (error) {
      if (error instanceof ReleaseArchiveError) throw error;
      if (error && typeof error === "object" && ["ENOENT", "ENOTDIR"].includes(error.code)) continue;
      throw error;
    }
  }
  fail("RELEASE_ARCHIVE_TOOL_NOT_FOUND");
}

export async function resolveTrustedExecutables({ repoRoot, candidateRoot, inheritedPath, nodePath = process.execPath }) {
  const physicalRepository = await realpath(repoRoot);
  const excludedRoots = [physicalRepository, resolve(candidateRoot)];
  const node = await physicalFile(nodePath);
  if (excludedRoots.some((root) => isInside(root, node))) fail("RELEASE_ARCHIVE_TOOL_INVALID");
  const npmCandidates = [join(dirname(node), "npm"), join(dirname(node), "npm.cmd")];
  let npm;
  for (const candidate of npmCandidates) {
    try {
      const physical = await physicalFile(candidate);
      if (!excludedRoots.some((root) => isInside(root, physical))) {
        npm = physical;
        break;
      }
    } catch (error) {
      if (!error || typeof error !== "object" || !["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  if (npm === undefined) npm = await findPhysicalExecutable("npm", { inheritedPath, excludedRoots });
  const [git, tar] = await Promise.all([
    findPhysicalExecutable("git", { inheritedPath, excludedRoots }),
    findPhysicalExecutable("tar", { inheritedPath, excludedRoots }),
  ]);
  return { git, node, npm, tar };
}

async function wait(milliseconds) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function terminateOwnedProcessGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ESRCH") throw error;
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ESRCH") throw error;
    return;
  }
  await wait(TERMINATION_WAIT_MS);
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ESRCH") throw error;
  }
}

export async function runIsolatedStep({
  name,
  executable,
  args,
  cwd,
  env,
  timeoutMs = STEP_TIMEOUT_MS,
  processLedger,
  captureStdout = false,
}) {
  if (
    typeof name !== "string" ||
    typeof executable !== "string" ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string") ||
    typeof cwd !== "string" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Array.isArray(processLedger)
  ) fail("RELEASE_ARCHIVE_STEP_INVALID");

  const child = spawn(executable, args, {
    cwd,
    detached: process.platform !== "win32",
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const record = {
    name,
    pgid: process.platform === "win32" ? null : child.pid,
    pid: child.pid,
    settled: false,
    status: "running",
    stderrBytes: 0,
    stdoutBytes: 0,
  };
  processLedger.push(record);
  const stdout = [];
  let capturedBytes = 0;
  let outputTooLarge = false;
  const consume = (stream, collect) => {
    stream?.on("data", (chunk) => {
      const size = Buffer.byteLength(chunk);
      if (collect) record.stdoutBytes += size;
      else record.stderrBytes += size;
      if (captureStdout && collect && !outputTooLarge) {
        if (capturedBytes + size > MAX_CAPTURE_BYTES) {
          outputTooLarge = true;
          void terminateOwnedProcessGroup(child.pid);
        } else {
          stdout.push(Buffer.from(chunk));
          capturedBytes += size;
        }
      }
    });
  };
  consume(child.stdout, true);
  consume(child.stderr, false);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void terminateOwnedProcessGroup(child.pid);
  }, timeoutMs);
  const outcome = await new Promise((resolvePromise) => {
    let complete = false;
    const settle = (value) => {
      if (!complete) {
        complete = true;
        resolvePromise(value);
      }
    };
    child.once("error", () => settle({ code: null, failedToStart: true, signal: null }));
    child.once("close", (code, signal) => settle({ code, failedToStart: false, signal }));
  });
  clearTimeout(timeout);
  await terminateOwnedProcessGroup(child.pid);
  record.settled = true;
  record.status = timedOut || outputTooLarge || outcome.failedToStart || outcome.code !== 0 || outcome.signal !== null
    ? "failed"
    : "passed";
  if (record.status !== "passed") fail("RELEASE_ARCHIVE_STEP_FAILED");
  return captureStdout ? Buffer.concat(stdout).toString("utf8") : undefined;
}

export async function runFixedSteps({ cwd, env, processLedger, steps }) {
  if (!Array.isArray(steps) || steps.length === 0) fail("RELEASE_ARCHIVE_STEPS_INVALID");
  for (const step of steps) {
    await runIsolatedStep({ cwd, env, processLedger, ...step });
  }
}

async function readSnapshot(path, expectedSize) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expectedSize) fail("RELEASE_ARCHIVE_COPY_MISMATCH");
    const contents = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== before.size || contents.length !== before.size) fail("RELEASE_ARCHIVE_COPY_MISMATCH");
    return contents;
  } catch (error) {
    if (error instanceof ReleaseArchiveError) throw error;
    fail("RELEASE_ARCHIVE_COPY_MISMATCH");
  } finally {
    await handle?.close();
  }
}

async function writeExclusiveNoFollow(path, contents) {
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(contents);
  } catch (error) {
    if (error instanceof ReleaseArchiveError) throw error;
    fail("RELEASE_ARCHIVE_COPY_MISMATCH");
  } finally {
    await handle?.close();
  }
}

export async function copyVerifiedArtifact({ sourceRoot, outputRoot, beforePromote }) {
  let source;
  try {
    source = await inspectReleaseArtifactTree({ artifactRoot: sourceRoot });
  } catch {
    fail("RELEASE_ARCHIVE_COPY_MISMATCH");
  }
  const incompleteRoot = join(outputRoot, "artifact.incomplete");
  const artifactRoot = join(outputRoot, "artifact");
  let incompleteCreated = false;
  let promoted = false;
  try {
    try {
      await lstat(artifactRoot);
      fail("RELEASE_ARCHIVE_COPY_MISMATCH");
    } catch (error) {
      if (error instanceof ReleaseArchiveError) throw error;
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        fail("RELEASE_ARCHIVE_COPY_MISMATCH");
      }
    }
    await mkdir(incompleteRoot, { mode: 0o700 });
    incompleteCreated = true;
    for (const file of source.files) {
      const destination = join(incompleteRoot, ...file.path.split("/"));
      await mkdir(dirname(destination), { mode: 0o700, recursive: true });
      const contents = await readSnapshot(join(sourceRoot, ...file.path.split("/")), file.size);
      if (digest(contents) !== file.sha256) fail("RELEASE_ARCHIVE_COPY_MISMATCH");
      await writeExclusiveNoFollow(destination, contents);
    }
    try {
      await compareReleaseArtifactTrees(sourceRoot, incompleteRoot);
    } catch {
      fail("RELEASE_ARCHIVE_COPY_MISMATCH");
    }
    if (beforePromote !== undefined) await beforePromote({ incompleteRoot });
    try {
      await compareReleaseArtifactTrees(sourceRoot, incompleteRoot);
    } catch {
      fail("RELEASE_ARCHIVE_COPY_MISMATCH");
    }
    await rename(incompleteRoot, artifactRoot);
    incompleteCreated = false;
    promoted = true;
    try {
      await compareReleaseArtifactTrees(sourceRoot, artifactRoot);
    } catch {
      fail("RELEASE_ARCHIVE_COPY_MISMATCH");
    }
    return { artifactRoot, inspection: source };
  } catch (error) {
    try {
      if (incompleteCreated) await rm(incompleteRoot, { force: true, recursive: true });
      if (promoted) await rm(artifactRoot, { force: true, recursive: true });
    } catch {
      throw new ReleaseArchiveError("RELEASE_ARCHIVE_COPY_MISMATCH");
    }
    throw error instanceof ReleaseArchiveError ? error : new ReleaseArchiveError("RELEASE_ARCHIVE_COPY_MISMATCH");
  }
}

async function readBoundedText(path, maxBytes = 64 * 1024) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > maxBytes) fail("RELEASE_ARCHIVE_REPOSITORY_PIN_INVALID");
    const contents = await handle.readFile();
    if (contents.length !== fileStat.size) fail("RELEASE_ARCHIVE_REPOSITORY_PIN_INVALID");
    return contents.toString("utf8");
  } catch (error) {
    if (error instanceof ReleaseArchiveError) throw error;
    fail("RELEASE_ARCHIVE_REPOSITORY_PIN_INVALID");
  } finally {
    await handle?.close();
  }
}

async function recordControllerStep(processLedger, name, action) {
  const record = { name, pgid: null, pid: null, settled: false, status: "running", stderrBytes: 0, stdoutBytes: 0 };
  processLedger.push(record);
  try {
    const result = await action();
    record.settled = true;
    record.status = "passed";
    return result;
  } catch (error) {
    record.settled = true;
    record.status = "failed";
    throw error instanceof ReleaseArchiveError ? error : new ReleaseArchiveError("RELEASE_ARCHIVE_CONTROLLER_FAILED");
  }
}

async function createPrivateDirectory(prefix, repoRoot) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await chmod(root, 0o700);
  const physical = await realpath(root);
  if (isInside(repoRoot, physical)) fail("RELEASE_ARCHIVE_TEMPORARY_ROOT_INVALID");
  return physical;
}

async function validateCandidateDataRoot(candidateRoot) {
  if (typeof candidateRoot !== "string" || !isAbsolute(candidateRoot)) fail("RELEASE_ARCHIVE_CANDIDATE_ROOT_INVALID");
  let candidateStat;
  try {
    candidateStat = await lstat(candidateRoot);
  } catch {
    fail("RELEASE_ARCHIVE_CANDIDATE_ROOT_INVALID");
  }
  if (candidateStat.isSymbolicLink() || !candidateStat.isDirectory()) fail("RELEASE_ARCHIVE_CANDIDATE_ROOT_INVALID");
  return realpath(candidateRoot);
}

async function assertRepositoryPins(candidateRoot) {
  const [nodeVersion, packageJson] = await Promise.all([
    readBoundedText(join(candidateRoot, ".node-version")),
    readBoundedText(join(candidateRoot, "package.json")),
  ]);
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(packageJson);
  } catch {
    fail("RELEASE_ARCHIVE_REPOSITORY_PIN_INVALID");
  }
  if (nodeVersion.trim() !== NODE_VERSION.slice(1) || packageMetadata?.packageManager !== `npm@${NPM_VERSION}`) {
    fail("RELEASE_ARCHIVE_REPOSITORY_PIN_INVALID");
  }
}

async function captureToolVersion({ tools, environment, processLedger, cwd }) {
  const nodeVersion = await runIsolatedStep({
    name: "node-version",
    executable: tools.node,
    args: ["--version"],
    cwd,
    env: environment,
    processLedger,
    captureStdout: true,
  });
  const npmVersion = await runIsolatedStep({
    name: "npm-version",
    executable: tools.node,
    args: [tools.npm, "--version"],
    cwd,
    env: environment,
    processLedger,
    captureStdout: true,
  });
  if (nodeVersion.trim() !== NODE_VERSION || npmVersion.trim() !== NPM_VERSION) fail("RELEASE_ARCHIVE_TOOLCHAIN_INVALID");
}

export async function verifyReleaseArchive({
  repoRoot = process.cwd(),
  candidateRoot: suppliedCandidateRoot,
  candidateSha: suppliedCandidateSha,
  outputRoot,
  inheritedEnv = process.env,
}) {
  const physicalRepository = await realpath(repoRoot);
  const candidateDataMode = suppliedCandidateRoot !== undefined || suppliedCandidateSha !== undefined;
  if (
    (suppliedCandidateRoot === undefined) !== (suppliedCandidateSha === undefined) ||
    (suppliedCandidateSha !== undefined && !COMMIT_SHA_PATTERN.test(suppliedCandidateSha))
  ) {
    fail("RELEASE_ARCHIVE_CANDIDATE_IDENTITY_INVALID");
  }
  const retainedOutput = outputRoot === undefined
    ? await createPrivateDirectory("molroom-verified-release-", physicalRepository)
    : await validateOutputRoot({ outputRoot, repoRoot: physicalRepository });
  let archiveRoot;
  const processLedger = [];
  try {
    archiveRoot = await createPrivateDirectory("molroom-release-archive-", physicalRepository);
    const candidateRoot = candidateDataMode
      ? await validateCandidateDataRoot(suppliedCandidateRoot)
      : join(archiveRoot, "candidate");
    const homeRoot = join(archiveRoot, "home");
    const cacheRoot = join(archiveRoot, "npm-cache");
    const evidenceRoot = join(retainedOutput, "evidence");
    await Promise.all([
      ...(candidateDataMode ? [] : [mkdir(candidateRoot, { mode: 0o700 })]),
      mkdir(homeRoot, { mode: 0o700 }),
      mkdir(cacheRoot, { mode: 0o700 }),
      mkdir(evidenceRoot, { mode: 0o700 }),
    ]);
    const environment = createCredentialFreeEnvironment({ inheritedEnv, privateHome: homeRoot, cacheRoot });
    const tools = await resolveTrustedExecutables({
      repoRoot: physicalRepository,
      candidateRoot,
      inheritedPath: environment.PATH,
    });
    let commitSha = suppliedCandidateSha;
    if (!candidateDataMode) {
      commitSha = (await runIsolatedStep({
        name: "capture-head",
        executable: tools.git,
        args: ["rev-parse", "HEAD"],
        cwd: physicalRepository,
        env: environment,
        processLedger,
        captureStdout: true,
      })).trim();
      if (!COMMIT_SHA_PATTERN.test(commitSha)) fail("RELEASE_ARCHIVE_COMMIT_INVALID");
      const porcelain = await runIsolatedStep({
        name: "clean-porcelain",
        executable: tools.git,
        args: ["status", "--porcelain=v1", "-z"],
        cwd: physicalRepository,
        env: environment,
        processLedger,
        captureStdout: true,
      });
      if (porcelain.length !== 0) fail("RELEASE_ARCHIVE_WORKTREE_DIRTY");
    }
    await captureToolVersion({ tools, environment, processLedger, cwd: physicalRepository });
    if (!candidateDataMode) {
      const archiveTar = join(archiveRoot, "candidate.tar");
      await runFixedSteps({
        cwd: physicalRepository,
        env: environment,
        processLedger,
        steps: [
          { name: "git-archive", executable: tools.git, args: ["archive", "--format=tar", "--output", archiveTar, commitSha] },
          { name: "tar-extract", executable: tools.tar, args: ["-xf", archiveTar, "-C", candidateRoot] },
        ],
      });
    }
    await recordControllerStep(processLedger, "repository-pins", () => assertRepositoryPins(candidateRoot));
    const standaloneOutput = join(archiveRoot, "standalone-baseline");
    await mkdir(standaloneOutput, { mode: 0o700 });
    await recordControllerStep(
      processLedger,
      "capture-standalone",
      () => copyVerifiedArtifact({ sourceRoot: join(candidateRoot, "docs", "design-examples", "standalone"), outputRoot: standaloneOutput }),
    );
    await runFixedSteps({
      cwd: candidateRoot,
      env: environment,
      processLedger,
      steps: [
        { name: "npm-ci", executable: tools.node, args: [tools.npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund"] },
        { name: "design-build", executable: tools.node, args: ["scripts/build-design-standalone.mjs"] },
      ],
    });
    await recordControllerStep(
      processLedger,
      "standalone-compare",
      () => compareReleaseArtifactTrees(join(standaloneOutput, "artifact"), join(candidateRoot, "docs", "design-examples", "standalone")),
    );
    await runFixedSteps({
      cwd: candidateRoot,
      env: environment,
      processLedger,
      steps: [
        { name: "design-validate", executable: tools.node, args: ["scripts/validate-design-examples.mjs"] },
        { name: "vitest", executable: tools.node, args: ["node_modules/vitest/vitest.mjs", "run", "--pool=threads", "--maxWorkers=1", "--minWorkers=1"] },
        { name: "typecheck", executable: tools.node, args: ["node_modules/typescript/bin/tsc", "-b", "--noEmit"] },
        { name: "vite-build", executable: tools.node, args: ["node_modules/vite/bin/vite.js", "build"] },
        { name: "bundle-scan", executable: tools.node, args: ["scripts/scan-production-bundle.mjs", "dist"] },
        { name: "readme-parity", executable: tools.node, args: ["scripts/validate-readmes.mjs"] },
      ],
    });
    const retained = await recordControllerStep(
      processLedger,
      "retain-artifact",
      () => copyVerifiedArtifact({ sourceRoot: join(candidateRoot, "dist"), outputRoot: retainedOutput }),
    );
    const receipt = `${JSON.stringify(createArchiveReceipt({
      candidateSha: commitSha,
      inspection: retained.inspection,
      npmVersion: NPM_VERSION,
      steps: processLedger,
    }), null, 2)}\n`;
    await writeFile(join(evidenceRoot, "steps.json"), `${JSON.stringify(processLedger.map(({ name, status }) => ({ name, status })), null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(join(retainedOutput, "receipt.json"), receipt, { flag: "wx", mode: 0o600 });
    return {
      artifactPath: retained.artifactRoot,
      outputRoot: retainedOutput,
      receiptPath: join(retainedOutput, "receipt.json"),
    };
  } catch (error) {
    let failure = error instanceof ReleaseArchiveError ? error : new ReleaseArchiveError("RELEASE_ARCHIVE_FAILED");
    const evidencePath = join(retainedOutput, "evidence", "steps.json");
    try {
      const evidenceRoot = join(retainedOutput, "evidence");
      await mkdir(evidenceRoot, { mode: 0o700, recursive: true });
      await writeFile(evidencePath, `${JSON.stringify(processLedger.map(({ name, status }) => ({ name, status })), null, 2)}\n`, {
        flag: "w",
        mode: 0o600,
      });
    } catch {
      failure = new ReleaseArchiveError("RELEASE_ARCHIVE_EVIDENCE_FAILED");
    }
    failure.evidencePath = evidencePath;
    failure.outputRoot = retainedOutput;
    throw failure;
  } finally {
    if (archiveRoot !== undefined) await rm(archiveRoot, { force: true, recursive: true });
  }
}
