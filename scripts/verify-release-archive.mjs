const SAFE_ENVIRONMENT_KEYS = new Set(["LANG", "LC_ALL", "PATH", "TMPDIR"]);
const PUBLIC_ENVIRONMENT_KEYS = new Set([
  "VITE_ADAPTER",
  "VITE_ALLOWED_HD",
  "VITE_DEPLOYMENT",
  "VITE_GOOGLE_CLIENT_ID",
]);

function safeEnvironment() {
  const output = {};
  for (const [key, value] of Object.entries(process.env)) {
    if ((SAFE_ENVIRONMENT_KEYS.has(key) || PUBLIC_ENVIRONMENT_KEYS.has(key)) && typeof value === "string" && !/[\0\r\n]/.test(value)) {
      output[key] = value;
    }
  }
  return output;
}

const environment = safeEnvironment();
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);

try {
  const { parseReleaseArchiveArguments, verifyReleaseArchive } = await import("./lib/release-archive.mjs");
  const { candidateRoot, candidateSha, outputRoot } = parseReleaseArchiveArguments(process.argv.slice(2));
  const result = await verifyReleaseArchive({
    candidateRoot,
    candidateSha,
    inheritedEnv: environment,
    outputRoot,
    repoRoot: candidateRoot ?? process.cwd(),
  });
  process.stdout.write(`${JSON.stringify({
    artifact_path: result.artifactPath,
    output_root: result.outputRoot,
    receipt_path: result.receiptPath,
    schema_version: 1,
    status: "verified",
  })}\n`);
} catch (error) {
  const outputRoot = typeof error?.outputRoot === "string" && error.outputRoot.startsWith("/") && !/[\0\r\n]/.test(error.outputRoot)
    ? error.outputRoot
    : null;
  const evidencePath = typeof error?.evidencePath === "string" && error.evidencePath.startsWith("/") && !/[\0\r\n]/.test(error.evidencePath)
    ? error.evidencePath
    : null;
  process.stdout.write(`${JSON.stringify({
    evidence_path: evidencePath,
    output_root: outputRoot,
    schema_version: 1,
    status: "failed",
  })}\n`);
  process.exitCode = 1;
}
