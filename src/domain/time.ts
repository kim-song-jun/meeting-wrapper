import type { Booking, BookingDraft, Policy } from "./types";

export const MINUTE = 60_000;

/** 두 구간이 겹치는가. 끝점이 맞닿는 것(a.end === b.start)은 겹침이 아니다. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** 격자의 하루 시작 시각 (해당 날짜의 gridStartHour) */
export function gridDayStart(day: Date, policy: Policy): Date {
  const d = new Date(day);
  d.setHours(policy.gridStartHour, 0, 0, 0);
  return d;
}

export function gridSlotCount(policy: Policy): number {
  return ((policy.gridEndHour - policy.gridStartHour) * 60) / policy.slotMinutes;
}

/** 격자 시작 기준 슬롯 인덱스. 슬롯 경계에 안 맞으면 소수가 나온다. */
export function slotIndexOf(t: Date, dayStart: Date, slotMinutes: number): number {
  return (t.getTime() - dayStart.getTime()) / (slotMinutes * MINUTE);
}

export interface GridPlacement {
  top: number;
  height: number;
  slots: number;
}

/**
 * 격자 안에서의 픽셀 위치.
 *
 * 이 계산을 화면에서 손으로 하지 않는다 — 한 번 틀리면 눈으로 잡기 어렵다
 * (실제로 미리보기에서 한두 슬롯씩 밀린 채 렌더된 적 있음).
 *
 * 1px 인셋: 이벤트 테두리가 격자선과 겹쳐 두 겹으로 보이는 것을 막는다.
 */
export function placeInGrid(
  start: Date,
  end: Date,
  dayStart: Date,
  slotMinutes: number,
  slotPx: number,
): GridPlacement {
  const i = slotIndexOf(start, dayStart, slotMinutes);
  const n = slotIndexOf(end, dayStart, slotMinutes) - i;
  return {
    top: i * slotPx + 1,
    height: n * slotPx - 2,
    slots: n,
  };
}

export type DraftProblem =
  | { code: "too-long"; maxMinutes: number }
  | { code: "too-far"; maxDays: number }
  | { code: "in-past" }
  | { code: "end-before-start" };

/**
 * 예약 규칙 검증.
 *
 * 주의: 이 검사는 브라우저에서만 돌기 때문에 개발자도구로 우회할 수 있다.
 * 의도된 트레이드오프다 (설계 스펙 §2.3) — 사내 도구이고, 우회해도 구글이
 * 권한을 강제하므로 남의 예약을 망가뜨릴 수는 없다.
 */
export function validateDraft(
  draft: Pick<BookingDraft, "start" | "end">,
  policy: Policy,
  now: Date,
): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const durationMin = (draft.end.getTime() - draft.start.getTime()) / MINUTE;

  if (durationMin <= 0) {
    problems.push({ code: "end-before-start" });
  } else if (durationMin > policy.maxDurationMinutes) {
    problems.push({ code: "too-long", maxMinutes: policy.maxDurationMinutes });
  }

  if (draft.end.getTime() <= now.getTime()) {
    problems.push({ code: "in-past" });
  }

  const advanceDays = (draft.start.getTime() - now.getTime()) / (24 * 60 * MINUTE);
  if (advanceDays > policy.maxAdvanceDays) {
    problems.push({ code: "too-far", maxDays: policy.maxAdvanceDays });
  }

  return problems;
}

/**
 * 미체크인 판정.
 *
 * 노쇼를 자동 취소하지 않고 표시만 하기로 했으므로(설계 스펙 §2.5),
 * 이 판정은 화면을 그릴 때 계산한다. 백그라운드 잡이 필요 없다.
 */
export function isNoShow(booking: Booking, now: Date, graceMinutes: number): boolean {
  if (booking.checkedInAt !== null) return false;
  if (now.getTime() >= booking.end.getTime()) return false;
  return now.getTime() >= booking.start.getTime() + graceMinutes * MINUTE;
}

export type ExtendResult =
  | { ok: true; newEnd: Date }
  | { ok: false; reason: "blocked"; blockedBy: Booking }
  | { ok: false; reason: "too-long"; maxMinutes: number };

/**
 * 연장 가능 여부.
 *
 * 호출 직전에 회의실 캘린더를 다시 읽어서 넘겨야 한다. 오래된 클라이언트
 * 캐시로 판단하면 조용히 이중 예약이 된다 (설계 스펙 §6.2).
 */
export function canExtend(
  booking: Booking,
  sameRoomBookings: readonly Booking[],
  stepMinutes: number,
  policy: Policy,
): ExtendResult {
  const newEnd = new Date(booking.end.getTime() + stepMinutes * MINUTE);

  const durationMin = (newEnd.getTime() - booking.start.getTime()) / MINUTE;
  if (durationMin > policy.maxDurationMinutes) {
    return { ok: false, reason: "too-long", maxMinutes: policy.maxDurationMinutes };
  }

  for (const other of sameRoomBookings) {
    if (other.id === booking.id) continue;
    if (overlaps(booking.start, newEnd, other.start, other.end)) {
      return { ok: false, reason: "blocked", blockedBy: other };
    }
  }

  return { ok: true, newEnd };
}

/** 단축 가능 여부. 슬롯 하나 아래로는 줄이지 않는다. */
export function canShorten(booking: Booking, stepMinutes: number, slotMinutes: number): boolean {
  const newDuration = (booking.end.getTime() - booking.start.getTime()) / MINUTE - stepMinutes;
  return newDuration >= slotMinutes;
}

export interface Gap {
  start: Date;
  end: Date;
}

/**
 * from 시각 이후 그 방의 다음 빈 구간.
 * QR 랜딩의 "지금 비어있음 / 다음 예약 14:00" 과 "15:00에 예약하기" 에 쓴다.
 */
export function nextGap(
  sameRoomBookings: readonly Booking[],
  from: Date,
  dayEnd: Date,
): Gap | null {
  const sorted = [...sameRoomBookings]
    .filter((b) => b.end.getTime() > from.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  let cursor = from;
  for (const b of sorted) {
    if (b.start.getTime() > cursor.getTime()) {
      return { start: cursor, end: b.start };
    }
    if (b.end.getTime() > cursor.getTime()) {
      cursor = b.end;
    }
  }

  if (cursor.getTime() < dayEnd.getTime()) {
    return { start: cursor, end: dayEnd };
  }
  return null;
}

/** 지금 그 방을 쓰고 있는 예약 */
export function currentBooking(
  sameRoomBookings: readonly Booking[],
  now: Date,
): Booking | null {
  return (
    sameRoomBookings.find(
      (b) => b.start.getTime() <= now.getTime() && now.getTime() < b.end.getTime(),
    ) ?? null
  );
}

const pad = (n: number): string => (n < 10 ? "0" + String(n) : String(n));

/** 09:05 형식 */
export function hhmm(d: Date): string {
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/** 1시간 30분 형식 */
export function humanDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return String(m) + "분";
  if (m === 0) return String(h) + "시간";
  return String(h) + "시간 " + String(m) + "분";
}
