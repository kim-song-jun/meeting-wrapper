import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const FORBIDDEN_PRODUCTION_MARKERS = [
  "molroom.mock.identity",
  "molroom.mockAuth.session",
  "[MolRoom QA]",
  "QA fixture:",
  "mockSaveDelayMs",
  "mockReadError",
  "mockPrefsSaveError",
  "mockNow",
  "__taken",
  "__declined",
];

function toBundlePath(root, file) {
  return relative(root, file).split(sep).join("/");
}

async function collectRegularFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRegularFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

export async function scanProductionBundle(root) {
  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`Production bundle scan root does not exist: ${root}`);
    }
    throw error;
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`Production bundle scan root is not a directory: ${root}`);
  }

  const files = await collectRegularFiles(root);
  if (files.length === 0) {
    throw new Error(`Production bundle scan root is empty: ${root}`);
  }

  const findings = [];
  for (const file of files) {
    const contents = await readFile(file);
    for (const marker of FORBIDDEN_PRODUCTION_MARKERS) {
      if (contents.includes(marker)) {
        findings.push({ marker, path: toBundlePath(root, file) });
      }
    }
  }

  return findings.sort((left, right) =>
    left.path === right.path
      ? left.marker < right.marker
        ? -1
        : left.marker > right.marker
          ? 1
          : 0
      : left.path < right.path
        ? -1
        : 1,
  );
}
