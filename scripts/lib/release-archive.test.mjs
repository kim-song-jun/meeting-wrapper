import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { inspectReleaseArtifactTree } from "./release-manifest.mjs";
import {
  ReleaseArchiveError,
  copyVerifiedArtifact,
  createCredentialFreeEnvironment,
  parseReleaseArchiveArguments,
  resolveTrustedExecutables,
  runFixedSteps,
  runIsolatedStep,
  validateOutputRoot,
  verifyReleaseArchive,
} from "./release-archive.mjs";

const temporaryRoots = [];
const verifyReleaseArchiveCli = fileURLToPath(new URL("../verify-release-archive.mjs", import.meta.url));

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

async function command(executablePath, args, cwd) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(executablePath, args, { cwd, stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error(`test command failed: ${executablePath}`));
    });
  });
}

async function commandResult(executablePath, args, cwd, env = undefined) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executablePath, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolvePromise({
        code,
        signal,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

async function eventuallyAbsent(pid) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`owned process survived cleanup: ${pid}`);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("release archive controller boundaries", () => {
  it("accepts only the automation output-root option shape", () => {
    expect(parseReleaseArchiveArguments([])).toEqual({ candidateRoot: undefined, candidateSha: undefined, outputRoot: undefined });
    expect(parseReleaseArchiveArguments(["--output-root", "/private/tmp/output"])).toEqual({
      candidateRoot: undefined,
      candidateSha: undefined,
      outputRoot: "/private/tmp/output",
    });
    expect(parseReleaseArchiveArguments([
      "--candidate-root", "/work/candidate",
      "--candidate-sha", "0123456789abcdef0123456789abcdef01234567",
      "--output-root", "/output",
    ])).toEqual({
      candidateRoot: "/work/candidate",
      candidateSha: "0123456789abcdef0123456789abcdef01234567",
      outputRoot: "/output",
    });
    for (const arguments_ of [
      ["--unknown"],
      ["--output-root"],
      ["--output-root", "/tmp/a", "--output-root", "/tmp/b"],
      ["--output-root=/tmp/a"],
      ["--candidate-root", "/work/candidate", "--output-root", "/output"],
      ["--candidate-sha", "0123456789abcdef0123456789abcdef01234567", "--output-root", "/output"],
    ]) {
      expect(() => parseReleaseArchiveArguments(arguments_)).toThrow(ReleaseArchiveError);
    }
  });

  it("rejects relative, repository-contained, symlinked, missing, and nonempty output roots", async () => {
    const root = await temporaryRoot("molroom-release-output-");
    const repoRoot = join(root, "repo");
    const empty = join(root, "empty");
    const nonempty = join(root, "nonempty");
    const link = join(root, "link");
    await Promise.all([mkdir(repoRoot), mkdir(empty), mkdir(nonempty)]);
    await writeFile(join(nonempty, "present"), "x");
    await symlink(empty, link);
    await chmod(empty, 0o755);

    await expect(validateOutputRoot({ outputRoot: "relative", repoRoot })).rejects.toThrow(ReleaseArchiveError);
    await expect(validateOutputRoot({ outputRoot: join(repoRoot, "output"), repoRoot })).rejects.toThrow(ReleaseArchiveError);
    await expect(validateOutputRoot({ outputRoot: join(root, "missing"), repoRoot })).rejects.toThrow(ReleaseArchiveError);
    await expect(validateOutputRoot({ outputRoot: nonempty, repoRoot })).rejects.toThrow(ReleaseArchiveError);
    await expect(validateOutputRoot({ outputRoot: link, repoRoot })).rejects.toThrow(ReleaseArchiveError);
    await expect(validateOutputRoot({ outputRoot: empty, repoRoot })).resolves.toEqual(await realpath(empty));
    expect((await stat(empty)).mode & 0o777).toBe(0o700);
  });

  it("uses the supplied candidate SHA and rejects candidate data at the trusted repository-pin boundary", async () => {
    const root = await temporaryRoot("molroom-release-candidate-data-");
    const candidateRoot = join(root, "candidate");
    const outputRoot = join(root, "output");
    await Promise.all([mkdir(candidateRoot), mkdir(outputRoot)]);
    await writeFile(join(candidateRoot, ".node-version"), "not-the-pinned-version\n");
    await writeFile(join(candidateRoot, "package.json"), `${JSON.stringify({ packageManager: "npm@11.17.0" })}\n`);

    await expect(verifyReleaseArchive({
      candidateRoot,
      candidateSha: "0123456789abcdef0123456789abcdef01234567",
      inheritedEnv: { PATH: process.env.PATH ?? "" },
      outputRoot,
      repoRoot: candidateRoot,
    })).rejects.toMatchObject({ code: "RELEASE_ARCHIVE_REPOSITORY_PIN_INVALID" });
  });

  it("passes exactly the four allowed public VITE values to a real child and never retains child output in redacted evidence", async () => {
    const root = await temporaryRoot("molroom-release-environment-");
    const observed = join(root, "observed.json");
    const child = await executable(join(root, "child.mjs"), [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.argv[2], JSON.stringify({ deployment: process.env.VITE_DEPLOYMENT, adapter: process.env.VITE_ADAPTER, clientId: process.env.VITE_GOOGLE_CLIENT_ID, public: process.env.VITE_ALLOWED_HD, unrelated: process.env.VITE_UNRELATED, aws: process.env.AWS_SECRET_ACCESS_KEY, github: process.env.GITHUB_TOKEN, npm: process.env.npm_config__auth, nodeOptions: process.env.NODE_OPTIONS }));',
      'process.stdout.write("child-sentinel-stdout");',
      'process.stderr.write("child-sentinel-stderr");',
      "process.exit(17);",
    ].join("\n"));
    const environment = createCredentialFreeEnvironment({
      inheritedEnv: {
        PATH: process.env.PATH ?? "",
        VITE_ADAPTER: "google",
        VITE_ALLOWED_HD: "molcube.com",
        VITE_DEPLOYMENT: "production",
        VITE_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        VITE_UNRELATED: "must-not-cross-the-boundary",
        AWS_SECRET_ACCESS_KEY: "aws-sentinel",
        GITHUB_TOKEN: "github-sentinel",
        npm_config__auth: "npm-sentinel",
        NODE_OPTIONS: "--require=sentinel",
        HTTPS_PROXY: "proxy-sentinel",
      },
      privateHome: join(root, "home"),
      cacheRoot: join(root, "cache"),
    });
    const ledger = [];

    await expect(
      runIsolatedStep({
        name: "sentinel-child",
        executable: process.execPath,
        args: [child, observed],
        cwd: root,
        env: environment,
        processLedger: ledger,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "RELEASE_ARCHIVE_STEP_FAILED" });

    expect(JSON.parse(await readFile(observed, "utf8"))).toEqual({
      adapter: "google",
      clientId: "client.apps.googleusercontent.com",
      deployment: "production",
      public: "molcube.com",
    });
    expect(Object.keys(environment).filter((key) => key.startsWith("VITE_")).sort()).toEqual([
      "VITE_ADAPTER",
      "VITE_ALLOWED_HD",
      "VITE_DEPLOYMENT",
      "VITE_GOOGLE_CLIENT_ID",
    ]);
    const redactedEvidence = JSON.stringify(ledger);
    for (const sentinel of ["child-sentinel-stdout", "child-sentinel-stderr", "aws-sentinel", "github-sentinel", "npm-sentinel", "proxy-sentinel"]) {
      expect(redactedEvidence).not.toContain(sentinel);
    }
  });

  it("returns only a sanitized retained-output and evidence location on a public CLI failure", async () => {
    const root = await temporaryRoot("molroom-release-cli-failure-");
    const repository = join(root, "repository");
    const outputRoot = join(root, "retained-output");
    await Promise.all([mkdir(repository), mkdir(outputRoot)]);
    await writeFile(join(repository, "placeholder"), "placeholder");
    await command("git", ["init", "--quiet"], repository);
    await command("git", ["config", "user.email", "release-test@example.invalid"], repository);
    await command("git", ["config", "user.name", "Release test"], repository);
    await command("git", ["add", "placeholder"], repository);
    await command("git", ["commit", "--quiet", "-m", "initial"], repository);

    const result = await commandResult(
      process.execPath,
      [verifyReleaseArchiveCli, "--output-root", outputRoot],
      repository,
      { PATH: process.env.PATH ?? "" },
    );
    const parsed = JSON.parse(result.stdout);
    const physicalOutput = await realpath(outputRoot);

    expect(result).toMatchObject({ code: 1, signal: null, stderr: "" });
    expect(parsed).toEqual({
      evidence_path: join(physicalOutput, "evidence", "steps.json"),
      output_root: physicalOutput,
      schema_version: 1,
      status: "failed",
    });
    await expect(readFile(parsed.evidence_path, "utf8")).resolves.toContain("capture-head");
    expect(result.stdout).not.toContain("RELEASE_ARCHIVE_");
  });

  it("keeps a PATH-shadowed node from interpreting the trusted npm CLI", async () => {
    const root = await temporaryRoot("molroom-release-npm-interpreter-");
    const repository = join(root, "repository");
    const outputRoot = join(root, "output");
    const fakeBin = join(root, "fake-bin");
    const fakeNodeMarker = join(root, "fake-node-used");
    await Promise.all([mkdir(repository), mkdir(outputRoot), mkdir(fakeBin)]);
    await writeFile(join(repository, "placeholder"), "placeholder");
    await command("git", ["init", "--quiet"], repository);
    await command("git", ["config", "user.email", "release-test@example.invalid"], repository);
    await command("git", ["config", "user.name", "Release test"], repository);
    await command("git", ["add", "placeholder"], repository);
    await command("git", ["commit", "--quiet", "-m", "initial"], repository);
    await executable(join(fakeBin, "node"), [
      "#!/bin/sh",
      `printf 'fake-node-used\\n' > ${JSON.stringify(fakeNodeMarker)}`,
      "printf '11.17.0\\n'",
    ].join("\n"));

    await expect(verifyReleaseArchive({
      repoRoot: repository,
      outputRoot,
      inheritedEnv: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    })).rejects.toMatchObject({ code: "RELEASE_ARCHIVE_REPOSITORY_PIN_INVALID" });
    await expect(readFile(fakeNodeMarker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resolves physical tools outside a repository even when that repository shadows PATH", async () => {
    const root = await temporaryRoot("molroom-release-tools-");
    const repository = join(root, "repository");
    const shadow = join(repository, "bin");
    await mkdir(shadow, { recursive: true });
    for (const name of ["git", "npm", "tar"]) {
      await executable(join(shadow, name), "#!/bin/sh\nexit 99\n");
    }

    const tools = await resolveTrustedExecutables({
      repoRoot: repository,
      candidateRoot: join(root, "candidate"),
      inheritedPath: `${shadow}:${process.env.PATH ?? ""}`,
      nodePath: process.execPath,
    });
    for (const path of Object.values(tools)) expect(path.startsWith(repository)).toBe(false);
  });

  it("kills an owned process group and its real grandchild after a failing child", async () => {
    const root = await temporaryRoot("molroom-release-process-");
    const pidPath = join(root, "grandchild.pid");
    const child = await executable(join(root, "spawner.mjs"), [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      "writeFileSync(process.argv[2], String(grandchild.pid));",
      "setTimeout(() => process.exit(23), 25);",
    ].join("\n"));
    const ledger = [];

    await expect(
      runIsolatedStep({
        name: "grandchild-cleanup",
        executable: process.execPath,
        args: [child, pidPath],
        cwd: root,
        env: { PATH: process.env.PATH ?? "" },
        processLedger: ledger,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "RELEASE_ARCHIVE_STEP_FAILED" });

    await eventuallyAbsent(Number(await readFile(pidPath, "utf8")));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ name: "grandchild-cleanup", settled: true });
  });

  it("cannot let an early-success child skip the controller's following fixed step", async () => {
    const root = await temporaryRoot("molroom-release-order-");
    const marker = join(root, "following-step-ran");
    const early = await executable(join(root, "early.mjs"), "process.exit(0);\n");
    const following = await executable(join(root, "following.mjs"), [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.argv[2], "ran");',
    ].join("\n"));

    await runFixedSteps({
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      processLedger: [],
      steps: [
        { name: "early", executable: process.execPath, args: [early] },
        { name: "following", executable: process.execPath, args: [following, marker] },
      ],
    });

    await expect(readFile(marker, "utf8")).resolves.toBe("ran");
  });

  it("copies only the inspected archive tree, detects a copy race, and retains an independently reinspectable artifact", async () => {
    const root = await temporaryRoot("molroom-release-copy-");
    const sharedDist = join(root, "shared-dist");
    const outputRoot = join(root, "output");
    await Promise.all([mkdir(join(sharedDist, "assets"), { recursive: true }), mkdir(outputRoot)]);
    await writeFile(join(sharedDist, "index.html"), "archive-index");
    await writeFile(join(sharedDist, "assets", "app-a1b2c3d4.js"), "archive-app");
    const before = await inspectReleaseArtifactTree({ artifactRoot: sharedDist });

    const retained = await copyVerifiedArtifact({ sourceRoot: sharedDist, outputRoot });
    const after = await inspectReleaseArtifactTree({ artifactRoot: retained.artifactRoot });
    expect(after.treeSha256).toBe(before.treeSha256);
    expect(await readFile(join(sharedDist, "index.html"), "utf8")).toBe("archive-index");
    await expect(inspectReleaseArtifactTree({ artifactRoot: retained.artifactRoot })).resolves.toMatchObject({
      treeSha256: before.treeSha256,
    });

    const racingOutput = join(root, "racing-output");
    await mkdir(racingOutput);
    await expect(
      copyVerifiedArtifact({
        sourceRoot: sharedDist,
        outputRoot: racingOutput,
        beforePromote: async ({ incompleteRoot }) => writeFile(join(incompleteRoot, "index.html"), "raced-byte"),
      }),
    ).rejects.toMatchObject({ code: "RELEASE_ARCHIVE_COPY_MISMATCH" });
  });

  it("fails closed on missing, symlinked, control-named, and oversized artifact input", async () => {
    const root = await temporaryRoot("molroom-release-hostile-input-");
    const outputRoot = join(root, "output");
    const symlinked = join(root, "symlinked");
    const controlNamed = join(root, "control-named");
    const oversized = join(root, "oversized");
    await Promise.all([mkdir(outputRoot), mkdir(symlinked), mkdir(controlNamed), mkdir(oversized)]);

    await expect(copyVerifiedArtifact({ sourceRoot: join(root, "missing-dist"), outputRoot })).rejects.toMatchObject({
      code: "RELEASE_ARCHIVE_COPY_MISMATCH",
    });

    await writeFile(join(symlinked, "index.html"), "index");
    await symlink(join(symlinked, "index.html"), join(symlinked, "linked.html"));
    await expect(inspectReleaseArtifactTree({ artifactRoot: symlinked })).rejects.toThrow("symbolic link");

    await writeFile(join(controlNamed, "index.html"), "index");
    await writeFile(join(controlNamed, "bad\nname"), "x");
    await expect(inspectReleaseArtifactTree({ artifactRoot: controlNamed })).rejects.toThrow("Unsafe release artifact name");

    await writeFile(join(oversized, "index.html"), "large");
    await expect(inspectReleaseArtifactTree({
      artifactRoot: oversized,
      artifactLimits: { maxFileBytes: 4, maxTotalBytes: 4 },
    })).rejects.toThrow("per-file byte limit");
  });
});
