// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, type RenderResult } from "@testing-library/react";
import { createElement, StrictMode, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useAsync } from "./useAsync";

interface AsyncSnapshot<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface LatestRequestCoordinator<T> {
  activate(): void;
  deactivate(): void;
  start(loader: () => Promise<T>): void;
  run(loader: () => Promise<T>): Promise<void>;
  acknowledgeCommit(snapshot: AsyncSnapshot<T>): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
}

interface ProbeSnapshot {
  data: string | null;
  error: string | null;
  loading: boolean;
}

interface QueuedRequest extends Deferred<string> {
  dependency: string;
}

type CoordinatorFactory = <T>(
  initial: AsyncSnapshot<T>,
  commit: (snapshot: AsyncSnapshot<T>) => void,
) => LatestRequestCoordinator<T>;

async function loadCoordinatorFactory(): Promise<CoordinatorFactory> {
  const useAsyncModule = await import("./useAsync");
  const factory = (
    useAsyncModule as typeof useAsyncModule & {
      createLatestRequestCoordinator?: CoordinatorFactory;
    }
  ).createLatestRequestCoordinator;

  expect(factory, "latest-request coordinator must be implemented").toBeTypeOf("function");
  if (!factory) {
    throw new Error("latest-request coordinator must be implemented");
  }
  return factory;
}

function createAcknowledgedCoordinator<T>(
  factory: CoordinatorFactory,
  initial: AsyncSnapshot<T>,
  commit: (snapshot: AsyncSnapshot<T>) => void,
): LatestRequestCoordinator<T> {
  let coordinator!: LatestRequestCoordinator<T>;
  coordinator = factory(initial, (snapshot) => {
    commit(snapshot);
    coordinator.acknowledgeCommit(snapshot);
  });
  coordinator.activate();
  return coordinator;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createRequestQueue() {
  const requests: QueuedRequest[] = [];
  return {
    load(dependency: string): Promise<string> {
      const request = { dependency, ...deferred<string>() };
      requests.push(request);
      return request.promise;
    },
    requests,
  };
}

function AsyncProbe({
  dependency,
  load,
  onReloadReady,
  onReloadStart,
  onRender,
}: {
  dependency: string;
  load: (dependency: string) => Promise<string>;
  onReloadReady?: (reloadAsync: () => Promise<void>) => void;
  onReloadStart?: (completion: Promise<void>) => void;
  onRender?: (snapshot: ProbeSnapshot) => void;
}) {
  const state = useAsync(() => load(dependency), [dependency]);
  const snapshot: ProbeSnapshot = {
    data: state.data,
    error: state.error?.message ?? null,
    loading: state.loading,
  };
  onRender?.(snapshot);

  useEffect(() => {
    onReloadReady?.(state.reloadAsync);
  }, [onReloadReady, state.reloadAsync]);

  return createElement(
    "section",
    null,
    createElement("output", { "data-testid": "async-data" }, state.data ?? ""),
    createElement("output", { "data-testid": "async-error" }, state.error?.message ?? ""),
    createElement("output", { "data-testid": "async-loading" }, String(state.loading)),
    createElement(
      "button",
      {
        "data-testid": "reload-async",
        onClick: () => {
          const completion = state.reloadAsync();
          onReloadStart?.(completion);
        },
        type: "button",
      },
      "reload async",
    ),
    createElement(
      "button",
      {
        "data-testid": "reload",
        onClick: state.reload,
        type: "button",
      },
      "reload",
    ),
  );
}

function renderProbe(
  dependency: string,
  queue: ReturnType<typeof createRequestQueue>,
  onRender?: (snapshot: ProbeSnapshot) => void,
  onReloadStart?: (completion: Promise<void>) => void,
  onReloadReady?: (reloadAsync: () => Promise<void>) => void,
) {
  return render(
    createElement(AsyncProbe, {
      dependency,
      load: queue.load,
      ...(onReloadReady ? { onReloadReady } : {}),
      ...(onReloadStart ? { onReloadStart } : {}),
      ...(onRender ? { onRender } : {}),
    }),
  );
}

function readProbe(view: RenderResult): ProbeSnapshot {
  return {
    data: view.getByTestId("async-data").textContent || null,
    error: view.getByTestId("async-error").textContent || null,
    loading: view.getByTestId("async-loading").textContent === "true",
  };
}

async function fulfill(request: Deferred<string>, value: string): Promise<void> {
  await act(async () => {
    request.resolve(value);
    await request.promise;
  });
}

async function fail(request: Deferred<string>, error: unknown): Promise<void> {
  await act(async () => {
    request.reject(error);
    await request.promise.catch(() => undefined);
  });
}

afterEach(() => {
  cleanup();
});

describe("createLatestRequestCoordinator", () => {
  it("starts automatic loads only during an active lifetime without a completion handle", async () => {
    const createCoordinator = await loadCoordinatorFactory();
    const commits: AsyncSnapshot<string>[] = [];
    let coordinator!: LatestRequestCoordinator<string>;
    coordinator = createCoordinator<string>(
      { data: null, error: null, loading: true },
      (snapshot) => {
        commits.push(snapshot);
        coordinator.acknowledgeCommit(snapshot);
      },
    );
    let loaderStarts = 0;

    expect(coordinator.start, "automatic requests need a non-awaiting start path").toBeTypeOf(
      "function",
    );
    if (typeof coordinator.start !== "function") return;

    const inactiveResult = coordinator.start(() => {
      loaderStarts += 1;
      return Promise.resolve("must not load while inactive");
    });
    expect(inactiveResult).toBeUndefined();
    expect(loaderStarts).toBe(0);
    expect(commits).toEqual([]);

    coordinator.activate();
    const active = deferred<string>();
    const activeResult = coordinator.start(() => {
      loaderStarts += 1;
      return active.promise;
    });
    expect(activeResult).toBeUndefined();
    expect(loaderStarts).toBe(1);
    expect(commits).toEqual([{ data: null, error: null, loading: true }]);

    active.resolve("fresh");
    await active.promise;
    await Promise.resolve();
    expect(commits.at(-1)).toEqual({ data: "fresh", error: null, loading: false });

    coordinator.deactivate();
    const commitCountAtDeactivation = commits.length;
    const deactivatedResult = coordinator.start(() => {
      loaderStarts += 1;
      return Promise.resolve("must not reload after deactivation");
    });
    expect(deactivatedResult).toBeUndefined();
    expect(loaderStarts).toBe(1);
    expect(commits).toHaveLength(commitCountAtDeactivation);
  });

  it("runs loaders only while its lifetime is active", async () => {
    const createCoordinator = await loadCoordinatorFactory();
    const commits: AsyncSnapshot<string>[] = [];
    let coordinator!: LatestRequestCoordinator<string>;
    coordinator = createCoordinator<string>(
      { data: null, error: null, loading: true },
      (snapshot) => {
        commits.push(snapshot);
        coordinator.acknowledgeCommit(snapshot);
      },
    );
    let inactiveLoaderStarted = false;

    expect(coordinator.activate, "coordinator lifetime must be activatable").toBeTypeOf(
      "function",
    );
    expect(coordinator.deactivate, "coordinator lifetime must be deactivatable").toBeTypeOf(
      "function",
    );
    if (
      typeof coordinator.activate !== "function" ||
      typeof coordinator.deactivate !== "function"
    ) {
      return;
    }

    await expect(
      coordinator.run(() => {
        inactiveLoaderStarted = true;
        return Promise.resolve("must not load");
      }),
    ).resolves.toBeUndefined();
    expect(inactiveLoaderStarted).toBe(false);
    expect(commits).toEqual([]);

    coordinator.activate();
    const active = deferred<string>();
    const activeRun = coordinator.run(() => active.promise);
    expect(commits).toEqual([{ data: null, error: null, loading: true }]);
    active.resolve("live");
    await activeRun;
    expect(commits.at(-1)).toEqual({ data: "live", error: null, loading: false });

    coordinator.deactivate();
    const commitCountAtDeactivation = commits.length;
    let deactivatedLoaderStarted = false;
    await expect(
      coordinator.run(() => {
        deactivatedLoaderStarted = true;
        return Promise.resolve("must not reload");
      }),
    ).resolves.toBeUndefined();
    expect(deactivatedLoaderStarted).toBe(false);
    expect(commits).toHaveLength(commitCountAtDeactivation);
  });

  it("keeps previous data visible while the latest reload is pending", async () => {
    const createCoordinator = await loadCoordinatorFactory();
    let snapshot: AsyncSnapshot<string> = { data: null, error: null, loading: true };
    const coordinator = createAcknowledgedCoordinator(createCoordinator, snapshot, (next) => {
      snapshot = next;
    });

    const initial = deferred<string>();
    const initialRun = coordinator.run(() => initial.promise);
    initial.resolve("cached");
    await initialRun;
    expect(snapshot).toEqual({ data: "cached", error: null, loading: false });

    const reload = deferred<string>();
    const reloadRun = coordinator.run(() => reload.promise);
    expect(snapshot).toEqual({ data: "cached", error: null, loading: true });

    reload.resolve("fresh");
    await reloadRun;
    expect(snapshot).toEqual({ data: "fresh", error: null, loading: false });
  });

  it("keeps data and loading owned by the newest request when an older request fulfills first", async () => {
    const createCoordinator = await loadCoordinatorFactory();
    let snapshot: AsyncSnapshot<string> = { data: null, error: null, loading: true };
    const coordinator = createAcknowledgedCoordinator(createCoordinator, snapshot, (next) => {
      snapshot = next;
    });
    const older = deferred<string>();
    const newer = deferred<string>();

    const olderRun = coordinator.run(() => older.promise);
    const newerRun = coordinator.run(() => newer.promise);
    let olderRunSettled = false;
    void olderRun.then(() => {
      olderRunSettled = true;
    });
    older.resolve("stale");
    await older.promise;
    await Promise.resolve();

    expect(olderRunSettled).toBe(false);
    expect(snapshot).toEqual({ data: null, error: null, loading: true });

    newer.resolve("fresh");
    await Promise.all([olderRun, newerRun]);
    expect(olderRunSettled).toBe(true);
    expect(snapshot).toEqual({ data: "fresh", error: null, loading: false });
  });

  it("does not let an older fulfillment clear the newest request error", async () => {
    const createCoordinator = await loadCoordinatorFactory();
    let snapshot: AsyncSnapshot<string> = { data: "cached", error: null, loading: false };
    const coordinator = createAcknowledgedCoordinator(createCoordinator, snapshot, (next) => {
      snapshot = next;
    });
    const older = deferred<string>();
    const newer = deferred<string>();

    const olderRun = coordinator.run(() => older.promise);
    const newerRun = coordinator.run(() => newer.promise);
    newer.reject(new Error("newest failed"));
    await Promise.all([olderRun, newerRun]);
    older.resolve("stale");
    await older.promise;
    await Promise.resolve();

    expect(snapshot.data).toBe("cached");
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toEqual(new Error("newest failed"));
  });

  it("does not let an older rejection replace the newest request success", async () => {
    const createCoordinator = await loadCoordinatorFactory();
    let snapshot: AsyncSnapshot<string> = { data: "cached", error: null, loading: false };
    const coordinator = createAcknowledgedCoordinator(createCoordinator, snapshot, (next) => {
      snapshot = next;
    });
    const older = deferred<string>();
    const newer = deferred<string>();

    const olderRun = coordinator.run(() => older.promise);
    const newerRun = coordinator.run(() => newer.promise);
    newer.resolve("fresh");
    await Promise.all([olderRun, newerRun]);
    older.reject(new Error("stale failure"));
    await older.promise.catch(() => undefined);
    await Promise.resolve();

    expect(snapshot).toEqual({ data: "fresh", error: null, loading: false });
  });

  it("invalidates every commit from an in-flight request on unmount", async () => {
    const createCoordinator = await loadCoordinatorFactory();
    const commits: AsyncSnapshot<string>[] = [];
    const coordinator = createAcknowledgedCoordinator(
      createCoordinator,
      { data: "cached", error: null, loading: false },
      (next) => commits.push(next),
    );
    const pending = deferred<string>();

    const run = coordinator.run(() => pending.promise);
    expect(commits).toEqual([{ data: "cached", error: null, loading: true }]);
    coordinator.deactivate();
    await expect(run).resolves.toBeUndefined();
    pending.resolve("must not commit");
    await pending.promise;
    await Promise.resolve();

    expect(commits).toEqual([{ data: "cached", error: null, loading: true }]);
  });

  it("normalizes non-Error rejections without rejecting reloadAsync callers", async () => {
    const createCoordinator = await loadCoordinatorFactory();
    let snapshot: AsyncSnapshot<string> = { data: "cached", error: null, loading: false };
    const coordinator = createAcknowledgedCoordinator(createCoordinator, snapshot, (next) => {
      snapshot = next;
    });

    await expect(coordinator.run(() => Promise.reject("offline"))).resolves.toBeUndefined();

    expect(snapshot.data).toBe("cached");
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toEqual(new Error("offline"));
  });
});

describe("useAsync React lifecycle", () => {
  it("ignores an old fulfillment after a dependency rerender", async () => {
    const queue = createRequestQueue();
    const view = renderProbe("alpha", queue);
    expect(queue.requests.map(({ dependency }) => dependency)).toEqual(["alpha"]);

    view.rerender(
      createElement(AsyncProbe, {
        dependency: "beta",
        load: queue.load,
      }),
    );
    expect(queue.requests.map(({ dependency }) => dependency)).toEqual(["alpha", "beta"]);

    await fulfill(queue.requests[0]!, "stale alpha");
    expect(readProbe(view)).toEqual({ data: null, error: null, loading: true });

    await fulfill(queue.requests[1]!, "fresh beta");
    expect(readProbe(view)).toEqual({ data: "fresh beta", error: null, loading: false });
  });

  it("ignores an old rejection after a dependency rerender", async () => {
    const queue = createRequestQueue();
    const view = renderProbe("alpha", queue);

    view.rerender(
      createElement(AsyncProbe, {
        dependency: "beta",
        load: queue.load,
      }),
    );
    await fail(queue.requests[0]!, new Error("stale alpha failure"));

    expect(readProbe(view)).toEqual({ data: null, error: null, loading: true });

    await fulfill(queue.requests[1]!, "fresh beta");
    expect(readProbe(view)).toEqual({ data: "fresh beta", error: null, loading: false });
  });

  it.each([
    {
      label: "fulfillment",
      settle: (request: Deferred<string>) => fulfill(request, "must not render"),
    },
    {
      label: "rejection",
      settle: (request: Deferred<string>) => fail(request, new Error("must not render")),
    },
  ])("blocks every $label state update after unmount", async ({ settle }) => {
    const queue = createRequestQueue();
    const renders: ProbeSnapshot[] = [];
    const view = renderProbe("alpha", queue, (snapshot) => renders.push(snapshot));
    const renderCountAtUnmount = renders.length;

    view.unmount();
    await settle(queue.requests[0]!);

    expect(renders).toHaveLength(renderCountAtUnmount);
  });

  it("resolves a captured reloadAsync without starting work after unmount", async () => {
    const queue = createRequestQueue();
    const renders: ProbeSnapshot[] = [];
    let capturedReloadAsync: (() => Promise<void>) | undefined;
    const view = renderProbe(
      "alpha",
      queue,
      (snapshot) => renders.push(snapshot),
      undefined,
      (reloadAsync) => {
        capturedReloadAsync = reloadAsync;
      },
    );
    if (!capturedReloadAsync) {
      throw new Error("reloadAsync callback was not exposed by the mounted probe");
    }
    const reloadAsync = capturedReloadAsync;
    const requestCountAtUnmount = queue.requests.length;
    const renderCountAtUnmount = renders.length;

    view.unmount();
    let resolution = "pending";
    await act(async () => {
      const completion = reloadAsync();
      let pendingBoundary: ReturnType<typeof setTimeout> | undefined;
      try {
        resolution = await Promise.race([
          completion.then(() => "resolved"),
          new Promise<string>((resolve) => {
            pendingBoundary = setTimeout(() => resolve("pending"), 0);
          }),
        ]);
      } finally {
        if (pendingBoundary !== undefined) clearTimeout(pendingBoundary);
      }
    });

    expect({
      renderCount: renders.length,
      requestCount: queue.requests.length,
      resolution,
    }).toEqual({
      renderCount: renderCountAtUnmount,
      requestCount: requestCountAtUnmount,
      resolution: "resolved",
    });
  });

  it("keeps manual reload latest-only through the rendered hook", async () => {
    const queue = createRequestQueue();
    const view = renderProbe("alpha", queue);
    await fulfill(queue.requests[0]!, "cached");

    fireEvent.click(view.getByTestId("reload-async"));
    fireEvent.click(view.getByTestId("reload-async"));
    expect(queue.requests).toHaveLength(3);

    await fulfill(queue.requests[2]!, "fresh");
    await fail(queue.requests[1]!, new Error("stale reload failure"));

    expect(readProbe(view)).toEqual({ data: "fresh", error: null, loading: false });
  });

  it("keeps a stale reloadAsync caller pending until the superseding dependency request commits", async () => {
    const queue = createRequestQueue();
    let manualCompletion: Promise<void> | undefined;
    const view = renderProbe(
      "alpha",
      queue,
      undefined,
      (completion) => {
        manualCompletion = completion;
      },
    );
    await fulfill(queue.requests[0]!, "cached alpha");

    fireEvent.click(view.getByTestId("reload-async"));
    if (!manualCompletion) {
      throw new Error("reloadAsync completion was not exposed by the rendered probe");
    }
    const completion = manualCompletion;
    let snapshotAtCompletion: ProbeSnapshot | undefined;
    void completion.then(() => {
      snapshotAtCompletion = readProbe(view);
    });

    view.rerender(
      createElement(AsyncProbe, {
        dependency: "beta",
        load: queue.load,
      }),
    );
    expect(queue.requests.map(({ dependency }) => dependency)).toEqual([
      "alpha",
      "alpha",
      "beta",
    ]);

    await fulfill(queue.requests[1]!, "stale manual alpha");
    expect(snapshotAtCompletion).toBeUndefined();
    expect(readProbe(view)).toEqual({ data: "cached alpha", error: null, loading: true });

    await fulfill(queue.requests[2]!, "fresh beta");
    await completion;
    expect(snapshotAtCompletion).toEqual({ data: "fresh beta", error: null, loading: false });
  });

  it("does not acknowledge a batched stale commit before the replacement effect starts", async () => {
    const queue = createRequestQueue();
    let manualCompletion: Promise<void> | undefined;
    const view = renderProbe(
      "alpha",
      queue,
      undefined,
      (completion) => {
        manualCompletion = completion;
      },
    );
    await fulfill(queue.requests[0]!, "cached alpha");

    fireEvent.click(view.getByTestId("reload-async"));
    if (!manualCompletion) {
      throw new Error("reloadAsync completion was not exposed by the rendered probe");
    }
    const completion = manualCompletion;
    let completionSettled = false;
    void completion.then(() => {
      completionSettled = true;
    });

    await act(async () => {
      queue.requests[1]!.resolve("batched stale alpha");
      await queue.requests[1]!.promise;
      view.rerender(
        createElement(AsyncProbe, {
          dependency: "beta",
          load: queue.load,
        }),
      );
    });

    expect(queue.requests.map(({ dependency }) => dependency)).toEqual([
      "alpha",
      "alpha",
      "beta",
    ]);
    expect(completionSettled).toBe(false);

    await fulfill(queue.requests[2]!, "fresh beta");
    await completion;
    expect(readProbe(view)).toEqual({ data: "fresh beta", error: null, loading: false });
  });

  it("runs reload through the effect while keeping rendered prior data", async () => {
    const queue = createRequestQueue();
    const view = renderProbe("alpha", queue);
    await fulfill(queue.requests[0]!, "cached");

    fireEvent.click(view.getByTestId("reload"));
    expect(queue.requests).toHaveLength(2);
    expect(readProbe(view)).toEqual({ data: "cached", error: null, loading: true });

    await fulfill(queue.requests[1]!, "fresh");
    expect(readProbe(view)).toEqual({ data: "fresh", error: null, loading: false });
  });

  it("keeps rendered prior data and normalizes a non-Error reload rejection", async () => {
    const queue = createRequestQueue();
    let reloadCompletion: Promise<void> | undefined;
    const view = renderProbe(
      "alpha",
      queue,
      undefined,
      (completion) => {
        reloadCompletion = completion;
      },
    );
    await fulfill(queue.requests[0]!, "cached");

    fireEvent.click(view.getByTestId("reload-async"));
    await fail(queue.requests[1]!, "offline");
    if (!reloadCompletion) {
      throw new Error("reloadAsync completion was not exposed by the rendered probe");
    }
    await expect(reloadCompletion).resolves.toBeUndefined();

    expect(readProbe(view)).toEqual({ data: "cached", error: "offline", loading: false });
  });

  it("keeps the StrictMode replay request from replacing its live successor", async () => {
    const queue = createRequestQueue();
    const view = render(
      createElement(
        StrictMode,
        null,
        createElement(AsyncProbe, {
          dependency: "alpha",
          load: queue.load,
        }),
      ),
    );
    expect(queue.requests).toHaveLength(2);

    await fulfill(queue.requests[1]!, "fresh");
    await fulfill(queue.requests[0]!, "stale replay");

    expect(readProbe(view)).toEqual({ data: "fresh", error: null, loading: false });
  });
});
