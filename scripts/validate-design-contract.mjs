import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

function requireText(relativePath, fragments) {
  const source = read(relativePath);
  for (const fragment of fragments) {
    if (!source.includes(fragment)) failures.push(`${relativePath}: missing ${JSON.stringify(fragment)}`);
  }
}

function forbidPattern(relativePaths, pattern) {
  for (const relativePath of relativePaths) {
    const source = read(relativePath);
    const matches = source.match(pattern) ?? [];
    for (const match of matches) failures.push(`${relativePath}: forbidden ${JSON.stringify(match)}`);
  }
}

function requirePattern(relativePath, pattern, label) {
  if (!pattern.test(read(relativePath))) failures.push(`${relativePath}: missing ${label}`);
}

requireText("DESIGN.md", [
  "C3 — 역할·입력 방식별 계약",
  "`24px`",
  "`44px`",
  "`12px/14px`",
  "`14px/20px`",
  "`11px/14px`",
  "`13px/18px`",
  "`76px`",
  "`#4E5968`",
]);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("MolRoom design contract: valid");
}
