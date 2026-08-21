import { scanProductionBundle } from "./lib/production-bundle-policy.mjs";

const root = process.argv[2] ?? "dist";

try {
  const findings = await scanProductionBundle(root);
  if (findings.length === 0) {
    console.log("MolRoom production bundle: valid");
  } else {
    console.error("MolRoom production bundle: forbidden markers found");
    for (const finding of findings) {
      console.error(`${finding.path}: ${finding.marker}`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
