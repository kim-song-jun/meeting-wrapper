import { createHash } from "node:crypto";

const EVIDENCE_KEYS = new Set([
  "schemaVersion",
  "probeId",
  "runId",
  "candidateSha",
  "observedAt",
  "roleAlias",
  "browserAlias",
  "deviceAlias",
  "operationId",
  "endpoint",
  "httpStatus",
  "googleRequestId",
  "capability",
  "result",
  "responseCounts",
  "fieldPresence",
  "locatorHashes",
  "teardownStatus",
  "notes",
]);

const REQUIRED_EVIDENCE_KEYS = [
  "schemaVersion",
  "probeId",
  "runId",
  "candidateSha",
  "observedAt",
  "roleAlias",
  "browserAlias",
  "deviceAlias",
  "operationId",
  "endpoint",
  "capability",
  "result",
  "teardownStatus",
];

const INPUT_KEYS = new Set([...EVIDENCE_KEYS, "locatorInputs"]);
const RESPONSE_COUNT_KEYS = new Set([
  "items",
  "matches",
  "accepted",
  "declined",
  "pages",
  "attempts",
  "created",
  "updated",
  "deleted",
  "unknown",
]);
const FIELD_PRESENCE_KEYS = new Set([
  "sharedProperty",
  "visibility",
  "organizer",
  "conferenceData",
  "iCalUid",
  "recurringEventId",
  "originalStartTime",
  "nextPageToken",
  "names",
  "emailAddresses",
  "organizations",
  "department",
]);
const LOCATOR_KEYS = new Set([
  "event",
  "organizerEvent",
  "roomEvent",
  "file",
  "series",
  "iCalUid",
  "calendar",
  "roomCalendar",
]);
const CAPABILITIES = new Set([
  "SUPPORTED",
  "UNSUPPORTED",
  "TENANT_BLOCKED",
  "ENVIRONMENT_BLOCKED",
  "INCONCLUSIVE",
  "NOT_APPLICABLE",
]);
const RESULTS = new Set([
  "SUCCESS",
  "DENIED",
  "DECLINED",
  "TIMEOUT",
  "PARTIAL",
  "UNKNOWN_OUTCOME",
  "BLOCKED",
  "ALREADY_ABSENT",
  "NOT_RUN",
]);
const TEARDOWN_STATUSES = new Set(["NOT_REQUIRED", "PENDING", "COMPLETE", "UNKNOWN"]);
const NOTE_VALUES = new Set([
  "FIXTURE",
  "OPERATOR_VERIFIED",
  "TENANT_POLICY",
  "BLOCKED_ENVIRONMENT",
  "USER_DENIED",
  "POPUP_BLOCKED",
  "TOKEN_EXPIRED",
  "RECONNECT_REQUIRED",
  "PROPAGATION_TIMEOUT",
  "AUTO_DECLINED",
  "UNSUPPORTED",
  "CLEANUP_ALREADY_ABSENT",
  "RETRYABLE_RATE_LIMIT",
  "FEATURE_REDUCED",
]);

const MANIFEST_KEYS = new Set([
  "schemaVersion",
  "candidateSha",
  "generatedAt",
  "harnessCommitSha",
  "probeCommitShas",
  "officialDocs",
  "coverage",
  "evidence",
  "architectureTriggers",
  "teardownStatus",
]);
const REQUIRED_MANIFEST_KEYS = [...MANIFEST_KEYS];
const PROBE_IDS = new Set([
  "provisioning",
  "account-matrix",
  "gis-lifecycle",
  "calendar-capabilities",
  "calendar-crud",
  "calendar-series",
  "drive-appdata",
  "people-directory",
  "teardown",
]);
const COVERAGE_KEYS = new Set([
  "roleAlias",
  "browserAlias",
  "deviceAlias",
  "status",
]);
const COVERAGE_STATUSES = new Set(["COMPLETE", "BLOCKED_ENVIRONMENT", "NOT_APPLICABLE"]);
const MANIFEST_EVIDENCE_KEYS = new Set(["probeId", "path", "sha256", "capability"]);
const ARCHITECTURE_TRIGGERS = new Set([
  "TOKEN_RECONNECT_UNACCEPTABLE",
  "REAL_MOBILE_EVIDENCE_MISSING",
  "ROOM_SHARED_PROPERTY_UNSUPPORTED",
  "ROOM_CONFLICT_UNSAFE",
  "OWN_MUTATION_UNSUPPORTED",
  "DRIVE_APPDATA_UNSUPPORTED",
  "TEARDOWN_INCOMPLETE",
  "MEET_FEATURE_REDUCTION",
  "PEOPLE_FEATURE_REDUCTION",
  "ADMIN_CANCEL_FEATURE_REDUCTION",
  "VISIBILITY_FEATURE_REDUCTION",
  "TENANT_POLICY_BLOCKED",
  "UNKNOWN_OUTCOME",
]);

const ALIAS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const LOCATOR_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_VALUE_PATTERNS = [
  /\bBearer\s+\S+/i,
  /\bya29\.[A-Za-z0-9_-]+/,
  /\bGOCSPX-[A-Za-z0-9_-]+/,
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/,
  /https?:\/\/[^\s?#]+\?[^\s#]+/i,
];

export class EvidencePolicyError extends Error {
  constructor(category, pointer) {
    super(`${category} pointer=${pointer}`);
    this.name = "EvidencePolicyError";
    this.category = category;
    this.pointer = pointer;
  }
}

function escapePointerSegment(segment) {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(pointer, segment) {
  const escaped = escapePointerSegment(segment);
  return pointer === "/" ? `/${escaped}` : `${pointer}/${escaped}`;
}

function failShape(pointer) {
  throw new EvidencePolicyError("INVALID_EVIDENCE_SHAPE", pointer);
}

function failForbidden(pointer) {
  throw new EvidencePolicyError("FORBIDDEN_EVIDENCE_FIELD", pointer);
}

function isPlainRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function assertRecord(value, pointer) {
  if (!isPlainRecord(value)) failShape(pointer);
}

function assertAllowedKeys(value, allowedKeys, pointer) {
  assertRecord(value, pointer);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) failForbidden(childPointer(pointer, key));
  }
}

function assertRequiredKeys(value, requiredKeys, pointer) {
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) failShape(childPointer(pointer, key));
  }
}

function assertNoForbiddenValue(value, pointer) {
  if (typeof value !== "string") return;
  if (FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value))) failForbidden(pointer);
}

function assertString(value, pointer, { min = 1, max = 256, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) failShape(pointer);
  assertNoForbiddenValue(value, pointer);
  if (pattern && !pattern.test(value)) failShape(pointer);
}

function assertEnum(value, allowed, pointer) {
  if (typeof value !== "string") failShape(pointer);
  assertNoForbiddenValue(value, pointer);
  if (!allowed.has(value)) failShape(pointer);
}

function assertTimestamp(value, pointer) {
  assertString(value, pointer, { max: 32, pattern: ISO_TIMESTAMP_PATTERN });
  if (Number.isNaN(Date.parse(value))) failShape(pointer);
}

function assertEndpoint(value, pointer) {
  assertString(value, pointer, { max: 512 });
  if (value.includes("?") || value.includes("#") || value.includes("@")) failForbidden(pointer);

  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    failShape(pointer);
  }

  const allowedHosts = new Set([
    "www.googleapis.com",
    "people.googleapis.com",
    "oauth2.googleapis.com",
  ]);
  if (endpoint.protocol !== "https:" || !allowedHosts.has(endpoint.hostname)) failShape(pointer);
}

function assertCountMap(value, pointer) {
  assertAllowedKeys(value, RESPONSE_COUNT_KEYS, pointer);
  for (const [key, count] of Object.entries(value)) {
    if (!Number.isSafeInteger(count) || count < 0) failShape(childPointer(pointer, key));
  }
}

function assertPresenceMap(value, pointer) {
  assertAllowedKeys(value, FIELD_PRESENCE_KEYS, pointer);
  for (const [key, present] of Object.entries(value)) {
    if (typeof present !== "boolean") failShape(childPointer(pointer, key));
  }
}

function assertLocatorHashes(value, pointer) {
  assertAllowedKeys(value, LOCATOR_KEYS, pointer);
  if (Object.keys(value).length === 0) failShape(pointer);
  for (const [key, locatorHash] of Object.entries(value)) {
    assertString(locatorHash, childPointer(pointer, key), {
      max: 71,
      pattern: LOCATOR_HASH_PATTERN,
    });
  }
}

function assertNotes(value, pointer) {
  if (!Array.isArray(value) || value.length > 16) failShape(pointer);
  value.forEach((note, index) => assertEnum(note, NOTE_VALUES, childPointer(pointer, index)));
}

function copyJsonValue(value) {
  if (Array.isArray(value)) return value.map(copyJsonValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyJsonValue(child)]));
  }
  return value;
}

export function hashLocator(rawLocator) {
  assertString(rawLocator, "/locator", { max: 2048 });
  return `sha256:${createHash("sha256").update(rawLocator, "utf8").digest("hex")}`;
}

export function redactEvidence(draft) {
  assertAllowedKeys(draft, INPUT_KEYS, "/");
  const output = {};

  for (const key of EVIDENCE_KEYS) {
    if (Object.hasOwn(draft, key)) output[key] = copyJsonValue(draft[key]);
  }

  if (Object.hasOwn(draft, "locatorInputs")) {
    if (Object.hasOwn(draft, "locatorHashes")) failForbidden("/locatorHashes");
    assertAllowedKeys(draft.locatorInputs, LOCATOR_KEYS, "/locatorInputs");
    if (Object.keys(draft.locatorInputs).length === 0) failShape("/locatorInputs");
    output.locatorHashes = Object.fromEntries(
      Object.entries(draft.locatorInputs).map(([key, rawLocator]) => [
        key,
        hashLocatorAtPointer(rawLocator, childPointer("/locatorInputs", key)),
      ]),
    );
  }

  return validateEvidence(output);
}

function hashLocatorAtPointer(rawLocator, pointer) {
  assertString(rawLocator, pointer, { max: 2048 });
  return `sha256:${createHash("sha256").update(rawLocator, "utf8").digest("hex")}`;
}

export function validateEvidence(evidence) {
  assertAllowedKeys(evidence, EVIDENCE_KEYS, "/");
  assertRequiredKeys(evidence, REQUIRED_EVIDENCE_KEYS, "/");

  if (evidence.schemaVersion !== 1) failShape("/schemaVersion");
  assertString(evidence.probeId, "/probeId", { max: 64, pattern: ALIAS_PATTERN });
  assertString(evidence.runId, "/runId", { max: 128, pattern: OPERATION_PATTERN });
  assertString(evidence.candidateSha, "/candidateSha", { max: 40, pattern: COMMIT_SHA_PATTERN });
  assertTimestamp(evidence.observedAt, "/observedAt");
  assertString(evidence.roleAlias, "/roleAlias", { max: 64, pattern: ALIAS_PATTERN });
  assertString(evidence.browserAlias, "/browserAlias", { max: 64, pattern: ALIAS_PATTERN });
  assertString(evidence.deviceAlias, "/deviceAlias", { max: 64, pattern: ALIAS_PATTERN });
  assertString(evidence.operationId, "/operationId", { max: 128, pattern: OPERATION_PATTERN });
  assertEndpoint(evidence.endpoint, "/endpoint");

  if (Object.hasOwn(evidence, "httpStatus")) {
    if (!Number.isSafeInteger(evidence.httpStatus) || evidence.httpStatus < 100 || evidence.httpStatus > 599) {
      failShape("/httpStatus");
    }
  }
  if (Object.hasOwn(evidence, "googleRequestId")) {
    assertString(evidence.googleRequestId, "/googleRequestId", {
      max: 256,
      pattern: OPERATION_PATTERN,
    });
  }

  assertEnum(evidence.capability, CAPABILITIES, "/capability");
  assertEnum(evidence.result, RESULTS, "/result");
  assertEnum(evidence.teardownStatus, TEARDOWN_STATUSES, "/teardownStatus");

  if (Object.hasOwn(evidence, "responseCounts")) {
    assertCountMap(evidence.responseCounts, "/responseCounts");
  }
  if (Object.hasOwn(evidence, "fieldPresence")) {
    assertPresenceMap(evidence.fieldPresence, "/fieldPresence");
  }
  if (Object.hasOwn(evidence, "locatorHashes")) {
    assertLocatorHashes(evidence.locatorHashes, "/locatorHashes");
  }
  if (Object.hasOwn(evidence, "notes")) assertNotes(evidence.notes, "/notes");

  return evidence;
}

function assertProbeCommits(value, pointer) {
  assertAllowedKeys(value, PROBE_IDS, pointer);
  if (Object.keys(value).length === 0) failShape(pointer);
  for (const [probeId, commitSha] of Object.entries(value)) {
    assertString(commitSha, childPointer(pointer, probeId), {
      max: 40,
      pattern: COMMIT_SHA_PATTERN,
    });
  }
}

function assertOfficialDocs(value, pointer) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) failShape(pointer);
  value.forEach((doc, index) => {
    const itemPointer = childPointer(pointer, index);
    assertString(doc, itemPointer, { max: 512 });
    if (!doc.startsWith("https://developers.google.com/") || doc.includes("?") || doc.includes("#")) {
      failShape(itemPointer);
    }
  });
}

function assertCoverage(value, pointer) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) failShape(pointer);
  value.forEach((cell, index) => {
    const itemPointer = childPointer(pointer, index);
    assertAllowedKeys(cell, COVERAGE_KEYS, itemPointer);
    assertRequiredKeys(cell, COVERAGE_KEYS, itemPointer);
    assertString(cell.roleAlias, childPointer(itemPointer, "roleAlias"), {
      max: 64,
      pattern: ALIAS_PATTERN,
    });
    assertString(cell.browserAlias, childPointer(itemPointer, "browserAlias"), {
      max: 64,
      pattern: ALIAS_PATTERN,
    });
    assertString(cell.deviceAlias, childPointer(itemPointer, "deviceAlias"), {
      max: 64,
      pattern: ALIAS_PATTERN,
    });
    assertEnum(cell.status, COVERAGE_STATUSES, childPointer(itemPointer, "status"));
  });
}

function assertEvidenceEntries(value, pointer) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) failShape(pointer);
  value.forEach((entry, index) => {
    const itemPointer = childPointer(pointer, index);
    assertAllowedKeys(entry, MANIFEST_EVIDENCE_KEYS, itemPointer);
    assertRequiredKeys(entry, MANIFEST_EVIDENCE_KEYS, itemPointer);
    assertEnum(entry.probeId, PROBE_IDS, childPointer(itemPointer, "probeId"));
    assertString(entry.path, childPointer(itemPointer, "path"), {
      max: 256,
      pattern: /^(?:docs|scripts)\/[A-Za-z0-9._/-]+$/,
    });
    if (entry.path.split("/").includes("..")) failShape(childPointer(itemPointer, "path"));
    assertString(entry.sha256, childPointer(itemPointer, "sha256"), {
      max: 64,
      pattern: SHA256_PATTERN,
    });
    assertEnum(entry.capability, CAPABILITIES, childPointer(itemPointer, "capability"));
  });
}

function assertArchitectureTriggers(value, pointer) {
  if (!Array.isArray(value) || value.length > ARCHITECTURE_TRIGGERS.size) failShape(pointer);
  const unique = new Set();
  value.forEach((trigger, index) => {
    assertEnum(trigger, ARCHITECTURE_TRIGGERS, childPointer(pointer, index));
    if (unique.has(trigger)) failShape(childPointer(pointer, index));
    unique.add(trigger);
  });
}

export function validateManifest(manifest) {
  assertAllowedKeys(manifest, MANIFEST_KEYS, "/");
  assertRequiredKeys(manifest, REQUIRED_MANIFEST_KEYS, "/");

  if (manifest.schemaVersion !== 1) failShape("/schemaVersion");
  assertString(manifest.candidateSha, "/candidateSha", {
    max: 40,
    pattern: COMMIT_SHA_PATTERN,
  });
  assertTimestamp(manifest.generatedAt, "/generatedAt");
  assertString(manifest.harnessCommitSha, "/harnessCommitSha", {
    max: 40,
    pattern: COMMIT_SHA_PATTERN,
  });
  assertProbeCommits(manifest.probeCommitShas, "/probeCommitShas");
  assertOfficialDocs(manifest.officialDocs, "/officialDocs");
  assertCoverage(manifest.coverage, "/coverage");
  assertEvidenceEntries(manifest.evidence, "/evidence");
  assertArchitectureTriggers(manifest.architectureTriggers, "/architectureTriggers");
  assertEnum(manifest.teardownStatus, TEARDOWN_STATUSES, "/teardownStatus");

  return manifest;
}
