#!/usr/bin/env node

import { EvidencePolicyError, parseStrictJson } from "./lib/evidence.mjs";
import { PrivateInputError, readBoundedUtf8RegularFile } from "./lib/private-input.mjs";
import {
  assertProvisioningReady,
  createProvisioningEvidence,
  parseProvisioningEnv,
} from "./lib/provisioning.mjs";

function fail(category, pointer) {
  throw new EvidencePolicyError(category, pointer);
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

  const envText = await readBoundedUtf8RegularFile(envPath, {
    categoryPrefix: "PROVISIONING_PATH",
    pointer: "/envFile",
    requireExactMode: true,
  });
  const env = parseProvisioningEnv(envText);
  const receiptText = await readBoundedUtf8RegularFile(receiptPath, {
    categoryPrefix: "PROVISIONING_PATH",
    pointer: "/receiptFile",
    requireExactMode: true,
  });
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
  if (error instanceof EvidencePolicyError || error instanceof PrivateInputError) {
    process.stderr.write(`${error.category} pointer=${error.pointer}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write("PROVISIONING_VALIDATION_FAILED pointer=/\n");
    process.exitCode = 1;
  }
}
