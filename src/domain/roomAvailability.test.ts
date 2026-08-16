import { describe, expect, it } from "vitest";
import {
  bookingsForLocalDay,
  deriveRoomAvailability,
  findExactQuickBookingOption,
  hasLocalDayChanged,
  millisecondsUntilNextMinute,
} from "./roomAvailability";
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

    expect(result.options).toEqual([
      { id: "30-minutes", label: "30분", start: at(10, 0), end: at(10, 30) },
      { id: "60-minutes", label: "1시간", start: at(10, 0), end: at(11, 0) },
    ]);
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

  it("caps a late-day gap at business end even when the next booking starts later", () => {
    const result = deriveRoomAvailability([booking(21, 0, 22, 0)], at(19, 30), POLICY);

    expect(result.availableUntil).toEqual(at(20, 0));
    expect(result.options).toEqual([
      { id: "30-minutes", label: "30분", start: at(19, 30), end: at(20, 0) },
    ]);
    expect(result.options.every((option) => option.end.getTime() <= at(20, 0).getTime())).toBe(true);
  });

  it("offers no quick booking when the remaining gap is shorter than 30 minutes", () => {
    const result = deriveRoomAvailability([booking(10, 20, 11, 0)], at(10, 0), POLICY);

    expect(result.availableUntil).toEqual(at(10, 20));
    expect(result.options).toEqual([]);
  });

  it("projects current and next bookings as safe time-only values", () => {
    const current = booking(9, 30, 10, 30, { isMine: true });
    const next = booking(11, 0, 12, 0);
    const result = deriveRoomAvailability([current, next], at(10, 0), POLICY);

    expect(result.current).toEqual({ start: at(9, 30), end: at(10, 30) });
    expect(result.next).toEqual({ start: at(11, 0), end: at(12, 0) });
  });
});

describe("room availability refresh boundaries", () => {
  it("schedules the next refresh at the next whole minute", () => {
    expect(millisecondsUntilNextMinute(new Date(2026, 7, 16, 10, 20, 59, 250))).toBe(750);
    expect(millisecondsUntilNextMinute(new Date(2026, 7, 16, 10, 21, 0, 0))).toBe(60_000);
  });

  it("detects a local day rollover at midnight", () => {
    expect(
      hasLocalDayChanged(
        new Date(2026, 7, 16, 23, 59, 59, 999),
        new Date(2026, 7, 17, 0, 0, 0, 0),
      ),
    ).toBe(true);
    expect(
      hasLocalDayChanged(
        new Date(2026, 7, 17, 0, 0, 0, 0),
        new Date(2026, 7, 17, 23, 59, 59, 999),
      ),
    ).toBe(false);
  });

  it("does not match a selected interval after the minute tick shifts its start", () => {
    const selected = deriveRoomAvailability([], at(10, 20), POLICY).options[0];
    const offeredAfterTick = deriveRoomAvailability([], at(10, 21), POLICY).options;

    expect(selected).toBeDefined();
    expect(selected && findExactQuickBookingOption(offeredAfterTick, selected)).toBeNull();
  });

  it("exposes bookings only for the local day they were loaded for", () => {
    const bookings = [booking(9, 0, 10, 0)];
    const payload = { day: at(8), bookings };

    expect(bookingsForLocalDay(payload, at(18))).toBe(bookings);
    expect(bookingsForLocalDay(payload, new Date(2026, 7, 17, 0, 0, 0, 0))).toBeNull();
  });
});
