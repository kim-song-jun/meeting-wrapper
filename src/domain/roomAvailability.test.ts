import { describe, expect, it } from "vitest";
import { deriveRoomAvailability } from "./roomAvailability";
import type { Booking, Policy } from "./types";

const POLICY: Policy = {
  maxDurationMinutes: 240,
  maxAdvanceDays: 28,
  gridStartHour: 8,
  gridEndHour: 20,
  slotMinutes: 30,
  checkInGraceMinutes: 10,
  extendStepMinutes: 15,
  admins: ["admin@molcube.com"],
};

const at = (hour: number, minute = 0): Date => new Date(2026, 7, 16, hour, minute, 0, 0);

let sequence = 0;
function booking(
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  overrides: Partial<Booking> = {},
): Booking {
  sequence += 1;
  return {
    id: `booking-${sequence}`,
    roomId: "room-a",
    title: "비공개 회의",
    organizerName: "김몰룸",
    organizerEmail: "user@molcube.com",
    organizerDepartment: "제품팀",
    recurringEventId: null,
    start: at(startHour, startMinute),
    end: at(endHour, endMinute),
    headcount: 2,
    attendeeCount: 1,
    conference: null,
    checkedInAt: null,
    summary: null,
    isMine: false,
    ...overrides,
  };
}

describe("deriveRoomAvailability", () => {
  it("offers 30 minutes and a non-standard until-next boundary inside a 45-minute gap", () => {
    const result = deriveRoomAvailability([booking(10, 45, 11, 30)], at(10, 0), POLICY);

    expect(result.state).toBe("free");
    expect(result.next?.start).toEqual(at(10, 45));
    expect(result.availableUntil).toEqual(at(10, 45));
    expect(result.options.map((option) => [option.id, option.label])).toEqual([
      ["30-minutes", "30분"],
      ["until-boundary", "10:45까지"],
    ]);
  });

  it("offers 30 and 60 minutes but never exceeds the policy maximum", () => {
    const result = deriveRoomAvailability([], at(10, 0), {
      ...POLICY,
      gridEndHour: 15,
      maxDurationMinutes: 60,
    });

    expect(result.options.map((option) => option.id)).toEqual(["30-minutes", "60-minutes"]);
    expect(result.options.every((option) => option.end.getTime() <= at(11, 0).getTime())).toBe(true);
  });

  it("blocks quick booking while another person's meeting is active", () => {
    const result = deriveRoomAvailability([booking(9, 30, 10, 30)], at(10, 0), POLICY);

    expect(result.state).toBe("busy");
    expect(result.current?.end).toEqual(at(10, 30));
    expect(result.options).toEqual([]);
    expect(result.unavailableReason).toBe("10:30에 다시 확인해 주세요.");
  });

  it("distinguishes my active meeting without exposing presentation data", () => {
    const result = deriveRoomAvailability([booking(9, 30, 10, 30, { isMine: true })], at(10, 0), POLICY);

    expect(result.state).toBe("mine");
    expect(result.options).toEqual([]);
  });

  it("returns a visible reason instead of invalid choices after business hours", () => {
    const result = deriveRoomAvailability([], at(20, 0), POLICY);

    expect(result.state).toBe("free");
    expect(result.options).toEqual([]);
    expect(result.unavailableReason).toBe("오늘 예약 가능한 시간이 끝났어요.");
  });
});
