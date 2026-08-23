import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";

export const MAX_SECURITY_ATTESTATION_BYTES = 32 * 1024;

export const SECURITY_ATTESTATION_KEYS = Object.freeze([
  "schema_version",
  "target_sha",
  "manual_review_sha256",
  "deep_security_scan_sha256",
  "scan_tool",
  "scan_version",
  "completed_at",
  "critical_count",
  "high_count",
  "redacted_finding_ids",
]);

const MANUAL_REVIEW_KEYS = Object.freeze([
  "schema_version",
  "kind",
  "status",
  "target_sha",
  "completed_at",
  "critical_count",
  "high_count",
  "redacted_finding_ids",
]);

const DEEP_SECURITY_SCAN_KEYS = Object.freeze([
  ...MANUAL_REVIEW_KEYS,
  "scan_tool",
  "scan_version",
]);

const SAFE_SOURCES = new Set(["attestation", "cli", "deep_security_scan", "manual_review", "output"]);
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const FINDING_ID_PATTERN = /^[0-9A-Za-z._:-]{1,128}$/;
const SCAN_TOOL_PATTERN = /^[0-9A-Za-z._/-]{1,64}$/;
const SCAN_VERSION_PATTERN = /^[0-9A-Za-z._+-]{1,64}$/;
const CORRELATION_ID_PATTERN = /^(?:request|operation|event)(?:[-._:]|$)/i;
const LOCAL_PATH_PATTERN = /^(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|file:\/\/|\/)/;
const URL_QUERY_PATTERN = /^https?:\/\/[^\s?#]+\?[^\s#]+$/i;
const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /\bBearer\s+\S+/i,
  /\bya29\.[A-Za-z0-9_-]+/,
  /\bGOCSPX-[A-Za-z0-9_-]+/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b\d{6,}-[a-z0-9_-]+\.apps\.googleusercontent\.com\b/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/,
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/,
]);
const FORBIDDEN_KEY_PATTERNS = Object.freeze([
  /(?:^|access|refresh|session|oauth|auth)token$/,
  /authorization/,
  /clientid/,
  /clientsecret/,
  /cookie/,
  /privatekey/,
  /secretaccesskey/,
  /(?:^|_)secret$/,
  /email/,
  /displayname/,
  /givenname/,
  /familyname/,
  /reviewername/,
  /title/,
  /subject/,
  /requestid/,
  /operationid/,
  /eventid/,
  /providerpayload/,
  /^payload$/,
  /^raw/,
  /^findings?$/,
  /findingtext/,
  /^description$/,
  /^summary$/,
  /^details?$/,
  /^message$/,
  /^remediation$/,
  /^evidence$/,
  /^response$/,
  /^results?$/,
]);

export class SecurityAttestationError extends Error {
  constructor(category, source = "attestation") {
    const safeSource = SAFE_SOURCES.has(source) ? source : "attestation";
    super(`${category} source=${safeSource}`);
    this.name = "SecurityAttestationError";
    this.category = category;
    this.source = safeSource;
  }
}

function fail(category, source) {
  throw new SecurityAttestationError(category, source);
}

class StrictJsonParseError extends SyntaxError {
  constructor(category = "INVALID_REPORT_JSON") {
    super(category);
    this.name = "StrictJsonParseError";
    this.category = category;
  }
}

function parseJsonStringToken(text, state) {
  if (text[state.index] !== '"') throw new StrictJsonParseError();
  state.index += 1;
  let decoded = "";
  while (state.index < text.length) {
    const character = text[state.index++];
    if (character === '"') return decoded;
    if (character === "\\") {
      if (state.index >= text.length) throw new StrictJsonParseError();
      const escape = text[state.index++];
      const escapes = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (Object.hasOwn(escapes, escape)) {
        decoded += escapes[escape];
        continue;
      }
      if (escape !== "u" || state.index + 4 > text.length) throw new StrictJsonParseError();
      const code = text.slice(state.index, state.index + 4);
      if (!/^[0-9A-Fa-f]{4}$/.test(code)) throw new StrictJsonParseError();
      decoded += String.fromCharCode(Number.parseInt(code, 16));
      state.index += 4;
      continue;
    }
    if (character < " ") throw new StrictJsonParseError();
    decoded += character;
  }
  throw new StrictJsonParseError();
}

function skipJsonWhitespace(text, state) {
  while (/\s/.test(text[state.index] ?? "")) state.index += 1;
}

const MAX_JSON_DEPTH = 64;

function scanJsonValue(text, state, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new StrictJsonParseError("JSON_NESTING_TOO_DEEP");
  skipJsonWhitespace(text, state);
  const character = text[state.index];
  if (character === '"') {
    parseJsonStringToken(text, state);
    return;
  }
  if (character === "{") {
    state.index += 1;
    skipJsonWhitespace(text, state);
    const keys = new Set();
    if (text[state.index] === "}") {
      state.index += 1;
      return;
    }
    while (state.index < text.length) {
      skipJsonWhitespace(text, state);
      const key = parseJsonStringToken(text, state);
      if (keys.has(key)) throw new StrictJsonParseError("DUPLICATE_JSON_KEY");
      keys.add(key);
      skipJsonWhitespace(text, state);
      if (text[state.index++] !== ":") throw new StrictJsonParseError();
      scanJsonValue(text, state, depth + 1);
      skipJsonWhitespace(text, state);
      const delimiter = text[state.index++];
      if (delimiter === "}") return;
      if (delimiter !== ",") throw new StrictJsonParseError();
    }
    throw new StrictJsonParseError();
  }
  if (character === "[") {
    state.index += 1;
    skipJsonWhitespace(text, state);
    if (text[state.index] === "]") {
      state.index += 1;
      return;
    }
    while (state.index < text.length) {
      scanJsonValue(text, state, depth + 1);
      skipJsonWhitespace(text, state);
      const delimiter = text[state.index++];
      if (delimiter === "]") return;
      if (delimiter !== ",") throw new StrictJsonParseError();
    }
    throw new StrictJsonParseError();
  }
  const literal = text.slice(state.index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
  if (!literal) throw new StrictJsonParseError();
  state.index += literal.length;
}

function parseStrictJson(text) {
  const state = { index: 0 };
  scanJsonValue(text, state);
  skipJsonWhitespace(text, state);
  if (state.index !== text.length) throw new StrictJsonParseError();
  return JSON.parse(text);
}

function sameFileSnapshot(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.nlink === after.nlink &&
    before.uid === after.uid &&
    before.gid === after.gid &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

export async function readSecurityReport(
  path,
  { source, openFile = open, maxBytes = MAX_SECURITY_ATTESTATION_BYTES } = {},
) {
  if (
    !SAFE_SOURCES.has(source) ||
    (source !== "manual_review" && source !== "deep_security_scan") ||
    typeof path !== "string" ||
    path.length === 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > MAX_SECURITY_ATTESTATION_BYTES
  ) {
    fail("INVALID_ARGUMENTS", source);
  }

  let handle;
  try {
    handle = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    fail("REPORT_PATH_NOT_READABLE", source);
  }

  let result;
  let failure;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) fail("REPORT_PATH_NOT_REGULAR", source);
    if (before.size > BigInt(maxBytes)) fail("REPORT_TOO_LARGE", source);
    if (before.size < 0n) fail("REPORT_PATH_NOT_READABLE", source);

    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > bytes.length - offset) {
        fail("REPORT_PATH_NOT_READABLE", source);
      }
      offset += bytesRead;
    }

    const after = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(before, after) || offset !== Number(before.size)) {
      fail("REPORT_CHANGED_DURING_READ", source);
    }

    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("INVALID_REPORT_UTF8", source);
    }
    result = {
      bytes,
      text,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    failure = error instanceof SecurityAttestationError
      ? error
      : new SecurityAttestationError("REPORT_PATH_NOT_READABLE", source);
  } finally {
    try {
      await handle.close();
    } catch {
      if (!failure) failure = new SecurityAttestationError("REPORT_PATH_CLOSE_FAILED", source);
    }
  }
  if (failure) throw failure;
  return result;
}

function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function normalizedKey(key) {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function containsSensitiveString(value) {
  return (
    SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ||
    CORRELATION_ID_PATTERN.test(value) ||
    LOCAL_PATH_PATTERN.test(value) ||
    URL_QUERY_PATTERN.test(value)
  );
}

function assertNoSensitiveMaterial(value, source) {
  if (typeof value === "string") {
    if (containsSensitiveString(value)) fail("SENSITIVE_REPORT_MATERIAL", source);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveMaterial(item, source);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) {
      fail("SENSITIVE_REPORT_MATERIAL", source);
    }
    assertNoSensitiveMaterial(child, source);
  }
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isCanonicalTimestamp(value) {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isFindingCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasValidFindingIds(value) {
  return (
    Array.isArray(value) &&
    value.length <= 256 &&
    value.every((identifier) => typeof identifier === "string" && FINDING_ID_PATTERN.test(identifier))
  );
}

function validateReport(value, { expectedKind, expectedKeys, source, targetSha }) {
  assertNoSensitiveMaterial(value, source);
  if (
    !hasExactKeys(value, expectedKeys) ||
    value.schema_version !== 1 ||
    value.kind !== expectedKind ||
    value.status !== "COMPLETED" ||
    !COMMIT_SHA_PATTERN.test(value.target_sha) ||
    !isCanonicalTimestamp(value.completed_at) ||
    !isFindingCount(value.critical_count) ||
    !isFindingCount(value.high_count) ||
    !hasValidFindingIds(value.redacted_finding_ids)
  ) {
    fail("INVALID_REPORT_SHAPE", source);
  }
  if (expectedKind === "deep-security-scan") {
    if (!SCAN_TOOL_PATTERN.test(value.scan_tool) || !SCAN_VERSION_PATTERN.test(value.scan_version)) {
      fail("INVALID_REPORT_SHAPE", source);
    }
  }
  if (value.target_sha !== targetSha) fail("TARGET_SHA_MISMATCH", source);
  if (value.critical_count !== 0 || value.high_count !== 0) {
    fail("SECURITY_FINDINGS_PRESENT", source);
  }
  return value;
}

function parseReport(report, options) {
  let value;
  try {
    value = parseStrictJson(report.text);
  } catch (error) {
    const category = error instanceof StrictJsonParseError ? error.category : "INVALID_REPORT_JSON";
    fail(category, options.source);
  }
  return validateReport(value, options);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function buildSecurityAttestation({
  targetSha,
  manualReviewPath,
  deepSecurityScanPath,
} = {}) {
  if (!COMMIT_SHA_PATTERN.test(targetSha ?? "")) fail("INVALID_TARGET_SHA", "attestation");
  if (typeof manualReviewPath !== "string" || typeof deepSecurityScanPath !== "string") {
    fail("INVALID_ARGUMENTS", "attestation");
  }

  const manualReport = await readSecurityReport(manualReviewPath, { source: "manual_review" });
  const deepReport = await readSecurityReport(deepSecurityScanPath, { source: "deep_security_scan" });
  const manual = parseReport(manualReport, {
    expectedKind: "manual-threat-review",
    expectedKeys: MANUAL_REVIEW_KEYS,
    source: "manual_review",
    targetSha,
  });
  const deep = parseReport(deepReport, {
    expectedKind: "deep-security-scan",
    expectedKeys: DEEP_SECURITY_SCAN_KEYS,
    source: "deep_security_scan",
    targetSha,
  });

  const redactedFindingIds = [...new Set([
    ...manual.redacted_finding_ids,
    ...deep.redacted_finding_ids,
  ])].sort(compareStrings);
  if (redactedFindingIds.length > 256) fail("INVALID_REPORT_SHAPE", "attestation");

  const attestation = {
    schema_version: 1,
    target_sha: targetSha,
    manual_review_sha256: manualReport.sha256,
    deep_security_scan_sha256: deepReport.sha256,
    scan_tool: deep.scan_tool,
    scan_version: deep.scan_version,
    completed_at: manual.completed_at > deep.completed_at ? manual.completed_at : deep.completed_at,
    critical_count: 0,
    high_count: 0,
    redacted_finding_ids: redactedFindingIds,
  };
  const json = `${JSON.stringify(attestation, null, 2)}\n`;
  if (Buffer.byteLength(json, "utf8") > MAX_SECURITY_ATTESTATION_BYTES) {
    fail("ATTESTATION_TOO_LARGE", "attestation");
  }
  return {
    attestation,
    json,
    base64: Buffer.from(json, "utf8").toString("base64"),
  };
}

export async function writeSecurityAttestation({ outputPath, ...buildOptions } = {}) {
  if (typeof outputPath !== "string" || outputPath.length === 0) fail("INVALID_ARGUMENTS", "output");
  const result = await buildSecurityAttestation(buildOptions);
  try {
    await writeFile(outputPath, result.json, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    fail(error && typeof error === "object" && error.code === "EEXIST"
      ? "OUTPUT_ALREADY_EXISTS"
      : "OUTPUT_WRITE_FAILED", "output");
  }
  return result;
}
