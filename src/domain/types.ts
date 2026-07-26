/** 회의실. rooms.config.json 에서 로드한다 (Directory API 는 관리자 권한이 필요해 못 쓴다). */
export interface Room {
  id: string;
  /** Google Calendar 리소스 캘린더 주소 */
  email: string;
  name: string;
  capacity: number;
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
  start: Date;
  end: Date;
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
  attendeeEmails: string[];
  conference: Conference | null;
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
