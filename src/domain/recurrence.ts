import { MINUTE } from "./time";

/**
 * 반복 규칙.
 *
 * Google Calendar 의 RRULE 로 그대로 번역되는 최소 집합만 다룬다.
 * 사내 회의실 예약에서 실제로 쓰이는 건 매주·격주·매월 n번째 요일 정도이고,
 * 그 이상(BYSETPOS, EXDATE, 무한 반복)은 UI 로 표현하기 어렵고 회의실
 * 가용성 확인도 불가능해진다.
 */
export type RecurrenceFreq = "weekly" | "biweekly" | "monthly-nth-weekday";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** 첫 회를 포함한 총 횟수 */
  count: number;
}

export interface Occurrence {
  start: Date;
  end: Date;
}

/** 반복 횟수 상한. 회의실 가용성을 인스턴스마다 확인해야 하므로 무한 반복을 허용하지 않는다. */
export const MAX_OCCURRENCES = 26;

function sameClock(from: Date, y: number, m: number, d: number): Date {
  const out = new Date(from);
  out.setFullYear(y, m, d);
  return out;
}

function addDays(base: Date, days: number): Date {
  const out = new Date(base);
  // setDate 는 월·연 경계를 알아서 넘긴다. ms 덧셈은 DST 가 있는 지역에서 시각이 밀린다.
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * base 가 속한 달에서 base 가 몇 번째 해당 요일인지 (1-based).
 * 예: 2026-07-21(화) -> 3 (셋째 화요일)
 */
export function nthWeekdayOfMonth(base: Date): number {
  return Math.floor((base.getDate() - 1) / 7) + 1;
}

/**
 * year/month 달의 n번째 weekday 날짜. 그 달에 없으면 null.
 * "다섯째 화요일" 은 없는 달이 많다 — 그런 달은 건너뛰는 것이 Google 의 동작이다.
 */
function nthWeekdayDate(year: number, month: number, weekday: number, nth: number): number | null {
  const first = new Date(year, month, 1);
  const shift = (weekday - first.getDay() + 7) % 7;
  const day = 1 + shift + (nth - 1) * 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return day <= daysInMonth ? day : null;
}

/**
 * 반복 일정의 실제 발생 시각들을 펼친다.
 *
 * 회의실 가용성은 인스턴스마다 따로 확인해야 하므로 (Google 은 반복 일정의
 * 각 인스턴스에 대해 회의실이 개별적으로 수락/거절한다) 호출부는 이 목록을
 * 받아 하나하나 검사해야 한다.
 */
export function expandRecurrence(
  start: Date,
  end: Date,
  rule: RecurrenceRule,
): Occurrence[] {
  const durationMs = end.getTime() - start.getTime();
  const wanted = Math.min(Math.max(1, Math.floor(rule.count)), MAX_OCCURRENCES);
  const out: Occurrence[] = [];

  if (rule.freq === "weekly" || rule.freq === "biweekly") {
    const step = rule.freq === "weekly" ? 7 : 14;
    for (let i = 0; i < wanted; i++) {
      const s = addDays(start, step * i);
      out.push({ start: s, end: new Date(s.getTime() + durationMs) });
    }
    return out;
  }

  // monthly-nth-weekday: "매월 셋째 화요일"
  const weekday = start.getDay();
  const nth = nthWeekdayOfMonth(start);
  let year = start.getFullYear();
  let month = start.getMonth();
  let guard = 0;

  // 해당 요일이 없는 달은 건너뛴다. 건너뛴 달이 결과 수를 줄이면 안 되므로
  // wanted 개를 채울 때까지 달을 넘긴다 (무한루프 방지 상한 있음).
  while (out.length < wanted && guard < MAX_OCCURRENCES * 3) {
    guard += 1;
    const day = nthWeekdayDate(year, month, weekday, nth);
    if (day !== null) {
      const s = sameClock(start, year, month, day);
      out.push({ start: s, end: new Date(s.getTime() + durationMs) });
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return out;
}

const RRULE_DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/**
 * Google Calendar events.insert 의 recurrence 필드에 넣을 RRULE 한 줄.
 *
 * expandRecurrence 와 같은 날짜 집합을 만들어야 한다. 둘이 어긋나면
 * 우리가 미리 검사한 날짜와 구글이 실제로 만드는 날짜가 달라져,
 * "비어있다고 확인한 시간"과 "실제로 예약된 시간"이 서로 다른 사고가 난다.
 */
export function toRRule(start: Date, rule: RecurrenceRule): string {
  const count = Math.min(Math.max(1, Math.floor(rule.count)), MAX_OCCURRENCES);
  const day = RRULE_DAY[start.getDay()];

  if (rule.freq === "weekly") {
    return "RRULE:FREQ=WEEKLY;BYDAY=" + day + ";COUNT=" + String(count);
  }
  if (rule.freq === "biweekly") {
    return "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=" + day + ";COUNT=" + String(count);
  }
  return (
    "RRULE:FREQ=MONTHLY;BYDAY=" +
    String(nthWeekdayOfMonth(start)) +
    day +
    ";COUNT=" +
    String(count)
  );
}

export const FREQ_LABEL: Record<RecurrenceFreq, string> = {
  weekly: "매주",
  biweekly: "격주",
  "monthly-nth-weekday": "매월 같은 요일",
};

/** "매주 화요일 · 12회" 같은 사람이 읽는 요약 */
export function describeRecurrence(start: Date, rule: RecurrenceRule): string {
  const weekdayName = ["일", "월", "화", "수", "목", "금", "토"][start.getDay()];
  const base =
    rule.freq === "monthly-nth-weekday"
      ? "매월 " + String(nthWeekdayOfMonth(start)) + "번째 " + String(weekdayName) + "요일"
      : FREQ_LABEL[rule.freq] + " " + String(weekdayName) + "요일";
  return base + " · " + String(rule.count) + "회";
}

/** 반복 전체가 정책의 선행 예약 한도를 넘지 않는지 */
export function lastOccurrenceExceedsAdvance(
  occurrences: readonly Occurrence[],
  maxAdvanceDays: number,
  now: Date,
): boolean {
  const last = occurrences[occurrences.length - 1];
  if (!last) return false;
  const days = (last.start.getTime() - now.getTime()) / (24 * 60 * MINUTE);
  return days > maxAdvanceDays;
}
