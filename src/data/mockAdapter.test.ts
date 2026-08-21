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

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
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

describe("mockAdapter schedule mutations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T11:30:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates and persists the requested room, time, title, and ownership", async () => {
    const adapter = await importAdapter("");
    const requested = {
      ...draft(),
      roomId: "room-small",
      title: "계약 테스트 회의",
      start: new Date("2026-08-20T16:00:00+09:00"),
      end: new Date("2026-08-20T16:30:00+09:00"),
    };

    const result = await settle(adapter.create(requested));
    expect(result).toMatchObject({
      ok: true,
      booking: {
        roomId: "room-small",
        title: "계약 테스트 회의",
        start: requested.start,
        end: requested.end,
        isMine: true,
      },
    });

    const persisted = await settle(adapter.listByRoom("room-small", requested.start));
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roomId: "room-small",
          title: "계약 테스트 회의",
          start: requested.start,
          end: requested.end,
          isMine: true,
        }),
      ]),
    );
  });

  it("moves a booking across rooms and removes it from the old room", async () => {
    const adapter = await importAdapter("");
    const day = new Date("2026-08-20T00:00:00+09:00");
    const seeded = (await settle(adapter.listByDay(day))).find(
      (booking) => booking.title === "주간 기획회의",
    );
    expect(seeded).toBeDefined();
    if (!seeded) throw new Error("seeded booking missing");

    const newStart = new Date("2026-08-20T11:00:00+09:00");
    const newEnd = new Date("2026-08-20T12:00:00+09:00");
    const result = await settle(
      adapter.reschedule(seeded.id, newStart, newEnd, "room-small"),
    );
    expect(result).toMatchObject({
      ok: true,
      booking: { id: seeded.id, roomId: "room-small", start: newStart, end: newEnd },
    });

    const oldRoom = await settle(adapter.listByRoom("room-large", day));
    const destination = await settle(adapter.listByRoom("room-small", day));
    expect(oldRoom.some((booking) => booking.id === seeded.id)).toBe(false);
    expect(destination).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: seeded.id,
          roomId: "room-small",
          start: newStart,
          end: newEnd,
        }),
      ]),
    );
  });

  it("rejects a destination overlap without mutating the original booking", async () => {
    const adapter = await importAdapter("");
    const day = new Date("2026-08-20T00:00:00+09:00");
    const seeded = (await settle(adapter.listByDay(day))).find(
      (booking) => booking.title === "주간 기획회의",
    );
    expect(seeded).toBeDefined();
    if (!seeded) throw new Error("seeded booking missing");

    const result = await settle(
      adapter.reschedule(
        seeded.id,
        new Date("2026-08-20T09:30:00+09:00"),
        new Date("2026-08-20T10:30:00+09:00"),
        "room-small",
      ),
    );
    expect(result).toMatchObject({ ok: false, reason: "blocked", by: "이영희" });

    const oldRoom = await settle(adapter.listByRoom("room-large", day));
    const destination = await settle(adapter.listByRoom("room-small", day));
    expect(oldRoom).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: seeded.id,
          roomId: seeded.roomId,
          start: seeded.start,
          end: seeded.end,
        }),
      ]),
    );
    expect(destination.some((booking) => booking.id === seeded.id)).toBe(false);
  });

  it("shortens an active booking and rejects an extension into another booking", async () => {
    const adapter = await importAdapter("");
    const day = new Date("2026-08-20T00:00:00+09:00");
    const seeded = (await settle(adapter.listByDay(day))).find(
      (booking) => booking.title === "주간 기획회의",
    );
    expect(seeded).toBeDefined();
    if (!seeded) throw new Error("seeded booking missing");

    const shortenedEnd = new Date("2026-08-20T12:00:00+09:00");
    const shortened = await settle(adapter.changeEnd(seeded.id, shortenedEnd));
    expect(shortened).toMatchObject({
      ok: true,
      booking: { id: seeded.id, start: seeded.start, end: shortenedEnd },
    });

    const blocker = await settle(
      adapter.create({
        ...draft(),
        roomId: "room-large",
        title: "연장 차단 회의",
        start: new Date("2026-08-20T13:00:00+09:00"),
        end: new Date("2026-08-20T14:00:00+09:00"),
      }),
    );
    expect(blocker).toMatchObject({ ok: true });

    const rejected = await settle(
      adapter.changeEnd(seeded.id, new Date("2026-08-20T13:30:00+09:00")),
    );
    expect(rejected).toMatchObject({ ok: false, reason: "blocked" });

    const persisted = (await settle(adapter.listByRoom("room-large", day))).find(
      (booking) => booking.id === seeded.id,
    );
    expect(persisted?.end).toEqual(shortenedEnd);
  });
});
