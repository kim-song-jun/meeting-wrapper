import { EvidencePolicyError, validateEvidence } from "./evidence.mjs";

const ENV_KEYS = Object.freeze([
  "VITE_GOOGLE_CLIENT_ID",
  "VITE_ALLOWED_HD",
  "GOOGLE_SPIKE_AUTHORIZED_ORIGINS",
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT",
  "GOOGLE_SPIKE_ADMIN_ACCOUNT",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID",
  "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
]);
const ENV_KEY_SET = new Set(ENV_KEYS);
const RECEIPT_KEYS = new Set([
  "schemaVersion",
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
]);
const REQUIRED_RECEIPT_KEYS = [...RECEIPT_KEYS].filter((key) => key !== "observedAt");
const EXPECTED_ORIGINS = new Set([
  "http://localhost:5184",
  "https://molroom.molcube.com",
]);
const ACCOUNT_SEPARATOR = String.fromCharCode(64);
const ACCOUNT_LOCAL_PATTERN = /^(?=.{1,64}$)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CLIENT_ID_PATTERN = /^\d{6,}-([a-z0-9]{8,})\.apps\.googleusercontent\.com$/;
const CLIENT_ID_SUFFIX_PATTERN = /^[a-z0-9]{8}$/;
const MAX_INPUT_BYTES = 16 * 1024;

function fail(category, pointer) {
  throw new EvidencePolicyError(category, pointer);
}

function isPlainRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function copyJsonValue(value) {
  if (Array.isArray(value)) return value.map(copyJsonValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, copyJsonValue(child)]),
    );
  }
  return value;
}

function deepFreeze(value) {
  if ((isPlainRecord(value) || Array.isArray(value)) && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function childPointer(pointer, segment) {
  return pointer === "/" ? `/${segment}` : `${pointer}/${segment}`;
}

function assertExactKeys(
  value,
  allowedKeys,
  requiredKeys,
  pointer,
  shapeCategory,
  unknownCategory = shapeCategory,
) {
  if (!isPlainRecord(value)) fail(shapeCategory, pointer);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) fail(unknownCategory, childPointer(pointer, "_unknown"));
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) fail(shapeCategory, childPointer(pointer, key));
  }
}

function assertSafeEnvString(value, pointer) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f\s]/.test(value)
  ) {
    fail("INVALID_PROVISIONING_ENV", pointer);
  }
}

function assertDomainName(value, pointer) {
  if (typeof value !== "string" || value.length > 253) {
    fail("INVALID_PROVISIONING_ENV", pointer);
  }
  const labels = value.split(".");
  if (labels.length < 2 || labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))) {
    fail("INVALID_PROVISIONING_ENV", pointer);
  }
}

function assertHostedAccount(value, pointer) {
  assertSafeEnvString(value, pointer);
  const parts = value.split(ACCOUNT_SEPARATOR);
  if (
    parts.length !== 2 ||
    !ACCOUNT_LOCAL_PATTERN.test(parts[0]) ||
    parts[1] !== "molcube.com"
  ) {
    fail("INVALID_PROVISIONING_ENV", pointer);
  }
}

function assertCalendarIdentifier(value, pointer) {
  assertSafeEnvString(value, pointer);
  const parts = value.split(ACCOUNT_SEPARATOR);
  if (
    parts.length !== 2 ||
    !ACCOUNT_LOCAL_PATTERN.test(parts[0]) ||
    parts[1].length === 0
  ) {
    fail("INVALID_PROVISIONING_ENV", pointer);
  }
  assertDomainName(parts[1], pointer);
}

function clientIdSuffix(clientId) {
  const match = CLIENT_ID_PATTERN.exec(clientId);
  if (!match) fail("INVALID_PROVISIONING_ENV", "/clientIdSuffix");
  return match[1].slice(-8);
}

function validateEnvRecord(value) {
  assertExactKeys(
    value,
    ENV_KEY_SET,
    ENV_KEYS,
    "/env",
    "INVALID_PROVISIONING_ENV",
  );
  for (const key of ENV_KEYS) assertSafeEnvString(value[key], "/env");

  clientIdSuffix(value.VITE_GOOGLE_CLIENT_ID);
  if (value.VITE_ALLOWED_HD !== "molcube.com") {
    fail("INVALID_PROVISIONING_ENV", "/domain");
  }

  const origins = value.GOOGLE_SPIKE_AUTHORIZED_ORIGINS.split(",");
  if (
    origins.length !== EXPECTED_ORIGINS.size ||
    new Set(origins).size !== origins.length ||
    origins.some((origin) => !EXPECTED_ORIGINS.has(origin))
  ) {
    fail("INVALID_PROVISIONING_ENV", "/origins");
  }

  assertHostedAccount(value.GOOGLE_SPIKE_ORDINARY_ACCOUNT, "/accounts/ordinary");
  assertHostedAccount(value.GOOGLE_SPIKE_ADMIN_ACCOUNT, "/accounts/roomWriterAdmin");
  if (value.GOOGLE_SPIKE_ORDINARY_ACCOUNT === value.GOOGLE_SPIKE_ADMIN_ACCOUNT) {
    fail("INVALID_PROVISIONING_ENV", "/accounts/distinct");
  }

  assertCalendarIdentifier(value.GOOGLE_SPIKE_ROOM_A_CALENDAR_ID, "/rooms/0");
  assertCalendarIdentifier(value.GOOGLE_SPIKE_ROOM_B_CALENDAR_ID, "/rooms/1");
  if (value.GOOGLE_SPIKE_ROOM_A_CALENDAR_ID === value.GOOGLE_SPIKE_ROOM_B_CALENDAR_ID) {
    fail("INVALID_PROVISIONING_ENV", "/rooms");
  }
  return value;
}

function allTrue(value, keys) {
  return isPlainRecord(value) && keys.every((key) => value[key] === true);
}

function receiptIsReady(receipt) {
  return (
    receipt.observation === "OPERATOR_OBSERVED" &&
    receipt.operatorVerified === true &&
    receipt.appType === "INTERNAL" &&
    typeof receipt.clientIdSuffix === "string" &&
    CLIENT_ID_SUFFIX_PATTERN.test(receipt.clientIdSuffix) &&
    receipt.workspaceEdition !== "UNOBSERVED" &&
    allTrue(receipt.enabledApis, ["calendar", "drive", "people"]) &&
    allTrue(receipt.initialScopes, [
      "calendarEvents",
      "calendarReadonly",
      "driveAppdata",
    ]) &&
    allTrue(receipt.origins, ["localhostSpike", "production"]) &&
    isPlainRecord(receipt.accounts) &&
    receipt.accounts.ordinary?.present === true &&
    receipt.accounts.roomWriterAdmin?.present === true &&
    receipt.accounts.distinct === true &&
    Array.isArray(receipt.rooms) &&
    receipt.rooms.length === 2 &&
    receipt.rooms.every(
      (room) =>
        isPlainRecord(room) &&
        room.present === true &&
        room.domainReadAcl === true &&
        room.ordinaryRoomWriter === false &&
        room.adminRoomWriter === true &&
        (room.autoAccept === "ENABLED" || room.autoAccept === "DISABLED"),
    ) &&
    receipt.tenantPolicy === "ALLOWED"
  );
}

function deriveState(receipt) {
  if (receipt.tenantPolicy === "BLOCKED") {
    return { status: "TENANT_POLICY_BLOCKED", capability: "TENANT_BLOCKED" };
  }
  if (receiptIsReady(receipt)) {
    return { status: "COMPLETE", capability: "SUPPORTED" };
  }
  return { status: "INCOMPLETE", capability: "INCONCLUSIVE" };
}

function evidenceFromReceipt(receipt) {
  const { status, capability } = deriveState(receipt);
  return {
    ...copyJsonValue(receipt),
    kind: "provisioning",
    probeId: "provisioning",
    status,
    capability,
  };
}

export function parseProvisioningEnv(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > MAX_INPUT_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) {
    fail("INVALID_PROVISIONING_ENV", "/env");
  }

  const parsed = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || line.startsWith("export ")) {
      fail("INVALID_PROVISIONING_ENV", "/env");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (
      !ENV_KEY_SET.has(key) ||
      Object.hasOwn(parsed, key) ||
      value.includes("$") ||
      value.includes('"') ||
      value.includes("'") ||
      value.includes("`")
    ) {
      fail("INVALID_PROVISIONING_ENV", "/env");
    }
    parsed[key] = value;
  }

  const result = Object.fromEntries(ENV_KEYS.map((key) => [key, parsed[key]]));
  validateEnvRecord(result);
  return deepFreeze(result);
}

export function validateProvisioningReceipt(receipt) {
  assertExactKeys(
    receipt,
    RECEIPT_KEYS,
    REQUIRED_RECEIPT_KEYS,
    "/",
    "INVALID_EVIDENCE_SHAPE",
    "FORBIDDEN_EVIDENCE_FIELD",
  );
  const copy = copyJsonValue(receipt);
  validateEvidence(evidenceFromReceipt(copy));
  return deepFreeze(copy);
}

export function createProvisioningEvidence(env, receipt) {
  validateEnvRecord(env);
  const validatedReceipt = validateProvisioningReceipt(receipt);
  if (
    validatedReceipt.clientIdSuffix !== "UNOBSERVED" &&
    validatedReceipt.clientIdSuffix !== clientIdSuffix(env.VITE_GOOGLE_CLIENT_ID)
  ) {
    fail("PROVISIONING_ENV_MISMATCH", "/clientIdSuffix");
  }

  const evidence = evidenceFromReceipt(validatedReceipt);
  validateEvidence(evidence);
  const serialized = JSON.stringify(evidence);
  if (Object.values(env).some((rawValue) => serialized.includes(rawValue))) {
    fail("RAW_PROVISIONING_VALUE_RETAINED", "/");
  }
  return deepFreeze(evidence);
}

export function assertProvisioningReady(evidence) {
  validateEvidence(evidence);
  if (evidence.status === "TENANT_POLICY_BLOCKED") {
    fail("TENANT_POLICY_BLOCKED", "/tenantPolicy");
  }
  if (evidence.status === "COMPLETE") return "COMPLETE";

  const checks = [
    [evidence.observation === "OPERATOR_OBSERVED", "/observation"],
    [Object.hasOwn(evidence, "observedAt"), "/observedAt"],
    [evidence.operatorVerified === true, "/operatorVerified"],
    [evidence.appType === "INTERNAL", "/appType"],
    [evidence.clientIdSuffix !== "UNOBSERVED", "/clientIdSuffix"],
    [evidence.workspaceEdition !== "UNOBSERVED", "/workspaceEdition"],
    [evidence.enabledApis.calendar === true, "/enabledApis/calendar"],
    [evidence.enabledApis.drive === true, "/enabledApis/drive"],
    [evidence.enabledApis.people === true, "/enabledApis/people"],
    [evidence.initialScopes.calendarEvents === true, "/initialScopes/calendarEvents"],
    [
      evidence.initialScopes.calendarReadonly === true,
      "/initialScopes/calendarReadonly",
    ],
    [evidence.initialScopes.driveAppdata === true, "/initialScopes/driveAppdata"],
    [evidence.origins.localhostSpike === true, "/origins/localhostSpike"],
    [evidence.origins.production === true, "/origins/production"],
    [evidence.accounts.ordinary.present === true, "/accounts/ordinary/present"],
    [
      evidence.accounts.roomWriterAdmin.present === true,
      "/accounts/roomWriterAdmin/present",
    ],
    [evidence.accounts.distinct === true, "/accounts/distinct"],
  ];

  evidence.rooms.forEach((room, index) => {
    checks.push(
      [room.present === true, `/rooms/${index}/present`],
      [room.domainReadAcl === true, `/rooms/${index}/domainReadAcl`],
      [room.ordinaryRoomWriter === false, `/rooms/${index}/ordinaryRoomWriter`],
      [room.adminRoomWriter === true, `/rooms/${index}/adminRoomWriter`],
      [room.autoAccept !== "UNOBSERVED", `/rooms/${index}/autoAccept`],
    );
  });
  checks.push([evidence.tenantPolicy === "ALLOWED", "/tenantPolicy"]);

  const missing = checks.find(([ready]) => !ready);
  fail("PROVISIONING_INCOMPLETE", missing?.[1] ?? "/status");
}
