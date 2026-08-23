import { createHash } from "node:crypto";
import { AccountMatrixError, validateAccountMatrix } from "./account-matrix.mjs";

const PROBE_EVIDENCE_KEYS = new Set([
  "kind",
  "schemaVersion",
  "probeId",
  "runId",
  "candidateSha",
  "observedAt",
  "roleAlias",
  "browserAlias",
  "deviceAlias",
  "aliases",
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

const REQUIRED_PROBE_EVIDENCE_KEYS = [
  "schemaVersion",
  "probeId",
  "runId",
  "candidateSha",
  "observedAt",
  "roleAlias",
  "browserAlias",
  "deviceAlias",
  "aliases",
  "operationId",
  "endpoint",
  "capability",
  "result",
  "teardownStatus",
];

const PROBE_INPUT_KEYS = new Set([...PROBE_EVIDENCE_KEYS, "locatorInputs"]);
const PROVISIONING_EVIDENCE_KEYS = new Set([
  "schemaVersion",
  "kind",
  "probeId",
  "status",
  "observation",
  "observedAt",
  "appType",
  "domain",
  "clientIdSuffix",
  "workspaceEdition",
  "enabledApis",
  "initialScopes",
  "directoryScopeTiming",
  "origins",
  "accounts",
  "rooms",
  "tenantPolicy",
  "operatorVerified",
  "capability",
]);
const REQUIRED_PROVISIONING_EVIDENCE_KEYS = [
  "schemaVersion",
  "kind",
  "probeId",
  "status",
  "observation",
  "appType",
  "domain",
  "clientIdSuffix",
  "workspaceEdition",
  "enabledApis",
  "initialScopes",
  "directoryScopeTiming",
  "origins",
  "accounts",
  "rooms",
  "tenantPolicy",
  "operatorVerified",
  "capability",
];
const PROVISIONING_ONLY_KEYS = new Set(
  [...PROVISIONING_EVIDENCE_KEYS].filter(
    (key) => key !== "schemaVersion" && key !== "kind" && key !== "probeId" && key !== "observedAt" && key !== "capability",
  ),
);
const ALIAS_KEYS = new Set(["account", "room", "calendar"]);
const PROVISIONING_API_KEYS = new Set(["calendar", "drive", "people"]);
const PROVISIONING_SCOPE_KEYS = new Set([
  "calendarEvents",
  "calendarReadonly",
  "driveAppdata",
]);
const PROVISIONING_ORIGIN_KEYS = new Set(["localhostSpike", "production"]);
const PROVISIONING_ACCOUNTS_KEYS = new Set(["ordinary", "roomWriterAdmin", "distinct"]);
const PROVISIONING_ACCOUNT_KEYS = new Set(["alias", "present"]);
const PROVISIONING_ROOM_KEYS = new Set([
  "alias",
  "present",
  "domainReadAcl",
  "ordinaryRoomWriter",
  "adminRoomWriter",
  "autoAccept",
]);
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
const PROVISIONING_STATUSES = new Set([
  "INCOMPLETE",
  "COMPLETE",
  "TENANT_POLICY_BLOCKED",
]);
const PROVISIONING_OBSERVATIONS = new Set(["UNOBSERVED", "OPERATOR_OBSERVED"]);
const PROVISIONING_APP_TYPES = new Set(["UNOBSERVED", "INTERNAL", "EXTERNAL"]);
const WORKSPACE_EDITIONS = new Set([
  "UNOBSERVED",
  "BUSINESS",
  "ENTERPRISE",
  "EDUCATION",
  "FRONTLINE",
  "NONPROFIT",
  "ESSENTIALS",
  "OTHER_WORKSPACE",
]);
const AUTO_ACCEPT_STATES = new Set(["UNOBSERVED", "ENABLED", "DISABLED"]);
const TENANT_POLICY_STATES = new Set(["UNOBSERVED", "ALLOWED", "BLOCKED"]);
const PROVISIONING_ROOM_ALIASES = new Set(["room-a", "room-b"]);
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
const CURRENT_PROBE_IDS = new Set(["fixture-safe", "safe-self-test"]);
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
  "SHARED_SERIES_COPY_MISMATCH",
]);

export const GOOGLE_ENDPOINT_TEMPLATES = Object.freeze([
  "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events",
  "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events/{event}",
  "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events/{event}/instances",
  "https://www.googleapis.com/drive/v3/files",
  "https://www.googleapis.com/drive/v3/files/{file}",
  "https://www.googleapis.com/upload/drive/v3/files",
  "https://www.googleapis.com/upload/drive/v3/files/{file}",
  "https://people.googleapis.com/v1/people:searchDirectoryPeople",
  "https://oauth2.googleapis.com/revoke",
]);

const GOOGLE_ENDPOINT_TEMPLATE_SET = new Set(GOOGLE_ENDPOINT_TEMPLATES);

const ALIAS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CLIENT_ID_SUFFIX_PATTERN = /^[a-z0-9]{8}$/;
const FIXTURE_RUN_PATTERN = /^run-[A-Za-z0-9][A-Za-z0-9._:-]{0,123}$/;
const FIXTURE_OPERATION_PATTERN = /^operation-[A-Za-z0-9][A-Za-z0-9._:-]{0,117}$/;
const FIXTURE_REQUEST_PATTERN = /^request-[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SELF_TEST_PATTERN = /^safe-self-test-[1-9]\d*$/;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const LOCATOR_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):([0-5]\d)(?:\.(\d{3}))?Z$/;
export const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /(?:^|[\s{,])["']?(?:access_token|refresh_token|client_secret|authorization|cookie|private[_-]?key)["']?\s*[:=]/i,
  /\bBearer\s+\S+/i,
  /\bya29\.[A-Za-z0-9_-]+/,
  /\bGOCSPX-[A-Za-z0-9_-]+/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b\d{6,}-[a-z0-9_-]+\.apps\.googleusercontent\.com\b/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\b(?:aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token)|secret[_-]?access[_-]?key|session[_-]?token)["']?\s*[:=]\s*["']?[A-Za-z0-9/+=_-]{16,}/i,
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/,
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/,
  /https?:\/\/[^\s?#]+\?[^\s#]+/i,
]);

export function containsSensitiveMaterial(value) {
  return typeof value === "string" && SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export class EvidencePolicyError extends Error {
  constructor(category, pointer) {
    const safePointer = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(pointer)
      ? pointer
      : "/_invalid";
    super(`${category} pointer=${safePointer}`);
    this.name = "EvidencePolicyError";
    this.category = category;
    this.pointer = safePointer;
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

export class StrictJsonParseError extends SyntaxError {
  constructor(category = "INVALID_EVIDENCE_JSON") {
    super(category);
    this.name = "StrictJsonParseError";
    this.category = category;
  }
}

function parseJsonStringToken(text, state) {
  const start = state.index;
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
  state.index = start;
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

export function parseStrictJson(text) {
  if (typeof text !== "string") throw new StrictJsonParseError();
  const state = { index: 0 };
  scanJsonValue(text, state);
  skipJsonWhitespace(text, state);
  if (state.index !== text.length) throw new StrictJsonParseError();
  return JSON.parse(text);
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
    if (!allowedKeys.has(key)) failForbidden(childPointer(pointer, "_unknown"));
  }
}

function assertRequiredKeys(value, requiredKeys, pointer) {
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) failShape(childPointer(pointer, key));
  }
}

function assertNoForbiddenValue(value, pointer) {
  if (typeof value !== "string") return;
  if (containsSensitiveMaterial(value)) failForbidden(pointer);
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
  const [, year, month, day, hour, minute, second, millisecond = "000"] =
    ISO_TIMESTAMP_PATTERN.exec(value);
  const instant = new Date(0);
  instant.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  instant.setUTCHours(
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  );
  if (
    instant.getUTCFullYear() !== Number(year) ||
    instant.getUTCMonth() !== Number(month) - 1 ||
    instant.getUTCDate() !== Number(day) ||
    instant.getUTCHours() !== Number(hour) ||
    instant.getUTCMinutes() !== Number(minute) ||
    instant.getUTCSeconds() !== Number(second) ||
    instant.getUTCMilliseconds() !== Number(millisecond)
  ) {
    failShape(pointer);
  }
}

function assertEndpoint(value, pointer) {
  assertString(value, pointer, { max: 512 });
  if (!GOOGLE_ENDPOINT_TEMPLATE_SET.has(value)) failForbidden(pointer);
}

function assertAliases(value, pointer) {
  assertAllowedKeys(value, ALIAS_KEYS, pointer);
  assertRequiredKeys(value, ["account"], pointer);
  for (const [key, alias] of Object.entries(value)) {
    assertString(alias, childPointer(pointer, key), { max: 64, pattern: ALIAS_PATTERN });
  }
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

function assertGeneratedIdentifier(value, pointer, pattern) {
  assertString(value, pointer, { max: 128, pattern });
}

function assertProbeContract(evidence, pointer = "/") {
  assertEnum(evidence.probeId, CURRENT_PROBE_IDS, childPointer(pointer, "probeId"));
  const calendarEventsEndpoint = "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events";
  if (evidence.endpoint !== calendarEventsEndpoint) failShape(childPointer(pointer, "endpoint"));
  if (evidence.roleAlias !== "ordinary") failShape(childPointer(pointer, "roleAlias"));
  if (evidence.aliases.account !== "ordinary") failShape(childPointer(pointer, "aliases"));
  if (evidence.teardownStatus !== "NOT_REQUIRED") {
    failShape(childPointer(pointer, "teardownStatus"));
  }
  if (
    !Array.isArray(evidence.notes) ||
    evidence.notes.length !== 1 ||
    evidence.notes[0] !== "FIXTURE"
  ) {
    failShape(childPointer(pointer, "notes"));
  }

  if (evidence.probeId === "fixture-safe") {
    assertGeneratedIdentifier(evidence.runId, childPointer(pointer, "runId"), FIXTURE_RUN_PATTERN);
    assertGeneratedIdentifier(
      evidence.operationId,
      childPointer(pointer, "operationId"),
      FIXTURE_OPERATION_PATTERN,
    );
    if (Object.hasOwn(evidence, "googleRequestId")) {
      assertGeneratedIdentifier(
        evidence.googleRequestId,
        childPointer(pointer, "googleRequestId"),
        FIXTURE_REQUEST_PATTERN,
      );
    }
    if (evidence.capability !== "SUPPORTED") failShape(childPointer(pointer, "capability"));
    if (evidence.result !== "SUCCESS") failShape(childPointer(pointer, "result"));
    return;
  }

  assertGeneratedIdentifier(evidence.runId, childPointer(pointer, "runId"), SELF_TEST_PATTERN);
  assertGeneratedIdentifier(
    evidence.operationId,
    childPointer(pointer, "operationId"),
    SELF_TEST_PATTERN,
  );
  if (Object.hasOwn(evidence, "googleRequestId")) {
    failShape(childPointer(pointer, "googleRequestId"));
  }
  if (evidence.capability !== "NOT_APPLICABLE") failShape(childPointer(pointer, "capability"));
  if (evidence.result !== "SUCCESS") failShape(childPointer(pointer, "result"));
}

function assertBoolean(value, pointer) {
  if (typeof value !== "boolean") failShape(pointer);
}

function assertClosedBooleanMap(value, allowedKeys, pointer) {
  assertAllowedKeys(value, allowedKeys, pointer);
  assertRequiredKeys(value, allowedKeys, pointer);
  for (const [key, present] of Object.entries(value)) {
    assertBoolean(present, childPointer(pointer, key));
  }
}

function evidenceKind(value) {
  assertRecord(value, "/");
  if (!Object.hasOwn(value, "kind")) {
    if (
      value.probeId === "provisioning" ||
      Object.keys(value).some((key) => PROVISIONING_ONLY_KEYS.has(key))
    ) {
      failShape("/kind");
    }
    return "probe";
  }
  if (value.kind !== "probe" && value.kind !== "provisioning" && value.kind !== "account-matrix") failShape("/kind");
  return value.kind;
}

function assertProvisioningAccount(value, pointer, expectedAlias) {
  assertAllowedKeys(value, PROVISIONING_ACCOUNT_KEYS, pointer);
  assertRequiredKeys(value, PROVISIONING_ACCOUNT_KEYS, pointer);
  assertString(value.alias, childPointer(pointer, "alias"), {
    max: 64,
    pattern: ALIAS_PATTERN,
  });
  if (value.alias !== expectedAlias) failShape(childPointer(pointer, "alias"));
  assertBoolean(value.present, childPointer(pointer, "present"));
}

function assertProvisioningAccounts(value, pointer) {
  assertAllowedKeys(value, PROVISIONING_ACCOUNTS_KEYS, pointer);
  assertRequiredKeys(value, PROVISIONING_ACCOUNTS_KEYS, pointer);
  assertProvisioningAccount(value.ordinary, childPointer(pointer, "ordinary"), "ordinary");
  assertProvisioningAccount(
    value.roomWriterAdmin,
    childPointer(pointer, "roomWriterAdmin"),
    "room-writer-admin",
  );
  assertBoolean(value.distinct, childPointer(pointer, "distinct"));
}

function assertProvisioningRooms(value, pointer) {
  if (!Array.isArray(value) || value.length !== 2) failShape(pointer);
  const aliases = new Set();
  value.forEach((room, index) => {
    const itemPointer = childPointer(pointer, index);
    assertAllowedKeys(room, PROVISIONING_ROOM_KEYS, itemPointer);
    assertRequiredKeys(room, PROVISIONING_ROOM_KEYS, itemPointer);
    assertString(room.alias, childPointer(itemPointer, "alias"), {
      max: 64,
      pattern: ALIAS_PATTERN,
    });
    if (!PROVISIONING_ROOM_ALIASES.has(room.alias) || aliases.has(room.alias)) {
      failShape(childPointer(itemPointer, "alias"));
    }
    aliases.add(room.alias);
    for (const key of [
      "present",
      "domainReadAcl",
      "ordinaryRoomWriter",
      "adminRoomWriter",
    ]) {
      assertBoolean(room[key], childPointer(itemPointer, key));
    }
    assertEnum(room.autoAccept, AUTO_ACCEPT_STATES, childPointer(itemPointer, "autoAccept"));
  });
  if (aliases.size !== PROVISIONING_ROOM_ALIASES.size) failShape(pointer);
}

function provisioningFactsAreUnobserved(evidence) {
  return (
    evidence.appType === "UNOBSERVED" &&
    evidence.clientIdSuffix === "UNOBSERVED" &&
    evidence.workspaceEdition === "UNOBSERVED" &&
    Object.values(evidence.enabledApis).every((value) => value === false) &&
    Object.values(evidence.initialScopes).every((value) => value === false) &&
    Object.values(evidence.origins).every((value) => value === false) &&
    evidence.accounts.ordinary.present === false &&
    evidence.accounts.roomWriterAdmin.present === false &&
    evidence.accounts.distinct === false &&
    evidence.rooms.every(
      (room) =>
        room.present === false &&
        room.domainReadAcl === false &&
        room.ordinaryRoomWriter === false &&
        room.adminRoomWriter === false &&
        room.autoAccept === "UNOBSERVED",
    ) &&
    evidence.tenantPolicy === "UNOBSERVED"
  );
}

function provisioningIsComplete(evidence) {
  return (
    evidence.observation === "OPERATOR_OBSERVED" &&
    evidence.operatorVerified === true &&
    evidence.appType === "INTERNAL" &&
    evidence.clientIdSuffix !== "UNOBSERVED" &&
    evidence.workspaceEdition !== "UNOBSERVED" &&
    Object.values(evidence.enabledApis).every((value) => value === true) &&
    Object.values(evidence.initialScopes).every((value) => value === true) &&
    Object.values(evidence.origins).every((value) => value === true) &&
    evidence.accounts.ordinary.present === true &&
    evidence.accounts.roomWriterAdmin.present === true &&
    evidence.accounts.distinct === true &&
    evidence.rooms.every(
      (room) =>
        room.present === true &&
        room.domainReadAcl === true &&
        room.ordinaryRoomWriter === false &&
        room.adminRoomWriter === true &&
        room.autoAccept !== "UNOBSERVED",
    ) &&
    evidence.tenantPolicy === "ALLOWED"
  );
}

function validateProvisioningEvidence(evidence) {
  assertAllowedKeys(evidence, PROVISIONING_EVIDENCE_KEYS, "/");
  assertRequiredKeys(evidence, REQUIRED_PROVISIONING_EVIDENCE_KEYS, "/");

  if (evidence.schemaVersion !== 1) failShape("/schemaVersion");
  if (evidence.kind !== "provisioning") failShape("/kind");
  if (evidence.probeId !== "provisioning") failShape("/probeId");
  assertEnum(evidence.status, PROVISIONING_STATUSES, "/status");
  assertEnum(evidence.observation, PROVISIONING_OBSERVATIONS, "/observation");
  assertEnum(evidence.appType, PROVISIONING_APP_TYPES, "/appType");
  if (evidence.domain !== "MOLCUBE_COM") failShape("/domain");
  if (evidence.clientIdSuffix !== "UNOBSERVED") {
    assertString(evidence.clientIdSuffix, "/clientIdSuffix", {
      max: 8,
      pattern: CLIENT_ID_SUFFIX_PATTERN,
    });
  }
  assertEnum(evidence.workspaceEdition, WORKSPACE_EDITIONS, "/workspaceEdition");
  assertClosedBooleanMap(evidence.enabledApis, PROVISIONING_API_KEYS, "/enabledApis");
  assertClosedBooleanMap(evidence.initialScopes, PROVISIONING_SCOPE_KEYS, "/initialScopes");
  if (evidence.directoryScopeTiming !== "DEFERRED_TO_TASK_11") {
    failShape("/directoryScopeTiming");
  }
  assertClosedBooleanMap(evidence.origins, PROVISIONING_ORIGIN_KEYS, "/origins");
  assertProvisioningAccounts(evidence.accounts, "/accounts");
  assertProvisioningRooms(evidence.rooms, "/rooms");
  assertEnum(evidence.tenantPolicy, TENANT_POLICY_STATES, "/tenantPolicy");
  assertBoolean(evidence.operatorVerified, "/operatorVerified");
  assertEnum(evidence.capability, CAPABILITIES, "/capability");

  if (evidence.observation === "UNOBSERVED") {
    if (Object.hasOwn(evidence, "observedAt")) failShape("/observedAt");
    if (evidence.operatorVerified || !provisioningFactsAreUnobserved(evidence)) {
      failShape("/observation");
    }
  } else {
    if (!Object.hasOwn(evidence, "observedAt")) failShape("/observedAt");
    assertTimestamp(evidence.observedAt, "/observedAt");
    if (!evidence.operatorVerified) failShape("/operatorVerified");
  }

  let expectedStatus = "INCOMPLETE";
  let expectedCapability = "INCONCLUSIVE";
  if (evidence.tenantPolicy === "BLOCKED") {
    if (evidence.observation !== "OPERATOR_OBSERVED") failShape("/observation");
    expectedStatus = "TENANT_POLICY_BLOCKED";
    expectedCapability = "TENANT_BLOCKED";
  } else if (provisioningIsComplete(evidence)) {
    expectedStatus = "COMPLETE";
    expectedCapability = "SUPPORTED";
  }

  if (evidence.status !== expectedStatus) failShape("/status");
  if (evidence.capability !== expectedCapability) failShape("/capability");
  return evidence;
}

function copyJsonValue(value) {
  if (Array.isArray(value)) return value.map(copyJsonValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyJsonValue(child)]));
  }
  return value;
}

export function hashLocator(rawLocator) {
  assertRawLocator(rawLocator, "/locator");
  return `sha256:${createHash("sha256").update(rawLocator, "utf8").digest("hex")}`;
}

export function redactEvidence(draft) {
  const kind = evidenceKind(draft);
  if (kind === "provisioning") {
    assertAllowedKeys(draft, PROVISIONING_EVIDENCE_KEYS, "/");
    return validateEvidence(copyJsonValue(draft));
  }

  assertAllowedKeys(draft, PROBE_INPUT_KEYS, "/");
  const output = {};

  for (const key of PROBE_EVIDENCE_KEYS) {
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
  assertRawLocator(rawLocator, pointer);
  return `sha256:${createHash("sha256").update(rawLocator, "utf8").digest("hex")}`;
}

function assertRawLocator(rawLocator, pointer) {
  if (
    typeof rawLocator !== "string" ||
    rawLocator.length === 0 ||
    rawLocator.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(rawLocator)
  ) {
    failShape(pointer);
  }
}

export function validateEvidence(evidence) {
  const kind = evidenceKind(evidence);
  if (kind === "account-matrix") {
    try {
      return validateAccountMatrix(evidence);
    } catch (error) {
      if (error instanceof AccountMatrixError) fail(error.category, error.pointer);
      throw error;
    }
  }
  if (kind === "provisioning") return validateProvisioningEvidence(evidence);

  assertAllowedKeys(evidence, PROBE_EVIDENCE_KEYS, "/");
  assertRequiredKeys(evidence, REQUIRED_PROBE_EVIDENCE_KEYS, "/");

  if (evidence.schemaVersion !== 1) failShape("/schemaVersion");
  if (Object.hasOwn(evidence, "kind") && evidence.kind !== "probe") failShape("/kind");
  assertString(evidence.probeId, "/probeId", { max: 64, pattern: ALIAS_PATTERN });
  assertString(evidence.runId, "/runId", { max: 128 });
  assertString(evidence.candidateSha, "/candidateSha", { max: 40, pattern: COMMIT_SHA_PATTERN });
  assertTimestamp(evidence.observedAt, "/observedAt");
  assertString(evidence.roleAlias, "/roleAlias", { max: 64, pattern: ALIAS_PATTERN });
  assertString(evidence.browserAlias, "/browserAlias", { max: 64, pattern: ALIAS_PATTERN });
  assertString(evidence.deviceAlias, "/deviceAlias", { max: 64, pattern: ALIAS_PATTERN });
  assertAliases(evidence.aliases, "/aliases");
  assertString(evidence.operationId, "/operationId", { max: 128 });
  assertEndpoint(evidence.endpoint, "/endpoint");

  if (Object.hasOwn(evidence, "httpStatus")) {
    if (!Number.isSafeInteger(evidence.httpStatus) || evidence.httpStatus < 100 || evidence.httpStatus > 599) {
      failShape("/httpStatus");
    }
  }
  if (Object.hasOwn(evidence, "googleRequestId")) {
    assertString(evidence.googleRequestId, "/googleRequestId", { max: 128 });
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

  assertProbeContract(evidence);

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
    let parsed;
    try {
      parsed = new URL(doc);
    } catch {
      failShape(itemPointer);
    }
    if (
      parsed.origin !== "https://developers.google.com" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      (parsed.hash !== "" && !/^#[A-Za-z0-9._~-]+$/.test(parsed.hash))
    ) {
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
    if (entry.path.split("/").some((segment) => segment === "." || segment === "..")) {
      failShape(childPointer(itemPointer, "path"));
    }
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
