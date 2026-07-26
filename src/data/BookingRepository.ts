import type { Booking, BookingDraft, CurrentUser, DirectoryPerson, UserPrefs } from "../domain/types";

/**
 * 화면과 데이터 계층 사이의 유일한 경계.
 *
 * 지금은 mockAdapter 가 구현한다. 스파이크 테스트가 끝나면
 * googleCalendarAdapter 가 같은 인터페이스를 구현하고, 화면은 손대지 않는다.
 *
 * 설계 스펙 §6.1 의 3중 방어 중 2차·3차는 이 계층 안에서 일어난다:
 *   create() 는 "예약 직전 재조회 → insert → 회의실 응답 확인 → 실패 시 롤백"
 *   까지를 하나의 동작으로 책임진다. 화면은 결과만 받는다.
 */
export interface BookingRepository {
  getCurrentUser(): Promise<CurrentUser>;

  /** 지정한 날짜의 전체 회의실 예약. 격자가 쓴다. */
  listByDay(day: Date): Promise<Booking[]>;

  /** 한 회의실의 예약. QR 랜딩과 연장 직전 재조회가 쓴다. */
  listByRoom(roomId: string, day: Date): Promise<Booking[]>;

  /** 내가 잡은 앞으로의 예약 */
  listMine(): Promise<Booking[]>;

  create(draft: BookingDraft): Promise<CreateResult>;

  /**
   * 반복 예약. draft.recurrence 가 있어야 한다.
   * 구현은 회차를 펼쳐 각각의 회의실 응답을 확인하고 부분 성공을 그대로 돌려준다.
   */
  createRecurring(draft: BookingDraft): Promise<RecurringCreateResult>;

  /** 여러 날에 걸친 한 회의실의 예약. 주간 뷰가 쓴다. */
  listByRoomRange(roomId: string, from: Date, to: Date): Promise<Booking[]>;

  /** 여러 날에 걸친 전체 회의실 예약. 월 개요가 쓴다. */
  listByRange(from: Date, to: Date): Promise<Booking[]>;

  /** 시리즈 전체 취소 */
  cancelSeries(seriesId: string): Promise<void>;

  /** 종료 시각 변경 (연장·단축) */
  changeEnd(bookingId: string, newEnd: Date): Promise<ChangeResult>;

  cancel(bookingId: string): Promise<void>;

  /** QR 체크인. extendedProperties.shared.checkedInAt 기록 */
  checkIn(bookingId: string): Promise<void>;

  getPrefs(): Promise<UserPrefs>;
  savePrefs(prefs: UserPrefs): Promise<void>;

  /**
   * 사내 구성원 이름/이메일 부분 검색 (참석자 자동완성).
   *
   * 구현: People API people.searchDirectoryPeople 을 사용자 본인 토큰으로 호출한다
   * (scope: directory.readonly, 브라우저에서 직접 호출 가능, 관리자 권한 불필요).
   *
   * 관리자가 Admin console > Directory > Directory settings 에서 디렉터리 공개를
   * 꺼두면 에러가 아니라 **빈 배열**이 온다. 호출부는 이 경우를 실패가 아니라
   * "자동완성 없음"으로 다루고 자유 입력으로 넘어가야 한다.
   */
  searchDirectory(query: string): Promise<DirectoryPerson[]>;
}

/**
 * 반복 예약 결과.
 *
 * **부분 성공이 정상 경로다.** Google 은 반복 일정의 각 인스턴스에 대해
 * 회의실이 개별적으로 수락/거절한다 — 12주 중 3주만 이미 차 있으면
 * 나머지 9주는 예약되고 3주는 거절된다. events.insert 는 그래도 200 을 준다.
 *
 * 그래서 이 결과는 boolean 이 아니라 회차별 목록이다. 호출부는 반드시
 * 실패한 회차를 사용자에게 보여줘야 한다 — "12주 다 잡혔겠지" 하고
 * 넘어가면 그 방에 갔을 때 다른 팀이 앉아 있다.
 */
export interface RecurringCreateResult {
  /** 시리즈 id. 하나도 못 만들었으면 null */
  seriesId: string | null;
  booked: Booking[];
  /** 회의실이 거절했거나 이미 차 있던 회차 */
  rejected: Array<{ start: Date; end: Date; reason: string }>;
}

export type CreateResult =
  | { ok: true; booking: Booking }
  /** 2차 방어: 예약 직전 재조회에서 이미 찬 것을 발견 */
  | { ok: false; reason: "taken"; by: string }
  /** 3차 방어: 이벤트를 만들었으나 회의실이 거절해 롤백함 */
  | { ok: false; reason: "room-declined" }
  | { ok: false; reason: "error"; message: string };

export type ChangeResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "blocked"; by: string }
  | { ok: false; reason: "error"; message: string };
