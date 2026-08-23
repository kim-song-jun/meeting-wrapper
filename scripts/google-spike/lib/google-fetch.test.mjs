import { afterEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_ENDPOINT_TEMPLATES } from "./evidence.mjs";
import {
  GOOGLE_OPERATIONS,
  computeRetryDelay,
  createGoogleFetch,
} from "./google-fetch.mjs";

const success = () => new Response(null, { status: 204 });
const rateLimited = (status = 429) =>
  new Response(
    JSON.stringify({
      error: {
        errors: [{ reason: "rateLimitExceeded" }],
      },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function abortError() {
  return new DOMException("The operation was aborted", "AbortError");
}

afterEach(() => vi.useRealTimers());

describe("Google request construction", () => {
  it("keeps every fixed operation on the Task 2 endpoint-template allowlist", () => {
    const operationTemplates = new Set(
      Object.values(GOOGLE_OPERATIONS).map((operation) => operation.endpointTemplate),
    );
    expect(operationTemplates).toEqual(new Set(GOOGLE_ENDPOINT_TEMPLATES));
  });

  it("encodes path values, permits only operation query keys, and adds auth internally", async () => {
    const calls = [];
    const transitions = [];
    const googleFetch = createGoogleFetch({
      fetch: async (url, init) => {
        calls.push({ url, init });
        return success();
      },
      onTransition: (transition) => transitions.push(transition),
    });
    const accessToken = ["fixture", "access", "value"].join("-");

    await googleFetch.request({
      operation: "calendar-event-get",
      accessToken,
      path: {
        calendar: "calendar value/segment",
        event: "event value/segment",
      },
      query: { maxAttendees: 10, timeZone: "Asia/Seoul" },
    });

    expect(calls).toHaveLength(1);
    const requested = new URL(calls[0].url);
    expect(requested.origin).toBe("https://www.googleapis.com");
    expect(requested.pathname).toBe(
      "/calendar/v3/calendars/calendar%20value%2Fsegment/events/event%20value%2Fsegment",
    );
    expect(requested.searchParams.get("maxAttendees")).toBe("10");
    expect(requested.searchParams.get("timeZone")).toBe("Asia/Seoul");
    expect(calls[0].url).not.toContain(accessToken);
    expect(calls[0].init.credentials).toBe("omit");
    expect(calls[0].init.cache).toBe("no-store");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.mode).toBe("cors");
    expect(calls[0].init.referrerPolicy).toBe("no-referrer");
    expect(new Headers(calls[0].init.headers).get("Authorization")?.endsWith(accessToken)).toBe(true);
    expect(transitions.every((entry) => {
      const keys = Object.keys(entry).sort();
      return keys.every((key) => ["attempt", "category", "delay", "state"].includes(key));
    })).toBe(true);
    expect(JSON.stringify(transitions)).not.toContain(accessToken);
    expect(JSON.stringify(transitions)).not.toContain("calendar value");
  });

  it("rejects raw operations, raw request fields, and non-allowlisted queries before fetch", async () => {
    let calls = 0;
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        calls += 1;
        return success();
      },
    });
    const base = {
      accessToken: "fixture-value",
      path: { calendar: "calendar-alias" },
    };

    await expect(
      googleFetch.request({ ...base, operation: "https://non-google.invalid/resource" }),
    ).rejects.toMatchObject({ category: "INVALID_OPERATION" });
    await expect(
      googleFetch.request({ ...base, operation: "calendar-events-list", url: "https://non-google.invalid" }),
    ).rejects.toMatchObject({ category: "INVALID_REQUEST_SHAPE" });
    await expect(
      googleFetch.request({
        ...base,
        operation: "calendar-events-list",
        query: { unsupported: "value" },
      }),
    ).rejects.toMatchObject({ category: "INVALID_QUERY" });
    await expect(
      googleFetch.request({
        ...base,
        operation: "calendar-event-get",
        path: { calendar: "calendar-alias" },
      }),
    ).rejects.toMatchObject({ category: "INVALID_PATH" });
    await expect(
      googleFetch.request({
        ...base,
        operation: "calendar-events-list",
        path: { calendar: "calendar-alias", event: "unexpected" },
      }),
    ).rejects.toMatchObject({ category: "INVALID_PATH" });
    for (const pathValue of [".", "..", "line\r\nbreak"]) {
      await expect(
        googleFetch.request({
          ...base,
          operation: "calendar-events-list",
          path: { calendar: pathValue },
        }),
      ).rejects.toMatchObject({ category: "INVALID_PATH" });
    }
    await expect(
      googleFetch.request({
        ...base,
        operation: "calendar-events-list",
        query: { timeZone: "line\r\nbreak" },
      }),
    ).rejects.toMatchObject({ category: "INVALID_QUERY" });
    expect(calls).toBe(0);
  });

  it("sends revoke material in a direct form body rather than a URL or auth header", async () => {
    const calls = [];
    const googleFetch = createGoogleFetch({
      fetch: async (url, init) => {
        calls.push({ url, init });
        return success();
      },
    });
    const accessToken = ["revoke", "fixture", "value"].join("-");

    await googleFetch.request({ operation: "oauth-revoke", accessToken });

    expect(calls[0].url).toBe("https://oauth2.googleapis.com/revoke");
    expect(calls[0].url).not.toContain(accessToken);
    expect(new Headers(calls[0].init.headers).has("Authorization")).toBe(false);
    expect(new URLSearchParams(calls[0].init.body).get("token")).toBe(accessToken);
  });
});

describe("bounded Google request state machine", () => {
  it("allows at most two active requests and releases a slot exactly once", async () => {
    const pending = [deferred(), deferred(), deferred()];
    let started = 0;
    let active = 0;
    let maximum = 0;
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        const index = started;
        started += 1;
        active += 1;
        maximum = Math.max(maximum, active);
        const response = await pending[index].promise;
        active -= 1;
        return response;
      },
    });
    const request = () =>
      googleFetch.request({
        operation: "calendar-events-list",
        accessToken: "fixture-value",
        path: { calendar: "calendar-alias" },
      });

    const first = request();
    const second = request();
    const third = request();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toBe(2);
    expect(maximum).toBe(2);

    pending[0].resolve(success());
    await first;
    await Promise.resolve();
    expect(started).toBe(3);
    pending[1].resolve(success());
    pending[2].resolve(success());
    await Promise.race([
      Promise.all([second, third]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("queued request did not start")), 100)),
    ]);
    expect(active).toBe(0);
  });

  it("uses deterministic half-to-full jitter and never exceeds three attempts", async () => {
    expect(computeRetryDelay(1, () => 0)).toBe(125);
    expect(computeRetryDelay(1, () => 1)).toBe(250);
    expect(computeRetryDelay(2, () => 0)).toBe(250);
    expect(computeRetryDelay(2, () => 1)).toBe(500);
    expect(computeRetryDelay(5, () => 1)).toBe(2_000);
    expect(computeRetryDelay(20, () => 1)).toBe(2_000);

    const delays = [];
    const randomValues = [0, 1];
    let attempts = 0;
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        attempts += 1;
        return new Response(null, { status: 429, headers: { "Retry-After": "999999" } });
      },
      random: () => randomValues.shift(),
      sleep: async (delay) => delays.push(delay),
    });

    await expect(
      googleFetch.request({
        operation: "calendar-events-list",
        accessToken: "fixture-value",
        path: { calendar: "calendar-alias" },
      }),
    ).rejects.toMatchObject({ category: "RATE_LIMITED", attempts: 3, status: 429 });
    expect(attempts).toBe(3);
    expect(delays).toEqual([125, 500]);
  });

  it("retries only Calendar 429 and exact rateLimitExceeded 403 responses", async () => {
    const cases = [
      {
        operation: "calendar-events-list",
        path: { calendar: "calendar-alias" },
        response: () => rateLimited(403),
        expectedAttempts: 3,
        expectedCategory: "RATE_LIMITED",
      },
      {
        operation: "calendar-events-list",
        path: { calendar: "calendar-alias" },
        response: () => new Response("not-json", { status: 429 }),
        expectedAttempts: 3,
        expectedCategory: "RATE_LIMITED",
      },
      {
        operation: "calendar-events-list",
        path: { calendar: "calendar-alias" },
        response: () =>
          new Response(JSON.stringify({ error: { errors: [{ reason: "forbidden" }] } }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
        expectedAttempts: 1,
        expectedCategory: "FORBIDDEN",
      },
      {
        operation: "calendar-events-list",
        path: { calendar: "calendar-alias" },
        response: () =>
          new Response(JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
        expectedAttempts: 1,
        expectedCategory: "FORBIDDEN",
      },
      {
        operation: "calendar-events-list",
        path: { calendar: "calendar-alias" },
        response: () => new Response("not-json", { status: 403 }),
        expectedAttempts: 1,
        expectedCategory: "FORBIDDEN",
      },
      {
        operation: "drive-files-list",
        path: {},
        response: () => rateLimited(),
        expectedAttempts: 1,
        expectedCategory: "HTTP_ERROR",
      },
      {
        operation: "people-search-directory",
        path: {},
        response: () => rateLimited(),
        expectedAttempts: 1,
        expectedCategory: "HTTP_ERROR",
      },
      {
        operation: "oauth-revoke",
        path: {},
        response: () => rateLimited(),
        expectedAttempts: 1,
        expectedCategory: "HTTP_ERROR",
      },
      {
        operation: "calendar-events-list",
        path: { calendar: "calendar-alias" },
        response: () => new Response(null, { status: 401 }),
        expectedAttempts: 1,
        expectedCategory: "HTTP_ERROR",
      },
      {
        operation: "calendar-events-list",
        path: { calendar: "calendar-alias" },
        response: () => new Response(null, { status: 500 }),
        expectedAttempts: 1,
        expectedCategory: "HTTP_ERROR",
      },
    ];

    for (const testCase of cases) {
      let attempts = 0;
      const googleFetch = createGoogleFetch({
        fetch: async () => {
          attempts += 1;
          return testCase.response();
        },
        random: () => 0,
        sleep: async () => undefined,
      });
      await expect(
        googleFetch.request({
          operation: testCase.operation,
          accessToken: "fixture-value",
          path: testCase.path,
        }),
      ).rejects.toMatchObject({ category: testCase.expectedCategory });
      expect(attempts).toBe(testCase.expectedAttempts);
    }
  });

  it("discards raw Google error messages from errors and transitions", async () => {
    const transitions = [];
    const rawMessage = ["raw", "google", "message", "fixture"].join("-");
    const googleFetch = createGoogleFetch({
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              errors: [{ reason: "forbidden", message: rawMessage }],
              message: rawMessage,
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      onTransition: (entry) => transitions.push(entry),
    });

    const error = await googleFetch
      .request({
        operation: "calendar-events-list",
        accessToken: "fixture-value",
        path: { calendar: "calendar-alias" },
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({ category: "FORBIDDEN", attempts: 1, status: 403 });
    expect(error.message).toBe("FORBIDDEN");
    expect(error.message).not.toContain(rawMessage);
    expect(JSON.stringify(transitions)).not.toContain(rawMessage);
  });

  it("does not retry or expose a network failure message", async () => {
    let attempts = 0;
    const rawMessage = ["network", "message", "fixture"].join("-");
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        attempts += 1;
        throw new Error(rawMessage);
      },
    });

    const error = await googleFetch
      .request({
        operation: "calendar-events-list",
        accessToken: "fixture-value",
        path: { calendar: "calendar-alias" },
      })
      .catch((caught) => caught);

    expect(error).toMatchObject({ category: "NETWORK_ERROR", attempts: 1 });
    expect(error.message).toBe("NETWORK_ERROR");
    expect(error.message).not.toContain(rawMessage);
    expect(attempts).toBe(1);
  });
});

describe("Google request cancellation", () => {
  it("does not queue or fetch an already-aborted request", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        calls += 1;
        return success();
      },
    });

    await expect(
      googleFetch.request({
        operation: "calendar-events-list",
        accessToken: "fixture-value",
        path: { calendar: "calendar-alias" },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("removes an aborted queued request and starts no later attempt", async () => {
    const pending = [deferred(), deferred()];
    let calls = 0;
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        const index = calls;
        calls += 1;
        return pending[index].promise;
      },
    });
    const request = (signal) =>
      googleFetch.request({
        operation: "calendar-events-list",
        accessToken: "fixture-value",
        path: { calendar: "calendar-alias" },
        signal,
      });
    const first = request();
    const second = request();
    const controller = new AbortController();
    const queued = request(controller.signal);
    const queuedRejection = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await queuedRejection;
    expect(calls).toBe(2);

    pending[0].resolve(success());
    pending[1].resolve(success());
    await Promise.all([first, second]);
    await Promise.resolve();
    expect(calls).toBe(2);
  });

  it("aborts during backoff and releases the concurrency slot", async () => {
    const enteredBackoff = deferred();
    const controller = new AbortController();
    let calls = 0;
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        calls += 1;
        return calls === 1 ? rateLimited() : success();
      },
      random: () => 0,
      sleep: async (_delay, signal) => {
        enteredBackoff.resolve();
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      },
    });

    const request = googleFetch.request({
      operation: "calendar-events-list",
      accessToken: "fixture-value",
      path: { calendar: "calendar-alias" },
      signal: controller.signal,
    });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await enteredBackoff.promise;
    controller.abort();
    await rejection;
    expect(calls).toBe(1);

    await googleFetch.request({
      operation: "drive-files-list",
      accessToken: "fixture-value",
      path: {},
    });
    expect(calls).toBe(2);
  });

  it("propagates abort to fetch, releases its slot, and starts the third queued request", async () => {
    const controller = new AbortController();
    const secondGate = deferred();
    let calls = 0;
    const transitions = [];
    const googleFetch = createGoogleFetch({
      fetch: async (_url, init) => {
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
          });
        }
        if (calls === 2) await secondGate.promise;
        return success();
      },
      onTransition: (entry) => transitions.push(entry),
    });

    const aborted = googleFetch.request({
      operation: "calendar-events-list",
      accessToken: "fixture-value",
      path: { calendar: "calendar-alias" },
      signal: controller.signal,
    });
    const second = googleFetch.request({
      operation: "drive-files-list",
      accessToken: "fixture-value",
      path: {},
    });
    const third = googleFetch.request({
      operation: "people-search-directory",
      accessToken: "fixture-value",
      path: {},
    });
    const rejection = expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    controller.abort();
    await rejection;
    expect(transitions.filter((entry) => entry.state === "aborted" && entry.category === "ABORTED")).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(3);
    secondGate.resolve(success());
    await Promise.all([second, third]);
  });
});

describe("Google request deadline", () => {
  it("times out a hung active request at the total deadline and releases its slot", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const transitions = [];
    const googleFetch = createGoogleFetch({
      fetch: async (_url, init) => {
        calls += 1;
        if (calls === 1) {
          await new Promise((_, reject) => {
            init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
          });
        }
        return success();
      },
      onTransition: (entry) => transitions.push(entry),
    });
    const first = googleFetch.request({
      operation: "calendar-events-list",
      accessToken: "fixture-value",
      path: { calendar: "calendar-alias" },
    });
    const firstRejection = expect(first).rejects.toMatchObject({ category: "TIMEOUT", attempts: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    await firstRejection;
    expect(transitions.filter((entry) => entry.state === "failed" && entry.category === "TIMEOUT")).toHaveLength(1);

    await expect(
      googleFetch.request({
        operation: "drive-files-list",
        accessToken: "fixture-value",
        path: {},
      }),
    ).resolves.toMatchObject({ status: 204 });
    expect(calls).toBe(2);
  });

  it("cleans a queued caller abort without leaving its deadline timer", async () => {
    vi.useFakeTimers();
    const pending = [deferred(), deferred()];
    let calls = 0;
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        const index = calls;
        calls += 1;
        return pending[index].promise;
      },
    });
    const request = (signal) =>
      googleFetch.request({
        operation: "calendar-events-list",
        accessToken: "fixture-value",
        path: { calendar: "calendar-alias" },
        signal,
      });
    const first = request();
    const second = request();
    const controller = new AbortController();
    const queued = request(controller.signal);
    const queuedRejection = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(calls).toBe(2);
    controller.abort();
    await queuedRejection;
    expect(vi.getTimerCount()).toBe(2);

    pending[0].resolve(success());
    pending[1].resolve(success());
    await Promise.all([first, second]);
  });

  it("cleans all request timers when a request waits in the queue through the deadline", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const transitions = [];
    const googleFetch = createGoogleFetch({
      fetch: async () => {
        calls += 1;
        return new Promise(() => undefined);
      },
      onTransition: (entry) => transitions.push(entry),
    });
    const request = () =>
      googleFetch.request({
        operation: "calendar-events-list",
        accessToken: "fixture-value",
        path: { calendar: "calendar-alias" },
      });
    const requests = [request(), request(), request()];
    const rejections = requests.map((request_) =>
      expect(request_).rejects.toMatchObject({ category: "TIMEOUT" }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all(rejections);
    expect(calls).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(transitions.filter((entry) => entry.state === "failed" && entry.category === "TIMEOUT")).toHaveLength(3);
  });
});
