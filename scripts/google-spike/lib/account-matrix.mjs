import { EnvContractError, parseSharedEnv } from "./env-contract.mjs";

export class AccountMatrixError extends Error {
  constructor(category, pointer = "/") {
    super(`${category} pointer=${pointer}`);
    this.name = "AccountMatrixError";
    this.category = category;
    this.pointer = pointer;
  }
}

const TASK5_ENV_KEYS = Object.freeze([
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT",
  "GOOGLE_SPIKE_ADMIN_ACCOUNT",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID",
  "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
]);
const ACCOUNT_EMAIL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@molcube\.com$/;
const CALENDAR_ID_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

const CANONICAL_ACCOUNTS = Object.freeze({
  ordinary: Object.freeze({
    alias: "ordinary",
    role: "ordinary",
    bindingAlias: "account:ordinary",
    roomWriter: false,
    browserProfiles: Object.freeze(["ordinary-chrome-desktop", "ordinary-safari-desktop"]),
  }),
  "room-writer-admin": Object.freeze({
    alias: "room-writer-admin",
    role: "room-writer-admin",
    bindingAlias: "account:room-writer-admin",
    roomWriter: true,
    browserProfiles: Object.freeze(["admin-chrome-desktop", "admin-safari-desktop"]),
  }),
});
const CANONICAL_ROOMS = Object.freeze({
  "room-a": Object.freeze({ alias: "room-a", bindingAlias: "room:room-a" }),
  "room-b": Object.freeze({ alias: "room-b", bindingAlias: "room:room-b" }),
});
const CANONICAL_FIXTURES = Object.freeze({
  "ordinary-own-event": Object.freeze({ alias: "ordinary-own-event", mutableId: "fixture:ordinary-own-event", owner: "ordinary", room: "room-a" }),
  "ordinary-room-copy": Object.freeze({ alias: "ordinary-room-copy", mutableId: "fixture:ordinary-room-copy", owner: "ordinary", room: "room-b" }),
  "admin-room-copy": Object.freeze({ alias: "admin-room-copy", mutableId: "fixture:admin-room-copy", owner: "room-writer-admin", room: "room-a" }),
  "cross-browser-preference": Object.freeze({ alias: "cross-browser-preference", mutableId: "fixture:cross-browser-preference", owner: "ordinary", room: "room-a" }),
  "conflict-event-a": Object.freeze({ alias: "conflict-event-a", mutableId: "fixture:conflict-event-a", owner: "ordinary", room: "room-b" }),
  "conflict-event-b": Object.freeze({ alias: "conflict-event-b", mutableId: "fixture:conflict-event-b", owner: "room-writer-admin", room: "room-b" }),
});
const CANONICAL_ROWS = Object.freeze({
  "ordinary-room-read": Object.freeze({ alias: "ordinary-room-read", actor: "ordinary", resource: "room-a", owner: "ordinary", cleanupOwner: "ordinary", fixture: "ordinary-own-event", expectedCapability: "SUPPORTED", concurrencyGroup: "ordinary-read", concurrent: false }),
  "ordinary-own-event-mutation": Object.freeze({ alias: "ordinary-own-event-mutation", actor: "ordinary", resource: "room-a", owner: "ordinary", cleanupOwner: "ordinary", fixture: "ordinary-own-event", expectedCapability: "SUPPORTED", concurrencyGroup: "ordinary-mutation", concurrent: false }),
  "ordinary-room-copy-write": Object.freeze({ alias: "ordinary-room-copy-write", actor: "ordinary", resource: "room-b", owner: "ordinary", cleanupOwner: "ordinary", fixture: "ordinary-room-copy", expectedCapability: "DENIED", concurrencyGroup: "ordinary-room-copy", concurrent: false }),
  "admin-room-copy-write": Object.freeze({ alias: "admin-room-copy-write", actor: "room-writer-admin", resource: "room-a", owner: "room-writer-admin", cleanupOwner: "room-writer-admin", fixture: "admin-room-copy", expectedCapability: "INCONCLUSIVE", concurrencyGroup: "admin-room-copy", concurrent: false }),
  "same-account-cross-browser-drive": Object.freeze({ alias: "same-account-cross-browser-drive", actor: "ordinary", resource: "drive-appdata", owner: "ordinary", cleanupOwner: "ordinary", fixture: "cross-browser-preference", expectedCapability: "SUPPORTED", concurrencyGroup: "drive-read", concurrent: false }),
  "people-directory-search": Object.freeze({ alias: "people-directory-search", actor: "ordinary", resource: "people-directory", owner: "ordinary", cleanupOwner: "ordinary", fixture: "cross-browser-preference", expectedCapability: "INCONCLUSIVE", concurrencyGroup: "people-search", concurrent: false }),
  "two-browser-conflict-a": Object.freeze({ alias: "two-browser-conflict-a", actor: "ordinary", resource: "room-b", owner: "ordinary", cleanupOwner: "ordinary", fixture: "conflict-event-a", expectedCapability: "INCONCLUSIVE", concurrencyGroup: "conflict-room-b", concurrent: true }),
  "two-browser-conflict-b": Object.freeze({ alias: "two-browser-conflict-b", actor: "room-writer-admin", resource: "room-b", owner: "room-writer-admin", cleanupOwner: "room-writer-admin", fixture: "conflict-event-b", expectedCapability: "INCONCLUSIVE", concurrencyGroup: "conflict-room-b", concurrent: true }),
});

function fail(category, pointer) {
  throw new AccountMatrixError(category, pointer);
}

function assertRecord(value, pointer) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("INVALID_ACCOUNT_MATRIX", pointer);
}

function assertExactKeys(value, expected, pointer) {
  const expectedKeys = Object.keys(expected);
  for (const key of Object.keys(value)) {
    if (!expectedKeys.includes(key)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/_unknown`);
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/${key}`);
  }
}

function assertExactTuple(value, expected, pointer) {
  assertRecord(value, pointer);
  assertExactKeys(value, expected, pointer);
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(value[key]) || value[key].length !== expectedValue.length) {
        fail("INVALID_ACCOUNT_MATRIX", `${pointer}/${key}`);
      }
      const expectedSet = new Set(expectedValue);
      value[key].forEach((entry, index) => {
        if (!expectedSet.has(entry)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/${key}/${index}`);
      });
      if (new Set(value[key]).size !== expectedSet.size) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/${key}`);
    } else if (value[key] !== expectedValue) {
      fail("INVALID_ACCOUNT_MATRIX", `${pointer}/${key}`);
    }
  }
}

function assertExactCollection(value, expectedByAlias, pointer) {
  if (!Array.isArray(value) || value.length !== Object.keys(expectedByAlias).length) {
    fail("INVALID_ACCOUNT_MATRIX", pointer);
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    assertRecord(entry, `${pointer}/${index}`);
    const expected = expectedByAlias[entry.alias];
    if (!expected || seen.has(entry.alias)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/${index}/alias`);
    seen.add(entry.alias);
    assertExactTuple(entry, expected, `${pointer}/${index}`);
  });
}

function parseTask5Env(text) {
  let env;
  try {
    env = parseSharedEnv(text, {
      category: "INVALID_ACCOUNT_MATRIX_ENV",
      requiredKeys: TASK5_ENV_KEYS,
      unknownPointer: "/env/_unknown",
      reportMissingKey: true,
    });
  } catch (error) {
    if (error instanceof EnvContractError) fail(error.category, error.pointer);
    throw error;
  }
  if (!ACCOUNT_EMAIL_PATTERN.test(env.GOOGLE_SPIKE_ORDINARY_ACCOUNT)) {
    fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/accounts/ordinary");
  }
  if (!ACCOUNT_EMAIL_PATTERN.test(env.GOOGLE_SPIKE_ADMIN_ACCOUNT)) {
    fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/accounts/roomWriterAdmin");
  }
  if (env.GOOGLE_SPIKE_ORDINARY_ACCOUNT === env.GOOGLE_SPIKE_ADMIN_ACCOUNT) {
    fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/accounts/distinct");
  }
  if (!CALENDAR_ID_PATTERN.test(env.GOOGLE_SPIKE_ROOM_A_CALENDAR_ID)) {
    fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/rooms/0");
  }
  if (!CALENDAR_ID_PATTERN.test(env.GOOGLE_SPIKE_ROOM_B_CALENDAR_ID)) {
    fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/rooms/1");
  }
  if (env.GOOGLE_SPIKE_ROOM_A_CALENDAR_ID === env.GOOGLE_SPIKE_ROOM_B_CALENDAR_ID) {
    fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/rooms");
  }
  return env;
}

export function validateAccountMatrix(value, { envText } = {}) {
  assertRecord(value, "/");
  const matrixKeys = {
    schemaVersion: 1,
    kind: "account-matrix",
    probeId: "account-matrix",
    status: "UNBOUND",
    observation: "UNOBSERVED",
    domain: "MOLCUBE_COM",
    accounts: undefined,
    rooms: undefined,
    fixtures: undefined,
    rows: undefined,
  };
  assertExactKeys(value, matrixKeys, "/");
  for (const [key, expected] of Object.entries(matrixKeys)) {
    if (expected !== undefined && value[key] !== expected) fail("INVALID_ACCOUNT_MATRIX", `/${key}`);
  }

  assertExactCollection(value.accounts, CANONICAL_ACCOUNTS, "/accounts");
  assertExactCollection(value.rooms, CANONICAL_ROOMS, "/rooms");
  assertExactCollection(value.fixtures, CANONICAL_FIXTURES, "/fixtures");
  assertExactCollection(value.rows, CANONICAL_ROWS, "/rows");

  if (envText !== undefined) parseTask5Env(envText);
  return value;
}
