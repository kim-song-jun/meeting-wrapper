import { describe, it, expect } from "vitest";
import {
  overlaps,
  placeInGrid,
  gridDayStart,
  gridSlotCount,
  canExtend,
  canReschedule,
  canShorten,
  isNoShow,
  nextGap,
  currentBooking,
  validateDraft,
  humanDuration,
} from "./time";
import type { Booking, Policy } from "./types";

const POLICY: Policy = {
  maxDurationMinutes: 240,
  maxAdvanceDays: 28,
  gridStartHour: 9,
  gridEndHour: 20,
  slotMinutes: 30,
  checkInGraceMinutes: 10,
  extendStepMinutes: 15,
  admins: ["admin@molcube.com"],
};

/** 2026-07-26 의 지정 시각 */
const at = (h: number, m = 0): Date => new Date(2026, 6, 26, h, m, 0, 0);

let seq = 0;
function booking(startH: number, startM: number, endH: number, endM: number, over: Partial<Booking> = {}): Booking {
  seq += 1;
  return {
    id: "ev-" + String(seq),
    roomId: "room-a",
    title: "회의",
    organizerName: "김철수",
    organizerEmail: "chulsoo@molcube.com",
    organizerDepartment: "개발팀",
    recurringEventId: null,
    start: at(startH, startM),
    end: at(endH, endM),
    headcount: 2,
    attendeeCount: 2,
    conference: null,
    checkedInAt: null,
    summary: null,
    isMine: false,
    ...over,
  };
}

describe("overlaps", () => {
  it("겹치는 구간을 겹친다고 판정한다", () => {
    expect(overlaps(at(10), at(11), at(10, 30), at(11, 30))).toBe(true);
  });

  it("한쪽이 다른 쪽을 완전히 포함해도 겹침이다", () => {
    expect(overlaps(at(9), at(18), at(13), at(14))).toBe(true);
  });

  it("끝점이 맞닿는 것은 겹침이 아니다", () => {
    // 이 경계가 틀리면 10:00 에 끝나는 회의 뒤에 10:00 시작 예약을 못 잡는다.
    expect(overlaps(at(9), at(10), at(10), at(11))).toBe(false);
    expect(overlaps(at(10), at(11), at(9), at(10))).toBe(false);
  });

  it("완전히 떨어진 구간은 겹치지 않는다", () => {
    expect(overlaps(at(9), at(10), at(14), at(15))).toBe(false);
  });
});

describe("placeInGrid", () => {
  const dayStart = gridDayStart(at(0), POLICY); // 09:00
  const SLOT_PX = 28;
  const place = (sh: number, sm: number, eh: number, em: number) =>
    placeInGrid(at(sh, sm), at(eh, em), dayStart, POLICY.slotMinutes, SLOT_PX);

  it("격자 첫 슬롯에서 시작하는 예약은 top 1", () => {
    // 미리보기에서 실제로 났던 버그: 손으로 계산해 29px 로 박아 09:30 에 그려졌었다.
    expect(place(9, 0, 10, 0)).toEqual({ top: 1, height: 54, slots: 2 });
  });

  it("두 시간 뒤 예약은 슬롯 4개만큼 내려간다", () => {
    expect(place(11, 0, 12, 30)).toEqual({ top: 4 * 28 + 1, height: 3 * 28 - 2, slots: 3 });
  });

  it("30분 예약은 슬롯 1개", () => {
    const p = place(10, 0, 10, 30);
    expect(p.slots).toBe(1);
    expect(p.top).toBe(2 * 28 + 1);
    expect(p.height).toBe(26);
  });

  it("연속한 두 예약의 경계가 어긋나지 않는다", () => {
    const first = place(9, 0, 10, 0);
    const second = place(10, 0, 11, 0);
    // 1px 인셋을 감안하면 first 의 바닥과 second 의 머리가 2px 안에서 만나야 한다.
    expect(second.top - (first.top + first.height)).toBe(2);
  });
});

describe("gridSlotCount", () => {
  it("09:00~20:00 을 30분 단위로 나누면 22슬롯", () => {
    expect(gridSlotCount(POLICY)).toBe(22);
  });
});

describe("canExtend", () => {
  it("뒤가 비어 있으면 연장할 수 있다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const r = canExtend(mine, [mine], 15, POLICY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newEnd).toEqual(at(11, 15));
  });

  it("바로 뒤 예약과 겹치면 막고 누가 막는지 알려준다", () => {
    // 이게 틀리면 연장 버튼이 조용히 이중 예약을 만든다.
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const next = booking(11, 0, 12, 0, { organizerName: "이영희" });
    const r = canExtend(mine, [mine, next], 15, POLICY);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "blocked") {
      expect(r.blockedBy.organizerName).toBe("이영희");
    } else {
      throw new Error("blocked 로 막혀야 한다");
    }
  });

  it("뒤 예약이 연장분보다 멀면 연장할 수 있다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const later = booking(13, 0, 14, 0);
    expect(canExtend(mine, [mine, later], 15, POLICY).ok).toBe(true);
  });

  it("최대 예약 시간을 넘기면 막는다", () => {
    const mine = booking(10, 0, 14, 0, { isMine: true }); // 이미 240분
    const r = canExtend(mine, [mine], 15, POLICY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-long");
  });

  it("자기 자신과는 겹침 판정하지 않는다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    expect(canExtend(mine, [mine], 15, POLICY).ok).toBe(true);
  });
});

describe("canReschedule", () => {
  const now = at(9, 0);

  it("빈 시간으로 옮길 수 있다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const r = canReschedule(mine, [mine], at(14, 0), at(15, 0), POLICY, now);
    expect(r.ok).toBe(true);
  });

  it("자기 원래 자리와 겹치는 것은 겹침이 아니다", () => {
    // 이게 틀리면 옮기려는 예약이 자기 자신에 막혀 아무 데도 못 간다.
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const r = canReschedule(mine, [mine], at(10, 30), at(11, 30), POLICY, now);
    expect(r.ok).toBe(true);
  });

  it("남의 예약과 겹치면 막고 누가 막는지 알려준다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const other = booking(14, 0, 15, 0, { organizerName: "이영희" });
    const r = canReschedule(mine, [mine, other], at(14, 30), at(15, 30), POLICY, now);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "blocked") {
      expect(r.blockedBy.organizerName).toBe("이영희");
    } else {
      throw new Error("blocked 로 막혀야 한다");
    }
  });

  it("맞닿기만 하면 옮길 수 있다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const other = booking(14, 0, 15, 0);
    const r = canReschedule(mine, [mine, other], at(13, 0), at(14, 0), POLICY, now);
    expect(r.ok).toBe(true);
  });

  it("슬롯 하나보다 짧게 줄이지 못한다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const r = canReschedule(mine, [mine], at(10, 0), at(10, 15), POLICY, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-short");
  });

  it("최대 예약 시간을 넘기게 늘리지 못한다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const r = canReschedule(mine, [mine], at(10, 0), at(15, 0), POLICY, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-long");
  });

  it("지난 시간으로 끌어다 놓지 못한다", () => {
    // 격자에서 마우스로 위로 끌면 쉽게 일어난다 — 그대로 저장되면 조용히 깨진다.
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const r = canReschedule(mine, [mine], at(8, 0), at(9, 0), POLICY, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("in-past");
  });

  it("선행 예약 한도를 넘기게 옮기지 못한다", () => {
    const mine = booking(10, 0, 11, 0, { isMine: true });
    const far = new Date(now.getTime() + 40 * 24 * 60 * 60_000);
    const farEnd = new Date(far.getTime() + 60 * 60_000);
    const r = canReschedule(mine, [mine], far, farEnd, POLICY, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-far");
  });
});

describe("canShorten", () => {
  it("슬롯 하나가 남으면 줄일 수 있다", () => {
    expect(canShorten(booking(10, 0, 11, 0), 15, 30)).toBe(true);
  });

  it("슬롯 하나 아래로는 줄이지 않는다", () => {
    expect(canShorten(booking(10, 0, 10, 30), 15, 30)).toBe(false);
  });
});

describe("isNoShow", () => {
  it("유예 시간이 지나고 체크인이 없으면 미체크인", () => {
    const b = booking(10, 0, 11, 0);
    expect(isNoShow(b, at(10, 11), 10)).toBe(true);
  });

  it("유예 시간 안에서는 미체크인이 아니다", () => {
    const b = booking(10, 0, 11, 0);
    expect(isNoShow(b, at(10, 9), 10)).toBe(false);
  });

  it("체크인했으면 미체크인이 아니다", () => {
    const b = booking(10, 0, 11, 0, { checkedInAt: at(10, 2) });
    expect(isNoShow(b, at(10, 30), 10)).toBe(false);
  });

  it("이미 끝난 회의는 미체크인으로 표시하지 않는다", () => {
    // 지나간 회의에 경고 배지를 남기면 격자가 경고로 뒤덮인다.
    const b = booking(10, 0, 11, 0);
    expect(isNoShow(b, at(15, 0), 10)).toBe(false);
  });

  it("아직 시작 전이면 미체크인이 아니다", () => {
    const b = booking(14, 0, 15, 0);
    expect(isNoShow(b, at(10, 0), 10)).toBe(false);
  });
});

describe("nextGap", () => {
  const dayEnd = at(20, 0);

  it("예약이 없으면 하루 끝까지가 빈 구간", () => {
    expect(nextGap([], at(10, 0), dayEnd)).toEqual({ start: at(10, 0), end: dayEnd });
  });

  it("다음 예약 직전까지가 빈 구간", () => {
    const b = booking(14, 0, 15, 0);
    expect(nextGap([b], at(10, 0), dayEnd)).toEqual({ start: at(10, 0), end: at(14, 0) });
  });

  it("지금 사용 중이면 그 회의가 끝난 뒤부터", () => {
    const b = booking(10, 0, 11, 0);
    expect(nextGap([b], at(10, 30), dayEnd)).toEqual({ start: at(11, 0), end: dayEnd });
  });

  it("연달아 붙은 예약들을 건너뛴다", () => {
    const a = booking(10, 0, 11, 0);
    const b = booking(11, 0, 12, 0);
    expect(nextGap([a, b], at(10, 30), dayEnd)).toEqual({ start: at(12, 0), end: dayEnd });
  });

  it("하루가 꽉 차 있으면 null", () => {
    const b = booking(10, 0, 20, 0);
    expect(nextGap([b], at(10, 30), dayEnd)).toBeNull();
  });

  it("정렬되지 않은 입력에서도 올바르게 찾는다", () => {
    const later = booking(14, 0, 15, 0);
    const sooner = booking(11, 0, 12, 0);
    expect(nextGap([later, sooner], at(10, 0), dayEnd)).toEqual({ start: at(10, 0), end: at(11, 0) });
  });
});

describe("currentBooking", () => {
  it("진행 중인 예약을 찾는다", () => {
    const b = booking(10, 0, 11, 0);
    expect(currentBooking([b], at(10, 30))?.id).toBe(b.id);
  });

  it("끝난 시각 정각에는 더 이상 진행 중이 아니다", () => {
    const b = booking(10, 0, 11, 0);
    expect(currentBooking([b], at(11, 0))).toBeNull();
  });
});

describe("validateDraft", () => {
  const now = at(10, 0);

  it("정상 예약은 문제 없음", () => {
    expect(validateDraft({ start: at(11), end: at(12) }, POLICY, now)).toEqual([]);
  });

  it("최대 시간을 넘기면 too-long", () => {
    const p = validateDraft({ start: at(11), end: at(16) }, POLICY, now);
    expect(p.map((x) => x.code)).toContain("too-long");
  });

  it("종료가 시작보다 이르면 end-before-start", () => {
    const p = validateDraft({ start: at(12), end: at(11) }, POLICY, now);
    expect(p.map((x) => x.code)).toContain("end-before-start");
  });

  it("이미 지난 시간은 in-past", () => {
    const p = validateDraft({ start: at(8), end: at(9) }, POLICY, now);
    expect(p.map((x) => x.code)).toContain("in-past");
  });

  it("너무 먼 미래는 too-far", () => {
    const far = new Date(now.getTime() + 40 * 24 * 60 * 60_000);
    const farEnd = new Date(far.getTime() + 60 * 60_000);
    const p = validateDraft({ start: far, end: farEnd }, POLICY, now);
    expect(p.map((x) => x.code)).toContain("too-far");
  });
});

describe("humanDuration", () => {
  it("분만 있을 때", () => expect(humanDuration(30)).toBe("30분"));
  it("정시간", () => expect(humanDuration(120)).toBe("2시간"));
  it("시간과 분", () => expect(humanDuration(90)).toBe("1시간 30분"));
});
