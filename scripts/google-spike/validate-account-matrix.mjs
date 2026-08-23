#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { AccountMatrixError, validateAccountMatrix } from "./lib/account-matrix.mjs";

async function main() {
  const [matrixPath, envPath] = process.argv.slice(2);
  if (!matrixPath || process.argv.length > 4) throw new AccountMatrixError("INVALID_ACCOUNT_MATRIX_ARGUMENTS");
  let matrix;
  try {
    matrix = JSON.parse(await readFile(matrixPath, "utf8"));
  } catch {
    throw new AccountMatrixError("ACCOUNT_MATRIX_NOT_READABLE");
  }
  let envText;
  if (envPath) {
    try {
      envText = await readFile(envPath, "utf8");
    } catch {
      throw new AccountMatrixError("ACCOUNT_MATRIX_ENV_NOT_READABLE", "/env");
    }
  }
  const result = validateAccountMatrix(matrix, { envText });
  process.stdout.write(`account-matrix-valid schemaVersion=${result.schemaVersion} status=${result.status}\n`);
}

try {
  await main();
} catch (error) {
  if (error instanceof AccountMatrixError) {
    process.stderr.write(`${error.category} pointer=${error.pointer}\n`);
  } else {
    process.stderr.write("ACCOUNT_MATRIX_VALIDATION_FAILED pointer=/\n");
  }
  process.exitCode = 1;
}
