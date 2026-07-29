import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function setNavigation(search: string): void {
  vi.stubGlobal("window", { location: { search } });
}

async function importClock(search: string, development = true) {
  vi.resetModules();
  vi.stubEnv("DEV", development);
  vi.stubEnv("PROD", !development);
  setNavigation(search);
  return import("./clock");
}

describe("appNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-02-03T04:05:06.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captures a valid DEV mockNow on first navigation and returns fresh clones", async () => {
    const clock = await importClock("?mockNow=2026-07-29T10%3A45%3A00%2B09%3A00");

    const first = clock.appNow();
    setNavigation("?mockNow=2027-01-01T00%3A00%3A00Z");
    const second = clock.appNow();

    expect(first.toISOString()).toBe("2026-07-29T01:45:00.000Z");
    expect(second.getTime()).toBe(first.getTime());
    expect(second).not.toBe(first);
  });

  it.each(["?mockNow=not-a-date", "?mockNow="])(
    "warns exactly once for invalid or empty DEV mockNow and keeps a real clock: %s",
    async (search) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const clock = await importClock(search);

      expect(clock.appNow().toISOString()).toBe("2031-02-03T04:05:06.000Z");
      vi.setSystemTime(new Date("2031-02-03T04:05:07.000Z"));
      expect(clock.appNow().toISOString()).toBe("2031-02-03T04:05:07.000Z");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("[MolRoom QA] invalid mockNow");
    },
  );

  it("ignores fixture queries in production and always reads the real clock", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const clock = await importClock(
      "?mockNow=2026-07-29T10%3A45%3A00%2B09%3A00&mockSaveDelayMs=2000&mockReadError=grid-once",
      false,
    );

    expect(clock.appNow().toISOString()).toBe("2031-02-03T04:05:06.000Z");
    vi.setSystemTime(new Date("2031-02-03T04:05:08.000Z"));
    expect(clock.appNow().toISOString()).toBe("2031-02-03T04:05:08.000Z");
    expect(warn).not.toHaveBeenCalled();
  });
});
