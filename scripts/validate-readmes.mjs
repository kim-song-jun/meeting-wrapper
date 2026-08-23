#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { validateReadmeParity } from "./lib/readme-parity.mjs";

const root = join(import.meta.dirname, "..");
const [korean, english, koreanRunbook, englishRunbook] = await Promise.all([
  readFile(join(root, "README.ko.md"), "utf8"),
  readFile(join(root, "README.en.md"), "utf8"),
  readFile(join(root, "docs/ops/release-ko.md"), "utf8"),
  readFile(join(root, "docs/ops/release-en.md"), "utf8"),
]);
const result = await validateReadmeParity(korean, english, { root, koreanRunbook, englishRunbook });
if (!result.valid) {
  console.error(`readme-parity-invalid missing=${result.missing.join(",")}`);
  process.exitCode = 1;
} else {
  console.log("readme-parity-valid locales=ko,en");
}
