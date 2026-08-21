import type { BookingRepository, CreateResult, ChangeResult, RecurringCreateResult } from "./BookingRepository";
import type { Booking, BookingDraft, CurrentUser, DirectoryPerson, UserPrefs } from "../domain/types";
import { overlaps } from "../domain/time";
import { expandRecurrence } from "../domain/recurrence";
import rooms from "../config/rooms.json";
import { MOCK_IDENTITY } from "../config/currentUser";
import { appNow } from "../app/clock";

/**
 * 환경변수를 붙이기 전까지 화면을 돌리는 인메모리 어댑터.
 *
 * 성공 경로만 흉내내지 않는다 — 설계 스펙 §6.1 의 2차·3차 방어를 실제로
 * 발동시킬 수 있어야 그 UI 경로가 죽은 코드가 되지 않는다.
 * 제목에 "__taken" / "__declined" 을 넣으면 각 실패를 재현한다.
 */

/**
 * 로그인한 사람과 예약 데이터의 "나" 는 같은 사람이어야 한다 — 어긋나면 isMine
 * 판정과 관리자 권한이 조용히 틀어진다. 그래서 값을 두 곳에 적지 않고
 * src/config/currentUser.ts 하나를 양쪽(mockAuthAdapter 포함)이 참조한다.
 */
const ME: CurrentUser = { ...MOCK_IDENTITY, isAdmin: true };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const CREATE_DELAY_MS = 220;
const RECURRING_CREATE_DELAY_MS = 260;

type ReadErrorFixture = "grid-once" | "room-once" | "my-bookings-once";

function captureQaFixtures(): {
  saveDelayMs: number | null;
  readError: ReadErrorFixture | null;
  prefsSaveError: "once" | null;
} {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return { saveDelayMs: null, readError: null, prefsSaveError: null };
  }

  const params = new URLSearchParams(window.location.search);
  let saveDelayMs: number | null = null;
  if (params.has("mockSaveDelayMs")) {
    const rawDelay = params.get("mockSaveDelayMs") ?? "";
    const parsedDelay = Number(rawDelay);
    if (/^(0|[1-9]\d*)$/.test(rawDelay) && parsedDelay <= 5000) {
      saveDelayMs = parsedDelay;
    } else {
      console.warn("[MolRoom QA] invalid mockSaveDelayMs");
    }
  }

  let readError: ReadErrorFixture | null = null;
  if (params.has("mockReadError")) {
    const rawReadError = params.get("mockReadError");
    if (
      rawReadError === "grid-once" ||
      rawReadError === "room-once" ||
      rawReadError === "my-bookings-once"
    ) {
      readError = rawReadError;
    } else {
      console.warn("[MolRoom QA] invalid mockReadError");
    }
  }

  let prefsSaveError: "once" | null = null;
  if (params.has("mockPrefsSaveError")) {
    if (params.get("mockPrefsSaveError") === "once") {
      prefsSaveError = "once";
    } else {
      console.warn("[MolRoom QA] invalid mockPrefsSaveError");
    }
  }

  return { saveDelayMs, readError, prefsSaveError };
}

const qaFixtures = captureQaFixtures();
let readErrorArmed = true;
let prefsSaveErrorArmed = true;
let pendingReadErrorResolutions: Array<(fail: boolean) => void> = [];
let readErrorBatchScheduled = false;

function takeReadError(expected: ReadErrorFixture): Promise<boolean> {
  if (!readErrorArmed || qaFixtures.readError !== expected) return Promise.resolve(false);

  return new Promise((resolve) => {
    pendingReadErrorResolutions.push(resolve);
    if (readErrorBatchScheduled) return;
    readErrorBatchScheduled = true;

    queueMicrotask(() => {
      readErrorBatchScheduled = false;
      const batch = pendingReadErrorResolutions;
      pendingReadErrorResolutions = [];
      readErrorArmed = false;
      for (let index = 0; index < batch.length; index += 1) {
        batch[index]!(index === batch.length - 1);
      }
    });
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** 날짜 범위 필터 (일 단위, from·to 모두 포함). listByRange 가 쓴다. */
function inDateRange(d: Date, from: Date, to: Date): boolean {
  const t = startOfDay(d).getTime();
  return t >= startOfDay(from).getTime() && t <= startOfDay(to).getTime();
}

function atOffset(dayOffset: number, h: number, m: number): Date {
  const d = appNow();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

let idSeq = 0;
const nextId = (): string => {
  idSeq += 1;
  return "mock-ev-" + String(idSeq);
};

let seriesSeq = 0;
const nextSeriesId = (): string => {
  seriesSeq += 1;
  return "mock-series-" + String(seriesSeq);
};

/** People API 디렉터리 검색을 흉내내는 사내 구성원 목록 */
const DIRECTORY: DirectoryPerson[] = [
  { email: "sungjun@molcube.com", name: "성준", detail: "개발팀" },
  { email: "chulsoo@molcube.com", name: "김철수", detail: "개발팀" },
  { email: "minji@molcube.com", name: "최민지", detail: "개발팀" },
  { email: "jihyun@molcube.com", name: "박지현", detail: "기획팀" },
  { email: "younghee@molcube.com", name: "이영희", detail: "기획팀 리드" },
  { email: "haeun@molcube.com", name: "정하은", detail: "디자인팀" },
  { email: "dongwook@molcube.com", name: "한동욱", detail: "영업팀" },
  { email: "seoyeon@molcube.com", name: "임서연", detail: "인사팀" },
];

/** 현재 사용자의 부서. DIRECTORY 의 성준 항목과 일치시킨다. */
const ME_DEPARTMENT: string | null = DIRECTORY.find((p) => p.email === ME.email)?.detail ?? null;

function departmentOf(email: string): string | null {
  return DIRECTORY.find((p) => p.email === email)?.detail ?? null;
}

function seed(): Booking[] {
  // 회의실은 소회의실·대회의실 둘이다(config/rooms.json). 시드는 둘에 나눠 넣는다 —
  // 한 방에 몰아넣으면 "다른 방은 비었는데 이 방만 찼다" 같은 실제 판단 상황이 안 나온다.
  const roomSmall = rooms[0]!.id;
  const roomLarge = rooms[1]!.id;

  return [
    {
      id: nextId(),
      roomId: roomLarge,
      title: "채용 면접",
      organizerName: "김철수",
      organizerEmail: "chulsoo@molcube.com",
      organizerDepartment: departmentOf("chulsoo@molcube.com"),
      recurringEventId: null,
      start: atOffset(0, 9, 0),
      end: atOffset(0, 10, 0),
      headcount: 3,
      attendeeCount: 3,
      conference: { kind: "meet", url: "https://meet.google.com/abc-defg-hij" },
      checkedInAt: atOffset(0, 9, 2),
      summary: null,
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomLarge,
      title: "주간 기획회의",
      organizerName: ME.name,
      organizerEmail: ME.email,
      organizerDepartment: ME_DEPARTMENT,
      recurringEventId: null,
      start: atOffset(0, 11, 0),
      end: atOffset(0, 12, 30),
      // 8명이 모이지만 초대는 5명만 — 정원 검사가 초대 수와 다른 이유
      headcount: 8,
      attendeeCount: 5,
      conference: { kind: "zoom", url: "https://zoom.us/j/1234567890" },
      checkedInAt: null,
      summary: null,
      isMine: true,
    },
    {
      id: nextId(),
      roomId: roomLarge,
      title: "1on1",
      organizerName: "박지현",
      organizerEmail: "jihyun@molcube.com",
      organizerDepartment: departmentOf("jihyun@molcube.com"),
      recurringEventId: null,
      start: atOffset(0, 10, 0),
      end: atOffset(0, 10, 30),
      headcount: 2,
      attendeeCount: 2,
      conference: null,
      checkedInAt: null,
      summary: null,
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomSmall,
      // 체크인 없이 시작 시각이 지난 상태 — 미체크인 배지가 뜨는지 확인용
      title: "디자인 리뷰",
      organizerName: "이영희",
      organizerEmail: "younghee@molcube.com",
      organizerDepartment: departmentOf("younghee@molcube.com"),
      recurringEventId: null,
      start: atOffset(0, 9, 0),
      end: atOffset(0, 10, 30),
      headcount: 4,
      attendeeCount: 4,
      conference: null,
      checkedInAt: null,
      summary: null,
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomSmall,
      title: "전사 주간회의",
      organizerName: "이영희",
      organizerEmail: "younghee@molcube.com",
      organizerDepartment: departmentOf("younghee@molcube.com"),
      recurringEventId: null,
      start: atOffset(0, 13, 0),
      end: atOffset(0, 15, 0),
      headcount: 18,
      attendeeCount: 18,
      conference: { kind: "meet", url: "https://meet.google.com/xyz-uvwx-yz" },
      checkedInAt: null,
      summary: null,
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomSmall,
      title: "스프린트 회고",
      organizerName: ME.name,
      organizerEmail: ME.email,
      organizerDepartment: ME_DEPARTMENT,
      recurringEventId: null,
      start: atOffset(1, 14, 0),
      end: atOffset(1, 15, 0),
      headcount: 6,
      attendeeCount: 6,
      conference: null,
      checkedInAt: null,
      summary: null,
      isMine: true,
    },
    // 반복 예약 부분 성공 데모용 시드.
    // 3층 회의실 A, 14:00~15:00 에 다른 팀 예약을 미리 심어둔다 (+7일, +21일).
    // 오늘 이 방/시간대로 "매주" 반복을 4회 이상 걸면 두 회차가 자동으로 rejected 로 떨어진다 —
    // '반복 걸면 다 잡히겠지' 가 아니라는 걸 보여주는 재현 케이스.
    {
      id: nextId(),
      roomId: roomLarge,
      title: "디자인 스프린트",
      organizerName: "최민지",
      organizerEmail: "minji@molcube.com",
      organizerDepartment: departmentOf("minji@molcube.com"),
      recurringEventId: null,
      start: atOffset(7, 14, 0),
      end: atOffset(7, 15, 0),
      headcount: 5,
      attendeeCount: 5,
      conference: null,
      checkedInAt: null,
      summary: null,
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomLarge,
      title: "브랜드 워크숍",
      organizerName: "정하은",
      organizerEmail: "haeun@molcube.com",
      organizerDepartment: departmentOf("haeun@molcube.com"),
      recurringEventId: null,
      start: atOffset(21, 14, 0),
      end: atOffset(21, 15, 0),
      headcount: 4,
      attendeeCount: 4,
      conference: null,
      checkedInAt: null,
      summary: null,
      isMine: false,
    },

    /*
     * 지난 내 예약. "지난 예약" 탭과 회의 요약을 실제로 판단하려면 세 가지가 다 있어야 한다:
     * 요약을 이미 쓴 회의 · 아직 안 쓴 회의 · 체크인을 놓친 회의.
     * 하나만 넣어두면 빈 상태와 채워진 상태 중 한쪽을 못 본다.
     */
    {
      id: nextId(),
      roomId: roomLarge,
      title: "스프린트 회고",
      organizerName: ME.name,
      organizerEmail: ME.email,
      organizerDepartment: ME_DEPARTMENT,
      recurringEventId: null,
      start: atOffset(-1, 15, 0),
      end: atOffset(-1, 16, 0),
      headcount: 6,
      attendeeCount: 6,
      conference: null,
      checkedInAt: atOffset(-1, 15, 3),
      summary: "배포 자동화 먼저 하기로 했어요. 다음 회고까지 최민지님이 초안을 가져옵니다.",
      isMine: true,
    },
    {
      id: nextId(),
      roomId: roomSmall,
      title: "디자인 리뷰",
      organizerName: ME.name,
      organizerEmail: ME.email,
      organizerDepartment: ME_DEPARTMENT,
      recurringEventId: null,
      start: atOffset(-2, 11, 0),
      end: atOffset(-2, 11, 30),
      headcount: 3,
      attendeeCount: 2,
      conference: null,
      checkedInAt: atOffset(-2, 11, 1),
      summary: null,
      isMine: true,
    },
    {
      id: nextId(),
      roomId: roomSmall,
      title: "벤더 미팅",
      organizerName: ME.name,
      organizerEmail: ME.email,
      organizerDepartment: ME_DEPARTMENT,
      recurringEventId: null,
      start: atOffset(-5, 10, 0),
      end: atOffset(-5, 11, 0),
      headcount: 4,
      attendeeCount: 4,
      conference: { kind: "zoom", url: "https://zoom.us/j/1234567890" },
      checkedInAt: null,
      summary: null,
      isMine: true,
    },
  ];
}

let store: Booking[] = seed();
let prefs: UserPrefs = { defaultZoomUrl: "https://zoom.us/j/1234567890" };

const clone = (b: Booking): Booking => ({ ...b, start: new Date(b.start), end: new Date(b.end) });

function reasonForFailedCreate(result: Extract<CreateResult, { ok: false }>): string {
  if (result.reason === "taken") return result.by + "님 예약과 겹침";
  if (result.reason === "room-declined") return "회의실이 예약을 거절했습니다";
  return result.message;
}

export const mockAdapter: BookingRepository = {
  async getCurrentUser() {
    await sleep(80);
    return { ...ME };
  },

  async listByDay(day) {
    const fail = await takeReadError("grid-once");
    await sleep(140);
    if (fail) throw new Error("QA fixture: grid read failed");
    return store.filter((b) => sameDay(b.start, day)).map(clone);
  },

  async listByRoom(roomId, day) {
    const fail = await takeReadError("room-once");
    await sleep(120);
    if (fail) throw new Error("QA fixture: room read failed");
    return store.filter((b) => b.roomId === roomId && sameDay(b.start, day)).map(clone);
  },

  async listMine() {
    const fail = await takeReadError("my-bookings-once");
    await sleep(120);
    if (fail) throw new Error("QA fixture: my-bookings read failed");
    const now = appNow();
    return store
      .filter((b) => b.isMine && b.end.getTime() >= now.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map(clone);
  },

  async listByRange(from, to) {
    await sleep(180);
    return store.filter((b) => inDateRange(b.start, from, to)).map(clone);
  },

  async create(draft: BookingDraft): Promise<CreateResult> {
    await sleep(qaFixtures.saveDelayMs ?? CREATE_DELAY_MS);

    // 3차 방어 재현: 회의실이 사후에 거절
    if (draft.title.includes("__declined")) {
      return { ok: false, reason: "room-declined" };
    }

    // 2차 방어: 예약 직전 재조회
    const conflict = store.find(
      (b) => b.roomId === draft.roomId && overlaps(draft.start, draft.end, b.start, b.end),
    );
    if (conflict || draft.title.includes("__taken")) {
      return { ok: false, reason: "taken", by: conflict?.organizerName ?? "다른 사용자" };
    }

    const created: Booking = {
      id: nextId(),
      roomId: draft.roomId,
      title: draft.title,
      organizerName: ME.name,
      organizerEmail: ME.email,
      organizerDepartment: ME_DEPARTMENT,
      recurringEventId: null,
      start: draft.start,
      end: draft.end,
      headcount: draft.headcount,
      attendeeCount: draft.attendeeEmails.length,
      conference: draft.conference,
      checkedInAt: null,
      summary: null,
      isMine: true,
    };
    store = [...store, created];
    return { ok: true, booking: clone(created) };
  },

  async createRecurring(draft: BookingDraft): Promise<RecurringCreateResult> {
    await sleep(qaFixtures.saveDelayMs ?? RECURRING_CREATE_DELAY_MS);

    // 반복 규칙이 없으면 단발 예약 한 번을 부른 것과 같은 결과로 감싼다.
    if (!draft.recurrence) {
      const single = await mockAdapter.create(draft);
      if (single.ok) {
        return { seriesId: null, booked: [single.booking], rejected: [] };
      }
      return {
        seriesId: null,
        booked: [],
        rejected: [{ start: draft.start, end: draft.end, reason: reasonForFailedCreate(single) }],
      };
    }

    const occurrences = expandRecurrence(draft.start, draft.end, draft.recurrence);
    const seriesId = nextSeriesId();
    const booked: Booking[] = [];
    const rejected: Array<{ start: Date; end: Date; reason: string }> = [];

    for (const occ of occurrences) {
      // Google 은 반복 일정의 각 인스턴스에 대해 회의실이 개별적으로 수락/거절한다 —
      // 회차마다 그 시점의 store 를 기준으로 충돌을 따로 검사한다.
      const conflict = store.find(
        (b) => b.roomId === draft.roomId && overlaps(occ.start, occ.end, b.start, b.end),
      );
      if (conflict) {
        rejected.push({ start: occ.start, end: occ.end, reason: conflict.organizerName + "님 예약과 겹침" });
        continue;
      }

      const created: Booking = {
        id: nextId(),
        roomId: draft.roomId,
        title: draft.title,
        organizerName: ME.name,
        organizerEmail: ME.email,
        organizerDepartment: ME_DEPARTMENT,
        recurringEventId: seriesId,
        start: occ.start,
        end: occ.end,
        headcount: draft.headcount,
        attendeeCount: draft.attendeeEmails.length,
        conference: draft.conference,
        checkedInAt: null,
        summary: null,
        isMine: true,
      };
      store = [...store, created];
      booked.push(clone(created));
    }

    return {
      seriesId: booked.length > 0 ? seriesId : null,
      booked,
      rejected,
    };
  },

  async cancelSeries(seriesId) {
    await sleep(200);
    store = store.filter((b) => b.recurringEventId !== seriesId);
  },

  async changeEnd(bookingId, newEnd): Promise<ChangeResult> {
    await sleep(180);
    const target = store.find((b) => b.id === bookingId);
    if (!target) return { ok: false, reason: "error", message: "예약을 찾을 수 없습니다" };

    // 연장 직전 재조회 — 오래된 캐시로 판단하면 조용히 이중 예약이 된다
    const blocker = store.find(
      (b) => b.id !== bookingId && b.roomId === target.roomId && overlaps(target.start, newEnd, b.start, b.end),
    );
    if (blocker) return { ok: false, reason: "blocked", by: blocker.organizerName };

    const updated: Booking = { ...target, end: newEnd };
    store = store.map((b) => (b.id === bookingId ? updated : b));
    return { ok: true, booking: clone(updated) };
  },

  async reschedule(bookingId, newStart, newEnd, newRoomId): Promise<ChangeResult> {
    await sleep(180);
    const target = store.find((b) => b.id === bookingId);
    if (!target) return { ok: false, reason: "error", message: "예약을 찾을 수 없습니다" };

    // 목적지 회의실. 안 주면 제자리.
    const destRoomId = newRoomId ?? target.roomId;

    // 저장 직전 재조회 — 드래그하는 동안 남이 그 자리를 잡았을 수 있다.
    // 화면이 들고 있던 목록으로 판단하면 조용히 이중 예약이 된다.
    // **목적지 방**을 기준으로 검사한다 — 원래 방으로 검사하면 방을 옮길 때
    // 정작 가려는 방의 충돌을 놓친다.
    const blocker = store.find(
      (b) => b.id !== bookingId && b.roomId === destRoomId && overlaps(newStart, newEnd, b.start, b.end),
    );
    if (blocker) return { ok: false, reason: "blocked", by: blocker.organizerName };

    const updated: Booking = { ...target, roomId: destRoomId, start: newStart, end: newEnd };
    store = store.map((b) => (b.id === bookingId ? updated : b));
    return { ok: true, booking: clone(updated) };
  },

  async cancel(bookingId) {
    await sleep(180);
    store = store.filter((b) => b.id !== bookingId);
  },

  async listMinePast(limit) {
    await sleep(140);
    const now = appNow();
    return store
      .filter((b) => b.isMine && b.end.getTime() < now.getTime())
      .sort((a, b) => b.start.getTime() - a.start.getTime()) // 최신순 — 방금 끝난 회의가 맨 위
      .slice(0, limit)
      .map(clone);
  },

  async saveSummary(bookingId, summary) {
    await sleep(160);
    const target = store.find((b) => b.id === bookingId);
    if (!target) throw new Error("예약을 찾을 수 없어요");
    // 주최자만 쓸 수 있다 — 남의 회의 description 을 고치면 초대받은 모두의 캘린더가 바뀐다.
    if (!target.isMine) throw new Error("내가 잡은 회의만 기록을 남길 수 있어요");
    const trimmed = summary.trim();
    store = store.map((b) =>
      b.id === bookingId ? { ...b, summary: trimmed.length > 0 ? trimmed : null } : b,
    );
  },

  async checkIn(bookingId) {
    await sleep(150);
    store = store.map((b) => (b.id === bookingId ? { ...b, checkedInAt: appNow() } : b));
  },

  async getPrefs() {
    await sleep(60);
    return { ...prefs };
  },

  async savePrefs(next) {
    await sleep(100);
    if (qaFixtures.prefsSaveError === "once" && prefsSaveErrorArmed) {
      prefsSaveErrorArmed = false;
      throw new Error("QA fixture: preference save failed");
    }
    prefs = { ...next };
  },

  async searchDirectory(query) {
    await sleep(120);
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return DIRECTORY.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
    ).slice(0, 8);
  },
};
