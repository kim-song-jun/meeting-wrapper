#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { EvidencePolicyError, validateEvidence } from "./lib/evidence.mjs";

async function main() {
  const [evidencePath, ...extraArguments] = process.argv.slice(2);
  if (!evidencePath || extraArguments.length > 0) {
    throw new EvidencePolicyError("INVALID_EVIDENCE_ARGUMENTS", "/");
  }

  let contents;
  try {
    contents = await readFile(evidencePath, "utf8");
  } catch {
    throw new EvidencePolicyError("EVIDENCE_PATH_NOT_READABLE", "/");
  }

  let evidence;
  try {
    evidence = JSON.parse(contents);
  } catch {
    throw new EvidencePolicyError("INVALID_EVIDENCE_JSON", "/");
  }

  validateEvidence(evidence);
  process.stdout.write(
    `evidence-valid schemaVersion=${evidence.schemaVersion} probeId=${evidence.probeId}\n`,
  );
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
