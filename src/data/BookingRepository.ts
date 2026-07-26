import type { Booking, BookingDraft, CurrentUser, UserPrefs } from "../domain/types";

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

  /** 종료 시각 변경 (연장·단축) */
  changeEnd(bookingId: string, newEnd: Date): Promise<ChangeResult>;

  cancel(bookingId: string): Promise<void>;

  /** QR 체크인. extendedProperties.shared.checkedInAt 기록 */
  checkIn(bookingId: string): Promise<void>;

  getPrefs(): Promise<UserPrefs>;
  savePrefs(prefs: UserPrefs): Promise<void>;
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
