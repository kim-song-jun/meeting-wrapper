import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const subjectUrl = pathToFileURL(join(repositoryRoot, "scripts/lib/security-attestation.mjs")).href;
const cliPath = join(repositoryRoot, "scripts/build-security-attestation.mjs");
const workflowPath = join(repositoryRoot, ".github/workflows/security-gate.yml");
const targetSha = "a".repeat(40);
const temporaryRoots = [];

async function loadSubject() {
  return import(subjectUrl);
}

function manualReview(overrides = {}) {
  return {
    schema_version: 1,
    kind: "manual-threat-review",
    status: "COMPLETED",
    target_sha: targetSha,
    completed_at: "2026-08-24T00:00:00.000Z",
    critical_count: 0,
    high_count: 0,
    redacted_finding_ids: ["SEC-003", "SEC-001"],
    ...overrides,
  };
}

function deepSecurityScan(overrides = {}) {
  return {
    schema_version: 1,
    kind: "deep-security-scan",
    status: "COMPLETED",
    target_sha: targetSha,
    completed_at: "2026-08-24T01:00:00.000Z",
    scan_tool: "openai/deep-security-scan",
    scan_version: "2026.08.24+official",
    critical_count: 0,
    high_count: 0,
    redacted_finding_ids: ["SEC-002", "SEC-001"],
    ...overrides,
  };
}

async function makeReportFiles({ manual = manualReview(), deep = deepSecurityScan() } = {}) {
  const root = await mkdtemp(join(tmpdir(), "molroom-security-attestation-"));
  temporaryRoots.push(root);
  const manualReviewPath = join(root, "manual-review.json");
  const deepSecurityScanPath = join(root, "deep-scan.json");
  const manualBytes = Buffer.from(`${JSON.stringify(manual, null, 2)}\n`);
  const deepBytes = Buffer.from(`${JSON.stringify(deep, null, 2)}\n`);
  await writeFile(manualReviewPath, manualBytes, { mode: 0o600 });
  await writeFile(deepSecurityScanPath, deepBytes, { mode: 0o600 });
  return { root, manualReviewPath, deepSecurityScanPath, manualBytes, deepBytes };
}

async function buildFromFiles(files, overrides = {}) {
  const { buildSecurityAttestation } = await loadSubject();
  return buildSecurityAttestation({
    targetSha,
    manualReviewPath: files.manualReviewPath,
    deepSecurityScanPath: files.deepSecurityScanPath,
    ...overrides,
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseWorkflowInputKeys(workflow) {
  const match = workflow.match(/const allowedKeys = \[([\s\S]*?)\]\.sort\(\);/);
  if (!match) throw new Error("security-gate workflow allowedKeys contract was not found");
  return [...match[1].matchAll(/"([a-z0-9_]+)"/g)].map((entry) => entry[1]).sort();
}

async function expectCategory(promise, category) {
  await expect(promise).rejects.toMatchObject({ name: "SecurityAttestationError", category });
}

function runCli(arguments_, { cwd = repositoryRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...arguments_], {
      cwd,
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("security attestation canonical contract", () => {
  it("builds the exact deterministic redacted payload and digests the exact report bytes", async () => {
    const files = await makeReportFiles();
    const result = await buildFromFiles(files);
    const expected = {
      schema_version: 1,
      target_sha: targetSha,
      manual_review_sha256: sha256(files.manualBytes),
      deep_security_scan_sha256: sha256(files.deepBytes),
      scan_tool: "openai/deep-security-scan",
      scan_version: "2026.08.24+official",
      completed_at: "2026-08-24T01:00:00.000Z",
      critical_count: 0,
      high_count: 0,
      redacted_finding_ids: ["SEC-001", "SEC-002", "SEC-003"],
    };

    expect(result.attestation).toEqual(expected);
    expect(result.json).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    expect(result.base64).toBe(Buffer.from(result.json, "utf8").toString("base64"));
    expect(Buffer.from(result.base64, "base64").toString("base64")).toBe(result.base64);
    expect(Buffer.byteLength(result.json)).toBeLessThanOrEqual(32 * 1024);

    const repeated = await buildFromFiles(files);
    expect(repeated).toEqual(result);
  });

  it("matches the security-gate workflow's actual exact producer input key set", async () => {
    const files = await makeReportFiles();
    const { attestation } = await buildFromFiles(files);
    const workflowKeys = parseWorkflowInputKeys(await readFile(workflowPath, "utf8"));
    expect(workflowKeys).toHaveLength(10);
    expect(Object.keys(attestation).sort()).toEqual(workflowKeys);
  });

  it("does not disclose either local report path or source-report-only metadata", async () => {
    const files = await makeReportFiles();
    const { json } = await buildFromFiles(files);
    expect(json).not.toContain(files.root);
    expect(json).not.toContain('"kind"');
    expect(json).not.toContain('"status"');
  });

  it("uses the later canonical completion timestamp regardless of report argument order", async () => {
    const files = await makeReportFiles({
      manual: manualReview({ completed_at: "2026-08-24T03:00:00.000Z" }),
      deep: deepSecurityScan({ completed_at: "2026-08-24T02:00:00.000Z" }),
    });
    const { attestation } = await buildFromFiles(files);
    expect(attestation.completed_at).toBe("2026-08-24T03:00:00.000Z");
  });

  it("fails closed when the canonical output would exceed 32 KiB", async () => {
    const ids = Array.from({ length: 256 }, (_, index) =>
      `S${String(index).padStart(3, "0")}-${"x".repeat(123)}`,
    );
    const files = await makeReportFiles({
      manual: manualReview({ redacted_finding_ids: ids.slice(0, 128) }),
      deep: deepSecurityScan({ redacted_finding_ids: ids.slice(128) }),
    });
    await expectCategory(buildFromFiles(files), "ATTESTATION_TOO_LARGE");
  });
});

describe("security attestation report validation", () => {
  it.each([
    ["manual critical", manualReview({ critical_count: 1 }), deepSecurityScan()],
    ["manual high", manualReview({ high_count: 1 }), deepSecurityScan()],
    ["scan critical", manualReview(), deepSecurityScan({ critical_count: 1 })],
    ["scan high", manualReview(), deepSecurityScan({ high_count: 1 })],
  ])("rejects nonzero Critical/High findings from %s", async (_name, manual, deep) => {
    const files = await makeReportFiles({ manual, deep });
    await expectCategory(buildFromFiles(files), "SECURITY_FINDINGS_PRESENT");
  });

  it.each([
    ["manual target", manualReview({ target_sha: "b".repeat(40) }), deepSecurityScan()],
    ["scan target", manualReview(), deepSecurityScan({ target_sha: "b".repeat(40) })],
  ])("rejects a mismatched exact candidate SHA in the %s", async (_name, manual, deep) => {
    const files = await makeReportFiles({ manual, deep });
    await expectCategory(buildFromFiles(files), "TARGET_SHA_MISMATCH");
  });

  it.each([
    ["short", "a".repeat(39)],
    ["uppercase", "A".repeat(40)],
    ["non-hex", "z".repeat(40)],
  ])("rejects an invalid %s target SHA before reading reports", async (_name, invalidSha) => {
    const files = await makeReportFiles();
    await expectCategory(buildFromFiles(files, { targetSha: invalidSha }), "INVALID_TARGET_SHA");
  });

  it.each([
    ["manual status", manualReview({ status: "IN_PROGRESS" }), deepSecurityScan()],
    ["scan status", manualReview(), deepSecurityScan({ status: "IN_PROGRESS" })],
    ["manual kind", manualReview({ kind: "deep-security-scan" }), deepSecurityScan()],
    ["scan kind", manualReview(), deepSecurityScan({ kind: "manual-threat-review" })],
    ["manual schema", manualReview({ schema_version: 2 }), deepSecurityScan()],
    ["scan schema", manualReview(), deepSecurityScan({ schema_version: 2 })],
  ])("rejects an incomplete or wrong-shape %s", async (_name, manual, deep) => {
    const files = await makeReportFiles({ manual, deep });
    await expectCategory(buildFromFiles(files), "INVALID_REPORT_SHAPE");
  });

  it.each([
    ["noncanonical manual timestamp", manualReview({ completed_at: "2026-08-24T00:00:00Z" }), deepSecurityScan()],
    ["offset scan timestamp", manualReview(), deepSecurityScan({ completed_at: "2026-08-24T10:00:00+09:00" })],
    ["impossible manual timestamp", manualReview({ completed_at: "2026-02-30T00:00:00.000Z" }), deepSecurityScan()],
    ["invalid scan tool", manualReview(), deepSecurityScan({ scan_tool: "scan tool" })],
    ["invalid scan version", manualReview(), deepSecurityScan({ scan_version: "version/one" })],
  ])("rejects %s", async (_name, manual, deep) => {
    const files = await makeReportFiles({ manual, deep });
    await expectCategory(buildFromFiles(files), "INVALID_REPORT_SHAPE");
  });

  it("rejects unknown report fields even when they are not sensitive", async () => {
    const files = await makeReportFiles({ manual: manualReview({ notes: [] }) });
    await expectCategory(buildFromFiles(files), "INVALID_REPORT_SHAPE");
  });

  it.each([
    ["access token", { access_token: "ya29.redacted-but-still-forbidden" }],
    ["authorization header", { authorization: "Bearer abcdefghijklmnop" }],
    ["OAuth client ID", { client_id: "123456789012-example.apps.googleusercontent.com" }],
    ["email", { reviewer_email: "person@example.com" }],
    ["PII title", { title: "Security review for Person" }],
    ["request ID", { request_id: "request-123" }],
    ["operation ID", { operation_id: "operation-123" }],
    ["event ID", { event_id: "event-123" }],
    ["provider payload", { provider_payload: { response: "opaque" } }],
    ["raw finding text", { description: "full vulnerability narrative" }],
    ["absolute POSIX path", { report_location: "/Users/person/private/report.json" }],
    ["relative local path", { report_location: "../private/report.json" }],
    ["Windows local path", { report_location: "C:\\Users\\person\\report.json" }],
  ])("rejects %s anywhere in a source report", async (_name, forbidden) => {
    const files = await makeReportFiles({ deep: deepSecurityScan(forbidden) });
    await expectCategory(buildFromFiles(files), "SENSITIVE_REPORT_MATERIAL");
  });

  it.each(["request-123", "operation:123", "event.123"])(
    "rejects provider correlation identifiers masquerading as redacted finding IDs: %s",
    async (identifier) => {
      const files = await makeReportFiles({
        deep: deepSecurityScan({ redacted_finding_ids: [identifier] }),
      });
      await expectCategory(buildFromFiles(files), "SENSITIVE_REPORT_MATERIAL");
    },
  );

  it("rejects malformed and duplicate-key JSON without accepting the last value", async () => {
    const files = await makeReportFiles();
    const duplicate = JSON.stringify(manualReview()).replace(
      `"target_sha":"${targetSha}"`,
      `"target_sha":"${targetSha}","target_sha":"${"b".repeat(40)}"`,
    );
    await writeFile(files.manualReviewPath, duplicate, { mode: 0o600 });
    await expectCategory(buildFromFiles(files), "DUPLICATE_JSON_KEY");
  });

  it("rejects excessive JSON nesting before traversing the report", async () => {
    const files = await makeReportFiles();
    const nested = `${"[".repeat(66)}null${"]".repeat(66)}`;
    await writeFile(files.manualReviewPath, nested, { mode: 0o600 });
    await expectCategory(buildFromFiles(files), "JSON_NESTING_TOO_DEEP");
  });

  it("rejects non-UTF-8 source bytes using a fatal decoder", async () => {
    const files = await makeReportFiles();
    await writeFile(files.manualReviewPath, Buffer.from([0xc3, 0x28]), { mode: 0o600 });
    await expectCategory(buildFromFiles(files), "INVALID_REPORT_UTF8");
  });

  it("rejects a source report above the 32 KiB cap", async () => {
    const files = await makeReportFiles();
    await writeFile(files.manualReviewPath, Buffer.alloc(32 * 1024 + 1, 0x20), { mode: 0o600 });
    await expectCategory(buildFromFiles(files), "REPORT_TOO_LARGE");
  });

  it("rejects more than 256 redacted finding IDs", async () => {
    const files = await makeReportFiles({
      deep: deepSecurityScan({
        redacted_finding_ids: Array.from({ length: 257 }, (_, index) => `SEC-${index}`),
      }),
    });
    await expectCategory(buildFromFiles(files), "INVALID_REPORT_SHAPE");
  });
});

describe("bounded descriptor reader", () => {
  it("opens reports read-only with O_NOFOLLOW and O_NONBLOCK", async () => {
    const { readSecurityReport } = await loadSubject();
    const snapshots = [
      { dev: 1n, ino: 2n, mode: 0o100600n, nlink: 1n, uid: 1n, gid: 1n, size: 2n, mtimeNs: 3n, ctimeNs: 4n, isFile: () => true },
      { dev: 1n, ino: 2n, mode: 0o100600n, nlink: 1n, uid: 1n, gid: 1n, size: 2n, mtimeNs: 3n, ctimeNs: 4n, isFile: () => true },
    ];
    const calls = [];
    const handle = {
      stat: async () => snapshots.shift(),
      read: async (buffer, offset) => {
        buffer[offset] = 0x7b;
        buffer[offset + 1] = 0x7d;
        return { bytesRead: 2, buffer };
      },
      close: async () => {},
    };
    const openFile = async (...arguments_) => {
      calls.push(arguments_);
      return handle;
    };

    const result = await readSecurityReport("controlled-report", { source: "manual_review", openFile });
    expect(result.text).toBe("{}");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("controlled-report");
    expect(calls[0][1]).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  });

  it("preserves the primary read failure when descriptor close also fails", async () => {
    const { readSecurityReport } = await loadSubject();
    const metadata = { dev: 1n, ino: 2n, mode: 0o100600n, nlink: 1n, uid: 1n, gid: 1n, size: 1n, mtimeNs: 3n, ctimeNs: 4n, isFile: () => true };
    const openFile = async () => ({
      stat: async () => metadata,
      read: async () => { throw Object.assign(new Error("raw path must not escape"), { code: "EIO" }); },
      close: async () => { throw new Error("close failed"); },
    });
    const promise = readSecurityReport("/private/report.json", { source: "manual_review", openFile });
    await expectCategory(promise, "REPORT_PATH_NOT_READABLE");
    await expect(promise).rejects.not.toThrow("/private/report.json");
  });

  it("reports a close-only failure without silently accepting it", async () => {
    const { readSecurityReport } = await loadSubject();
    const metadata = { dev: 1n, ino: 2n, mode: 0o100600n, nlink: 1n, uid: 1n, gid: 1n, size: 0n, mtimeNs: 3n, ctimeNs: 4n, isFile: () => true };
    const openFile = async () => ({
      stat: async () => metadata,
      read: async () => ({ bytesRead: 0 }),
      close: async () => { throw new Error("close failed"); },
    });
    await expectCategory(
      readSecurityReport("controlled-report", { source: "manual_review", openFile }),
      "REPORT_PATH_CLOSE_FAILED",
    );
  });

  it("rejects a descriptor whose identity or size changes across the read", async () => {
    const { readSecurityReport } = await loadSubject();
    const before = { dev: 1n, ino: 2n, mode: 0o100600n, nlink: 1n, uid: 1n, gid: 1n, size: 1n, mtimeNs: 3n, ctimeNs: 4n, isFile: () => true };
    const after = { ...before, ino: 5n };
    const snapshots = [before, after];
    const openFile = async () => ({
      stat: async () => snapshots.shift(),
      read: async (buffer, offset) => {
        buffer[offset] = 0x7b;
        return { bytesRead: 1, buffer };
      },
      close: async () => {},
    });
    await expectCategory(
      readSecurityReport("controlled-report", { source: "manual_review", openFile }),
      "REPORT_CHANGED_DURING_READ",
    );
  });

  it("rejects symlinks and non-regular paths without leaking their names", async () => {
    const files = await makeReportFiles();
    const linkPath = join(files.root, "manual-link.json");
    await symlink(files.manualReviewPath, linkPath);
    const symlinkPromise = buildFromFiles({ ...files, manualReviewPath: linkPath });
    await expectCategory(symlinkPromise, "REPORT_PATH_NOT_READABLE");
    await expect(symlinkPromise).rejects.not.toThrow(linkPath);

    const directoryPath = join(files.root, "directory-report");
    await mkdir(directoryPath);
    const directoryPromise = buildFromFiles({ ...files, manualReviewPath: directoryPath });
    await expectCategory(directoryPromise, "REPORT_PATH_NOT_REGULAR");
  });
});

describe("security attestation file and CLI handoff", () => {
  it("writes a new 0600 output exactly once and never overwrites existing evidence", async () => {
    const files = await makeReportFiles();
    const outputPath = join(files.root, "security-gate-attestation.json");
    const { writeSecurityAttestation } = await loadSubject();
    const first = await writeSecurityAttestation({
      targetSha,
      manualReviewPath: files.manualReviewPath,
      deepSecurityScanPath: files.deepSecurityScanPath,
      outputPath,
    });
    expect(await readFile(outputPath, "utf8")).toBe(first.json);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);

    await expectCategory(
      writeSecurityAttestation({
        targetSha,
        manualReviewPath: files.manualReviewPath,
        deepSecurityScanPath: files.deepSecurityScanPath,
        outputPath,
      }),
      "OUTPUT_ALREADY_EXISTS",
    );
    expect(await readFile(outputPath, "utf8")).toBe(first.json);
  });

  it("prints only canonical base64 and writes bytes accepted by that handoff", async () => {
    const files = await makeReportFiles();
    const outputPath = join(files.root, "security-gate-attestation.json");
    const result = await runCli([
      "--target-sha", targetSha,
      "--manual-review", files.manualReviewPath,
      "--deep-security-scan", files.deepSecurityScanPath,
      "--output", outputPath,
    ]);
    expect(result).toMatchObject({ code: 0, signal: null, stderr: "" });
    expect(result.stdout).toMatch(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\n$/);
    const encoded = result.stdout.trimEnd();
    const output = await readFile(outputPath);
    expect(Buffer.from(encoded, "base64")).toEqual(output);
    expect(output.toString("base64")).toBe(encoded);
  });

  it("fails closed on incomplete CLI arguments without writing a default file", async () => {
    const files = await makeReportFiles();
    const result = await runCli(["--target-sha", targetSha], { cwd: files.root });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("INVALID_ARGUMENTS source=cli\n");
    await expect(access(join(files.root, "security-gate-attestation.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not expose report paths when the CLI rejects unsafe evidence", async () => {
    const files = await makeReportFiles({ deep: deepSecurityScan({ reviewer_email: "person@example.com" }) });
    const outputPath = join(files.root, "security-gate-attestation.json");
    const result = await runCli([
      "--target-sha", targetSha,
      "--manual-review", files.manualReviewPath,
      "--deep-security-scan", files.deepSecurityScanPath,
      "--output", outputPath,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("SENSITIVE_REPORT_MATERIAL source=deep_security_scan\n");
    expect(result.stderr).not.toContain(files.root);
  });
});
