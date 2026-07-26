import type { BookingRepository, CreateResult, ChangeResult } from "./BookingRepository";
import type { Booking, BookingDraft, CurrentUser, UserPrefs } from "../domain/types";
import { overlaps } from "../domain/time";
import rooms from "../config/rooms.json";

/**
 * 환경변수를 붙이기 전까지 화면을 돌리는 인메모리 어댑터.
 *
 * 성공 경로만 흉내내지 않는다 — 설계 스펙 §6.1 의 2차·3차 방어를 실제로
 * 발동시킬 수 있어야 그 UI 경로가 죽은 코드가 되지 않는다.
 * 제목에 "__taken" / "__declined" 을 넣으면 각 실패를 재현한다.
 */

const ME: CurrentUser = {
  email: "sungjun@molcube.com",
  name: "성준",
  isAdmin: true,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function atOffset(dayOffset: number, h: number, m: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

let idSeq = 0;
const nextId = (): string => {
  idSeq += 1;
  return "mock-ev-" + String(idSeq);
};

function seed(): Booking[] {
  const roomA = rooms[0]!.id;
  const roomSmall = rooms[1]!.id;
  const roomB = rooms[2]!.id;

  return [
    {
      id: nextId(),
      roomId: roomA,
      title: "채용 면접",
      organizerName: "김철수",
      organizerEmail: "chulsoo@molcube.com",
      start: atOffset(0, 9, 0),
      end: atOffset(0, 10, 0),
      attendeeCount: 3,
      conference: { kind: "meet", url: "https://meet.google.com/abc-defg-hij" },
      checkedInAt: atOffset(0, 9, 2),
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomA,
      title: "주간 기획회의",
      organizerName: ME.name,
      organizerEmail: ME.email,
      start: atOffset(0, 11, 0),
      end: atOffset(0, 12, 30),
      attendeeCount: 5,
      conference: { kind: "zoom", url: "https://zoom.us/j/1234567890" },
      checkedInAt: null,
      isMine: true,
    },
    {
      id: nextId(),
      roomId: roomSmall,
      title: "1on1",
      organizerName: "박지현",
      organizerEmail: "jihyun@molcube.com",
      start: atOffset(0, 10, 0),
      end: atOffset(0, 10, 30),
      attendeeCount: 2,
      conference: null,
      checkedInAt: null,
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomB,
      // 체크인 없이 시작 시각이 지난 상태 — 미체크인 배지가 뜨는지 확인용
      title: "디자인 리뷰",
      organizerName: "이영희",
      organizerEmail: "younghee@molcube.com",
      start: atOffset(0, 9, 0),
      end: atOffset(0, 10, 30),
      attendeeCount: 4,
      conference: null,
      checkedInAt: null,
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomB,
      title: "전사 주간회의",
      organizerName: "이영희",
      organizerEmail: "younghee@molcube.com",
      start: atOffset(0, 13, 0),
      end: atOffset(0, 15, 0),
      attendeeCount: 18,
      conference: { kind: "meet", url: "https://meet.google.com/xyz-uvwx-yz" },
      checkedInAt: null,
      isMine: false,
    },
    {
      id: nextId(),
      roomId: roomSmall,
      title: "스프린트 회고",
      organizerName: ME.name,
      organizerEmail: ME.email,
      start: atOffset(1, 14, 0),
      end: atOffset(1, 15, 0),
      attendeeCount: 6,
      conference: null,
      checkedInAt: null,
      isMine: true,
    },
  ];
}

let store: Booking[] = seed();
let prefs: UserPrefs = { defaultZoomUrl: "https://zoom.us/j/1234567890" };

const clone = (b: Booking): Booking => ({ ...b, start: new Date(b.start), end: new Date(b.end) });

export const mockAdapter: BookingRepository = {
  async getCurrentUser() {
    await sleep(80);
    return { ...ME };
  },

  async listByDay(day) {
    await sleep(140);
    return store.filter((b) => sameDay(b.start, day)).map(clone);
  },

  async listByRoom(roomId, day) {
    await sleep(120);
    return store.filter((b) => b.roomId === roomId && sameDay(b.start, day)).map(clone);
  },

  async listMine() {
    await sleep(120);
    const now = new Date();
    return store
      .filter((b) => b.isMine && b.end.getTime() >= now.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map(clone);
  },

  async create(draft: BookingDraft): Promise<CreateResult> {
    await sleep(220);

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
      start: draft.start,
      end: draft.end,
      attendeeCount: draft.attendeeEmails.length,
      conference: draft.conference,
      checkedInAt: null,
      isMine: true,
    };
    store = [...store, created];
    return { ok: true, booking: clone(created) };
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

  async cancel(bookingId) {
    await sleep(180);
    store = store.filter((b) => b.id !== bookingId);
  },

  async checkIn(bookingId) {
    await sleep(150);
    store = store.map((b) => (b.id === bookingId ? { ...b, checkedInAt: new Date() } : b));
  },

  async getPrefs() {
    await sleep(60);
    return { ...prefs };
  },

  async savePrefs(next) {
    await sleep(100);
    prefs = { ...next };
  },
};
