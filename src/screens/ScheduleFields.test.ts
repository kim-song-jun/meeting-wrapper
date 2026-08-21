import { describe, expect, it } from "vitest";
import {
  scheduleDraftFrom,
  scheduleDraftRange,
  scheduleInputStepMinutes,
} from "./ScheduleFields";
import type { ScheduleDraft } from "./ScheduleFields";

describe("schedule field helpers", () => {
  it("preserves the local date and start/end clock values", () => {
    const start = new Date(2026, 7, 20, 9, 5);
    const end = new Date(2026, 7, 20, 10, 35);

    expect(scheduleDraftFrom("room-small", start, end)).toEqual({
      roomId: "room-small",
      date: "2026-08-20",
      startTime: "09:05",
      endTime: "10:35",
    });
  });

  it("parses a valid local schedule draft", () => {
    const range = scheduleDraftRange({
      roomId: "room-large",
      date: "2026-08-20",
      startTime: "11:00",
      endTime: "12:30",
    });

    expect(range).toEqual({
      start: new Date(2026, 7, 20, 11, 0),
      end: new Date(2026, 7, 20, 12, 30),
    });
  });

  it.each<Pick<ScheduleDraft, "date" | "startTime" | "endTime">>([
    { date: "2026-02-30", startTime: "09:00", endTime: "09:30" },
    { date: "2026-08-20", startTime: "24:00", endTime: "09:30" },
    { date: "2026-08", startTime: "09:00", endTime: "09:30" },
    { date: "2026-08-20", startTime: "09", endTime: "09:30" },
  ])("rejects malformed local date/time input: %o", (value) => {
    expect(scheduleDraftRange({ roomId: "room-small", ...value })).toBeNull();
  });

  it("uses the policy slot for aligned bookings and one minute for off-grid quick bookings", () => {
    expect(
      scheduleInputStepMinutes(
        new Date(2026, 7, 20, 9, 0),
        new Date(2026, 7, 20, 9, 30),
      ),
    ).toBe(30);
    expect(
      scheduleInputStepMinutes(
        new Date(2026, 7, 20, 11, 7),
        new Date(2026, 7, 20, 11, 37),
      ),
    ).toBe(1);
  });
});
