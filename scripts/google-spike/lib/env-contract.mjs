const MAX_ENV_BYTES = 16 * 1024;

export const SHARED_ENV_KEYS = Object.freeze([
  "VITE_GOOGLE_CLIENT_ID",
  "VITE_ALLOWED_HD",
  "GOOGLE_SPIKE_AUTHORIZED_ORIGINS",
  "GOOGLE_SPIKE_ORDINARY_ACCOUNT",
  "GOOGLE_SPIKE_ADMIN_ACCOUNT",
  "GOOGLE_SPIKE_ROOM_A_CALENDAR_ID",
  "GOOGLE_SPIKE_ROOM_B_CALENDAR_ID",
]);

const SHARED_ENV_KEY_SET = new Set(SHARED_ENV_KEYS);

export class EnvContractError extends Error {
  constructor(category, pointer) {
    super(`${category} pointer=${pointer}`);
    this.name = "EnvContractError";
    this.category = category;
    this.pointer = pointer;
  }
}

function fail(category, pointer) {
  throw new EnvContractError(category, pointer);
}

function isBlankOrComment(line) {
  return line.trim() === "" || /^\s*#/.test(line);
}

export function parseSharedEnv(
  text,
  { category, requiredKeys = [], unknownPointer = "/env", reportMissingKey = false } = {},
) {
  if (
    typeof text !== "string" ||
    typeof category !== "string" ||
    Buffer.byteLength(text, "utf8") > MAX_ENV_BYTES ||
    /[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]|\r(?!\n)/.test(text)
  ) {
    fail(category, "/env");
  }

  const requiredKeySet = new Set(requiredKeys);
  if (
    requiredKeySet.size !== requiredKeys.length ||
    [...requiredKeySet].some((key) => !SHARED_ENV_KEY_SET.has(key))
  ) {
    fail(category, "/env");
  }

  const values = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (isBlankOrComment(line)) continue;
    const separator = line.indexOf("=");
    if (separator <= 0 || line.startsWith("export ")) fail(category, "/env");

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!SHARED_ENV_KEY_SET.has(key)) fail(category, unknownPointer);
    if (
      Object.hasOwn(values, key) ||
      value.length === 0 ||
      value !== value.trim() ||
      /["'$`]/.test(value)
    ) {
      fail(category, "/env");
    }
    values[key] = value;
  }

  for (const key of requiredKeys) {
    if (!Object.hasOwn(values, key)) {
      fail(category, reportMissingKey ? `/env/${key}` : "/env");
    }
  }
  return Object.freeze(values);
}
