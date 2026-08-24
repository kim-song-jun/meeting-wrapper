import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";

const MAX_INPUT_BYTES = 16 * 1024;

export class PrivateInputError extends Error {
  constructor(category, pointer) {
    super(`${category} pointer=${pointer}`);
    this.name = "PrivateInputError";
    this.category = category;
    this.pointer = pointer;
  }
}

function fail(categoryPrefix, suffix, pointer) {
  throw new PrivateInputError(`${categoryPrefix}_${suffix}`, pointer);
}

export async function readBoundedUtf8RegularFile(
  path,
  { categoryPrefix, pointer, requireExactMode = false } = {},
) {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch {
    fail(categoryPrefix, "NOT_READABLE", pointer);
  }

  let contents;
  let operationError;
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail(categoryPrefix, "NOT_REGULAR", pointer);
    if (requireExactMode && (before.mode & 0o777) !== 0o600) {
      fail(categoryPrefix, "NOT_PRIVATE", pointer);
    }
    if (before.size > MAX_INPUT_BYTES) fail(categoryPrefix, "TOO_LARGE", pointer);

    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) fail(categoryPrefix, "NOT_READABLE", pointer);
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      fail(categoryPrefix, "NOT_READABLE", pointer);
    }
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      fail(categoryPrefix, "NOT_UTF8", pointer);
    }
  } catch (error) {
    operationError = error instanceof PrivateInputError
      ? error
      : new PrivateInputError(`${categoryPrefix}_NOT_READABLE`, pointer);
  }

  try {
    await handle.close();
  } catch {
    if (!operationError) {
      operationError = new PrivateInputError(`${categoryPrefix}_CLOSE_FAILED`, pointer);
    }
  }
  if (operationError) throw operationError;
  return contents;
}
