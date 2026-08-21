import type { Booking } from "../domain/types";

export type BookingCompletion =
  | { kind: "created"; booking: Booking }
  | { kind: "preference-warning"; booking: Booking }
  | { kind: "recurrence-result"; booking: Booking; preferenceSaveFailed: boolean };

export function completionAfterBooking(
  booking: Booking,
  {
    hasRejectedOccurrences,
    preferenceSaveFailed,
  }: { hasRejectedOccurrences: boolean; preferenceSaveFailed: boolean },
): BookingCompletion {
  if (hasRejectedOccurrences) return { kind: "recurrence-result", booking, preferenceSaveFailed };
  if (preferenceSaveFailed) return { kind: "preference-warning", booking };
  return { kind: "created", booking };
}

export function acknowledgeRecurrenceResult(
  completion: Extract<BookingCompletion, { kind: "recurrence-result" }>,
): Exclude<BookingCompletion, { kind: "recurrence-result" }> {
  return completion.preferenceSaveFailed
    ? { kind: "preference-warning", booking: completion.booking }
    : { kind: "created", booking: completion.booking };
}

export function acknowledgePreferenceWarning(
  completion: Extract<BookingCompletion, { kind: "preference-warning" }>,
): Extract<BookingCompletion, { kind: "created" }> {
  return { kind: "created", booking: completion.booking };
}
