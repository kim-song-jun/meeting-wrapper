import { describe, expect, it } from "vitest";
import { eventContentMode, GRID_EVENT_TWO_LINE_MIN_PX } from "./gridEventContent";

describe("eventContentMode", () => {
  it("keeps a fine-pointer 30-minute block to the organizer line", () => {
    expect(eventContentMode(24, true)).toBe("organizer-only");
  });

  it("shows time only when two 20px lines fit", () => {
    expect(GRID_EVENT_TWO_LINE_MIN_PX).toBe(44);
    expect(eventContentMode(43.99, true)).toBe("organizer-only");
    expect(eventContentMode(44, true)).toBe("organizer-time");
    expect(eventContentMode(48, true)).toBe("organizer-time");
  });

  it("keeps a tall split-column event to the organizer line when the time range cannot fit", () => {
    expect(eventContentMode(96, false)).toBe("organizer-only");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid height %s",
    (height) => {
      expect(() => eventContentMode(height, true)).toThrow(
        `Grid event height must be a positive number; received ${String(height)}`,
      );
    },
  );
});
