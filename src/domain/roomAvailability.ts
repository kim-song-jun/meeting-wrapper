import { currentBooking, hhmm, MINUTE, nextGap } from "./time";
import type { Booking, Policy } from "./types";

export type RoomAvailabilityState = "free" | "busy" | "mine";

export interface QuickBookingOption {
  id: "30-minutes" | "60-minutes" | "until-boundary";
  label: string;
  start: Date;
  end: Date;
}

export interface RoomAvailabilityBooking {
  start: Date;
  end: Date;
}

export interface RoomAvailability {
  state: RoomAvailabilityState;
  current: RoomAvailabilityBooking | null;
  next: RoomAvailabilityBooking | null;
  availableUntil: Date | null;
  options: QuickBookingOption[];
  unavailableReason: string | null;
}

function atHour(day: Date, hour: number): Date {
  const value = new Date(day);
  value.setHours(hour, 0, 0, 0);
  return value;
}

function futureBooking(bookings: readonly Booking[], now: Date): Booking | null {
  return [...bookings]
    .filter((booking) => booking.start.getTime() > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
}

function projectBooking(booking: Booking | null): RoomAvailabilityBooking | null {
  return booking ? { start: booking.start, end: booking.end } : null;
}

function buildOptions(start: Date, end: Date, policy: Policy): QuickBookingOption[] {
  const availableMinutes = Math.floor((end.getTime() - start.getTime()) / MINUTE);
  const options: QuickBookingOption[] = [];

  if (availableMinutes >= 30 && policy.slotMinutes <= 30 && policy.maxDurationMinutes >= 30) {
    options.push({ id: "30-minutes", label: "30분", start, end: new Date(start.getTime() + 30 * MINUTE) });
  }
  if (availableMinutes >= 60 && policy.slotMinutes <= 60 && policy.maxDurationMinutes >= 60) {
    options.push({ id: "60-minutes", label: "1시간", start, end: new Date(start.getTime() + 60 * MINUTE) });
  }
  if (
    availableMinutes > Math.max(30, policy.slotMinutes) &&
    availableMinutes !== 60 &&
    availableMinutes <= policy.maxDurationMinutes
  ) {
    options.push({ id: "until-boundary", label: `${hhmm(end)}까지`, start, end });
  }

  return options;
}

export function deriveRoomAvailability(
  bookings: readonly Booking[],
  now: Date,
  policy: Policy,
): RoomAvailability {
  const active = currentBooking(bookings, now);
  const next = futureBooking(bookings, now);

  if (active) {
    return {
      state: active.isMine ? "mine" : "busy",
      current: projectBooking(active),
      next: projectBooking(next),
      availableUntil: null,
      options: [],
      unavailableReason: `${hhmm(active.end)}에 다시 확인해 주세요.`,
    };
  }

  const businessStart = atHour(now, policy.gridStartHour);
  const businessEnd = atHour(now, policy.gridEndHour);
  if (now.getTime() >= businessEnd.getTime()) {
    return {
      state: "free",
      current: null,
      next: projectBooking(next),
      availableUntil: null,
      options: [],
      unavailableReason: "오늘 예약 가능한 시간이 끝났어요.",
    };
  }

  const candidateStart = now.getTime() < businessStart.getTime() ? businessStart : now;
  const gap = nextGap(bookings, candidateStart, businessEnd);
  if (!gap || gap.start.getTime() > candidateStart.getTime()) {
    return {
      state: "free",
      current: null,
      next: projectBooking(next),
      availableUntil: null,
      options: [],
      unavailableReason: "지금 선택할 수 있는 시간이 없어요.",
    };
  }

  const availableUntil = gap.end.getTime() > businessEnd.getTime() ? businessEnd : gap.end;
  const options = buildOptions(candidateStart, availableUntil, policy);
  return {
    state: "free",
    current: null,
    next: projectBooking(next),
    availableUntil,
    options,
    unavailableReason: options.length === 0 ? "30분 이상 비어 있는 시간을 기다려 주세요." : null,
  };
}
