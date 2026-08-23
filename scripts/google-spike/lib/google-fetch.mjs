const MAX_CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 2_000;
const REQUEST_DEADLINE_MS = 30_000;
const REQUEST_KEYS = new Set(["operation", "accessToken", "path", "query", "body", "signal"]);

function operation(endpointTemplate, method, pathKeys, queryKeys, kind, bodyMode = "none") {
  return Object.freeze({
    endpointTemplate,
    method,
    pathKeys: Object.freeze([...pathKeys]),
    queryKeys: Object.freeze([...queryKeys]),
    kind,
    bodyMode,
  });
}

export const GOOGLE_OPERATIONS = Object.freeze({
  "calendar-events-list": operation(
    "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events",
    "GET",
    ["calendar"],
    [
      "timeMin",
      "timeMax",
      "singleEvents",
      "orderBy",
      "maxResults",
      "pageToken",
      "showDeleted",
      "timeZone",
      "sharedExtendedProperty",
    ],
    "calendar",
  ),
  "calendar-events-create": operation(
    "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events",
    "POST",
    ["calendar"],
    ["conferenceDataVersion", "sendUpdates", "supportsAttachments"],
    "calendar",
    "json",
  ),
  "calendar-event-get": operation(
    "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events/{event}",
    "GET",
    ["calendar", "event"],
    ["maxAttendees", "timeZone"],
    "calendar",
  ),
  "calendar-event-patch": operation(
    "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events/{event}",
    "PATCH",
    ["calendar", "event"],
    ["conferenceDataVersion", "sendUpdates", "supportsAttachments"],
    "calendar",
    "json",
  ),
  "calendar-event-delete": operation(
    "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events/{event}",
    "DELETE",
    ["calendar", "event"],
    ["sendUpdates"],
    "calendar",
  ),
  "calendar-event-instances": operation(
    "https://www.googleapis.com/calendar/v3/calendars/{calendar}/events/{event}/instances",
    "GET",
    ["calendar", "event"],
    ["maxResults", "pageToken", "showDeleted", "timeMin", "timeMax", "timeZone"],
    "calendar",
  ),
  "drive-files-list": operation(
    "https://www.googleapis.com/drive/v3/files",
    "GET",
    [],
    ["fields", "pageSize", "pageToken", "q", "spaces"],
    "drive",
  ),
  "drive-files-create": operation(
    "https://www.googleapis.com/drive/v3/files",
    "POST",
    [],
    ["fields"],
    "drive",
    "json",
  ),
  "drive-file-get": operation(
    "https://www.googleapis.com/drive/v3/files/{file}",
    "GET",
    ["file"],
    ["alt", "fields"],
    "drive",
  ),
  "drive-file-patch": operation(
    "https://www.googleapis.com/drive/v3/files/{file}",
    "PATCH",
    ["file"],
    ["fields"],
    "drive",
    "json",
  ),
  "drive-file-delete": operation(
    "https://www.googleapis.com/drive/v3/files/{file}",
    "DELETE",
    ["file"],
    [],
    "drive",
  ),
  "drive-upload-create": operation(
    "https://www.googleapis.com/upload/drive/v3/files",
    "POST",
    [],
    ["fields", "uploadType"],
    "drive",
    "raw",
  ),
  "drive-upload-patch": operation(
    "https://www.googleapis.com/upload/drive/v3/files/{file}",
    "PATCH",
    ["file"],
    ["fields", "uploadType"],
    "drive",
    "raw",
  ),
  "people-search-directory": operation(
    "https://people.googleapis.com/v1/people:searchDirectoryPeople",
    "GET",
    [],
    ["pageSize", "pageToken", "query", "readMask", "sources"],
    "people",
  ),
  "oauth-revoke": operation(
    "https://oauth2.googleapis.com/revoke",
    "POST",
    [],
    [],
    "oauth",
    "revoke",
  ),
});

export class GoogleFetchPolicyError extends Error {
  constructor(category) {
    super(category);
    this.name = "GoogleFetchPolicyError";
    this.category = category;
  }
}

export class GoogleFetchError extends Error {
  constructor(category, { status, attempts }) {
    super(category);
    this.name = "GoogleFetchError";
    this.category = category;
    this.status = status;
    this.attempts = attempts;
  }
}

function policyError(category) {
  throw new GoogleFetchPolicyError(category);
}

function isPlainRecord(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function abortError() {
  return new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function awaitWithAbort(promise, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function assertRequestShape(request) {
  if (!isPlainRecord(request)) policyError("INVALID_REQUEST_SHAPE");
  for (const key of Object.keys(request)) {
    if (!REQUEST_KEYS.has(key)) policyError("INVALID_REQUEST_SHAPE");
  }
  if (!Object.hasOwn(request, "operation") || !Object.hasOwn(request, "accessToken")) {
    policyError("INVALID_REQUEST_SHAPE");
  }
}

function assertAccessToken(accessToken) {
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > 4_096 ||
    /[\u0000-\u001f\u007f]/.test(accessToken)
  ) {
    policyError("INVALID_ACCESS_MATERIAL");
  }
}

function assertPathValue(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value === "." ||
    value === ".."
  ) {
    policyError("INVALID_PATH");
  }
}

function buildPath(operationDefinition, path) {
  const values = path === undefined ? {} : path;
  if (!isPlainRecord(values)) policyError("INVALID_PATH");
  const suppliedKeys = Object.keys(values);
  if (
    suppliedKeys.length !== operationDefinition.pathKeys.length ||
    suppliedKeys.some((key) => !operationDefinition.pathKeys.includes(key))
  ) {
    policyError("INVALID_PATH");
  }
  let endpoint = operationDefinition.endpointTemplate;
  for (const key of operationDefinition.pathKeys) {
    assertPathValue(values[key]);
    endpoint = endpoint.replace(`{${key}}`, encodeURIComponent(values[key]));
  }
  if (endpoint.includes("{")) policyError("INVALID_PATH");
  return endpoint;
}

function queryValues(value) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > 16) policyError("INVALID_QUERY");
  return values.map((item) => {
    if (
      !["string", "number", "boolean"].includes(typeof item) ||
      (typeof item === "number" && !Number.isFinite(item))
    ) {
      policyError("INVALID_QUERY");
    }
    const text = String(item);
    if (text.length === 0 || text.length > 2_048 || /[\u0000-\u001f\u007f]/.test(text)) {
      policyError("INVALID_QUERY");
    }
    return text;
  });
}

function appendQuery(url, operationDefinition, query) {
  const values = query === undefined ? {} : query;
  if (!isPlainRecord(values)) policyError("INVALID_QUERY");
  for (const key of Object.keys(values)) {
    if (!operationDefinition.queryKeys.includes(key)) policyError("INVALID_QUERY");
  }
  for (const key of operationDefinition.queryKeys) {
    if (!Object.hasOwn(values, key)) continue;
    for (const value of queryValues(values[key])) url.searchParams.append(key, value);
  }
}

function requestBody(operationDefinition, accessToken, body, headers) {
  if (operationDefinition.bodyMode === "revoke") {
    if (body !== undefined) policyError("INVALID_BODY");
    headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
    return new URLSearchParams({ token: accessToken }).toString();
  }
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (operationDefinition.bodyMode === "none") {
    if (body !== undefined) policyError("INVALID_BODY");
    return undefined;
  }
  if (body === undefined) policyError("INVALID_BODY");
  if (operationDefinition.bodyMode === "json") {
    if (!isPlainRecord(body)) policyError("INVALID_BODY");
    headers.set("Content-Type", "application/json");
    return JSON.stringify(body);
  }
  return body;
}

function buildRequest(request) {
  assertRequestShape(request);
  if (typeof request.operation !== "string" || !Object.hasOwn(GOOGLE_OPERATIONS, request.operation)) {
    policyError("INVALID_OPERATION");
  }
  const operationDefinition = GOOGLE_OPERATIONS[request.operation];
  assertAccessToken(request.accessToken);
  if (
    request.signal !== undefined &&
    (typeof request.signal !== "object" ||
      typeof request.signal.addEventListener !== "function" ||
      typeof request.signal.removeEventListener !== "function")
  ) {
    policyError("INVALID_SIGNAL");
  }
  const url = new URL(buildPath(operationDefinition, request.path));
  appendQuery(url, operationDefinition, request.query);
  const headers = new Headers({ Accept: "application/json" });
  const body = requestBody(operationDefinition, request.accessToken, request.body, headers);
  return Object.freeze({
    operationDefinition,
    url: url.toString(),
    init: Object.freeze({
      method: operationDefinition.method,
      headers,
      body,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      mode: "cors",
      signal: request.signal,
    }),
    signal: request.signal,
  });
}

function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  const drain = () => {
    while (active < limit && queue.length > 0) {
      const entry = queue.shift();
      entry.signal?.removeEventListener("abort", entry.onAbort);
      if (entry.signal?.aborted) {
        entry.reject(abortError());
        continue;
      }
      active += 1;
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        active -= 1;
        drain();
      });
    }
  };

  return Object.freeze({
    acquire(signal) {
      throwIfAborted(signal);
      return new Promise((resolve, reject) => {
        const entry = {
          signal,
          resolve,
          reject,
          onAbort: undefined,
        };
        entry.onAbort = () => {
          const index = queue.indexOf(entry);
          if (index === -1) return;
          queue.splice(index, 1);
          signal.removeEventListener("abort", entry.onAbort);
          reject(abortError());
        };
        signal?.addEventListener("abort", entry.onAbort, { once: true });
        queue.push(entry);
        drain();
      });
    },
  });
}

export function computeRetryDelay(attempt, random = Math.random) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || typeof random !== "function") {
    policyError("INVALID_RETRY_STATE");
  }
  const randomValue = random();
  if (typeof randomValue !== "number" || randomValue < 0 || randomValue > 1) {
    policyError("INVALID_RETRY_STATE");
  }
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.floor(ceiling * (0.5 + randomValue * 0.5));
}

function defaultSleep(delay, signal) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function calendarErrorReason(response, signal) {
  try {
    const payload = await awaitWithAbort(response.json(), signal);
    throwIfAborted(signal);
    const reason = payload?.error?.errors?.[0]?.reason;
    return typeof reason === "string" ? reason : null;
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw abortError();
    return null;
  }
}

async function classifyResponse(response, kind, signal) {
  if (
    response === null ||
    typeof response !== "object" ||
    !Number.isSafeInteger(response.status) ||
    typeof response.ok !== "boolean"
  ) {
    policyError("INVALID_FETCH_RESPONSE");
  }
  if (response.ok) return Object.freeze({ ok: true, retryable: false, category: "SUCCESS" });
  if (kind !== "calendar") {
    return Object.freeze({ ok: false, retryable: false, category: "HTTP_ERROR" });
  }
  if (response.status === 429) {
    return Object.freeze({ ok: false, retryable: true, category: "RATE_LIMITED" });
  }
  if (response.status === 403) {
    const reason = await calendarErrorReason(response, signal);
    if (reason === "rateLimitExceeded") {
      return Object.freeze({ ok: false, retryable: true, category: "RATE_LIMITED" });
    }
    return Object.freeze({ ok: false, retryable: false, category: "FORBIDDEN" });
  }
  return Object.freeze({ ok: false, retryable: false, category: "HTTP_ERROR" });
}

function transition(onTransition, state, values = {}) {
  const entry = { state };
  if (values.attempt !== undefined) entry.attempt = values.attempt;
  if (values.category !== undefined) entry.category = values.category;
  if (values.delay !== undefined) entry.delay = values.delay;
  onTransition(Object.freeze(entry));
}

export function createGoogleFetch({
  fetch: fetchImplementation = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  onTransition = () => undefined,
} = {}) {
  if (
    typeof fetchImplementation !== "function" ||
    typeof sleep !== "function" ||
    typeof random !== "function" ||
    typeof onTransition !== "function"
  ) {
    policyError("INVALID_FACTORY");
  }
  const semaphore = createSemaphore(MAX_CONCURRENCY);

  const request = async (input) => {
    const built = buildRequest(input);
    throwIfAborted(built.signal);
    const deadlineController = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => deadlineController.abort();
    built.signal?.addEventListener("abort", onCallerAbort, { once: true });
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      deadlineController.abort();
    }, REQUEST_DEADLINE_MS);
    const init = Object.freeze({ ...built.init, signal: deadlineController.signal });
    const timeoutError = (attempts) => new GoogleFetchError("TIMEOUT", { attempts });
    transition(onTransition, "queued");
    let release;
    let attempt = 0;
    try {
      release = await semaphore.acquire(deadlineController.signal);
    } catch (error) {
      if (timedOut) {
        transition(onTransition, "failed", { category: "TIMEOUT" });
        throw timeoutError(0);
      }
      if (error?.name === "AbortError") transition(onTransition, "aborted", { category: "ABORTED" });
      throw error;
    }
    try {
      for (attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        throwIfAborted(deadlineController.signal);
        transition(onTransition, "running", { attempt });
        let response;
        try {
          response = await awaitWithAbort(
            fetchImplementation(built.url, init),
            deadlineController.signal,
          );
        } catch (error) {
          if (deadlineController.signal.aborted) {
            if (timedOut) throw timeoutError(attempt);
            transition(onTransition, "aborted", { attempt, category: "ABORTED" });
            throw abortError();
          }
          transition(onTransition, "failed", { attempt, category: "NETWORK_ERROR" });
          throw new GoogleFetchError("NETWORK_ERROR", { attempts: attempt });
        }
        throwIfAborted(deadlineController.signal);
        const classification = await classifyResponse(
          response,
          built.operationDefinition.kind,
          deadlineController.signal,
        );
        if (classification.ok) {
          throwIfAborted(deadlineController.signal);
          transition(onTransition, "succeeded", { attempt, category: "SUCCESS" });
          return response;
        }
        if (classification.retryable && attempt < MAX_ATTEMPTS) {
          const delay = computeRetryDelay(attempt, random);
          transition(onTransition, "backoff", {
            attempt,
            category: classification.category,
            delay,
          });
          try {
            await awaitWithAbort(sleep(delay, deadlineController.signal), deadlineController.signal);
          } catch (error) {
            if (deadlineController.signal.aborted) {
              if (timedOut) throw timeoutError(attempt);
              transition(onTransition, "aborted", { attempt, category: "ABORTED" });
              throw abortError();
            }
            transition(onTransition, "failed", { attempt, category: "SLEEP_FAILED" });
            throw new GoogleFetchError("SLEEP_FAILED", { attempts: attempt });
          }
          continue;
        }
        transition(onTransition, "failed", {
          attempt,
          category: classification.category,
        });
        throw new GoogleFetchError(classification.category, {
          status: response.status,
          attempts: attempt,
        });
      }
      throw new GoogleFetchError("RETRY_STATE_INVALID", { attempts: MAX_ATTEMPTS });
    } catch (error) {
      if (timedOut && error?.name === "AbortError") {
        transition(onTransition, "failed", { attempt, category: "TIMEOUT" });
        throw timeoutError(attempt);
      }
      if (built.signal?.aborted && error?.name === "AbortError") {
        transition(onTransition, "aborted", { attempt, category: "ABORTED" });
      }
      throw error;
    } finally {
      release();
      clearTimeout(deadlineTimer);
      built.signal?.removeEventListener("abort", onCallerAbort);
    }
  };

  return Object.freeze({ request });
}
