import type { RecurrenceRule } from "./recurrence";

export type { RecurrenceRule, RecurrenceFreq, Occurrence } from "./recurrence";

/** 회의실. rooms.config.json 에서 로드한다 (Directory API 는 관리자 권한이 필요해 못 쓴다). */
export interface Room {
  id: string;
  /** Google Calendar 리소스 캘린더 주소 */
  email: string;
  name: string;
  /** 월간 칩처럼 이름을 다 쓸 수 없는 좁은 자리에 쓰는 한두 글자 약칭 */
  short: string;
  /*
   * 정원(capacity)은 두지 않는다. 두 회의실 모두 인원 제한이 없어서,
   * 정원을 적어두면 있지도 않은 제약을 UI 가 검사하고 경고하게 된다.
   * 예약의 headcount 는 계속 받는다 — 그건 제약이 아니라 기록이다.
   */
  floor: string;
}

export type Conference =
  | { kind: "meet"; url: string | null }
  | { kind: "zoom"; url: string };

/**
 * 예약 하나 = Google Calendar 이벤트 하나.
 * 이 타입은 화면이 소비하는 형태이며, 어댑터가 Calendar 응답을 여기에 맞춘다.
 */
export interface Booking {
  /** Calendar eventId */
  id: string;
  roomId: string;
  /** 회의 제목. 프라이버시 규칙상 격자 셀에는 노출하지 않는다 (DESIGN.md §7) */
  title: string;
  organizerName: string;
  organizerEmail: string;
  /** 주최자 부서. 부서별 보기용. 디렉터리에서 못 찾으면 null */
  organizerDepartment: string | null;
  /** 반복 일정의 일부이면 시리즈 id. 단발 예약이면 null */
  recurringEventId: string | null;
  start: Date;
  end: Date;
  /**
   * 실제로 모이는 사람 수. 정원 검사의 기준.
   *
   * 초대받은 사람 수와 다르다 — 10명이 모이는데 팀장 2명만 초대하는 경우가 흔하다.
   * 초대 수로 정원을 판단하면 4인실에 10명이 들어간다.
   * extendedProperties.shared.headcount 에 저장한다.
   */
  headcount: number;
  /** 캘린더 초대를 받은 사람 수 */
  attendeeCount: number;
  conference: Conference | null;
  /** QR 체크인 시각. extendedProperties.shared.checkedInAt */
  checkedInAt: Date | null;
  isMine: boolean;
}

/** 아직 저장되지 않은 예약 입력값 */
export interface BookingDraft {
  roomId: string;
  title: string;
  start: Date;
  end: Date;
  /** 모이는 사람 수 (정원 검사용). 초대와 무관하게 항상 받는다. */
  headcount: number;
  attendeeEmails: string[];
  conference: Conference | null;
  /** 반복 규칙. null 이면 단발 예약 */
  recurrence: RecurrenceRule | null;
}

/** 사내 구성원. People API 디렉터리 검색 결과 또는 프리셋 팀 구성원. */
export interface DirectoryPerson {
  email: string;
  name: string;
  /** 부서·직함. 동명이인 구분용. 없을 수 있다. */
  detail: string | null;
}

/** 자주 부르는 사람 묶음. teams.json 에서 로드 — API 의존이 없어 항상 동작한다. */
export interface Team {
  id: string;
  name: string;
  members: DirectoryPerson[];
}

export interface Policy {
  maxDurationMinutes: number;
  maxAdvanceDays: number;
  gridStartHour: number;
  gridEndHour: number;
  slotMinutes: number;
  checkInGraceMinutes: number;
  extendStepMinutes: number;
  admins: string[];
}

export interface CurrentUser {
  email: string;
  name: string;
  isAdmin: boolean;
}

/** 사용자 개인 설정. Drive appDataFolder 에 저장 (기기 간 동기화) */
export interface UserPrefs {
  defaultZoomUrl: string | null;
}
