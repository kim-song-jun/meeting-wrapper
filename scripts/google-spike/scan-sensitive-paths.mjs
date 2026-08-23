#!/usr/bin/env node

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { containsSensitiveMaterial } from "./lib/evidence.mjs";

const MAX_SCAN_BYTES = 1_048_576;

const SENSITIVE_PATTERNS = [
  /\battendees\b/i,
  /"summary"\s*:/i,
  /"(?:eventId|fileId|calendarId|roomCalendarId|iCalUID)"\s*:/i,
];

class SensitivePathError extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}

function sameFileSnapshot(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

async function readRegularFile(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new SensitivePathError("PATH_NOT_READABLE");
  }

  let contents;
  let operationError;
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile()) throw new SensitivePathError("PATH_NOT_REGULAR");
    if (metadata.size > BigInt(MAX_SCAN_BYTES)) throw new SensitivePathError("PATH_TOO_LARGE");
    const bytes = Buffer.alloc(Number(metadata.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new SensitivePathError("PATH_NOT_READABLE");
      offset += bytesRead;
    }
    const finalMetadata = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(metadata, finalMetadata)) {
      throw new SensitivePathError(
        finalMetadata.size > BigInt(MAX_SCAN_BYTES) ? "PATH_TOO_LARGE" : "PATH_NOT_READABLE",
      );
    }
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SensitivePathError("PATH_INVALID_UTF8");
    }
  } catch (error) {
    operationError =
      error instanceof SensitivePathError
        ? error
        : new SensitivePathError("PATH_NOT_READABLE");
  }

  try {
    await handle.close();
  } catch {
    if (!operationError) operationError = new SensitivePathError("PATH_CLOSE_FAILED");
  }

  if (operationError) throw operationError;
  return contents;
}

async function main() {
  const [mode, ...paths] = process.argv.slice(2);
  if (mode !== "--redact" || paths.length === 0) {
    throw new SensitivePathError("INVALID_SCAN_ARGUMENTS");
  }

  if (new Set(paths).size !== paths.length) {
    throw new SensitivePathError("DUPLICATE_SCAN_PATH");
  }

  for (const path of paths) {
    const contents = await readRegularFile(path);
    if (containsSensitiveMaterial(contents) || SENSITIVE_PATTERNS.some((pattern) => pattern.test(contents))) {
      throw new SensitivePathError("FORBIDDEN_PATH_CONTENT");
    }
  }

  process.stdout.write(`sensitive-scan-valid files=${paths.length}\n`);
}

try {
  await main();
} catch (error) {
  if (error instanceof SensitivePathError) {
    process.stderr.write(`${error.category} path=-\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write("SENSITIVE_SCAN_FAILED path=-\n");
    process.exitCode = 1;
  }
}
