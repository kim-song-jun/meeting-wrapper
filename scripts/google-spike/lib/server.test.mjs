import { afterEach, describe, expect, it } from "vitest";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createConnection, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  MAX_EVIDENCE_BYTES,
  loadPublicConfig,
  startProbeServer,
} from "./server.mjs";
import { parseServeArguments } from "../serve.mjs";

const SAFE_EVIDENCE_URL = new URL("../fixtures/safe-evidence.json", import.meta.url);
const BROWSER_HTML_URL = new URL("../browser/index.html", import.meta.url);
const BROWSER_APP_URL = new URL("../browser/app.mjs", import.meta.url);
const EXAMPLE_CONFIG_URL = new URL("../config.example.json", import.meta.url);
const activeServers = new Set();
const temporaryDirectories = new Set();

afterEach(async () => {
  for (const server of activeServers) {
    await server.close();
  }
  activeServers.clear();
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

async function createHarnessFiles(config = validConfig()) {
  const directory = await mkdtemp(join(tmpdir(), "molroom-google-spike-server-"));
  temporaryDirectories.add(directory);
  const browserDir = join(directory, "browser");
  const configPath = join(directory, "config.local");
  const pidPath = join(directory, ".server.pid.local");
  const googleFetchPath = join(directory, "google-fetch.mjs");
  await mkdir(browserDir);
  await writeFile(join(browserDir, "index.html"), "<!doctype html><title>probe</title>", "utf8");
  await writeFile(join(browserDir, "app.mjs"), "export const probe = true;", "utf8");
  await writeFile(googleFetchPath, "export const googleFetch = true;", "utf8");
  await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");
  return { directory, browserDir, configPath, googleFetchPath, pidPath };
}

function validConfig() {
  return {
    schemaVersion: 1,
    googleClientId: "replace-with-public-browser-client-id",
    accountAliases: ["ordinary", "room-writer-admin"],
    roomCalendars: {
      "room-a": "replace-with-room-a-calendar-id",
      "room-b": "replace-with-room-b-calendar-id",
    },
  };
}

async function start(options = {}) {
  const files = options.files ?? (await createHarnessFiles());
  const diagnostics = [];
  const server = await startProbeServer({
    host: "127.0.0.1",
    port: 0,
    allowEphemeralPort: true,
    browserDir: files.browserDir,
    configPath: files.configPath,
    googleFetchPath: files.googleFetchPath,
    pidPath: files.pidPath,
    processId: process.pid,
    onDiagnostic: (entry) => diagnostics.push(entry),
    ...options.server,
  });
  activeServers.add(server);
  return { files, diagnostics, server };
}

function endpoint(server, path = "/") {
  return `http://127.0.0.1:${server.port}${path}`;
}

async function responseCategory(response) {
  return (await response.json()).category;
}

async function safeEvidence() {
  return JSON.parse(await readFile(SAFE_EVIDENCE_URL, "utf8"));
}

function requestWithHeaders({ server, path = "/evidence", headers, body }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        method: "POST",
        path,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function rawHttp(server, requestText) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: server.port });
    const chunks = [];
    socket.setTimeout(2_000);
    socket.on("connect", () => socket.end(requestText));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("raw request timed out"));
    });
    socket.on("error", reject);
  });
}

function rawHttpWithoutRequestEnd(server, requestText, timeout = 500) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: server.port });
    const chunks = [];
    socket.setTimeout(timeout);
    socket.on("connect", () => socket.write(requestText));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("raw request timed out"));
    });
    socket.on("error", reject);
  });
}

async function occupyLoopbackPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  return server;
}

function closeNetServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function expectSecurityHeaders(response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  const csp = response.headers.get("content-security-policy");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self' https://accounts.google.com/gsi/client");
  expect(csp).toContain("style-src 'unsafe-inline'");
  expect(csp).toContain(
    "connect-src 'self' https://www.googleapis.com https://people.googleapis.com https://oauth2.googleapis.com",
  );
  expect(csp).not.toContain("script-src 'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
}

describe("local probe server lifecycle", () => {
  it("accepts only the literal production CLI host and port with no extra arguments", () => {
    expect(parseServeArguments(["--host", "127.0.0.1", "--port", "5184"])).toEqual({
      host: "127.0.0.1",
      port: 5184,
    });
    for (const args of [
      ["--host", "localhost", "--port", "5184"],
      ["--host", "0.0.0.0", "--port", "5184"],
      ["--host", "127.0.0.1", "--port", "5185"],
      ["--port", "5184", "--host", "127.0.0.1"],
      ["--host", "127.0.0.1", "--port", "5184", "--extra"],
      [],
    ]) {
      expect(() => parseServeArguments(args)).toThrowError(
        expect.objectContaining({ category: "INVALID_CLI_ARGUMENTS" }),
      );
    }
  });

  it("rejects every non-loopback bind before opening a listener", async () => {
    const files = await createHarnessFiles();

    await expect(
      startProbeServer({
        host: "0.0.0.0",
        port: 0,
        allowEphemeralPort: true,
        browserDir: files.browserDir,
        configPath: files.configPath,
        googleFetchPath: files.googleFetchPath,
        pidPath: files.pidPath,
      }),
    ).rejects.toMatchObject({ category: "INVALID_BIND" });
    await expect(lstat(files.pidPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports the actual IPv4 loopback address selected by the listener", async () => {
    const { server } = await start();
    expect(server.host).toBe("127.0.0.1");
    expect(server.address).toBe("127.0.0.1");
  });

  it("refuses a second live PID owner without changing the first file", async () => {
    const first = await start();
    const originalPidFile = await readFile(first.files.pidPath, "utf8");

    await expect(
      startProbeServer({
        host: "127.0.0.1",
        port: 0,
        allowEphemeralPort: true,
        browserDir: first.files.browserDir,
        configPath: first.files.configPath,
        googleFetchPath: first.files.googleFetchPath,
        pidPath: first.files.pidPath,
        processId: process.pid,
      }),
    ).rejects.toMatchObject({ category: "PORT_ALREADY_OWNED" });

    expect(await readFile(first.files.pidPath, "utf8")).toBe(originalPidFile);
  });

  it("allows exactly one simultaneous PID-file creator", async () => {
    const files = await createHarnessFiles();
    const options = {
      host: "127.0.0.1",
      port: 0,
      allowEphemeralPort: true,
      browserDir: files.browserDir,
      configPath: files.configPath,
      googleFetchPath: files.googleFetchPath,
      pidPath: files.pidPath,
      processId: process.pid,
    };
    const results = await Promise.allSettled([
      startProbeServer(options),
      startProbeServer(options),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(["PORT_ALREADY_OWNED", "PIDFILE_UNSAFE"]).toContain(rejected[0].reason.category);
    activeServers.add(fulfilled[0].value);
  });

  it("creates a 0600 PID file and removes only its exact owned PID", async () => {
    const owned = await start();
    expect((await stat(owned.files.pidPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(owned.files.pidPath, "utf8")).toBe(`${process.pid}\n`);

    await owned.server.close();
    activeServers.delete(owned.server);

    await expect(lstat(owned.files.pidPath)).rejects.toMatchObject({ code: "ENOENT" });

    const mismatched = await start();
    await writeFile(mismatched.files.pidPath, `${process.pid + 1}\n`, { mode: 0o600 });
    await mismatched.server.close();
    activeServers.delete(mismatched.server);

    expect(await readFile(mismatched.files.pidPath, "utf8")).toBe(`${process.pid + 1}\n`);
  });

  it("does not unlink a replaced PID inode even when the contents match", async () => {
    const owned = await start();
    await rm(owned.files.pidPath);
    await writeFile(owned.files.pidPath, `${process.pid}\n`, { mode: 0o600 });

    const result = await owned.server.close();
    activeServers.delete(owned.server);

    expect(result.pidFileRemoved).toBe(false);
    expect(await readFile(owned.files.pidPath, "utf8")).toBe(`${process.pid}\n`);
  });

  it("fails closed for symlink configuration and PID paths", async () => {
    const files = await createHarnessFiles();
    const linkedConfig = join(files.directory, "linked-config.local");
    await symlink(files.configPath, linkedConfig);
    await expect(loadPublicConfig(linkedConfig)).rejects.toMatchObject({ category: "CONFIG_UNSAFE" });

    const pidTarget = join(files.directory, "pid-target.local");
    const linkedPid = join(files.directory, "linked-pid.local");
    await writeFile(pidTarget, "999999\n", { mode: 0o600 });
    await symlink(pidTarget, linkedPid);
    await expect(
      startProbeServer({
        host: "127.0.0.1",
        port: 0,
        allowEphemeralPort: true,
        browserDir: files.browserDir,
        configPath: files.configPath,
        googleFetchPath: files.googleFetchPath,
        pidPath: linkedPid,
      }),
    ).rejects.toMatchObject({ category: "PIDFILE_UNSAFE" });
  });

  it("closes the listener when PID-file creation fails", async () => {
    const reserved = await occupyLoopbackPort();
    const address = reserved.address();
    const port = address.port;
    await closeNetServer(reserved);
    const files = await createHarnessFiles();
    const pidTarget = join(files.directory, "failed-pid-target.local");
    await writeFile(pidTarget, "999999999\n", { mode: 0o600 });
    await symlink(pidTarget, files.pidPath);

    await expect(
      startProbeServer({
        host: "127.0.0.1",
        port,
        allowEphemeralPort: true,
        browserDir: files.browserDir,
        configPath: files.configPath,
        googleFetchPath: files.googleFetchPath,
        pidPath: files.pidPath,
      }),
    ).rejects.toMatchObject({ category: "PIDFILE_UNSAFE" });

    const rebound = createNetServer();
    await new Promise((resolve, reject) => {
      rebound.once("error", reject);
      rebound.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
    });
    await closeNetServer(rebound);
  });

  it("forces an unfinished request closed within the shutdown bound and removes its PID file", async () => {
    const { files, server } = await start();
    const socket = createConnection({ host: "127.0.0.1", port: server.port });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(
      [
        "POST /evidence HTTP/1.1",
        `Host: 127.0.0.1:${server.port}`,
        "Content-Type: application/json",
        "Content-Length: 100",
        "Connection: keep-alive",
        "",
        "{",
      ].join("\r\n"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const closePromise = server.close();
    try {
      const outcome = await Promise.race([
        closePromise.then(() => "closed"),
        new Promise((resolve) => setTimeout(() => resolve("timed-out"), 750)),
      ]);
      expect(outcome).toBe("closed");
    } finally {
      socket.destroy();
      await closePromise;
      activeServers.delete(server);
    }
    await expect(lstat(files.pidPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["stale", "999999999\n"],
    ["unparseable", "not-a-pid\n"],
  ])("fails closed for a %s PID file", async (_label, contents) => {
    const files = await createHarnessFiles();
    await writeFile(files.pidPath, contents, { mode: 0o600 });
    await expect(
      startProbeServer({
        host: "127.0.0.1",
        port: 0,
        allowEphemeralPort: true,
        browserDir: files.browserDir,
        configPath: files.configPath,
        googleFetchPath: files.googleFetchPath,
        pidPath: files.pidPath,
      }),
    ).rejects.toMatchObject({ category: "PIDFILE_UNSAFE" });
  });

  it("fails closed for a non-regular PID path", async () => {
    const files = await createHarnessFiles();
    await mkdir(files.pidPath);
    await expect(
      startProbeServer({
        host: "127.0.0.1",
        port: 0,
        allowEphemeralPort: true,
        browserDir: files.browserDir,
        configPath: files.configPath,
        googleFetchPath: files.googleFetchPath,
        pidPath: files.pidPath,
      }),
    ).rejects.toMatchObject({ category: "PIDFILE_UNSAFE" });
  });

  it("maps an occupied loopback port to PORT_ALREADY_OWNED without creating a PID file", async () => {
    const occupied = await occupyLoopbackPort();
    const address = occupied.address();
    const files = await createHarnessFiles();
    try {
      await expect(
        startProbeServer({
          host: "127.0.0.1",
          port: address.port,
          allowEphemeralPort: true,
          browserDir: files.browserDir,
          configPath: files.configPath,
          googleFetchPath: files.googleFetchPath,
          pidPath: files.pidPath,
        }),
      ).rejects.toMatchObject({ category: "PORT_ALREADY_OWNED" });
      await expect(lstat(files.pidPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await closeNetServer(occupied);
    }
  });
});

describe("local probe server request boundary", () => {
  it("serves only the diagnostic files and a closed public config with no-store headers", async () => {
    const { diagnostics, server } = await start();

    const page = await fetch(endpoint(server));
    expect(page.status).toBe(200);
    expectSecurityHeaders(page);
    expect(await page.text()).toContain("<title>probe</title>");

    const googleFetchModule = await fetch(endpoint(server, "/google-fetch.mjs"));
    expect(googleFetchModule.status).toBe(200);
    expectSecurityHeaders(googleFetchModule);
    expect(await googleFetchModule.text()).toContain("googleFetch = true");

    const config = await fetch(endpoint(server, "/config"));
    expect(config.status).toBe(200);
    expectSecurityHeaders(config);
    expect(await config.json()).toEqual(validConfig());

    const app = await fetch(endpoint(server, "/app.mjs"));
    expect(app.status).toBe(200);
    expectSecurityHeaders(app);

    const unknown = await fetch(endpoint(server, "/src/main.tsx"));
    expect(unknown.status).toBe(404);
    expectSecurityHeaders(unknown);
    expect(await responseCategory(unknown)).toBe("NOT_FOUND");
    const diagnosticText = JSON.stringify(diagnostics);
    for (const forbidden of [
      validConfig().googleClientId,
      ...Object.values(validConfig().roomCalendars),
      ...validConfig().accountAliases,
    ]) {
      expect(diagnosticText).not.toContain(forbidden);
    }
  });

  it.each([
    "/../app.mjs",
    "/%2e%2e/app.mjs",
    "/app%2emjs",
    "/app\\mjs",
    "/app%00.mjs",
    "/nested/app.mjs",
  ])("does not normalize or serve a hostile static target %s", async (target) => {
    const { server } = await start();
    const response = await rawHttp(
      server,
      `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: close\r\n\r\n`,
    );
    expect(response).toMatch(/^HTTP\/1\.1 (?:400|404)/);
    expect(response).not.toContain("export const probe = true");
    expect(response).not.toContain("googleFetch = true");
    expect(response).toContain("Cache-Control: no-store");
  });

  it("rejects symlink and non-regular static files before listen", async () => {
    const linked = await createHarnessFiles();
    const linkedApp = join(linked.browserDir, "app.mjs");
    const target = join(linked.directory, "app-target.mjs");
    await writeFile(target, "export const target = true;", "utf8");
    await rm(linkedApp);
    await symlink(target, linkedApp);
    await expect(
      startProbeServer({
        host: "127.0.0.1",
        port: 0,
        allowEphemeralPort: true,
        browserDir: linked.browserDir,
        configPath: linked.configPath,
        googleFetchPath: linked.googleFetchPath,
        pidPath: linked.pidPath,
      }),
    ).rejects.toMatchObject({ category: "STATIC_FILE_UNSAFE" });

    const nonRegular = await createHarnessFiles();
    const nonRegularApp = join(nonRegular.browserDir, "app.mjs");
    await rm(nonRegularApp);
    await mkdir(nonRegularApp);
    await expect(
      startProbeServer({
        host: "127.0.0.1",
        port: 0,
        allowEphemeralPort: true,
        browserDir: nonRegular.browserDir,
        configPath: nonRegular.configPath,
        googleFetchPath: nonRegular.googleFetchPath,
        pidPath: nonRegular.pidPath,
      }),
    ).rejects.toMatchObject({ category: "STATIC_FILE_UNSAFE" });
  });

  it("accepts schema-valid redacted evidence with an empty 204 response", async () => {
    const { server } = await start();
    const response = await fetch(endpoint(server, "/evidence"), {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await safeEvidence()),
    });

    expect(response.status).toBe(204);
    expectSecurityHeaders(response);
    expect(await response.text()).toBe("");
  });

  it.each(["Authorization", "Cookie"])(
    "rejects %s before reading any request body",
    async (headerName) => {
      const { diagnostics, server } = await start();
      const marker = ["request", "material", "fixture"].join("-");
      const result = await requestWithHeaders({
        server,
        headers: { [headerName]: marker },
        body: JSON.stringify(await safeEvidence()),
      });

      expect(result.status).toBe(400);
      expect(JSON.parse(result.body)).toEqual({ category: "FORBIDDEN_REQUEST_MATERIAL" });
      expect(result.body).not.toContain(marker);
      expect(diagnostics.at(-1)).toMatchObject({
        category: "FORBIDDEN_REQUEST_MATERIAL",
        bodyRead: false,
        status: 400,
      });
      expect(JSON.stringify(diagnostics)).not.toContain(marker);
    },
  );

  it("enforces the streamed evidence limit independently of Content-Length", async () => {
    const { server } = await start();
    const serialized = JSON.stringify(await safeEvidence());
    const padding = MAX_EVIDENCE_BYTES - Buffer.byteLength(serialized);
    expect(padding).toBeGreaterThan(0);
    const exactBoundary = `${serialized}${" ".repeat(padding)}`;
    const boundary = await fetch(endpoint(server, "/evidence"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Readable.from([Buffer.from(exactBoundary)]),
      duplex: "half",
    });

    expect(boundary.status).toBe(204);
    expect(await boundary.text()).toBe("");

    const response = await fetch(endpoint(server, "/evidence"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Readable.from([Buffer.from(`${exactBoundary} `)]),
      duplex: "half",
    });

    expect(response.status).toBe(413);
    expect(await responseCategory(response)).toBe("EVIDENCE_TOO_LARGE");
  });

  it("rejects malformed JSON, unknown fields, query strings, and hostile origins without echoes", async () => {
    const { diagnostics, server } = await start();
    const malformed = await fetch(endpoint(server, "/evidence"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await responseCategory(malformed)).toBe("MALFORMED_JSON");

    const unknownPayload = { ...(await safeEvidence()), untrusted: "fixture-value" };
    const unknown = await fetch(endpoint(server, "/evidence"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(unknownPayload),
    });
    expect(unknown.status).toBe(400);
    expectSecurityHeaders(unknown);
    expect(await unknown.json()).toEqual({
      category: "FORBIDDEN_EVIDENCE_FIELD",
      pointer: "/_unknown",
    });

    const queryMarker = ["query", "marker"].join("-");
    const query = await fetch(endpoint(server, `/evidence?value=${queryMarker}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await safeEvidence()),
    });
    expect(query.status).toBe(400);
    expect(await responseCategory(query)).toBe("QUERY_NOT_ALLOWED");

    const originMarker = `https://${["hostile", "invalid"].join(".")}`;
    const hostileOrigin = await fetch(endpoint(server, "/evidence"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: originMarker,
      },
      body: JSON.stringify(await safeEvidence()),
    });
    expect(hostileOrigin.status).toBe(400);
    expect(await responseCategory(hostileOrigin)).toBe("ORIGIN_NOT_ALLOWED");
    expect(JSON.stringify(diagnostics)).not.toContain(queryMarker);
    expect(JSON.stringify(diagnostics)).not.toContain(originMarker);
  });

  it("uses an exact Host and Origin allowlist without echoing rejected values", async () => {
    const { diagnostics, server } = await start();
    const hostValues = [
      ["hostile", "invalid"].join("."),
      `localhost.:${server.port}`,
      `127.0.0.1.:${server.port}`,
    ];
    for (const host of hostValues) {
      const response = await requestWithHeaders({
        server,
        headers: { Host: host },
        body: JSON.stringify(await safeEvidence()),
      });
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ category: "HOST_NOT_ALLOWED" });
      expect(response.body).not.toContain(host);
    }

    const missingHost = await rawHttp(
      server,
      "GET / HTTP/1.0\r\nConnection: close\r\n\r\n",
    );
    expect(missingHost).toMatch(/^HTTP\/1\.1 400/);
    expect(missingHost).toContain("HOST_NOT_ALLOWED");

    for (const origin of ["null", "https://hostile.invalid", `http://localhost.:${server.port}`]) {
      const response = await fetch(endpoint(server, "/evidence"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(await safeEvidence()),
      });
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual({ category: "ORIGIN_NOT_ALLOWED" });
      expect(body).not.toContain(origin);
    }
    expect(JSON.stringify(diagnostics)).not.toContain("hostile.invalid");
  });

  it("rejects duplicate framing and forbidden Expect requests without a 100 response or body read", async () => {
    const { diagnostics, server } = await start();
    const host = `127.0.0.1:${server.port}`;
    const duplicateLength = await rawHttp(
      server,
      [
        "POST /evidence HTTP/1.1",
        `Host: ${host}`,
        "Content-Type: application/json",
        "Content-Length: 1",
        "Content-Length: 2",
        "Connection: close",
        "",
        "{}",
      ].join("\r\n"),
    );
    expect(duplicateLength).toMatch(/^HTTP\/1\.1 400/);
    expect(duplicateLength).toContain("MALFORMED_HTTP");
    expect(duplicateLength).toContain("Cache-Control: no-store");

    const conflictingFraming = await rawHttp(
      server,
      [
        "POST /evidence HTTP/1.1",
        `Host: ${host}`,
        "Content-Type: application/json",
        "Content-Length: 4",
        "Transfer-Encoding: chunked",
        "Connection: close",
        "",
        "0",
        "",
        "",
      ].join("\r\n"),
    );
    expect(conflictingFraming).toMatch(/^HTTP\/1\.1 400/);
    expect(conflictingFraming).toContain("MALFORMED_HTTP");

    const marker = ["expect", "fixture", "value"].join("-");
    const expectRequest = await rawHttp(
      server,
      [
        "POST /evidence HTTP/1.1",
        `Host: ${host}`,
        "Content-Type: application/json",
        "Content-Length: 100",
        "Expect: 100-continue",
        `Authorization: ${marker}`,
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
    expect(expectRequest).toMatch(/^HTTP\/1\.1 400/);
    expect(expectRequest).not.toContain("100 Continue");
    expect(expectRequest).toContain("FORBIDDEN_REQUEST_MATERIAL");
    expect(expectRequest).not.toContain(marker);
    expect(diagnostics.at(-1)).toMatchObject({ bodyRead: false, status: 400 });
    expect(JSON.stringify(diagnostics)).not.toContain(marker);
  });

  it("rejects a normal Expect request immediately without sending 100 Continue or reading a body", async () => {
    const { diagnostics, server } = await start();
    const response = await rawHttpWithoutRequestEnd(
      server,
      [
        "POST /evidence HTTP/1.1",
        `Host: 127.0.0.1:${server.port}`,
        "Content-Type: application/json",
        "Content-Length: 100",
        "Expect: 100-continue",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );

    expect(response).toMatch(/^HTTP\/1\.1 417/);
    expect(response).not.toContain("100 Continue");
    expect(response).toContain("EXPECTATION_NOT_ALLOWED");
    expect(diagnostics.at(-1)).toMatchObject({
      category: "EXPECTATION_NOT_ALLOWED",
      status: 417,
      bodyRead: false,
    });
  });

  it("rejects oversized HTTP headers without echoing request material", async () => {
    const { diagnostics, server } = await start();
    const marker = ["oversized", "header", "fixture"].join("-");
    const response = await rawHttp(
      server,
      [
        "GET / HTTP/1.1",
        `Host: 127.0.0.1:${server.port}`,
        `X-Fixture: ${marker}${"x".repeat(20_000)}`,
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
    expect(response).toMatch(/^HTTP\/1\.1 400/);
    expect(response).toContain("MALFORMED_HTTP");
    expect(response).toContain("Cache-Control: no-store");
    expect(response).not.toContain(marker);
    expect(JSON.stringify(diagnostics)).not.toContain(marker);
  });

  it("rejects missing JSON content type before reading the body", async () => {
    const { diagnostics, server } = await start();
    const response = await fetch(endpoint(server, "/evidence"), {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(await safeEvidence()),
    });

    expect(response.status).toBe(415);
    expect(await responseCategory(response)).toBe("CONTENT_TYPE_REQUIRED");
    expect(diagnostics.at(-1)).toMatchObject({ bodyRead: false, status: 415 });
  });
});

describe("public probe configuration", () => {
  it("returns an immutable schema-closed public config", async () => {
    const files = await createHarnessFiles();
    const config = await loadPublicConfig(files.configPath);
    expect(config).toEqual(validConfig());
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.accountAliases)).toBe(true);
    expect(Object.isFrozen(config.roomCalendars)).toBe(true);

    const forbiddenValue = ["private", "fixture", "value"].join("-");
    const unknownPath = join(files.directory, "unknown-config.local");
    await writeFile(
      unknownPath,
      JSON.stringify({ ...validConfig(), refreshToken: forbiddenValue }),
      "utf8",
    );
    await expect(loadPublicConfig(unknownPath)).rejects.toMatchObject({ category: "CONFIG_INVALID" });
    await loadPublicConfig(unknownPath).catch((error) => {
      expect(error.message).not.toContain(forbiddenValue);
    });
  });

  it("rejects a writable-by-others configuration file", async () => {
    const files = await createHarnessFiles();
    await chmod(files.configPath, 0o666);
    await expect(loadPublicConfig(files.configPath)).rejects.toMatchObject({
      category: "CONFIG_UNSAFE",
    });
  });
});

describe("browser probe static isolation", () => {
  it("lets a 320px viewport shrink around a classic vertical scrollbar", async () => {
    const html = await readFile(BROWSER_HTML_URL, "utf8");
    const bodyRule = html.match(/\n\s*body\s*\{([^}]*)\}/)?.[1];

    expect(bodyRule).toBeDefined();
    expect(bodyRule).not.toMatch(/min-width:\s*320px/);
    expect(html).toMatch(/\.probe-shell\s*\{[\s\S]*?width:\s*min\(100%,\s*1120px\)/);
    expect(html).toContain('<link rel="icon" href="data:," />');
  });

  it("keeps the stable controls, C3 role tokens, reserved feedback, and direct safety copy", async () => {
    const [html, app] = await Promise.all([
      readFile(BROWSER_HTML_URL, "utf8"),
      readFile(BROWSER_APP_URL, "utf8"),
    ]);

    for (const id of [
      "connect-google",
      "reconnect-google",
      "revoke-google",
      "probe-select",
      "run-probe",
      "export-evidence",
      "teardown",
      "status",
      "error",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    for (const copy of [
      "Google 계정 연결하기",
      "Google 계정 다시 연결하기",
      "연결 권한 해제하기",
      "선택한 검사 실행하기",
      "검사 결과 내보내기",
      "검사 데이터 정리하기",
      "가려진 결과만 전달",
      "내보낸 파일은 브라우저를 닫아도 기기에 남아요.",
    ]) {
      expect(html).toContain(copy);
    }

    for (const roleToken of [
      "--probe-action-radius",
      "--probe-select-radius",
      "--probe-card-radius",
      "--probe-feedback-radius",
      "--probe-boundary-radius",
      "--probe-boundary-node-radius",
      "--probe-alias-surface-radius",
      "--probe-skip-link-radius",
    ]) {
      expect(html).toContain(roleToken);
    }
    expect(html).not.toContain("--probe-input-radius");
    expect(html).not.toContain("border-radius: 999px");
    expect(html).toMatch(/--probe-action-height:\s*56px/);
    expect(html).toMatch(/--probe-select-height:\s*56px/);
    expect(html).toMatch(/@media \(min-width: 768px\)[\s\S]*--probe-action-height:\s*48px/);
    expect(html).toMatch(/@media \(min-width: 768px\)[\s\S]*--probe-select-height:\s*48px/);
    expect(html).toMatch(/\.probe-title\s*\{[\s\S]*font-size:\s*24px;[\s\S]*line-height:\s*36px/);
    expect(html).toContain("--probe-logo-wordmark: #202362");
    expect(html).toMatch(/--probe-feedback-panel-min-height:\s*160px/);
    expect(html).toMatch(
      /\.probe-status-panel\s*\{[\s\S]*min-height:\s*var\(--probe-feedback-panel-min-height\)/,
    );
    expect(html).toMatch(
      /<section class="probe-status-panel"[\s\S]*id="status"[\s\S]*id="error"[\s\S]*<\/section>/,
    );
    expect(html).not.toContain("min-height: 272px");
    expect(html).not.toContain("min-height: 176px");
    expect(html).not.toContain("min-height: 84px");
    expect(html).not.toMatch(/class="probe-reason"[^>]*hidden/);
    expect(app).toContain("elements.status.hidden = true;");
    expect(app).toContain("elements.status.hidden = false;");
    expect(app).not.toContain("reasonElement.hidden");
    expect(html).toMatch(/\.probe-alias-list li[\s\S]*overflow-wrap:\s*anywhere/);
    expect(html).not.toMatch(/probe-boundary-arrow"[^>]*aria-hidden/);
    expect(html.indexOf('class="probe-aliases"')).toBeLessThan(
      html.indexOf('id="revoke-google"'),
    );
    expect(html).toMatch(
      /<div class="probe-control">\s*<button[\s\S]*?id="run-probe"[\s\S]*?<p class="probe-reason" id="run-reason">/,
    );
    expect(app).toContain("scripts/google-spike/config.local 파일을 확인한 뒤 페이지를 다시 열어 주세요.");
    expect(app).toContain("내려받은 파일은 확인이 끝나면 직접 삭제해 주세요.");
  });

  it("keeps browser state ephemeral and the self-test network surface local", async () => {
    const [html, app, configText] = await Promise.all([
      readFile(BROWSER_HTML_URL, "utf8"),
      readFile(BROWSER_APP_URL, "utf8"),
      readFile(EXAMPLE_CONFIG_URL, "utf8"),
    ]);
    const config = JSON.parse(configText);

    expect(html).not.toContain('src="https://accounts.google.com/gsi/client"');
    expect(html).toContain('<script type="module" src="/app.mjs"></script>');
    expect(app).toContain('import { createGoogleFetch } from "/google-fetch.mjs";');
    expect(app).toContain('document.createElement("script")');
    expect(app).toContain('script.src = "https://accounts.google.com/gsi/client";');
    expect(app.indexOf('script.addEventListener("load"')).toBeLessThan(
      app.indexOf("document.head.append(script)"),
    );
    expect(app.indexOf('script.addEventListener("error"')).toBeLessThan(
      app.indexOf("document.head.append(script)"),
    );
    expect(app).toContain('fetch("/config"');
    expect(app).toContain('fetch("/evidence"');
    expect(app).not.toMatch(/fetch\(["']https?:/);
    expect(app).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB|caches|serviceWorker)\b/);
    expect(app).not.toContain("document.cookie");
    expect(app).not.toMatch(/\bconsole\s*\./);
    expect(app).not.toMatch(/\bwindow\s*\./);
    expect(app).not.toMatch(/(?:src\/|@vite|react)/i);
    expect(app).toContain("const activeRequests = new Set();");
    expect(app).toContain("const acceptedEvidence = [];");
    expect(app).toContain("let tokenClient = null;");
    expect(app).toContain("let accessToken = null;");
    expect(app).toContain('link.download = "molroom-google-spike-redacted-evidence.json";');
    expect(config).toEqual(validConfig());
    expect(configText).not.toMatch(/(?:client[_-]?secret|refresh[_-]?token|password|cookie|service[_-]?account)/i);
  });
});
