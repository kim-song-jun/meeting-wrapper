#!/usr/bin/env node

import {
  SecurityAttestationError,
  writeSecurityAttestation,
} from "./lib/security-attestation.mjs";

const REQUIRED_ARGUMENTS = new Set([
  "--target-sha",
  "--manual-review",
  "--deep-security-scan",
  "--output",
]);

function parseArguments(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.length !== REQUIRED_ARGUMENTS.size * 2) {
    throw new SecurityAttestationError("INVALID_ARGUMENTS", "cli");
  }
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!REQUIRED_ARGUMENTS.has(flag) || values.has(flag) || typeof value !== "string" || value.length === 0) {
      throw new SecurityAttestationError("INVALID_ARGUMENTS", "cli");
    }
    values.set(flag, value);
  }
  if (values.size !== REQUIRED_ARGUMENTS.size) {
    throw new SecurityAttestationError("INVALID_ARGUMENTS", "cli");
  }
  return {
    targetSha: values.get("--target-sha"),
    manualReviewPath: values.get("--manual-review"),
    deepSecurityScanPath: values.get("--deep-security-scan"),
    outputPath: values.get("--output"),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await writeSecurityAttestation(options);
  process.stdout.write(`${result.base64}\n`);
}

try {
  await main();
} catch (error) {
  if (error instanceof SecurityAttestationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write("SECURITY_ATTESTATION_FAILED source=cli\n");
  }
  process.exitCode = 1;
}
