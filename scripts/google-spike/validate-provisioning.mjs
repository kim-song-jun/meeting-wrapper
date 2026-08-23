#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { EvidencePolicyError, parseStrictJson } from "./lib/evidence.mjs";
import {
  assertProvisioningReady,
  createProvisioningEvidence,
  parseProvisioningEnv,
} from "./lib/provisioning.mjs";

const MAX_INPUT_BYTES = 16 * 1024;

function fail(category, pointer) {
  throw new EvidencePolicyError(category, pointer);
}

async function readPrivateRegularFile(path, pointer) {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch {
    fail("PROVISIONING_PATH_NOT_READABLE", pointer);
  }

  let contents;
  let operationError;
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail("PROVISIONING_PATH_NOT_REGULAR", pointer);
    if ((before.mode & 0o777) !== 0o600) {
      fail("PROVISIONING_PATH_NOT_PRIVATE", pointer);
    }
    if (before.size > MAX_INPUT_BYTES) {
      fail("PROVISIONING_PATH_TOO_LARGE", pointer);
    }
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) fail("PROVISIONING_PATH_NOT_READABLE", pointer);
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
      fail("PROVISIONING_PATH_NOT_READABLE", pointer);
    }
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      fail("PROVISIONING_PATH_NOT_UTF8", pointer);
    }
  } catch (error) {
    operationError =
      error instanceof EvidencePolicyError
        ? error
        : new EvidencePolicyError("PROVISIONING_PATH_NOT_READABLE", pointer);
  }

  try {
    await handle.close();
  } catch {
    if (!operationError) {
      operationError = new EvidencePolicyError("PROVISIONING_PATH_CLOSE_FAILED", pointer);
    }
  }
  if (operationError) throw operationError;
  return contents;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  let emitRedacted = false;
  let envPath;
  let receiptPath;
  if (arguments_.length === 2 && arguments_.every((value) => !value.startsWith("--"))) {
    [envPath, receiptPath] = arguments_;
  } else if (
    arguments_.length === 3 &&
    arguments_[0] === "--emit-redacted" &&
    arguments_.slice(1).every((value) => !value.startsWith("--"))
  ) {
    emitRedacted = true;
    [, envPath, receiptPath] = arguments_;
  } else {
    fail("INVALID_PROVISIONING_ARGUMENTS", "/");
  }

  const envText = await readPrivateRegularFile(envPath, "/envFile");
  const env = parseProvisioningEnv(envText);
  const receiptText = await readPrivateRegularFile(receiptPath, "/receiptFile");
  let receipt;
  try {
    receipt = parseStrictJson(receiptText);
  } catch {
    fail("INVALID_PROVISIONING_RECEIPT_JSON", "/receipt");
  }
  const evidence = createProvisioningEvidence(env, receipt);

  if (emitRedacted) {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return;
  }

  assertProvisioningReady(evidence);
  process.stdout.write("provisioning-valid schemaVersion=1 status=COMPLETE\n");
}

try {
  await main();
} catch (error) {
  if (error instanceof EvidencePolicyError) {
    process.stderr.write(`${error.category} pointer=${error.pointer}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write("PROVISIONING_VALIDATION_FAILED pointer=/\n");
    process.exitCode = 1;
  }
}
