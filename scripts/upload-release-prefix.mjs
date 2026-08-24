import {
  executeUploadPlan,
  planReleasePrefixUpload,
} from "./lib/release-manifest.mjs";

const VALUE_FLAGS = new Set(["--artifact-root", "--bucket", "--commit-sha", "--package-version"]);
const BOOLEAN_FLAGS = new Set(["--dry-run", "--execute"]);

function parseArguments(argv) {
  const values = new Map();
  const booleans = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      if (booleans.has(flag)) {
        throw new Error(`Duplicate release upload argument: ${flag}`);
      }
      booleans.add(flag);
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(`Unknown release upload argument: ${flag}`);
    }
    if (values.has(flag)) {
      throw new Error(`Duplicate release upload argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for release upload argument: ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }
  if (booleans.size !== 1) {
    throw new Error("Choose exactly one of --dry-run or --execute");
  }
  return { booleans, values };
}

try {
  const { booleans, values } = parseArguments(process.argv.slice(2));
  const artifactRoot = values.get("--artifact-root") ?? "dist";
  const bucket = values.get("--bucket") ?? process.env.MOLROOM_RELEASE_BUCKET;
  const commitSha = values.get("--commit-sha") ?? process.env.GITHUB_SHA;
  const packageVersion = values.get("--package-version");
  if (!bucket) {
    throw new Error("A release bucket is required through --bucket or MOLROOM_RELEASE_BUCKET");
  }
  if (!commitSha) {
    throw new Error("A commit SHA is required through --commit-sha or GITHUB_SHA");
  }
  if (!packageVersion) {
    throw new Error("A package version is required through --package-version");
  }

  const plan = await planReleasePrefixUpload({ artifactRoot, bucket, commitSha, expectedPackageVersion: packageVersion });
  if (!booleans.has("--execute")) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const results = await executeUploadPlan({ artifactRoot, plan });
    console.log(
      JSON.stringify({
        schema_version: 1,
        release_prefix: plan.releasePrefix,
        manifest_sha256: plan.manifestSha256,
        objects: results,
      }),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
