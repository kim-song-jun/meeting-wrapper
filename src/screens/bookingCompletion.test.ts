import { describe, expect, it } from "vitest";
import {
  acknowledgePreferenceWarning,
  acknowledgeRecurrenceResult,
  completionAfterBooking,
} from "./bookingCompletion";
import type { Booking } from "../domain/types";

const booking: Booking = {
  id: "booking-1",
  roomId: "room-small",
  title: "테스트 회의",
  organizerName: "김몰큐브",
  organizerEmail: "me@molcube.com",
  organizerDepartment: "제품팀",
  recurringEventId: null,
  start: new Date("2026-08-20T10:00:00+09:00"),
  end: new Date("2026-08-20T10:30:00+09:00"),
  headcount: 2,
  attendeeCount: 0,
  conference: { kind: "zoom", url: "https://zoom.us/j/123" },
  checkedInAt: null,
  summary: null,
  isMine: true,
};

describe("booking completion", () => {
  it("defers a created booking until the preference warning is acknowledged", () => {
    const pending = completionAfterBooking(booking, { hasRejectedOccurrences: false, preferenceSaveFailed: true });

    expect(pending).toEqual({ kind: "preference-warning", booking });
    if (pending.kind !== "preference-warning") throw new Error("expected preference warning");
    expect(acknowledgePreferenceWarning(pending)).toEqual({ kind: "created", booking });
  });

  it("keeps a recurring partial result ahead of the preference warning", () => {
    const partial = completionAfterBooking(booking, { hasRejectedOccurrences: true, preferenceSaveFailed: true });

    expect(partial).toEqual({ kind: "recurrence-result", booking, preferenceSaveFailed: true });
    if (partial.kind !== "recurrence-result") throw new Error("expected recurrence result");
    const warning = acknowledgeRecurrenceResult(partial);
    expect(warning).toEqual({ kind: "preference-warning", booking });
    if (warning.kind !== "preference-warning") throw new Error("expected preference warning");
    expect(acknowledgePreferenceWarning(warning)).toEqual({ kind: "created", booking });
  });

  it("completes immediately when the preference was saved", () => {
    expect(completionAfterBooking(booking, { hasRejectedOccurrences: false, preferenceSaveFailed: false })).toEqual({
      kind: "created",
      booking,
    });
  });
});
