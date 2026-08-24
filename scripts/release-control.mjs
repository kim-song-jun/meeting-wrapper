import { runReleaseControlCli } from "./lib/release-control.mjs";

try {
  const result = await runReleaseControlCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stdout.write('{"schema_version":1,"status":"failed"}\n');
  process.exitCode = process.argv[2] === "restore-absent-cloudformation-stack" ? 97 : 1;
}
