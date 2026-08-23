#!/usr/bin/env node

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { EvidencePolicyError, parseStrictJson, validateEvidence } from "./lib/evidence.mjs";

const MAX_EVIDENCE_BYTES = 16_384;

function sameFileSnapshot(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

async function readBoundedEvidence(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new EvidencePolicyError("EVIDENCE_PATH_NOT_READABLE", "/");
  }

  let contents;
  let failure;
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile()) throw new EvidencePolicyError("EVIDENCE_PATH_NOT_REGULAR", "/");
    if (metadata.size > BigInt(MAX_EVIDENCE_BYTES)) {
      throw new EvidencePolicyError("EVIDENCE_TOO_LARGE", "/");
    }
    const bytes = Buffer.alloc(Number(metadata.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new EvidencePolicyError("EVIDENCE_PATH_NOT_READABLE", "/");
      offset += bytesRead;
    }
    const finalMetadata = await handle.stat({ bigint: true });
    if (!sameFileSnapshot(metadata, finalMetadata)) {
      throw new EvidencePolicyError(
        finalMetadata.size > BigInt(MAX_EVIDENCE_BYTES)
          ? "EVIDENCE_TOO_LARGE"
          : "EVIDENCE_PATH_NOT_READABLE",
        "/",
      );
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    contents = decoder.decode(bytes);
  } catch (error) {
    failure = error instanceof EvidencePolicyError
      ? error
      : error instanceof TypeError
        ? new EvidencePolicyError("INVALID_EVIDENCE_UTF8", "/")
        : new EvidencePolicyError("EVIDENCE_PATH_NOT_READABLE", "/");
  } finally {
    try {
      await handle.close();
    } catch {
      if (!failure) failure = new EvidencePolicyError("EVIDENCE_PATH_CLOSE_FAILED", "/");
    }
  }
  if (failure) throw failure;
  return contents;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const evidencePath = arguments_[0];
  let expectedKind;
  if (arguments_.length === 3 && arguments_[1] === "--kind") {
    expectedKind = arguments_[2];
  } else if (arguments_.length !== 1) {
    throw new EvidencePolicyError("INVALID_EVIDENCE_ARGUMENTS", "/");
  }

  const contents = await readBoundedEvidence(evidencePath);

  let evidence;
  try {
    evidence = parseStrictJson(contents);
  } catch (error) {
    if (error?.category === "DUPLICATE_JSON_KEY") {
      throw new EvidencePolicyError("DUPLICATE_JSON_KEY", "/");
    }
    if (error instanceof EvidencePolicyError) throw error;
    if (error?.name === "TypeError" && /UTF-8/i.test(error.message)) {
      throw new EvidencePolicyError("INVALID_EVIDENCE_UTF8", "/");
    }
    throw new EvidencePolicyError("INVALID_EVIDENCE_JSON", "/");
  }

  validateEvidence(evidence);
  if (expectedKind !== undefined && evidence.kind !== expectedKind) {
    throw new EvidencePolicyError("EVIDENCE_KIND_MISMATCH", "/kind");
  }
  if (evidence.kind === "provisioning" || evidence.kind === "account-matrix") {
    process.stdout.write(
      `evidence-valid schemaVersion=${evidence.schemaVersion} kind=${evidence.kind} status=${evidence.status}\n`,
    );
  } else {
    process.stdout.write(
      `evidence-valid schemaVersion=${evidence.schemaVersion} probeId=${evidence.probeId}\n`,
    );
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof EvidencePolicyError) {
    process.stderr.write(`${error.category} pointer=${error.pointer}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write("EVIDENCE_VALIDATION_FAILED pointer=/\n");
    process.exitCode = 1;
  }
}
