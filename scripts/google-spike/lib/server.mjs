import { constants as fsConstants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { validateEvidence, EvidencePolicyError } from "./evidence.mjs";

export const MAX_EVIDENCE_BYTES = 16_384;

const MAX_CONFIG_BYTES = 16_384;
const MAX_STATIC_BYTES = 512 * 1024;
const SHUTDOWN_FORCE_MS = 250;
const CONFIG_KEYS = new Set([
  "schemaVersion",
  "googleClientId",
  "accountAliases",
  "roomCalendars",
]);
const REQUEST_DIAGNOSTIC_KEYS = new Set(["category", "status", "bodyRead"]);
const ALIAS_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CLIENT_ID_PATTERN = /^\d{6,}-[a-z0-9]+\.apps\.googleusercontent\.com$/;
const FORBIDDEN_CONFIG_KEY = /(?:authorization|bearer|clientsecret|cookie|password|refreshtoken|serviceaccount|token)/i;
const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Content-Security-Policy": [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self' https://www.googleapis.com https://people.googleapis.com https://oauth2.googleapis.com",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src https://accounts.google.com",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'unsafe-inline'",
  ].join("; "),
});

export class ProbeServerError extends Error {
  constructor(category) {
    super(category);
    this.name = "ProbeServerError";
    this.category = category;
  }
}

function fail(category) {
  throw new ProbeServerError(category);
}

function isPlainRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertString(value, { max = 512, pattern } = {}) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    (pattern && !pattern.test(value))
  ) {
    fail("CONFIG_INVALID");
  }
}

function assertNoForbiddenConfigKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenConfigKeys);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^A-Za-z]/g, "");
    if (FORBIDDEN_CONFIG_KEY.test(normalized)) fail("CONFIG_INVALID");
    assertNoForbiddenConfigKeys(child);
  }
}

function validatePublicConfig(value) {
  assertNoForbiddenConfigKeys(value);
  if (!isPlainRecord(value)) fail("CONFIG_INVALID");
  const keys = Object.keys(value);
  if (keys.length !== CONFIG_KEYS.size || keys.some((key) => !CONFIG_KEYS.has(key))) {
    fail("CONFIG_INVALID");
  }
  if (value.schemaVersion !== 1) fail("CONFIG_INVALID");
  assertString(value.googleClientId, { max: 256 });
  if (
    value.googleClientId !== "replace-with-public-browser-client-id" &&
    !CLIENT_ID_PATTERN.test(value.googleClientId)
  ) {
    fail("CONFIG_INVALID");
  }
  if (
    !Array.isArray(value.accountAliases) ||
    value.accountAliases.length === 0 ||
    value.accountAliases.length > 8
  ) {
    fail("CONFIG_INVALID");
  }
  const accountAliases = new Set();
  for (const alias of value.accountAliases) {
    assertString(alias, { max: 64, pattern: ALIAS_PATTERN });
    if (accountAliases.has(alias)) fail("CONFIG_INVALID");
    accountAliases.add(alias);
  }
  if (!isPlainRecord(value.roomCalendars)) fail("CONFIG_INVALID");
  const rooms = Object.entries(value.roomCalendars);
  if (rooms.length === 0 || rooms.length > 16) fail("CONFIG_INVALID");
  for (const [alias, calendarId] of rooms) {
    assertString(alias, { max: 64, pattern: ALIAS_PATTERN });
    assertString(calendarId, { max: 512 });
  }
  return freeze({
    schemaVersion: 1,
    googleClientId: value.googleClientId,
    accountAliases: [...value.accountAliases],
    roomCalendars: { ...value.roomCalendars },
  });
}

async function readRegularFile(path, { maxBytes, unsafeCategory, requirePrivate = false }) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (_error) {
    fail(unsafeCategory);
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maxBytes) fail(unsafeCategory);
    if (requirePrivate && (metadata.mode & 0o022) !== 0) fail(unsafeCategory);
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function loadPublicConfig(path) {
  const text = await readRegularFile(path, {
    maxBytes: MAX_CONFIG_BYTES,
    unsafeCategory: "CONFIG_UNSAFE",
    requirePrivate: true,
  });
  let value;
  try {
    value = JSON.parse(text);
  } catch (_error) {
    fail("CONFIG_INVALID");
  }
  return validatePublicConfig(value);
}

async function loadStaticFiles(browserDir, googleFetchPath) {
  const [html, app, googleFetch] = await Promise.all([
    readRegularFile(`${browserDir}/index.html`, {
      maxBytes: MAX_STATIC_BYTES,
      unsafeCategory: "STATIC_FILE_UNSAFE",
    }),
    readRegularFile(`${browserDir}/app.mjs`, {
      maxBytes: MAX_STATIC_BYTES,
      unsafeCategory: "STATIC_FILE_UNSAFE",
    }),
    readRegularFile(googleFetchPath, {
      maxBytes: MAX_STATIC_BYTES,
      unsafeCategory: "STATIC_FILE_UNSAFE",
    }),
  ]);
  return Object.freeze({ html, app, googleFetch });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    if (error?.code === "ESRCH") return false;
    fail("PIDFILE_UNSAFE");
  }
}

async function classifyExistingPidFile(pidPath) {
  let metadata;
  try {
    metadata = await lstat(pidPath);
  } catch (_error) {
    fail("PIDFILE_UNSAFE");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("PIDFILE_UNSAFE");
  const text = await readRegularFile(pidPath, {
    maxBytes: 32,
    unsafeCategory: "PIDFILE_UNSAFE",
  });
  if (!/^[1-9]\d*\n$/.test(text)) fail("PIDFILE_UNSAFE");
  const pid = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(pid) || !isProcessAlive(pid)) fail("PIDFILE_UNSAFE");
  fail("PORT_ALREADY_OWNED");
}

async function createPidFile(pidPath, processId) {
  let handle;
  try {
    handle = await open(
      pidPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (error?.code === "EEXIST" || error?.code === "ELOOP") {
      await classifyExistingPidFile(pidPath);
    }
    fail("PIDFILE_UNSAFE");
  }
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${processId}\n`, "utf8");
    await handle.sync();
    const metadata = await handle.stat();
    return Object.freeze({ dev: metadata.dev, ino: metadata.ino });
  } finally {
    await handle.close();
  }
}

async function removeOwnedPidFile(pidPath, processId, ownership) {
  let before;
  try {
    before = await lstat(pidPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return false;
  }
  if (!before.isFile() || before.isSymbolicLink()) return false;
  if (before.dev !== ownership.dev || before.ino !== ownership.ino) return false;
  let text;
  try {
    text = await readRegularFile(pidPath, {
      maxBytes: 32,
      unsafeCategory: "PIDFILE_UNSAFE",
    });
  } catch (error) {
    if (error instanceof ProbeServerError) return false;
    throw error;
  }
  if (text !== `${processId}\n`) return false;
  let after;
  try {
    after = await lstat(pidPath);
  } catch (_error) {
    return false;
  }
  if (after.dev !== before.dev || after.ino !== before.ino || after.isSymbolicLink()) return false;
  try {
    await unlink(pidPath);
    return true;
  } catch (_error) {
    return false;
  }
}

function applySecurityHeaders(response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

function diagnostic(onDiagnostic, entry) {
  const keys = Object.keys(entry);
  if (keys.some((key) => !REQUEST_DIAGNOSTIC_KEYS.has(key))) {
    fail("DIAGNOSTIC_UNSAFE");
  }
  onDiagnostic(Object.freeze({ ...entry }));
}

function sendJson(response, status, category, pointer, onDiagnostic, bodyRead) {
  applySecurityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  const payload = pointer === undefined ? { category } : { category, pointer };
  response.end(JSON.stringify(payload));
  diagnostic(onDiagnostic, { category, status, bodyRead });
}

function sendText(response, status, contentType, body, category, onDiagnostic) {
  applySecurityHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.end(body);
  diagnostic(onDiagnostic, { category, status, bodyRead: false });
}

function sendNoContent(response, onDiagnostic) {
  applySecurityHeaders(response);
  response.statusCode = 204;
  response.end();
  diagnostic(onDiagnostic, { category: "EVIDENCE_ACCEPTED", status: 204, bodyRead: true });
}

function parseRequestTarget(rawTarget) {
  if (
    typeof rawTarget !== "string" ||
    rawTarget.length === 0 ||
    rawTarget.length > 2_048 ||
    /[\u0000-\u001f\u007f\\%#]/.test(rawTarget)
  ) {
    return null;
  }
  const queryIndex = rawTarget.indexOf("?");
  const pathname = queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex);
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  return Object.freeze({ pathname, hasQuery: queryIndex !== -1 });
}

function readBoundedBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      request.off("aborted", onAborted);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("data", onData);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onAborted = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProbeServerError("REQUEST_ABORTED"));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProbeServerError("REQUEST_FAILED"));
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        chunks.length = 0;
        finish({ tooLarge: true });
        request.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish({ tooLarge: false, body: Buffer.concat(chunks).toString("utf8") });
    request.on("aborted", onAborted);
    request.on("error", onError);
    request.on("data", onData);
    request.on("end", onEnd);
  });
}

function isAllowedHost(hostHeader, port) {
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

function isAllowedOrigin(origin, port) {
  return (
    origin === undefined ||
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}`
  );
}

function createRequestHandler({ config, files, port, onDiagnostic }) {
  return async (request, response) => {
    if (!isAllowedHost(request.headers.host, port)) {
      sendJson(response, 400, "HOST_NOT_ALLOWED", undefined, onDiagnostic, false);
      return;
    }
    if (!isAllowedOrigin(request.headers.origin, port)) {
      sendJson(response, 400, "ORIGIN_NOT_ALLOWED", undefined, onDiagnostic, false);
      return;
    }
    const target = parseRequestTarget(request.url ?? "");
    if (target === null) {
      sendJson(response, 400, "REQUEST_TARGET_INVALID", undefined, onDiagnostic, false);
      return;
    }
    if (target.hasQuery) {
      sendJson(response, 400, "QUERY_NOT_ALLOWED", undefined, onDiagnostic, false);
      return;
    }

    if (request.method === "GET" && target.pathname === "/") {
      sendText(response, 200, "text/html; charset=utf-8", files.html, "STATIC_HTML", onDiagnostic);
      return;
    }
    if (request.method === "GET" && target.pathname === "/app.mjs") {
      sendText(
        response,
        200,
        "text/javascript; charset=utf-8",
        files.app,
        "STATIC_MODULE",
        onDiagnostic,
      );
      return;
    }
    if (request.method === "GET" && target.pathname === "/google-fetch.mjs") {
      sendText(
        response,
        200,
        "text/javascript; charset=utf-8",
        files.googleFetch,
        "GOOGLE_FETCH_MODULE",
        onDiagnostic,
      );
      return;
    }
    if (request.method === "GET" && target.pathname === "/config") {
      sendText(
        response,
        200,
        "application/json; charset=utf-8",
        JSON.stringify(config),
        "PUBLIC_CONFIG",
        onDiagnostic,
      );
      return;
    }
    if (request.method !== "POST" || target.pathname !== "/evidence") {
      sendJson(response, 404, "NOT_FOUND", undefined, onDiagnostic, false);
      return;
    }
    if (request.headers.authorization !== undefined || request.headers.cookie !== undefined) {
      response.setHeader("Connection", "close");
      sendJson(response, 400, "FORBIDDEN_REQUEST_MATERIAL", undefined, onDiagnostic, false);
      return;
    }
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      response.setHeader("Connection", "close");
      sendJson(response, 415, "CONTENT_TYPE_REQUIRED", undefined, onDiagnostic, false);
      return;
    }

    let bounded;
    try {
      bounded = await readBoundedBody(request, MAX_EVIDENCE_BYTES);
    } catch (error) {
      const category = error instanceof ProbeServerError ? error.category : "REQUEST_FAILED";
      if (!response.headersSent) sendJson(response, 400, category, undefined, onDiagnostic, true);
      return;
    }
    if (bounded.tooLarge) {
      sendJson(response, 413, "EVIDENCE_TOO_LARGE", undefined, onDiagnostic, true);
      return;
    }
    let evidence;
    try {
      evidence = JSON.parse(bounded.body);
    } catch (_error) {
      sendJson(response, 400, "MALFORMED_JSON", undefined, onDiagnostic, true);
      return;
    }
    try {
      validateEvidence(evidence);
    } catch (error) {
      if (error instanceof EvidencePolicyError) {
        sendJson(response, 400, error.category, error.pointer, onDiagnostic, true);
        return;
      }
      sendJson(response, 400, "INVALID_EVIDENCE_SHAPE", "/_invalid", onDiagnostic, true);
      return;
    }
    sendNoContent(response, onDiagnostic);
  };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port, exclusive: true });
  });
}

function closeHttpServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const forceTimer = setTimeout(() => server.closeAllConnections?.(), SHUTDOWN_FORCE_MS);
    forceTimer.unref?.();
    try {
      server.close((error) => {
        clearTimeout(forceTimer);
        if (error) reject(error);
        else resolve();
      });
      server.closeIdleConnections?.();
    } catch (error) {
      clearTimeout(forceTimer);
      reject(error);
    }
  });
}

function sendMalformedHttp(socket, onDiagnostic) {
  if (!socket.writable) return;
  const body = JSON.stringify({ category: "MALFORMED_HTTP" });
  const headerLines = [
    "HTTP/1.1 400 Bad Request",
    ...Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}`),
    "Connection: close",
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "",
    body,
  ];
  socket.end(headerLines.join("\r\n"));
  diagnostic(onDiagnostic, { category: "MALFORMED_HTTP", status: 400, bodyRead: false });
}

function rejectExpectation(request, response, onDiagnostic) {
  response.setHeader("Connection", "close");
  if (request.headers.authorization !== undefined || request.headers.cookie !== undefined) {
    sendJson(response, 400, "FORBIDDEN_REQUEST_MATERIAL", undefined, onDiagnostic, false);
    return;
  }
  sendJson(response, 417, "EXPECTATION_NOT_ALLOWED", undefined, onDiagnostic, false);
}

export async function startProbeServer({
  host,
  port,
  allowEphemeralPort = false,
  browserDir,
  configPath,
  googleFetchPath,
  pidPath,
  processId = process.pid,
  onDiagnostic = () => undefined,
}) {
  if (
    host !== "127.0.0.1" ||
    !Number.isSafeInteger(port) ||
    (port !== 5184 && !(allowEphemeralPort && port >= 0 && port <= 65_535)) ||
    typeof browserDir !== "string" ||
    typeof configPath !== "string" ||
    typeof googleFetchPath !== "string" ||
    typeof pidPath !== "string" ||
    !Number.isSafeInteger(processId) ||
    processId <= 0 ||
    typeof onDiagnostic !== "function"
  ) {
    fail("INVALID_BIND");
  }
  const [config, files] = await Promise.all([
    loadPublicConfig(configPath),
    loadStaticFiles(browserDir, googleFetchPath),
  ]);
  const server = createServer();
  server.on("clientError", (_error, socket) => sendMalformedHttp(socket, onDiagnostic));
  try {
    await listen(server, host, port);
  } catch (error) {
    if (error?.code === "EADDRINUSE") fail("PORT_ALREADY_OWNED");
    fail("LISTEN_FAILED");
  }
  const address = server.address();
  if (address === null || typeof address === "string" || address.address !== "127.0.0.1") {
    await closeHttpServer(server);
    fail("INVALID_BIND");
  }
  let pidOwnership;
  try {
    pidOwnership = await createPidFile(pidPath, processId);
  } catch (error) {
    await closeHttpServer(server);
    throw error;
  }
  const actualPort = address.port;
  const requestHandler = createRequestHandler({ config, files, port: actualPort, onDiagnostic });
  server.on("request", requestHandler);
  server.on("checkContinue", (request, response) =>
    rejectExpectation(request, response, onDiagnostic),
  );
  server.on("checkExpectation", (request, response) =>
    rejectExpectation(request, response, onDiagnostic),
  );
  let closePromise;
  const close = () => {
    if (closePromise === undefined) {
      closePromise = (async () => {
        await closeHttpServer(server);
        const pidFileRemoved = await removeOwnedPidFile(pidPath, processId, pidOwnership);
        return Object.freeze({ pidFileRemoved });
      })();
    }
    return closePromise;
  };
  return Object.freeze({
    host,
    address: address.address,
    port: actualPort,
    pid: processId,
    close,
  });
}
