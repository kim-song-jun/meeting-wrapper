import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  inspectFontResourcePolicy,
  PRETENDARD_FONT_ASSET_CONTRACT,
} from "./font-resource-policy.mjs";

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

const MAX_BUNDLE_ENTRIES = 256;
const MAX_BUNDLE_DEPTH = 16;
const MAX_BUNDLE_FILE_BYTES = 4_194_304;
const MAX_BUNDLE_TOTAL_BYTES = 8_388_608;

function toBundlePath(root, file) {
  return relative(root, file).split(sep).join("/");
}

async function collectRegularFiles(root, directory, state, depth = 0) {
  if (depth > MAX_BUNDLE_DEPTH) {
    throw new Error(`Production bundle depth exceeds limit (${MAX_BUNDLE_DEPTH}): ${root}`);
  }
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const entryPath = join(directory, entry.name);
    const path = toBundlePath(root, entryPath);
    state.entries += 1;
    if (state.entries > MAX_BUNDLE_ENTRIES) {
      throw new Error(`Production bundle entry count exceeds limit (${MAX_BUNDLE_ENTRIES}): ${root}`);
    }
    const entryStat = await lstat(entryPath, { bigint: true });
    if (entryStat.isSymbolicLink()) {
      throw new Error(`Production bundle contains a symbolic link: ${path}`);
    }
    if (entryStat.isDirectory()) {
      await collectRegularFiles(root, entryPath, state, depth + 1);
      continue;
    }
    if (!entryStat.isFile()) {
      throw new Error(`Production bundle contains a non-regular entry: ${path}`);
    }

    if (entryStat.size > BigInt(MAX_BUNDLE_FILE_BYTES)) {
      throw new Error(
        `Production bundle file exceeds byte limit (${MAX_BUNDLE_FILE_BYTES}): ${path}`,
      );
    }
    state.totalBytes += entryStat.size;
    if (state.totalBytes > BigInt(MAX_BUNDLE_TOTAL_BYTES)) {
      throw new Error(
        `Production bundle total bytes exceed limit (${MAX_BUNDLE_TOTAL_BYTES}): ${root}`,
      );
    }
    state.files.push({ expectedStat: entryStat, file: entryPath, path });
  }
}

function sameRegularFile(expected, actual) {
  return actual.isFile() &&
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.size === expected.size &&
    actual.mtimeNs === expected.mtimeNs;
}

/**
 * @internal Production scanner primitive exported only for deterministic tests
 * against real FileHandle instances. It does not own or close the handle.
 */
export async function readBoundedBundleFile(handle, {
  expectedStat, path,
}) {
  const expectedBytes = Number(expectedStat.size);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 ||
    expectedBytes > MAX_BUNDLE_FILE_BYTES) {
    throw new Error(`Production bundle file exceeds byte limit (${MAX_BUNDLE_FILE_BYTES}): ${path}`);
  }
  const before = await handle.stat({ bigint: true });
  if (!sameRegularFile(expectedStat, before)) {
    throw new Error(`Production bundle file changed during scan: ${path}`);
  }

  const contents = Buffer.alloc(expectedBytes + 1);
  let offset = 0;
  while (offset < contents.byteLength) {
    const { bytesRead } = await handle.read(
      contents,
      offset,
      contents.byteLength - offset,
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }

  const after = await handle.stat({ bigint: true });
  if (offset !== expectedBytes || !sameRegularFile(expectedStat, after)) {
    throw new Error(`Production bundle file changed during scan: ${path}`);
  }
  return contents.subarray(0, expectedBytes);
}

async function readRegularFile({ expectedStat, file, path }) {
  const handle = await open(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  let primaryError;
  try {
    return await readBoundedBundleFile(handle, {
      expectedStat,
      path,
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (closeError) {
      if (primaryError === undefined) throw closeError;
    }
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function inspectFontArtifacts(bundleFiles) {
  const findings = [];
  const fontFiles = bundleFiles.filter(({ path }) =>
    PRETENDARD_FONT_ASSET_CONTRACT.bundlePattern.test(path),
  );
  if (fontFiles.length > 1) {
    findings.push({ marker: "font-asset:duplicate", path: "assets" });
  }
  if (fontFiles.length === 0) {
    findings.push({ marker: "font-asset:missing", path: "assets" });
  } else {
    for (const font of fontFiles) {
      if (
        font.contents.byteLength !== PRETENDARD_FONT_ASSET_CONTRACT.bytes ||
        sha256(font.contents) !== PRETENDARD_FONT_ASSET_CONTRACT.sha256
      ) {
        findings.push({ marker: "font-asset:integrity", path: font.path });
      }
    }
  }

  const licenseFiles = bundleFiles.filter(({ path }) =>
    path.startsWith("licenses/pretendard/") && path.endsWith("/SIL-OFL-1.1.txt"),
  );
  const license = bundleFiles.find(({ path }) =>
    path === PRETENDARD_FONT_ASSET_CONTRACT.licensePath,
  );
  if (license === undefined) {
    findings.push({
      marker: "font-license:missing",
      path: PRETENDARD_FONT_ASSET_CONTRACT.licensePath,
    });
  } else if (
    license.contents.byteLength !== PRETENDARD_FONT_ASSET_CONTRACT.licenseBytes ||
    sha256(license.contents) !== PRETENDARD_FONT_ASSET_CONTRACT.licenseSha256
  ) {
    findings.push({
      marker: "font-license:integrity",
      path: PRETENDARD_FONT_ASSET_CONTRACT.licensePath,
    });
  }
  if (licenseFiles.length > 1) {
    findings.push({ marker: "font-license:duplicate", path: "licenses/pretendard" });
  }

  return { findings, fontFiles };
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

  const state = { entries: 0, files: [], totalBytes: 0n };
  await collectRegularFiles(root, root, state);
  if (state.files.length === 0) {
    throw new Error(`Production bundle scan root is empty: ${root}`);
  }

  const bundleFiles = [];
  for (const metadata of state.files) {
    bundleFiles.push({
      contents: await readRegularFile(metadata),
      path: metadata.path,
    });
  }
  const findings = [];
  for (const { contents, path } of bundleFiles) {
    for (const marker of FORBIDDEN_PRODUCTION_MARKERS) {
      if (contents.includes(marker)) {
        findings.push({ marker, path });
      }
    }
  }

  const artifactInspection = inspectFontArtifacts(bundleFiles);
  findings.push(...artifactInspection.findings);
  const htmlSources = bundleFiles
    .filter(({ path }) => /\.html$/i.test(path))
    .map(({ contents, path }) => ({ path, source: contents.toString("utf8") }));
  const cssSources = bundleFiles
    .filter(({ path }) => /\.css$/i.test(path))
    .map(({ contents, path }) => ({ path, source: contents.toString("utf8") }));
  findings.push(...inspectFontResourcePolicy({
    cssSources,
    expectedPretendardSource: artifactInspection.fontFiles.length === 1
      ? `/${artifactInspection.fontFiles[0].path}`
      : undefined,
    htmlSources,
  }));

  const uniqueFindings = new Map();
  for (const finding of findings) {
    uniqueFindings.set(`${finding.path}\0${finding.marker}`, finding);
  }
  return [...uniqueFindings.values()].sort((left, right) =>
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
