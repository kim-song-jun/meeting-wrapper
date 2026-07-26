import { describe, it, expect } from "vitest";
import {
  expandRecurrence,
  toRRule,
  nthWeekdayOfMonth,
  describeRecurrence,
  lastOccurrenceExceedsAdvance,
  MAX_OCCURRENCES,
} from "./recurrence";

/** 2026-07-21 은 화요일이고 그 달의 셋째 화요일이다 */
const TUE = (h = 14, m = 0) => new Date(2026, 6, 21, h, m, 0, 0);
const iso = (d: Date) =>
  d.getFullYear() +
  "-" +
  String(d.getMonth() + 1).padStart(2, "0") +
  "-" +
  String(d.getDate()).padStart(2, "0") +
  " " +
  String(d.getHours()).padStart(2, "0") +
  ":" +
  String(d.getMinutes()).padStart(2, "0");

describe("nthWeekdayOfMonth", () => {
  it("2026-07-21 은 셋째 화요일", () => {
    expect(nthWeekdayOfMonth(new Date(2026, 6, 21))).toBe(3);
  });
  it("달의 1~7일은 첫째 주", () => {
    expect(nthWeekdayOfMonth(new Date(2026, 6, 1))).toBe(1);
    expect(nthWeekdayOfMonth(new Date(2026, 6, 7))).toBe(1);
  });
  it("8일은 둘째 주", () => {
    expect(nthWeekdayOfMonth(new Date(2026, 6, 8))).toBe(2);
  });
});

describe("expandRecurrence — weekly", () => {
  it("첫 회를 포함해 count 개를 만든다", () => {
    const out = expandRecurrence(TUE(), TUE(15), { freq: "weekly", count: 4 });
    expect(out.map((o) => iso(o.start))).toEqual([
      "2026-07-21 14:00",
      "2026-07-28 14:00",
      "2026-08-04 14:00",
      "2026-08-11 14:00",
    ]);
  });

  it("월 경계를 올바르게 넘는다", () => {
    // 7월 28일 + 7일 = 8월 4일. ms 덧셈이 아니라 날짜 연산이어야 한다.
    const out = expandRecurrence(TUE(), TUE(15), { freq: "weekly", count: 3 });
    expect(iso(out[2]!.start)).toBe("2026-08-04 14:00");
  });

  it("길이를 보존한다", () => {
    const out = expandRecurrence(TUE(14, 0), TUE(15, 30), { freq: "weekly", count: 3 });
    for (const o of out) {
      expect(o.end.getTime() - o.start.getTime()).toBe(90 * 60_000);
    }
  });

  it("시각을 보존한다", () => {
    const out = expandRecurrence(TUE(9, 15), TUE(10, 0), { freq: "weekly", count: 5 });
    for (const o of out) {
      expect(o.start.getHours()).toBe(9);
      expect(o.start.getMinutes()).toBe(15);
    }
  });
});

describe("expandRecurrence — biweekly", () => {
  it("14일 간격", () => {
    const out = expandRecurrence(TUE(), TUE(15), { freq: "biweekly", count: 3 });
    expect(out.map((o) => iso(o.start))).toEqual([
      "2026-07-21 14:00",
      "2026-08-04 14:00",
      "2026-08-18 14:00",
    ]);
  });
});

describe("expandRecurrence — monthly-nth-weekday", () => {
  it("매월 셋째 화요일을 이어간다", () => {
    const out = expandRecurrence(TUE(), TUE(15), { freq: "monthly-nth-weekday", count: 4 });
    expect(out.map((o) => iso(o.start))).toEqual([
      "2026-07-21 14:00",
      "2026-08-18 14:00",
      "2026-09-15 14:00",
      "2026-10-20 14:00",
    ]);
  });

  it("전부 같은 요일이다", () => {
    const out = expandRecurrence(TUE(), TUE(15), { freq: "monthly-nth-weekday", count: 6 });
    for (const o of out) expect(o.start.getDay()).toBe(2); // 화요일
  });

  it("다섯째 요일이 없는 달은 건너뛰고, 그래도 count 개를 채운다", () => {
    // 2026-07-29 는 그 달의 다섯째 수요일. 다섯째 수요일이 없는 달이 많다.
    const fifthWed = new Date(2026, 6, 29, 10, 0, 0, 0);
    expect(nthWeekdayOfMonth(fifthWed)).toBe(5);
    const out = expandRecurrence(
      fifthWed,
      new Date(2026, 6, 29, 11, 0, 0, 0),
      { freq: "monthly-nth-weekday", count: 3 },
    );
    expect(out).toHaveLength(3);
    for (const o of out) {
      expect(o.start.getDay()).toBe(3); // 전부 수요일
      expect(nthWeekdayOfMonth(o.start)).toBe(5); // 전부 다섯째 주
    }
    // 건너뛴 달이 있으므로 연속한 달이 아니다
    expect(iso(out[1]!.start)).not.toBe("2026-08-29 10:00");
  });

  it("연 경계를 넘는다", () => {
    const dec = new Date(2026, 11, 15, 14, 0, 0, 0); // 2026-12-15 화요일
    const out = expandRecurrence(dec, new Date(2026, 11, 15, 15, 0, 0, 0), {
      freq: "monthly-nth-weekday",
      count: 3,
    });
    expect(out[1]!.start.getFullYear()).toBe(2027);
  });
});

describe("expandRecurrence — 상한", () => {
  it("MAX_OCCURRENCES 를 넘지 않는다", () => {
    const out = expandRecurrence(TUE(), TUE(15), { freq: "weekly", count: 999 });
    expect(out).toHaveLength(MAX_OCCURRENCES);
  });

  it("0 이나 음수는 1회로 클램프한다", () => {
    expect(expandRecurrence(TUE(), TUE(15), { freq: "weekly", count: 0 })).toHaveLength(1);
    expect(expandRecurrence(TUE(), TUE(15), { freq: "weekly", count: -5 })).toHaveLength(1);
  });
});

describe("toRRule", () => {
  it("매주", () => {
    expect(toRRule(TUE(), { freq: "weekly", count: 12 })).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=12",
    );
  });
  it("격주는 INTERVAL=2", () => {
    expect(toRRule(TUE(), { freq: "biweekly", count: 6 })).toBe(
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=6",
    );
  });
  it("매월 n번째 요일은 BYDAY 에 n 을 붙인다", () => {
    expect(toRRule(TUE(), { freq: "monthly-nth-weekday", count: 4 })).toBe(
      "RRULE:FREQ=MONTHLY;BYDAY=3TU;COUNT=4",
    );
  });
  it("count 상한이 RRULE 에도 반영된다", () => {
    // 우리가 검사한 날짜 수와 구글이 만드는 인스턴스 수가 어긋나면
    // "비어있다고 확인한 시간"과 "실제 예약된 시간"이 달라진다.
    expect(toRRule(TUE(), { freq: "weekly", count: 999 })).toContain(
      "COUNT=" + String(MAX_OCCURRENCES),
    );
  });
  it("RRULE 의 COUNT 와 expandRecurrence 결과 수가 항상 일치한다", () => {
    for (const freq of ["weekly", "biweekly", "monthly-nth-weekday"] as const) {
      for (const count of [1, 3, 12, 26, 40]) {
        const rule = { freq, count };
        const expanded = expandRecurrence(TUE(), TUE(15), rule);
        const m = /COUNT=(\d+)/.exec(toRRule(TUE(), rule));
        expect(Number(m?.[1])).toBe(expanded.length);
      }
    }
  });
});

describe("describeRecurrence", () => {
  it("매주", () => {
    expect(describeRecurrence(TUE(), { freq: "weekly", count: 12 })).toBe("매주 화요일 · 12회");
  });
  it("매월은 몇 번째인지 말한다", () => {
    expect(describeRecurrence(TUE(), { freq: "monthly-nth-weekday", count: 4 })).toBe(
      "매월 3번째 화요일 · 4회",
    );
  });
});

describe("lastOccurrenceExceedsAdvance", () => {
  const now = new Date(2026, 6, 21, 9, 0, 0, 0);

  it("마지막 회차가 한도 안이면 false", () => {
    const out = expandRecurrence(TUE(), TUE(15), { freq: "weekly", count: 3 });
    expect(lastOccurrenceExceedsAdvance(out, 28, now)).toBe(false);
  });

  it("마지막 회차가 한도를 넘으면 true", () => {
    // 12주 = 77일 뒤, 한도 28일
    const out = expandRecurrence(TUE(), TUE(15), { freq: "weekly", count: 12 });
    expect(lastOccurrenceExceedsAdvance(out, 28, now)).toBe(true);
  });

  it("빈 목록은 false", () => {
    expect(lastOccurrenceExceedsAdvance([], 28, now)).toBe(false);
  });
});
