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

  /**
   * 이미 끝난 내 예약. 최신순.
   *
   * listMine 과 나눠 둔 이유: 지난 것과 앞으로의 것은 화면에서 하는 일이 다르다
   * (앞의 것은 취소·체크인, 지난 것은 기록을 남기는 곳). 한 목록으로 합치면
   * "취소" 버튼이 이미 끝난 회의에도 붙는다. Google 어댑터에서도 timeMax/timeMin 이
   * 반대로 걸리는 별개의 조회다.
   *
   * @param limit 최대 건수. 지난 예약은 끝없이 쌓이므로 화면이 감당할 만큼만 가져온다.
   */
  listMinePast(limit: number): Promise<Booking[]>;

  /**
   * 회의 요약을 저장한다. 빈 문자열이면 지운다(null 로 저장).
   *
   * 주최자만 쓸 수 있다 — 구현은 내 예약이 아니면 거절해야 한다. 남의 회의
   * description 을 고치면 초대받은 모두의 캘린더가 바뀐다.
   */
  saveSummary(bookingId: string, summary: string): Promise<void>;

  create(draft: BookingDraft): Promise<CreateResult>;

  /**
   * 반복 예약. draft.recurrence 가 있어야 한다.
   * 구현은 회차를 펼쳐 각각의 회의실 응답을 확인하고 부분 성공을 그대로 돌려준다.
   */
  createRecurring(draft: BookingDraft): Promise<RecurringCreateResult>;

  /**
   * 여러 날에 걸친 전체 회의실 예약. 주간·월간 뷰가 쓴다.
   *
   * 방 하나만 가져오는 변형(listByRoomRange)은 두지 않는다. 화면이 방으로 좁히는
   * 것은 필터링이지 조회가 아니고, 조회 단위를 방으로 나누면 "지금 화면에 어떤
   * 부서가 있나" 같은 파생 정보가 뷰마다 달라진다(실제로 그렇게 갈라졌었다).
   */
  listByRange(from: Date, to: Date): Promise<Booking[]>;

  /** 시리즈 전체 취소 */
  cancelSeries(seriesId: string): Promise<void>;

  /** 종료 시각 변경 (연장·단축) */
  changeEnd(bookingId: string, newEnd: Date): Promise<ChangeResult>;

  /**
   * 시작·종료를 함께 바꾼다 (격자에서 드래그로 옮기거나 길이를 조절할 때).
   * `newRoomId` 를 주면 **다른 회의실로** 옮긴다.
   *
   * changeEnd 와 나눠 둔 이유: 종료만 바꾸는 연장은 시작 시각을 신뢰할 수 있지만,
   * 옮기기는 시작도 움직여서 "지난 시간으로 이동" 같은 새 실패 경로가 생긴다.
   * 서버(캘린더) 쪽에서도 patch 필드가 달라진다.
   *
   * 방 이동을 이 메서드에 묶은 이유: Google 어댑터에서 이것은 단순한 필드 수정이
   * 아니라 "원래 방 캘린더에서 빼고 새 방을 초대" 하는 동작이다. 화면이 취소 후
   * 재생성으로 흉내내면 그 틈에 남이 그 시간을 잡을 수 있고, 두 번째 단계가
   * 실패하면 예약이 사라진 채로 남는다.
   */
  reschedule(
    bookingId: string,
    newStart: Date,
    newEnd: Date,
    newRoomId?: string,
  ): Promise<ChangeResult>;

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
