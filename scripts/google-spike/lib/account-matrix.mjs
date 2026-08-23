import { readFile } from "node:fs/promises";

export class AccountMatrixError extends Error {
  constructor(category, pointer = "/") {
    super(`${category} pointer=${pointer}`);
    this.name = "AccountMatrixError";
    this.category = category;
    this.pointer = pointer;
  }
}

const ACCOUNT_ALIASES = new Set(["ordinary", "room-writer-admin"]);
const ROOM_ALIASES = new Set(["room-a", "room-b"]);
const CAPABILITIES = new Set(["SUPPORTED", "DENIED", "INCONCLUSIVE"]);
const REQUIRED_ROW_ALIASES = new Set([
  "ordinary-room-read",
  "ordinary-own-event-mutation",
  "ordinary-room-copy-write",
  "admin-room-copy-write",
  "same-account-cross-browser-drive",
  "people-directory-search",
  "two-browser-conflict-a",
  "two-browser-conflict-b",
]);
const ENV_KEYS = Object.freeze([
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT",
  "GOOGLE_SPIKE_ADMIN_ACCOUNT",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID",
  "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
]);
const ENV_BINDINGS = Object.freeze({
  GOOGLE_SPIKE_ORDINARY_ACCOUNT: "account:ordinary",
  GOOGLE_SPIKE_ADMIN_ACCOUNT: "account:room-writer-admin",
  GOOGLE_SPIKE_ROOM_A_CALENDAR_ID: "room:room-a",
  GOOGLE_SPIKE_ROOM_B_CALENDAR_ID: "room:room-b",
});

function fail(category, pointer) {
  throw new AccountMatrixError(category, pointer);
}

function record(value, pointer) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("INVALID_ACCOUNT_MATRIX", pointer);
  return value;
}

function string(value, pointer) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f@]/.test(value)) fail("INVALID_ACCOUNT_MATRIX", pointer);
  return value;
}

function exactKeys(value, allowed, pointer) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/_unknown`);
}

function unique(values, pointer) {
  if (new Set(values).size !== values.length) fail("INVALID_ACCOUNT_MATRIX", pointer);
}

function assertAccount(account, index) {
  const pointer = `/accounts/${index}`;
  record(account, pointer);
  exactKeys(account, new Set(["alias", "role", "bindingAlias", "roomWriter", "browserProfiles"]), pointer);
  if (!ACCOUNT_ALIASES.has(account.alias) || account.role !== account.alias) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/alias`);
  if (typeof account.bindingAlias !== "string" || !/^account:(ordinary|room-writer-admin)$/.test(account.bindingAlias)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/bindingAlias`);
  if (typeof account.roomWriter !== "boolean" || account.roomWriter !== (account.alias === "room-writer-admin")) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/roomWriter`);
  if (!Array.isArray(account.browserProfiles) || account.browserProfiles.length < 2) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/browserProfiles`);
  account.browserProfiles.forEach((profile, profileIndex) => string(profile, `${pointer}/browserProfiles/${profileIndex}`));
  unique(account.browserProfiles, `${pointer}/browserProfiles`);
}

function assertRoom(room, index) {
  const pointer = `/rooms/${index}`;
  record(room, pointer);
  exactKeys(room, new Set(["alias", "bindingAlias"]), pointer);
  if (!ROOM_ALIASES.has(room.alias) || room.bindingAlias !== `room:${room.alias}`) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/alias`);
}

function assertFixture(fixture, index, accounts, rooms) {
  const pointer = `/fixtures/${index}`;
  record(fixture, pointer);
  exactKeys(fixture, new Set(["alias", "mutableId", "owner", "room"]), pointer);
  for (const key of ["alias", "mutableId"]) string(fixture[key], `${pointer}/${key}`);
  if (!ACCOUNT_ALIASES.has(fixture.owner) || !ROOM_ALIASES.has(fixture.room)) fail("INVALID_ACCOUNT_MATRIX", pointer);
  if (fixture.mutableId.includes("@")) fail("FORBIDDEN_ACCOUNT_MATRIX_VALUE", `${pointer}/mutableId`);
  if (!accounts.has(fixture.owner) || !rooms.has(fixture.room)) fail("INVALID_ACCOUNT_MATRIX", pointer);
}

function assertRow(row, index, accounts, rooms, fixtures) {
  const pointer = `/rows/${index}`;
  record(row, pointer);
  exactKeys(row, new Set(["alias", "actor", "resource", "owner", "cleanupOwner", "fixture", "expectedCapability", "concurrencyGroup", "concurrent"]), pointer);
  string(row.alias, `${pointer}/alias`);
  if (!accounts.has(row.actor) || !accounts.has(row.owner) || !accounts.has(row.cleanupOwner)) fail("INVALID_ACCOUNT_MATRIX", pointer);
  if (!rooms.has(row.resource) && !new Set(["drive-appdata", "people-directory"]).has(row.resource)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/resource`);
  if (!fixtures.has(row.fixture)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/fixture`);
  if (!CAPABILITIES.has(row.expectedCapability)) fail("INVALID_ACCOUNT_MATRIX", `${pointer}/expectedCapability`);
  if (typeof row.concurrencyGroup !== "string" || typeof row.concurrent !== "boolean") fail("INVALID_ACCOUNT_MATRIX", pointer);
}

function parseEnv(text) {
  if (typeof text !== "string") fail("INVALID_ACCOUNT_MATRIX_ENV", "/env");
  const values = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || line.startsWith("export ")) fail("INVALID_ACCOUNT_MATRIX_ENV", "/env");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!ENV_KEYS.includes(key) || Object.hasOwn(values, key) || value.length === 0 || value.includes("$") || value.includes('"') || value.includes("'") || value.includes("`")) fail("INVALID_ACCOUNT_MATRIX_ENV", "/env");
    values[key] = value;
  }
  if (Object.keys(values).length !== ENV_KEYS.length) fail("INVALID_ACCOUNT_MATRIX_ENV", "/env");
  const accountPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@molcube\.com$/;
  const calendarPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
  if (!accountPattern.test(values.GOOGLE_SPIKE_ORDINARY_ACCOUNT) || !accountPattern.test(values.GOOGLE_SPIKE_ADMIN_ACCOUNT)) fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/accounts");
  if (!calendarPattern.test(values.GOOGLE_SPIKE_ROOM_A_CALENDAR_ID) || !calendarPattern.test(values.GOOGLE_SPIKE_ROOM_B_CALENDAR_ID)) fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/rooms");
  if (values.GOOGLE_SPIKE_ORDINARY_ACCOUNT === values.GOOGLE_SPIKE_ADMIN_ACCOUNT) fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/accounts");
  if (values.GOOGLE_SPIKE_ROOM_A_CALENDAR_ID === values.GOOGLE_SPIKE_ROOM_B_CALENDAR_ID) fail("INVALID_ACCOUNT_MATRIX_ENV", "/env/rooms");
  return values;
}

export function validateAccountMatrix(value, { envText } = {}) {
  const matrix = record(value, "/");
  exactKeys(matrix, new Set(["schemaVersion", "kind", "probeId", "status", "observation", "domain", "accounts", "rooms", "fixtures", "rows"]), "/");
  if (matrix.schemaVersion !== 1 || matrix.kind !== "account-matrix" || matrix.probeId !== "account-matrix" || matrix.status !== "UNBOUND" || matrix.observation !== "UNOBSERVED" || matrix.domain !== "MOLCUBE_COM") fail("INVALID_ACCOUNT_MATRIX", "/");
  if (!Array.isArray(matrix.accounts) || matrix.accounts.length !== 2) fail("INVALID_ACCOUNT_MATRIX", "/accounts");
  matrix.accounts.forEach(assertAccount);
  const accounts = new Set(matrix.accounts.map(({ alias }) => alias));
  unique(matrix.accounts.map(({ bindingAlias }) => bindingAlias), "/accounts/bindingAlias");
  if (accounts.size !== 2 || accounts.has("ordinary") === false || accounts.has("room-writer-admin") === false) fail("INVALID_ACCOUNT_MATRIX", "/accounts");
  if (matrix.accounts[0].bindingAlias === matrix.accounts[1].bindingAlias) fail("INVALID_ACCOUNT_MATRIX", "/accounts/distinct");
  const rooms = Array.isArray(matrix.rooms) ? matrix.rooms : fail("INVALID_ACCOUNT_MATRIX", "/rooms");
  if (rooms.length !== 2) fail("INVALID_ACCOUNT_MATRIX", "/rooms");
  rooms.forEach(assertRoom);
  const roomAliases = new Set(rooms.map(({ alias }) => alias));
  unique(rooms.map(({ bindingAlias }) => bindingAlias), "/rooms/bindingAlias");
  if (roomAliases.size !== 2) fail("INVALID_ACCOUNT_MATRIX", "/rooms");
  const fixtures = Array.isArray(matrix.fixtures) ? matrix.fixtures : fail("INVALID_ACCOUNT_MATRIX", "/fixtures");
  if (fixtures.length < 6) fail("INVALID_ACCOUNT_MATRIX", "/fixtures");
  fixtures.forEach((fixture, index) => assertFixture(fixture, index, accounts, roomAliases));
  unique(fixtures.map(({ alias }) => alias), "/fixtures/alias");
  unique(fixtures.map(({ mutableId }) => mutableId), "/fixtures/mutableId");
  const fixtureAliases = new Set(fixtures.map(({ alias }) => alias));
  const rows = Array.isArray(matrix.rows) ? matrix.rows : fail("INVALID_ACCOUNT_MATRIX", "/rows");
  if (rows.length !== REQUIRED_ROW_ALIASES.size) fail("INVALID_ACCOUNT_MATRIX", "/rows");
  rows.forEach((row, index) => assertRow(row, index, accounts, roomAliases, fixtureAliases));
  unique(rows.map(({ alias }) => alias), "/rows/alias");
  if (new Set(rows.map(({ alias }) => alias)).size !== REQUIRED_ROW_ALIASES.size || rows.some(({ alias }) => !REQUIRED_ROW_ALIASES.has(alias))) fail("INVALID_ACCOUNT_MATRIX", "/rows/alias");
  const byAlias = new Map(rows.map((row) => [row.alias, row]));
  const exact = (alias, expected) => {
    const row = byAlias.get(alias);
    for (const [key, value] of Object.entries(expected)) if (row[key] !== value) fail("INVALID_ACCOUNT_MATRIX", `/rows/${rows.indexOf(row)}/${key}`);
  };
  exact("ordinary-room-read", { actor: "ordinary", owner: "ordinary", resource: "room-a", expectedCapability: "SUPPORTED" });
  exact("ordinary-own-event-mutation", { actor: "ordinary", owner: "ordinary", resource: "room-a", expectedCapability: "SUPPORTED" });
  exact("ordinary-room-copy-write", { actor: "ordinary", owner: "ordinary", resource: "room-b", expectedCapability: "DENIED" });
  exact("admin-room-copy-write", { actor: "room-writer-admin", owner: "room-writer-admin", resource: "room-a", expectedCapability: "INCONCLUSIVE" });
  exact("same-account-cross-browser-drive", { actor: "ordinary", owner: "ordinary", resource: "drive-appdata", expectedCapability: "SUPPORTED" });
  exact("people-directory-search", { actor: "ordinary", owner: "ordinary", resource: "people-directory", expectedCapability: "INCONCLUSIVE" });
  exact("two-browser-conflict-a", { actor: "ordinary", owner: "ordinary", resource: "room-b", expectedCapability: "INCONCLUSIVE", concurrencyGroup: "conflict-room-b" });
  exact("two-browser-conflict-b", { actor: "room-writer-admin", owner: "room-writer-admin", resource: "room-b", expectedCapability: "INCONCLUSIVE", concurrencyGroup: "conflict-room-b" });
  const fixtureRows = new Map();
  for (const row of rows) {
    const fixture = fixtureAliases.has(row.fixture) ? matrix.fixtures.find((candidate) => candidate.alias === row.fixture) : undefined;
    if (!fixture || row.cleanupOwner !== fixture.owner || (ROOM_ALIASES.has(row.resource) && row.resource !== fixture.room)) fail("INVALID_ACCOUNT_MATRIX", `/rows/${rows.indexOf(row)}/cleanupOwner`);
    const previous = fixtureRows.get(row.fixture);
    if (previous && (previous.concurrent || row.concurrent || previous.concurrencyGroup === row.concurrencyGroup)) fail("INVALID_ACCOUNT_MATRIX", `/rows/${rows.indexOf(row)}/fixture`);
    fixtureRows.set(row.fixture, row);
  }
  if (envText !== undefined) {
    const env = parseEnv(envText);
    for (const [key, bindingAlias] of Object.entries(ENV_BINDINGS)) {
      const expected = bindingAlias === "account:ordinary" ? "ordinary" : bindingAlias === "account:room-writer-admin" ? "room-writer-admin" : bindingAlias.slice("room:".length);
      if (!matrix.accounts.concat(matrix.rooms).some((entry) => entry.bindingAlias === bindingAlias && entry.alias === expected)) fail("INVALID_ACCOUNT_MATRIX", `/env/${key}`);
      if (env[key].length === 0) fail("INVALID_ACCOUNT_MATRIX_ENV", `/env/${key}`);
    }
  }
  return matrix;
}

export async function readAccountMatrix(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("ACCOUNT_MATRIX_NOT_READABLE", "/");
  }
  return validateAccountMatrix(parsed);
}
