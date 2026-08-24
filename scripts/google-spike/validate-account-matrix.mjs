#!/usr/bin/env node

import { parseStrictJson } from "./lib/evidence.mjs";
import { AccountMatrixError, validateAccountMatrix } from "./lib/account-matrix.mjs";
import { PrivateInputError, readBoundedUtf8RegularFile } from "./lib/private-input.mjs";

async function main() {
  const [matrixPath, envPath] = process.argv.slice(2);
  if (!matrixPath || process.argv.length > 4) throw new AccountMatrixError("INVALID_ACCOUNT_MATRIX_ARGUMENTS");
  const matrixText = await readBoundedUtf8RegularFile(matrixPath, {
    categoryPrefix: "ACCOUNT_MATRIX_PATH",
    pointer: "/matrixFile",
  });
  let matrix;
  try {
    matrix = parseStrictJson(matrixText);
  } catch {
    throw new AccountMatrixError("INVALID_ACCOUNT_MATRIX_JSON", "/matrix");
  }
  let envText;
  if (envPath) {
    envText = await readBoundedUtf8RegularFile(envPath, {
      categoryPrefix: "ACCOUNT_MATRIX_PATH",
      pointer: "/envFile",
      requireExactMode: true,
    });
  }
  const result = validateAccountMatrix(matrix, { envText });
  process.stdout.write(`account-matrix-valid schemaVersion=${result.schemaVersion} status=${result.status}\n`);
}

try {
  await main();
} catch (error) {
  if (error instanceof AccountMatrixError || error instanceof PrivateInputError) {
    process.stderr.write(`${error.category} pointer=${error.pointer}\n`);
  } else {
    process.stderr.write("ACCOUNT_MATRIX_VALIDATION_FAILED pointer=/\n");
  }
  process.exitCode = 1;
}
