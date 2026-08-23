#!/usr/bin/env node

import { constants } from "node:fs";
import { open } from "node:fs/promises";

const SENSITIVE_PATTERNS = [
  /\bBearer\s+\S+/i,
  /\baccess_token\b/i,
  /\brefresh_token\b/i,
  /\bclient_secret\b/i,
  /\bAuthorization\b/i,
  /\bcookie\b/i,
  /\battendees\b/i,
  /"summary"\s*:/i,
  /"(?:eventId|fileId|calendarId|roomCalendarId|iCalUID)"\s*:/i,
  /\bya29\.[A-Za-z0-9_-]+/,
  /\bGOCSPX-[A-Za-z0-9_-]+/,
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/,
  /https?:\/\/[^\s?#]+\?[^\s#]+/i,
];

class SensitivePathError extends Error {
  constructor(category, path) {
    super(category);
    this.category = category;
    this.path = path;
  }
}

async function readRegularFile(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new SensitivePathError("PATH_NOT_READABLE", path);
  }

  let contents;
  let operationError;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new SensitivePathError("PATH_NOT_REGULAR", path);
    contents = await handle.readFile("utf8");
  } catch (error) {
    operationError =
      error instanceof SensitivePathError
        ? error
        : new SensitivePathError("PATH_NOT_READABLE", path);
  }

  try {
    await handle.close();
  } catch {
    throw new SensitivePathError("PATH_CLOSE_FAILED", path);
  }

  if (operationError) throw operationError;
  return contents;
}

async function main() {
  const [mode, ...paths] = process.argv.slice(2);
  if (mode !== "--redact" || paths.length === 0) {
    throw new SensitivePathError("INVALID_SCAN_ARGUMENTS", "-");
  }

  if (new Set(paths).size !== paths.length) {
    throw new SensitivePathError("DUPLICATE_SCAN_PATH", "-");
  }

  for (const path of paths) {
    const contents = await readRegularFile(path);
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(contents))) {
      throw new SensitivePathError("FORBIDDEN_PATH_CONTENT", path);
    }
  }

  process.stdout.write(`sensitive-scan-valid files=${paths.length}\n`);
}

try {
  await main();
} catch (error) {
  if (error instanceof SensitivePathError) {
    process.stderr.write(`${error.category} path=${error.path}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write("SENSITIVE_SCAN_FAILED path=-\n");
    process.exitCode = 1;
  }
}
