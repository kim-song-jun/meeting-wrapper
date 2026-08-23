import { readFile } from "node:fs/promises";
import { buildReleaseArtifacts, writeReleaseMetadata } from "./lib/release-manifest.mjs";

const VALUE_FLAGS = new Set([
  "--artifact-root",
  "--commit-sha",
  "--package-version",
  "--source-date-epoch",
]);

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown release manifest argument: ${flag}`);
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate release manifest argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for release manifest argument: ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  return values;
}

async function packageVersionFromRepository() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (!packageJson || typeof packageJson.version !== "string") {
    throw new Error("package.json must contain a string version");
  }
  return packageJson.version;
}

function parseSourceDateEpoch(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("SOURCE_DATE_EPOCH must contain canonical decimal seconds");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("SOURCE_DATE_EPOCH exceeds the safe integer range");
  }
  return parsed;
}

try {
  const argumentsByName = parseArguments(process.argv.slice(2));
  const artifactRoot = argumentsByName.get("--artifact-root") ?? "dist";
  const commitSha = argumentsByName.get("--commit-sha") ?? process.env.GITHUB_SHA;
  const packageVersion =
    argumentsByName.get("--package-version") ?? (await packageVersionFromRepository());
  const sourceDateEpoch = parseSourceDateEpoch(
    argumentsByName.get("--source-date-epoch") ?? process.env.SOURCE_DATE_EPOCH,
  );
  if (!commitSha) {
    throw new Error("A commit SHA is required through --commit-sha or GITHUB_SHA");
  }

  const release = await buildReleaseArtifacts({
    artifactRoot,
    commitSha,
    packageVersion,
    sourceDateEpoch,
  });
  const writeStatus = await writeReleaseMetadata({ artifactRoot, release });
  console.log(
    JSON.stringify({
      schema_version: 1,
      commit_sha: commitSha,
      manifest_sha256: release.manifestSha256,
      runtime_object_count: release.entries.length,
      metadata_status: writeStatus,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
