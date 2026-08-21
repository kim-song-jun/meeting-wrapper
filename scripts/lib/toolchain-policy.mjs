import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readExpectedToolchain(root) {
  const node = readFileSync(join(root, ".node-version"), "utf8").trim();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const match = /^npm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? "");
  if (!match) throw new Error("packageManager must pin npm with an exact version");
  return { node, npm: match[1] };
}

export function verifyToolchain(expected, actual) {
  if (actual.node !== expected.node) {
    throw new Error(`Node ${expected.node} is required; received ${actual.node}`);
  }
  if (actual.npm !== expected.npm) {
    throw new Error(`npm ${expected.npm} is required; received ${actual.npm}`);
  }
}
