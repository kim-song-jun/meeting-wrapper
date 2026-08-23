import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ProbeServerError, startProbeServer } from "./lib/server.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export function parseServeArguments(args) {
  if (
    !Array.isArray(args) ||
    args.length !== 4 ||
    args[0] !== "--host" ||
    args[1] !== "127.0.0.1" ||
    args[2] !== "--port" ||
    args[3] !== "5184"
  ) {
    throw new ProbeServerError("INVALID_CLI_ARGUMENTS");
  }
  return Object.freeze({ host: "127.0.0.1", port: 5184 });
}

async function selectConfigPath() {
  const localPath = join(SCRIPT_DIRECTORY, "config.local");
  try {
    await lstat(localPath);
    return localPath;
  } catch (error) {
    if (error?.code === "ENOENT") return join(SCRIPT_DIRECTORY, "config.example.json");
    throw new ProbeServerError("CONFIG_UNSAFE");
  }
}

function safeCategory(error) {
  return error instanceof ProbeServerError ? error.category : "SERVER_FAILED";
}

export async function runServe(args = process.argv.slice(2)) {
  const bind = parseServeArguments(args);
  const instance = await startProbeServer({
    ...bind,
    browserDir: join(SCRIPT_DIRECTORY, "browser"),
    configPath: await selectConfigPath(),
    googleFetchPath: join(SCRIPT_DIRECTORY, "lib", "google-fetch.mjs"),
    pidPath: join(SCRIPT_DIRECTORY, ".server.pid.local"),
    onDiagnostic: ({ category, status, bodyRead }) => {
      process.stdout.write(
        `PROBE_REQUEST category=${category} status=${status} bodyRead=${bodyRead}\n`,
      );
    },
  });
  process.stdout.write(
    `GOOGLE_SPIKE_READY host=${instance.host} port=${instance.port} pid=${instance.pid}\n`,
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      const result = await instance.close();
      if (!result.pidFileRemoved) throw new ProbeServerError("PIDFILE_CLEANUP_FAILED");
      process.stdout.write("GOOGLE_SPIKE_STOPPED category=CLEAN\n");
    } catch (error) {
      process.stderr.write(`${safeCategory(error)}\n`);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return instance;
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  runServe().catch((error) => {
    process.stderr.write(`${safeCategory(error)}\n`);
    process.exitCode = 1;
  });
}
