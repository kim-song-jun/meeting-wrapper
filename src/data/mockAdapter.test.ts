import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingDraft } from "../domain/types";

function setNavigation(search: string): void {
  vi.stubGlobal("window", { location: { search } });
}

async function importAdapter(search: string, development = true) {
  vi.resetModules();
  vi.stubEnv("DEV", development);
  vi.stubEnv("PROD", !development);
  setNavigation(search);
  return (await import("./mockAdapter")).mockAdapter;
}

function draft(recurrence: BookingDraft["recurrence"] = null): BookingDraft {
  return {
    roomId: "room-small",
    title: "QA fixture booking",
    start: new Date("2026-08-03T08:00:00+09:00"),
    end: new Date("2026-08-03T08:30:00+09:00"),
    headcount: 2,
    attendeeEmails: [],
    conference: null,
    recurrence,
  };
}

async function expectPendingFor<T>(promise: Promise<T>, elapsedMs: number): Promise<void> {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(elapsedMs);
  expect(settled).toBe(false);
}

async function expectArrayAfter<T>(promise: Promise<T>, delayMs: number): Promise<void> {
  const assertion = expect(promise).resolves.toBeInstanceOf(Array);
  await vi.advanceTimersByTimeAsync(delayMs);
  await assertion;
}

async function expectErrorAfter(
  promise: Promise<unknown>,
  delayMs: number,
  message: string,
): Promise<void> {
  const observed = promise.then(
    () => ({ ok: true as const, error: null }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(delayMs);
  const result = await observed;
  expect(result.ok).toBe(false);
  expect(result.error).toBeInstanceOf(Error);
  if (result.error instanceof Error) {
    expect(result.error.message).toBe(message);
  }
}

describe("mockAdapter DEV QA fixtures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T01:45:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses mockSaveDelayMs for create while leaving reads at their original latency", async () => {
    const adapter = await importAdapter("?mockSaveDelayMs=2000");

    const read = adapter.listByDay(new Date("2026-07-29T00:00:00+09:00"));
    await expectPendingFor(read, 139);
    await vi.advanceTimersByTimeAsync(1);
    await expect(read).resolves.toBeInstanceOf(Array);

    const save = adapter.create(draft());
    await expectPendingFor(save, 1_999);
    await vi.advanceTimersByTimeAsync(1);
    await expect(save).resolves.toMatchObject({ ok: true });
  });

  it("uses mockSaveDelayMs for createRecurring", async () => {
    const adapter = await importAdapter("?mockSaveDelayMs=2000");
    const save = adapter.createRecurring(draft({ freq: "weekly", count: 1 }));

    await expectPendingFor(save, 1_999);
    await vi.advanceTimersByTimeAsync(1);
    await expect(save).resolves.toMatchObject({ booked: expect.any(Array), rejected: [] });
  });

  it.each(["5001", "1.5", "abc"])(
    "warns once for invalid mockSaveDelayMs=%s and preserves the existing create latency",
    async (value) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const adapter = await importAdapter("?mockSaveDelayMs=" + value);
      const save = adapter.create(draft());

      await expectPendingFor(save, 219);
      await vi.advanceTimersByTimeAsync(1);
      await expect(save).resolves.toMatchObject({ ok: true });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("[MolRoom QA] invalid mockSaveDelayMs");
    },
  );

  it("fails only the first grid read, then Retry and unrelated reads succeed", async () => {
    const adapter = await importAdapter("?mockReadError=grid-once");
    const day = new Date("2026-07-29T00:00:00+09:00");

    await expectErrorAfter(adapter.listByDay(day), 140, "QA fixture: grid read failed");
    await expectArrayAfter(adapter.listByDay(day), 140);
    await expectArrayAfter(adapter.listByRoom("room-small", day), 120);
  });

  it("fails exactly one of two immediate grid reads, keeping the latest read for StrictMode", async () => {
    const adapter = await importAdapter("?mockReadError=grid-once");
    const day = new Date("2026-07-29T00:00:00+09:00");
    const results = Promise.allSettled([adapter.listByDay(day), adapter.listByDay(day)]);

    await vi.advanceTimersByTimeAsync(140);

    await expect(results).resolves.toEqual([
      { status: "fulfilled", value: expect.any(Array) },
      { status: "rejected", reason: new Error("QA fixture: grid read failed") },
    ]);
  });

  it("fails only the first room read, then Retry and unrelated reads succeed", async () => {
    const adapter = await importAdapter("?mockReadError=room-once");
    const day = new Date("2026-07-29T00:00:00+09:00");

    await expectErrorAfter(
      adapter.listByRoom("room-small", day),
      120,
      "QA fixture: room read failed",
    );
    await expectArrayAfter(adapter.listByRoom("room-small", day), 120);
    await expectArrayAfter(adapter.listByDay(day), 140);
  });

  it("fails only the first My Bookings read, then Retry and unrelated reads succeed", async () => {
    const adapter = await importAdapter("?mockReadError=my-bookings-once");
    const day = new Date("2026-07-29T00:00:00+09:00");

    await expectErrorAfter(adapter.listMine(), 120, "QA fixture: my-bookings read failed");
    await expectArrayAfter(adapter.listMine(), 120);
    await expectArrayAfter(adapter.listByDay(day), 140);
  });

  it("warns once and leaves reads green for an unknown read-error enum", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const adapter = await importAdapter("?mockReadError=surprise");
    const day = new Date("2026-07-29T00:00:00+09:00");

    await expectArrayAfter(adapter.listByDay(day), 140);
    await expectArrayAfter(adapter.listByRoom("room-small", day), 120);
    await expectArrayAfter(adapter.listMine(), 120);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[MolRoom QA] invalid mockReadError");
  });

  it("ignores all query fixtures in production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const adapter = await importAdapter(
      "?mockNow=2024-01-01T00%3A00%3A00Z&mockSaveDelayMs=2000&mockReadError=grid-once",
      false,
    );
    const day = new Date("2026-07-29T00:00:00+09:00");

    const read = adapter.listByDay(day);
    await expectPendingFor(read, 139);
    await vi.advanceTimersByTimeAsync(1);
    await expect(read).resolves.toBeInstanceOf(Array);

    const save = adapter.create(draft());
    await expectPendingFor(save, 219);
    await vi.advanceTimersByTimeAsync(1);
    await expect(save).resolves.toMatchObject({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });
});
