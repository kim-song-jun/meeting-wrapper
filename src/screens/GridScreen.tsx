import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Alert, Badge, Button, ButtonWithReason, Dialog } from "../components/ui";
import { BookingDialog } from "./BookingDialog";
import { ROOMS, POLICY, roomById } from "../app/config";
import { useRoomVisibility } from "../app/roomVisibility";
import { repo } from "../data";
import { useAsync } from "../app/useAsync";
import { appNow } from "../app/clock";
import {
  canExtend,
  canReschedule,
  canShorten,
  gridDayStart,
  gridSlotCount,
  hhmm,
  humanDuration,
  isNoShow,
  placeInGrid,
  slotIndexOf,
  MINUTE,
} from "../domain/time";
import type { GridPlacement, RescheduleResult } from "../domain/time";
import type { Booking, Room, UserPrefs } from "../domain/types";
import "../styles/grid.css";

const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

const READ_ERROR_MESSAGE = "예약 정보를 불러오지 못했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.";

/* ---------------- date helpers ---------------- */

const pad2 = (n: number): string => (n < 10 ? "0" + String(n) : String(n));

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** 월요일 시작 주. getDay() 는 일요일=0 이라 월요일 기준으로 이동시킨다. */
function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -dow);
}

function addWeeks(d: Date, n: number): Date {
  return addDays(d, n * 7);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function ymd(d: Date): string {
  return String(d.getFullYear()) + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function sameYMD(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

/** 드래그 수정이 막힌 이유를 원인 + 다음 행동으로 바꾼다 (DESIGN.md §10). */
function rescheduleMessage(r: Extract<RescheduleResult, { ok: false }>): string {
  switch (r.reason) {
    case "blocked":
      return r.blockedBy.organizerName + "님 예약과 겹쳐요. 빈 시간으로 옮겨주세요.";
    case "too-long":
      return "한 번에 " + humanDuration(r.maxMinutes) + "까지 예약할 수 있어요.";
    case "too-short":
      return humanDuration(r.minMinutes) + "보다 짧게 줄일 수 없어요.";
    case "in-past":
      return "이미 지난 시간으로는 옮길 수 없어요.";
    case "too-far":
      return String(r.maxDays) + "일 뒤까지만 예약할 수 있어요.";
  }
}

/** 월간 칸 하나에 그리는 일정 칩 최대 개수. 96px 칸에 날짜 + 칩 3개가 들어간다. */
const MONTH_CHIP_LIMIT = 3;

/** 화면에 로드된 예약들에서 주최자 부서를 distinct 로 뽑는다. 설정 파일에 따로 두지 않는다. */
function distinctDepartments(bookings: readonly Booking[]): string[] {
  const set = new Set<string>();
  for (const b of bookings) {
    if (b.organizerDepartment) set.add(b.organizerDepartment);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}

/**
 * 격자 축 라벨/정시 여부. 시간축은 어느 날짜인지와 무관하게 시:분 텍스트만 필요하므로
 * dayStart 는 "그 열이 대표하는 하루의 시작" 만 넘기면 된다 (일간·주간이 공유).
 */
function slotIsHourBoundary(slotIndex: number, slotMinutes: number): boolean {
  return ((slotIndex + 1) * slotMinutes) % 60 === 0;
}

function slotHourLabel(dayStart: Date, slotIndex: number, slotMinutes: number): string | null {
  if ((slotIndex * slotMinutes) % 60 !== 0) return null;
  return hhmm(new Date(dayStart.getTime() + slotIndex * slotMinutes * MINUTE));
}

/**
 * 격자 슬롯 높이(px)를 CSS 토큰에서 직접 읽는다.
 * tokens.css 의 --grid-slot-h 가 단일 진실 소스이며, JS 에 숫자를 따로
 * 하드코딩하면 CSS 값이 바뀔 때 픽셀 배치가 조용히 어긋난다.
 */
function readCssPx(varName: string): number {
  if (typeof window === "undefined") {
    throw new Error("[MolRoom] CSS geometry requires a browser.");
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)px$/);
  const n = match ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('[MolRoom] CSS token ' + varName + ' must be a positive px value; received "' + raw + '".');
  }
  return n;
}

function useCssPx(varName: string): number {
  const [value, setValue] = useState(() => readCssPx(varName));
  useEffect(() => {
    const media = [
      window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 768px)"),
      window.matchMedia("(hover: none), (pointer: coarse)"),
      window.matchMedia("(max-width: 767px)"),
    ];
    const update = () => setValue(readCssPx(varName));
    for (const query of media) query.addEventListener("change", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      for (const query of media) query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, [varName]);
  return value;
}

/** 모바일 폭 여부. grid.css 의 767px 브레이크포인트와 같은 값을 쓴다. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    setNarrow(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/* ---------------- 뷰 전환 ---------------- */

type ViewMode = "day" | "agenda" | "week" | "month";

/*
 * 기간 전환은 **일 · 주 · 월 세 개**다.
 *
 * 예전엔 "일간 / 일정 / 주간 / 월간" 네 개였는데, 그중 "일정" 만 기간이 아니라
 * *표시 방식*이라 축이 섞였다 — 거기에 시간순/회의실별 토글이 하나 더 붙어
 * 계층이 2단이 됐다("탭들이 이상한 계층을 표현한다").
 * 캘린더 레퍼런스(Clockwise)는 Day|Week 둘, Jobber 는 드롭다운 하나다.
 *
 * 그래서 축을 분리한다: **기간**(일/주/월)과, 일 기간 안에서의 **표시**(격자/목록).
 */
const RANGE_TABS: readonly { id: "day" | "week" | "month"; label: string }[] = [
  { id: "day", label: "일" },
  { id: "week", label: "주" },
  { id: "month", label: "월" },
];

/** 일 기간의 표시 방식. 격자 = 장소별 비교, 목록 = 일정별 훑기. */
const DAY_MODES: readonly { id: "day" | "agenda"; label: string }[] = [
  { id: "day", label: "격자" },
  { id: "agenda", label: "목록" },
];

/**
 * 일정 뷰의 묶는 기준.
 *
 * 격자(일간)는 "언제가 비었나" 를 보는 화면이라 회의실이 열이고 시간이 축이다.
 * 그런데 "오늘 무슨 회의가 있나" 를 알고 싶을 때 격자는 답을 주지 못한다 —
 * 눈으로 두 열을 번갈아 훑으며 시간순으로 재조립해야 한다. 그래서 목록을 따로 둔다.
 *
 * 그 목록을 무엇으로 묶느냐가 이 토글이다:
 *   time — 시간순. 방을 섞어서 "다음에 무슨 일이 있나" 를 본다
 *   room — 회의실별. "이 방은 오늘 어떻게 쓰이나" 를 본다
 */
type AgendaGroup = "time" | "room";

const AGENDA_GROUPS: readonly { id: AgendaGroup; label: string }[] = [
  { id: "time", label: "시간순" },
  { id: "room", label: "회의실별" },
];

/**
 * 일간·일정·주간·월간은 상호 배타적인 4개 뷰다 — 언더라인 탭(공용 Tabs 컴포넌트,
 * MyBookingsScreen 과 공유)보다 하나의 폐곡선 안에 묶인 segmented control 이
 * "지금 무엇을 보고 있나"를 더 즉시 읽히게 한다. components.css 의 공유 Tabs
 * 를 건드리지 않기 위해 이 화면 전용 마크업/스타일을 grid.css 안에서 새로 정의한다.
 */
function Segmented<T extends string>({
  items,
  active,
  onChange,
  label,
  small,
}: {
  items: readonly { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div
      className={cx("grid-viewswitch", small && "grid-viewswitch--sm")}
      role="tablist"
      aria-label={label}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          className={cx("grid-viewswitch__btn", it.id === active && "is-active")}
          aria-selected={it.id === active}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}


/* ---------------- 일정 뷰 (목록) ---------------- */

/**
 * 하루의 예약을 목록으로 본다. 격자가 답하지 못하는 질문("오늘 무슨 회의가
 * 있나", "이 방은 오늘 어떻게 쓰이나")을 담당한다.
 *
 * 격자와 같은 데이터·같은 필터를 쓴다 — 별도 조회를 만들지 않는다. 두 화면이
 * 다른 결과를 보이면 어느 쪽이 맞는지 사용자가 판단해야 한다.
 *
 * 행은 전부 버튼이다. 눌러서 상세를 열고, 거기서 시간 변경·취소를 한다 —
 * 격자에서 블록을 누르는 것과 같은 동작이라 배울 것이 하나도 늘지 않는다.
 */
function AgendaView({
  bookings,
  group,
  onGroupChange,
  visibleRooms,
  loading,
  now,
  onSelectBooking,
  onCreate,
}: {
  bookings: readonly Booking[];
  group: AgendaGroup;
  onGroupChange: (g: AgendaGroup) => void;
  visibleRooms: readonly Room[];
  loading: boolean;
  now: Date;
  onSelectBooking: (b: Booking) => void;
  /**
   * 이 화면에서 새 예약을 시작한다. **다음으로 비어 있는 30분**을 골라 다이얼로그를 연다
   * — 목록에는 "빈 줄" 이 없어서 사용자가 시간을 가리킬 좌표가 없다. 그래서 화면이
   * 대신 고르고, 다이얼로그에서 고치게 한다. null 이면 오늘 남은 빈 시간이 없다.
   */
  onCreate: () => void;
}) {
  const sorted = useMemo(
    () => [...bookings].sort((a, b) => a.start.getTime() - b.start.getTime()),
    [bookings],
  );

  const byRoom = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const room of visibleRooms) map.set(room.id, []);
    for (const b of sorted) map.get(b.roomId)?.push(b);
    return map;
  }, [sorted, visibleRooms]);

  const row = (b: Booking, showRoom: boolean) => {
    const room = roomById(b.roomId);
    const minutes = (b.end.getTime() - b.start.getTime()) / MINUTE;
    return (
      <button
        key={b.id}
        type="button"
        className={cx("agenda-row", b.isMine && "agenda-row--mine")}
        onClick={() => onSelectBooking(b)}
      >
        <span className="agenda-row__time t-num">
          <span className="agenda-row__start">{hhmm(b.start)}</span>
          <span className="agenda-row__end">{hhmm(b.end)}</span>
        </span>
        <span className="agenda-row__body">
          <span className="agenda-row__head">
            <span className="agenda-row__who">{b.organizerName}</span>
            {b.isMine ? <Badge tone="mine">내 예약</Badge> : null}
            {isNoShow(b, now, POLICY.checkInGraceMinutes) ? <Badge tone="attn">미체크인</Badge> : null}
          </span>
          <span className="agenda-row__meta">
            {showRoom ? (room?.name ?? b.roomId) + " · " : ""}
            {humanDuration(minutes)} · 인원 {b.headcount}명
            {b.organizerDepartment ? " · " + b.organizerDepartment : ""}
          </span>
        </span>
        {/* 누를 수 있다는 것을 남겨 둔다 — 행 전체가 버튼인데 아무 표시가 없으면
            읽기 전용 표처럼 보인다. */}
        <span className="agenda-row__go" aria-hidden="true">
          ›
        </span>
      </button>
    );
  };

  return (
    <div className="agenda">
      <div className="agenda__toolbar">
        <Segmented items={AGENDA_GROUPS} active={group} onChange={onGroupChange} label="묶는 기준" small />
        {/*
          목록에는 "빈 줄" 이 없어서 사용자가 빈 시간을 가리킬 수 없다. 그래서 예약을
          시작하는 길이 아예 없었다 — 격자로 가라는 안내만 있었다. 화면이 다음 빈 30분을
          대신 골라주고, 정확한 시간은 다이얼로그에서 정하게 한다.
        */}
        <Button variant="secondary" onClick={onCreate}>
          새 예약
        </Button>
        <p className="agenda__hint">
          일정을 누르면 시간을 바꾸거나 취소할 수 있어요.
        </p>
      </div>

      {loading ? (
        <p className="mr-state">불러오는 중…</p>
      ) : group === "time" ? (
        sorted.length === 0 ? (
          <p className="agenda__empty">이 날에는 예약이 없어요. 일간 보기에서 빈 시간을 끌어 예약할 수 있어요.</p>
        ) : (
          <div className="agenda__list">{sorted.map((b) => row(b, true))}</div>
        )
      ) : (
        <div className="agenda__rooms">
          {visibleRooms.map((room) => {
            const items = byRoom.get(room.id) ?? [];
            return (
              <section key={room.id} className="agenda__room">
                <h2 className="agenda__room-head">
                  <span className="agenda__room-name">{room.name}</span>
                  <span className="agenda__room-meta">
                    {room.floor} · 예약 {items.length}건
                  </span>
                </h2>
                {items.length === 0 ? (
                  <p className="agenda__empty">이 방은 이 날 비어있어요.</p>
                ) : (
                  <div className="agenda__list">{items.map((b) => row(b, false))}</div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 이전/다음 은 하나의 결정(어느 방향으로 한 칸)을 반으로 나눈 것이므로
 * 보더를 공유하는 2분할 pill 로 묶는다. "오늘"/"이번 주"/"이번 달"은 성격이
 * 다른 별도 액션(현재로 점프)이라 분리해 둔다.
 * 주간·월간 뷰가 이 컴포넌트를 공유하고, 필터바와 함께 하나의 .grid-controlbar
 * 안에 렌더링된다(day 뷰의 오늘/내일/날짜 툴바도 같은 컨테이너를 쓴다).
 */
function DateStepper({
  onPrev,
  onNext,
  onToday,
  prevLabel,
  nextLabel,
  todayLabel,
  rangeLabel,
}: {
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  prevLabel: string;
  nextLabel: string;
  todayLabel: string;
  rangeLabel: string;
}) {
  /*
   * 배치 순서는 실제 캘린더 제품들(Proton Calendar, Front)에서 가져왔다:
   * [현재로 점프] → [‹ ›] → [큰 기간 제목]. 셋 다 왼쪽에 모여 있고 제목이 가장 크다.
   * 우리는 스테퍼가 먼저 오고 제목이 작아서 "지금 어느 날짜를 보고 있나" 가
   * 컨트롤보다 약하게 읽혔다.
   */
  return (
    <div className="grid-toolbar mr-row">
      <Button variant="secondary" onClick={onToday}>
        {todayLabel}
      </Button>
      <div className="grid-datestepper" role="group" aria-label="날짜 이동">
        <button type="button" className="grid-datestepper__btn" onClick={onPrev} aria-label={prevLabel}>
          <span aria-hidden="true">‹</span>
        </button>
        <span className="grid-datestepper__divider" aria-hidden="true" />
        <button type="button" className="grid-datestepper__btn" onClick={onNext} aria-label={nextLabel}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <h2 className="grid-topbar__title">{rangeLabel}</h2>
    </div>
  );
}

/* ---------------- drag selection ---------------- */

/**
 * 빈 구간을 끌어 새 예약을 만드는 중의 상태.
 *
 * 커서 y 를 슬롯으로 바꾸는 방식은 EditDragState 와 **같다**(window mousemove + colTop).
 * 예전엔 슬롯의 mouseenter 에 기댔는데, 남의 예약 블록이 슬롯을 덮고 있어서 블록 위를
 * 지나는 동안 mouseenter 가 아예 안 떴다 — 선택이 멈췄다가 블록을 지나면 다시 늘어났고,
 * 그게 "드래그가 걸린다" 로 읽혔다.
 */
interface DragState {
  roomId: string;
  anchor: number;
  current: number;
  /** 이 열(.grid-col)의 화면상 top. 커서 y → 슬롯 변환에 쓴다 */
  colTop: number;
  /**
   * 지금 잡을 수 있는 **빈 구간**의 양끝(둘 다 포함). 이웃 예약이 벽이다.
   *
   * 겹치는 구간을 애초에 만들 수 없게 하려고 둔다. 겹침을 허용하고 나중에 막으면
   * 사용자는 제목·참석자까지 다 채운 뒤 저장 버튼에서 거절당한다.
   */
  minSlot: number;
  maxSlot: number;
}

/**
 * 내 예약을 격자에서 직접 옮기거나(move) 아래 끝을 끌어 길이를 바꾸는(resize) 중의 상태.
 *
 * 슬롯 인덱스로만 들고 있는다 — 픽셀로 들고 있으면 placeInGrid 와 계산이 갈라진다.
 * startSlot/endSlot 은 [시작, 끝) 반열림 구간이다(끝 슬롯은 포함하지 않는다).
 */
interface EditDragState {
  bookingId: string;
  roomId: string;
  mode: "move" | "resize";
  startSlot: number;
  endSlot: number;
  /**
   * move 일 때 블록 안 어디를 잡았는지 (**px**). 잡은 지점이 커서를 따라오게 한다.
   * 슬롯 단위로 반올림해 두면 첫 이동에서 블록이 한 슬롯 튀어 오른다.
   */
  grabOffsetPx: number;
  /** 저장 실패 시 되돌릴 원래 구간 */
  originStartSlot: number;
  originEndSlot: number;
  /**
   * 이 예약이 놓인 열(.grid-col)의 화면상 top. 커서 y 를 슬롯으로 바꿀 때 쓴다.
   *
   * 슬롯 mouseenter 에 의존하지 않는 이유: 끌고 있는 블록이 커서 밑에 있어서
   * 아래 슬롯의 mouseenter 가 발생하지 않는다. 블록에 pointer-events: none 을 주면
   * 이번엔 mouseup 의 클릭 타깃이 슬롯으로 바뀌어 "클릭해서 상세 열기" 가 죽는다.
   * 그래서 window mousemove + 열 좌표로 직접 계산한다.
   */
  colTop: number;
  /**
   * 지금 커서가 놓인 열의 회의실. 시작할 때는 roomId 와 같고, 커서가 옆 열로
   * 넘어가면 바뀐다 — 이게 "회의실 간 이동" 이다.
   *
   * 열 판정은 mousemove 때마다 실제 열 요소의 좌표를 재서 한다. 시작 시점에
   * 좌표를 캐시하지 않는 이유: 사이드바 회의실 토글로 열이 사라지거나 창 폭이
   * 바뀌면 캐시가 조용히 틀려지고, 그러면 엉뚱한 방으로 옮겨진다.
   */
  targetRoomId: string;
}

/* ================================================================== */

export function GridScreen() {
  const [view, setView] = useState<ViewMode>("day");
  const [agendaGroup, setAgendaGroup] = useState<AgendaGroup>("time");

  /*
   * 사이드바에서 끈 회의실은 격자에서 빠진다(macOS 캘린더의 캘린더 목록과 같은 동작).
   * 이 화면이 쓰는 "보이는 방 목록" 은 전부 이 값을 통과한 것이다.
   */
  const roomVisibility = useRoomVisibility();
  const visibleRooms = useMemo(
    () => ROOMS.filter((r) => roomVisibility.isVisible(r.id)),
    [roomVisibility],
  );

  /* ---- 일간 뷰 상태 (기존, 손대지 않음) ---- */
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(appNow()));
  const dayKey = ymd(selectedDate);

  const [now, setNow] = useState<Date>(() => appNow());
  useEffect(() => {
    const t = setInterval(() => setNow(appNow()), 30_000);
    return () => clearInterval(t);
  }, []);

  const bookingsState = useAsync<Booking[]>(() => repo.listByDay(selectedDate), [dayKey]);
  /*
   * **첫 로드에만** 스켈레톤을 띄운다.
   *
   * 예전엔 loading 이 true 이기만 하면 이벤트를 전부 지우고 스켈레톤을 그렸다.
   * 그런데 예약을 옮긴 뒤 reload() 를 부르면 그 순간에도 loading 이 true 가 되어,
   * 방금 옮긴 블록을 포함한 하루치가 통째로 사라졌다가 다시 나타났다.
   * useAsync 는 재조회 중에도 이전 data 를 들고 있으므로 그대로 그리면 된다.
   */
  const firstLoad = bookingsState.data === null;
  const gridLiveMessage = bookingsState.loading
    ? "예약 정보를 불러오는 중이에요."
    : bookingsState.error || bookingsState.data === null
      ? ""
      : "예약 정보를 불러왔어요.";
  const prefsState = useAsync<UserPrefs>(() => repo.getPrefs(), []);

  const slotPx = useCssPx("--grid-slot-h");
  const dayStart = useMemo(() => gridDayStart(selectedDate, POLICY), [selectedDate]);
  const slotCount = useMemo(() => gridSlotCount(POLICY), []);
  const dayEnd = useMemo(
    () => new Date(dayStart.getTime() + slotCount * POLICY.slotMinutes * MINUTE),
    [dayStart, slotCount],
  );
  const slotIndices = useMemo(() => Array.from({ length: slotCount }, (_, i) => i), [slotCount]);
  const isToday = sameYMD(selectedDate, now);
  const dayGridScrollRef = useRef<HTMLDivElement>(null);
  const autoPositionedTodayRef = useRef<string | null>(null);

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(
        selectedDate,
      ),
    [selectedDate],
  );

  /* ---- 필터 (모든 뷰 공통) ---- */
  const [deptFilter, setDeptFilter] = useState<string | null>(null);


  function matchesDept(b: Booking): boolean {
    return deptFilter === null || b.organizerDepartment === deptFilter;
  }

  const bookingsByRoom = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const room of visibleRooms) map.set(room.id, []);
    for (const b of bookingsState.data ?? []) {
      const arr = map.get(b.roomId);
      if (arr) arr.push(b);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return map;
  }, [bookingsState.data]);

  /* ---- 주간 뷰 상태 ---- */
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => startOfDay(appNow()));
  const weekStart = useMemo(() => startOfWeek(weekAnchor), [weekAnchor]);
  // repo 의 날짜 범위 조회는 from·to 를 모두 포함한다 (일 단위) — "주 끝"은 그 주의
  // 마지막 날(일요일)이지 다음 주 월요일이 아니다. +7 로 넘기면 다음 주 첫날 예약까지
  // 잘못 섞여 들어온다.
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekRangeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(weekStart) +
      " – " +
      new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(weekEnd),
    [weekStart, weekEnd],
  );
  /*
   * 주간도 **모든 방**을 한 번에 가져온다. 예전엔 고른 방 하나만 조회했는데
   * (listByRoomRange), 그러면 부서 칩이 뷰에 따라 달라졌다 — 일간에는 "기획팀" 이
   * 있는데 주간으로 넘어가면 사라진다. 그 부서의 예약이 마침 다른 방에 있었기
   * 때문이고, 사용자에겐 필터 목록이 이유 없이 바뀌는 것으로 보인다.
   *
   * 방 전환도 이제 재조회가 아니라 필터링이라 즉시 바뀐다. 회의실이 둘뿐이라
   * 한 번 더 가져오는 비용은 사실상 없다.
   */
  const weekState = useAsync<Booking[]>(
    () => (view === "week" ? repo.listByRange(weekStart, weekEnd) : Promise.resolve([])),
    [view, weekStart.getTime(), weekEnd.getTime()],
  );
  /*
   * 주간도 **켜 둔 회의실을 전부** 그린다.
   *
   * 예전엔 격자 위에 회의실 칩 줄이 따로 있었고 거기서 방 하나만 고를 수 있었다.
   * 그런데 회의실을 켜고 끄는 컨트롤은 좌측 사이드바에 이미 있다 — 같은 것을
   * 정하는 컨트롤이 화면에 둘이었고, 둘의 규칙(다중 / 단일)까지 서로 달랐다.
   * 사이드바 하나로 통일하고, 주간은 요일 안에서 방별로 열을 쪼갠다.
   */
  const weekBookings = useMemo(
    () => (weekState.data ?? []).filter((b) => visibleRooms.some((r) => r.id === b.roomId)),
    [weekState.data, visibleRooms],
  );

  /* ---- 월간 뷰 상태 ---- */
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(appNow()));
  // 마찬가지로 repo 의 범위 조회는 to 를 포함한다 — "한 달치"는 그 달의 마지막 날까지고
  // 다음 달 1일이 아니다. 앞뒤 달로 채워지는 달력 여백 칸은 스펙대로 개요 이상을 보여주지 않는다.
  const monthRangeEnd = useMemo(() => addDays(addMonths(monthAnchor, 1), -1), [monthAnchor]);
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(monthAnchor),
    [monthAnchor],
  );
  const monthState = useAsync<Booking[]>(
    () => (view === "month" ? repo.listByRange(monthAnchor, monthRangeEnd) : Promise.resolve([])),
    [view, monthAnchor.getTime(), monthRangeEnd.getTime()],
  );

  /* ---- 부서 목록: 현재 뷰에 실제로 로드된 예약에서만 distinct 로 뽑는다 ---- */
  const activeBookings = useMemo(() => {
    // 일정 뷰는 일간과 같은 하루 데이터를 쓴다
    if (view === "day" || view === "agenda") return bookingsState.data ?? [];
    if (view === "week") return weekState.data ?? [];
    return monthState.data ?? [];
  }, [view, bookingsState.data, weekState.data, monthState.data]);
  /*
   * 부서 목록은 현재 뷰에 로드된 예약에서 뽑되, **선택 중인 부서는 항상 포함한다.**
   * 그렇지 않으면 일간에서 "기획팀"을 고른 뒤 그 주에 기획팀 예약이 없는 주간 뷰로
   * 넘어갔을 때 칩이 사라지고 격자만 텅 빈다 — 사용자는 필터가 걸려 있다는 것도,
   * 무엇이 걸려 있는지도, 어떻게 푸는지도 알 수 없게 된다.
   */
  const departments = useMemo(() => {
    const found = distinctDepartments(activeBookings);
    if (deptFilter !== null && !found.includes(deptFilter)) {
      return [...found, deptFilter].sort((a, b) => a.localeCompare(b, "ko"));
    }
    return found;
  }, [activeBookings, deptFilter]);

  /** 부서 필터 때문에 결과가 0건이 된 경우 (인원 필터와 달리 조용히 비는 것을 막는다) */
  const deptFilterEmptied =
    deptFilter !== null &&
    activeBookings.length > 0 &&
    !activeBookings.some((b) => b.organizerDepartment === deptFilter);

  function slotToDate(slot: number): Date {
    return new Date(dayStart.getTime() + slot * POLICY.slotMinutes * MINUTE);
  }

  /* ---- drag selection (일간 뷰 전용) ---- */
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  const [dialogRange, setDialogRange] = useState<{ roomId: string; start: Date; end: Date } | null>(
    null,
  );

  /*
   * 다이얼로그가 열려 있는 동안 격자에 남겨 두는 **확정된 선택 구간.**
   *
   * drag 와 분리한 이유: drag 를 살려 두면 mousemove/Escape 핸들러가 계속 그것을
   * 갱신한다 — 다이얼로그 뒤 배경에서 마우스를 움직이면 사각형이 따라 늘어난다.
   * 이 값은 갱신 대상이 아니라 "무엇을 골랐는지"의 스냅샷이므로 별도로 둔다.
   */
  const [pendingSel, setPendingSel] = useState<{ roomId: string; min: number; max: number } | null>(
    null,
  );

  /** 다이얼로그를 여는 유일한 통로. 격자에 남길 선택 구간도 여기서 함께 정한다. */
  function openBookingDialog(roomId: string, start: Date, end: Date) {
    setDialogRange({ roomId, start, end });
    setPendingSel({
      roomId,
      min: Math.floor(slotIndexOf(start, dayStart, POLICY.slotMinutes)),
      max: Math.floor(slotIndexOf(end, dayStart, POLICY.slotMinutes)) - 1,
    });
  }

  function closeBookingDialog() {
    const range = dialogRange;
    setDialogRange(null);
    setPendingSel(null);
    if (range && view === "day") {
      const slot = Math.floor(slotIndexOf(range.start, dayStart, POLICY.slotMinutes));
      requestAnimationFrame(() => focusCell(range.roomId, slot));
    }
  }

  /* ---- 내 예약 드래그 수정 (일간 뷰 전용) ---- */
  const [edit, setEdit] = useState<EditDragState | null>(null);
  const editRef = useRef<EditDragState | null>(null);
  /*
   * 마우스를 **놓았는지**. edit 상태만으로는 구분이 안 된다.
   *
   * 저장이 끝날 때까지 프리뷰(edit)를 일부러 살려두도록 바꾼 뒤로(블록이 원위치로
   * 튀는 것을 막기 위해), mousemove 핸들러가 그 프리뷰를 계속 갱신했다 —
   * 손을 뗐는데도 블록이 커서를 따라다녔다. 놓는 순간 이 플래그를 세워
   * "화면에는 남아 있지만 더 이상 따라오지 않는" 상태로 만든다.
   */
  const editReleasedRef = useRef(false);
  useEffect(() => {
    editRef.current = edit;
  }, [edit]);
  /*
   * 드래그로 옮기거나 늘린 직후의 click 을 한 번 삼킨다.
   * mouseup 은 같은 요소에서 click 으로 이어지므로, 그냥 두면 옮기고 손을 뗄 때마다
   * 상세 다이얼로그가 열린다(실제로 끌어보고 발견).
   */
  const swallowClickRef = useRef(false);
  const [editError, setEditError] = useState<string | null>(null);

  /**
   * 이 방에서 `slot` 을 품고 있는 빈 구간의 양끝(둘 다 포함). 슬롯이 이미 예약돼
   * 있으면 null.
   *
   * **부서 필터로 가려진 예약도 벽으로 센다.** 화면에 안 보이는 예약 위에서 선택이
   * 멈추는 것은 분명 어색하지만, 반대로 두면 필터를 걸어둔 사람만 저장 단계에서
   * 조용히 거절당한다 — 벽은 눈에 안 보여도 실재한다.
   */
  function freeRangeAround(roomId: string, slot: number): { min: number; max: number } | null {
    let min = 0;
    let max = slotCount - 1;
    for (const b of bookingsByRoom.get(roomId) ?? []) {
      const s = slotIndexOf(b.start, dayStart, POLICY.slotMinutes);
      const e = slotIndexOf(b.end, dayStart, POLICY.slotMinutes); // [s, e) 반열림
      if (s <= slot && slot < e) return null; // 이미 예약된 자리
      if (e <= slot) min = Math.max(min, e);
      else max = Math.min(max, s - 1);
    }
    return { min, max };
  }

  /* ---- 키보드로 예약하기 ----
   *
   * 격자는 마우스로 끄는 것이 주 인터랙션이라, 그동안 **키보드로는 새 예약을 만들 수
   * 없었다**(빈 슬롯이 <div> 였다). 드래그의 키보드 대체를 "끌기" 로 흉내내지 않고,
   * 주간 뷰와 같은 계약 — **한 칸(30분)을 골라 시작하고 길이는 다이얼로그에서** — 으로
   * 맞췄다. 배울 것이 늘지 않는다.
   */
  const [rovingCell, setRovingCell] = useState<{ roomId: string; slot: number } | null>(null);

  /** 지금 탭으로 진입했을 때 포커스를 받을 칸인지. 아직 아무 데도 안 갔으면 첫 방의 첫 칸. */
  function isRovingCell(roomId: string, slot: number): boolean {
    if (rovingCell) return rovingCell.roomId === roomId && rovingCell.slot === slot;
    const first = visibleRooms[0];
    return first !== undefined && first.id === roomId && slot === 0;
  }

  function focusCell(roomId: string, slot: number) {
    setRovingCell({ roomId, slot });
    // 렌더 후에 실제 DOM 으로 포커스를 옮긴다 — tabIndex 가 먼저 바뀌어야 한다.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        '.grid-col[data-room-id="' + roomId + '"] .grid-slot--cell[data-slot="' + String(slot) + '"]',
      );
      el?.focus();
    });
  }

  function onSlotKeyDown(e: React.KeyboardEvent, roomId: string, slot: number) {
    const roomIndex = visibleRooms.findIndex((r) => r.id === roomId);
    if (e.key === "Enter" || e.key === " ") {
      /*
       * <button> 의 Enter 는 기본적으로 click 을 일으킨다. 슬롯의 click 은 드래그
       * 종료(mouseup) 경로와 겹치므로, 여기서 막고 직접 연다 — 그렇지 않으면 마우스로
       * 끌고 놓았을 때 다이얼로그가 두 번 열린다.
       */
      e.preventDefault();
      if (firstLoad) return;
      const range = freeRangeAround(roomId, slot);
      if (!range) {
        /*
         * 이미 예약된 칸. 조용히 아무 일도 안 하면 "키보드에서는 안 되는구나" 로
         * 읽힌다 — 마우스로 그 자리를 누르면 상세가 열리므로, 키보드도 같은 것을 연다.
         * 두 입력 방식이 같은 곳에서 같은 결과를 낸다.
         */
        const at = slotToDate(slot).getTime();
        const occupying = (bookingsByRoom.get(roomId) ?? []).find(
          (b) => b.start.getTime() <= at && at < b.end.getTime(),
        );
        if (occupying) setDetailBooking(occupying);
        return;
      }
      openBookingDialog(roomId, slotToDate(slot), slotToDate(slot + 1));
      return;
    }
    const move = (dSlot: number, dRoom: number) => {
      e.preventDefault();
      const nextRoom = visibleRooms[Math.min(visibleRooms.length - 1, Math.max(0, roomIndex + dRoom))];
      const nextSlot = Math.min(slotCount - 1, Math.max(0, slot + dSlot));
      if (nextRoom) focusCell(nextRoom.id, nextSlot);
    };
    if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "Home") move(-slot, 0);
    else if (e.key === "End") move(slotCount - 1 - slot, 0);
  }

  /**
   * 지금 이후로 가장 먼저 비어 있는 30분을 찾는다. 목록 보기의 "새 예약" 이 쓴다.
   *
   * 방을 순서대로 보는 것이 아니라 **시각을 먼저 맞춘다** — 같은 시각이면 사이드바
   * 순서(=사용자가 보는 순서)의 첫 방을 고른다. 방부터 훑으면 소회의실 저녁이
   * 대회의실 지금보다 먼저 잡힌다.
   */
  function nextFreeRange(): { roomId: string; start: Date; end: Date } | null {
    /*
     * slotIndexOf 는 **소수**를 돌려준다 — 현재시각 선을 픽셀로 놓기 위한 값이라
     * 그게 맞다. 여기서는 칸 번호가 필요하므로 내림한 뒤 다음 칸으로 넘어간다.
     * 안 그러면 "13:59–14:29" 처럼 30분 격자에 없는 시각이 나온다(실제로 그랬다).
     */
    const startSlot = isToday
      ? Math.max(0, Math.floor(slotIndexOf(now, dayStart, POLICY.slotMinutes)) + 1)
      : 0;
    for (let slot = startSlot; slot < slotCount; slot += 1) {
      for (const room of visibleRooms) {
        if (freeRangeAround(room.id, slot)) {
          return { roomId: room.id, start: slotToDate(slot), end: slotToDate(slot + 1) };
        }
      }
    }
    return null;
  }

  /** 한 방의 다음 빈 30분. 모바일의 방별 "예약" 버튼이 쓴다. */
  function nextFreeRangeInRoom(roomId: string): { start: Date; end: Date } | null {
    const startSlot = isToday
      ? Math.max(0, Math.floor(slotIndexOf(now, dayStart, POLICY.slotMinutes)) + 1)
      : 0;
    for (let slot = startSlot; slot < slotCount; slot += 1) {
      if (freeRangeAround(roomId, slot)) {
        return { start: slotToDate(slot), end: slotToDate(slot + 1) };
      }
    }
    return null;
  }

  function startDrag(roomId: string, slot: number, colTop: number) {
    const range = freeRangeAround(roomId, slot);
    if (!range) return;
    setDrag({ roomId, anchor: slot, current: slot, colTop, minSlot: range.min, maxSlot: range.max });
  }

  function beginEdit(
    booking: Booking,
    mode: "move" | "resize",
    grabOffsetPx: number,
    colTop: number,
  ) {
    const startSlot = slotIndexOf(booking.start, dayStart, POLICY.slotMinutes);
    const endSlot = slotIndexOf(booking.end, dayStart, POLICY.slotMinutes);
    setEditError(null);
    editReleasedRef.current = false;
    setEdit({
      bookingId: booking.id,
      roomId: booking.roomId,
      mode,
      startSlot,
      endSlot,
      grabOffsetPx,
      originStartSlot: startSlot,
      originEndSlot: endSlot,
      colTop,
      targetRoomId: booking.roomId,
    });
  }

  /**
   * 커서 x 좌표가 어느 회의실 열 위인지. 열 밖(시간축·여백)이면 null.
   *
   * DOM 을 직접 재는 이유: 열 폭은 CSS grid 가 정하고(1fr), 사이드바 토글로
   * 열 개수가 바뀐다. JS 에 폭을 따로 계산해 두면 두 값이 갈라져 엉뚱한 방으로
   * 옮겨진다 — placeInGrid 를 단일 좌표 소스로 두는 것과 같은 이유다.
   */
  function roomIdAtClientX(clientX: number): string | null {
    const cols = document.querySelectorAll<HTMLElement>(".grid-col[data-room-id]");
    for (const col of cols) {
      const r = col.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return col.dataset.roomId ?? null;
    }
    return null;
  }

  async function commitEdit(e: EditDragState) {
    const roomChanged = e.targetRoomId !== e.roomId;
    // 움직이지 않았으면 저장하지 않는다 — 클릭 한 번이 왕복 요청이 되지 않게.
    if (e.startSlot === e.originStartSlot && e.endSlot === e.originEndSlot && !roomChanged) {
      setEdit(null);
      return;
    }
    const newStart = slotToDate(e.startSlot);
    const newEnd = slotToDate(e.endSlot);
    try {
      /*
       * 저장 직전 재조회 후 도메인 규칙으로 먼저 판단한다(1·2차 방어).
       * **목적지 방**을 조회한다 — 방을 옮길 때 원래 방으로 검사하면 정작
       * 가려는 방의 충돌을 못 본다.
       */
      const fresh = await repo.listByRoom(e.targetRoomId, newStart);
      const target = fresh.find((b) => b.id === e.bookingId);
      const verdict = canReschedule(
        target ?? { ...(fresh[0] as Booking), id: e.bookingId },
        fresh,
        newStart,
        newEnd,
        POLICY,
        appNow(),
      );
      if (!verdict.ok) {
        setEditError(rescheduleMessage(verdict));
        setEdit(null);
        return;
      }
      const result = await repo.reschedule(
        e.bookingId,
        newStart,
        newEnd,
        roomChanged ? e.targetRoomId : undefined,
      );
      if (!result.ok) {
        setEditError(
          result.reason === "blocked"
            ? "방금 " + result.by + "님이 그 시간을 잡았어요. 다른 시간으로 옮겨주세요."
            : result.message,
        );
      }
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "옮기지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      /*
       * **프리뷰를 먼저 지우지 않는다.**
       *
       * 예전엔 setEdit(null) 을 여기서 바로 부르고 reload() 를 걸었다. 그러면
       * 블록이 (1) 놓는 순간 원래 자리로 튀고 (2) 새 데이터가 오면 다시 옮긴
       * 자리로 튀었다 — 두 번 움직이는 그 왕복이 "애니메이션처럼 줄었다 늘었다" 다.
       *
       * 재조회를 먼저 걸고, 새 데이터가 반영된 뒤(await) 프리뷰를 놓는다.
       * 그러면 블록은 놓인 자리에 그대로 있다가 조용히 진짜 데이터로 바뀐다.
       */
      await bookingsState.reloadAsync();
      setEdit(null);
    }
  }

  useEffect(() => {
    function finalizeDrag() {
      const d = dragRef.current;
      if (!d) return;
      const min = Math.min(d.anchor, d.current);
      const max = Math.max(d.anchor, d.current);
      openBookingDialog(d.roomId, slotToDate(min), slotToDate(max + 1));
      setDrag(null);
    }
    function onMouseUp() {
      const e = editRef.current;
      if (e) {
        editReleasedRef.current = true;
        if (e.startSlot !== e.originStartSlot || e.endSlot !== e.originEndSlot) {
          swallowClickRef.current = true;
        }
        void commitEdit(e);
        return; // 편집 중이던 마우스업은 새 예약 선택으로 이어지지 않는다
      }
      finalizeDrag();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (editRef.current) {
        editReleasedRef.current = true;
        setEdit(null); // 되돌린다 — 저장하지 않는다
        return;
      }
      if (dragRef.current) {
        setDrag(null);
      }
    }
    /*
     * 편집 중 프리뷰는 커서 y 를 슬롯으로 바꿔 계산한다. 열의 top 은 드래그를 시작할 때
     * 재 두었다 — 드래그 도중 격자가 스크롤되면 어긋날 수 있지만, 판이 잠겨 있어
     * (pane 모드) 드래그 중 스크롤이 일어나지 않는다.
     */
    function onMouseMove(ev: MouseEvent) {
      const e = editRef.current;
      if (!e) {
        /*
         * 새 예약 선택 중. 커서를 빈 구간 안에 가둔다 — 다음 예약에 닿으면 거기서 멈추고
         * 더 늘어나지 않는다(Google Calendar·Clockwise 와 같은 동작).
         */
        const d = dragRef.current;
        if (!d) return;
        const raw = Math.floor((ev.clientY - d.colTop) / slotPx);
        const slot = Math.min(d.maxSlot, Math.max(d.minSlot, raw));
        setDrag((cur) => (cur && cur.current !== slot ? { ...cur, current: slot } : cur));
        return;
      }
      if (editReleasedRef.current) return;
      const slot = Math.floor((ev.clientY - e.colTop) / slotPx);
      /*
       * 커서가 어느 회의실 열 위에 있나. 길이 조절(resize)은 방을 바꾸지 않는다 —
       * 아래 끝을 끌다가 옆으로 손이 흔들렸을 때 방이 바뀌면 사고다.
       */
      const roomUnderCursor =
        e.mode === "move" ? roomIdAtClientX(ev.clientX) : null;
      setEdit((cur) => {
        if (!cur) return cur;
        if (cur.mode === "resize") {
          const endSlot = Math.min(slotCount, Math.max(cur.startSlot + 1, slot + 1));
          return endSlot === cur.endSlot ? cur : { ...cur, endSlot };
        }
        const length = cur.endSlot - cur.startSlot;
        /*
         * 블록 위쪽 끝의 px 위치 = 커서 y - 잡은 지점 offset. 그걸 한 번만
         * 반올림해 슬롯으로 바꾼다. 이렇게 해야 "잡은 자리가 손을 따라온다".
         */
        const topPx = ev.clientY - cur.colTop - cur.grabOffsetPx;
        const startSlot = Math.min(
          Math.max(0, Math.round(topPx / slotPx)),
          slotCount - length,
        );
        const targetRoomId = roomUnderCursor ?? cur.targetRoomId;
        if (startSlot === cur.startSlot && targetRoomId === cur.targetRoomId) return cur;
        return { ...cur, startSlot, endSlot: startSlot + length, targetRoomId };
      });
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  function selectionStyle(min: number, max: number): CSSProperties {
    const placement = placeInGrid(slotToDate(min), slotToDate(max + 1), dayStart, POLICY.slotMinutes, slotPx);
    return { top: placement.top, height: placement.height };
  }

  /**
   * 드래그 중 선택 구간의 시간 범위. 사각형만 보이면 지금 몇 시를 잡고 있는지
   * 왼쪽 시간축과 눈으로 맞춰야 한다 — 캘린더 앱은 끄는 동안 시각을 같이 보여준다.
   * 시각 계산은 selectionStyle 과 같은 slotToDate 를 쓴다(두 값이 갈라지지 않게).
   */
  function selectionLabel(min: number, max: number): { text: string; minutes: number } {
    const start = slotToDate(min);
    const end = slotToDate(max + 1);
    return {
      text: hhmm(start) + "–" + hhmm(end),
      minutes: (end.getTime() - start.getTime()) / MINUTE,
    };
  }

  /* ---- now indicator ---- */
  // 순간(점) 이므로 구간을 받는 placeInGrid 대신, 도메인이 제공하는
  // slotIndexOf 로 슬롯 인덱스만 구하고 슬롯 높이를 곱한다.
  const nowSlot = slotIndexOf(now, dayStart, POLICY.slotMinutes);
  const showNowLine = isToday && nowSlot >= 0 && nowSlot <= slotCount;
  const nowTop = nowSlot * slotPx;

  useEffect(() => {
    if (view !== "day" || firstLoad || !showNowLine || autoPositionedTodayRef.current === dayKey) return;
    const frame = requestAnimationFrame(() => {
      const scroll = dayGridScrollRef.current;
      if (!scroll) return;
      autoPositionedTodayRef.current = dayKey;
      if (scroll.scrollHeight <= scroll.clientHeight + 1) return;
      const headerHeight =
        scroll.querySelector<HTMLElement>(".grid-room-header")?.getBoundingClientRect().height ?? 0;
      const lineY = headerHeight + nowTop;
      const visibleTop = scroll.scrollTop + headerHeight + 48;
      const visibleBottom = scroll.scrollTop + scroll.clientHeight - 96;
      if (lineY < visibleTop || lineY > visibleBottom) {
        const desired = lineY - scroll.clientHeight * 0.35;
        scroll.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, desired));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [dayKey, firstLoad, nowTop, showNowLine, view]);

  /* ---- event detail / cancel (모든 뷰 공유) ---- */
  const [detailBooking, setDetailBooking] = useState<Booking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);

  function onDateInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (!v) return;
    const parts = v.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const d = parts[2];
    if (y === undefined || m === undefined || d === undefined) return;
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return;
    setSelectedDate(new Date(y, m - 1, d));
  }

  const gridTemplateColumns =
    "var(--grid-axis-w) repeat(" + String(visibleRooms.length) + ", minmax(var(--grid-col-min), 1fr))";

  return (
    <div className="grid-screen">
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {gridLiveMessage}
      </p>
      {/*
       * 상단은 한 줄이다: 왼쪽에 날짜 이동(현재로 점프 · ‹ › · 큰 제목),
       * 오른쪽에 보기 범위(부서 필터 · 일간/주간/월간).
       * Proton Calendar · Front 의 실제 배치이고, 뷰 스위처를 왼쪽 위에 따로
       * 띄워 두던 것보다 세로를 한 줄 덜 쓴다 — 잠긴 판에서는 그게 격자 높이다.
       * 좁은 화면에서는 자연히 두 줄로 접힌다(flex-wrap).
       */}
      <div className="grid-controlbar">
        {/*
          인원 필터는 없앴다. 두 회의실 모두 정원 제한이 없어서 "N명 들어가는 방"
          이라는 질문 자체가 성립하지 않는다 — 걸러낼 근거가 없는 필터는 아무 방도
          빼지 않으면서 세로 한 줄과 컨트롤 넷을 차지한다.
        */}

        {visibleRooms.length > 0 ? (
          /* 일정 뷰는 일간과 같은 하루를 본다 — 날짜 컨트롤도 같은 것을 쓴다.
             뷰를 바꿀 때 날짜 이동 UI 가 자리를 옮기면 그것부터 다시 찾게 된다. */
          view === "day" || view === "agenda" ? (
            <div className="grid-toolbar mr-row">
              <Button variant="secondary" onClick={() => setSelectedDate(startOfDay(appNow()))}>
                오늘
              </Button>
              {/* 주간·월간과 같은 ‹ › 스테퍼를 쓴다 — 뷰를 바꿔도 날짜 이동 위치가 안 변한다.
                  "내일" 버튼은 ›  하나로 대체됐다. */}
              <div className="grid-datestepper" role="group" aria-label="날짜 이동">
                <button
                  type="button"
                  className="grid-datestepper__btn"
                  onClick={() => setSelectedDate((d) => addDays(d, -1))}
                  aria-label="이전 날"
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <span className="grid-datestepper__divider" aria-hidden="true" />
                <button
                  type="button"
                  className="grid-datestepper__btn"
                  onClick={() => setSelectedDate((d) => addDays(d, 1))}
                  aria-label="다음 날"
                >
                  <span aria-hidden="true">›</span>
                </button>
              </div>
              {/*
                날짜 라벨 자체가 피커다. 네이티브 date input 은 표시 형식을 못 바꾸고
                (2026. 07. 26. 고정) 폭도 커서 툴바를 잡아먹는다. 라벨을 보여주고
                input 을 그 위에 투명하게 덮어 캘린더 앱처럼 "날짜를 눌러 이동" 하게 한다.
                네이티브 피커를 그대로 쓰므로 키보드·모바일 동작은 브라우저 것이다.
              */}
              <span className="grid-datepick">
                <span className="grid-datepick__label grid-topbar__title">{dateLabel}</span>
                <input
                  type="date"
                  className="grid-datepick__input"
                  value={ymd(selectedDate)}
                  onChange={onDateInputChange}
                  aria-label="날짜 선택"
                />
              </span>
            </div>
          ) : view === "week" ? (
            <DateStepper
              onPrev={() => setWeekAnchor((d) => addWeeks(d, -1))}
              onNext={() => setWeekAnchor((d) => addWeeks(d, 1))}
              onToday={() => setWeekAnchor(startOfDay(appNow()))}
              prevLabel="이전 주"
              nextLabel="다음 주"
              todayLabel="이번 주"
              rangeLabel={weekRangeLabel}
            />
          ) : (
            <DateStepper
              onPrev={() => setMonthAnchor((d) => addMonths(d, -1))}
              onNext={() => setMonthAnchor((d) => addMonths(d, 1))}
              onToday={() => setMonthAnchor(startOfMonth(appNow()))}
              prevLabel="이전 달"
              nextLabel="다음 달"
              todayLabel="이번 달"
              rangeLabel={monthLabel}
            />
          )
        ) : null}

        {/*
          부서 필터는 **드롭다운**이다. 칩 네 개를 인라인으로 늘어놓으면 좁은
          폭에서 줄바꿈되며 툴바가 두세 줄로 터진다(440px 에서 실측 194px).
          Jobber 는 필터를 드롭다운 버튼 하나로 접고 켜진 개수만 배지로 보여준다.

          네이티브 <select> 를 쓰는 이유: 부서는 하나만 고르는 값이고,
          키보드·모바일 동작을 브라우저가 이미 정확히 해준다. 커스텀 팝오버를
          만들면 포커스 트랩·외부 클릭·Esc 를 우리가 다시 구현해야 한다.

          자리는 **왼쪽 클러스터**다. 오른쪽에 뒀을 때 부서 필터와 뷰 전환이 한
          덩어리로 보였는데, 둘은 축이 다르다 — 날짜·부서는 "무엇을 보나"(데이터를
          고르는 것)이고 일/주/월·격자/목록은 "어떻게 보나"(같은 데이터를 그리는 방식)다.
          같은 축끼리 붙여 두면 오른쪽 끝은 언제나 뷰 전환 하나만 남는다.
        */}
        {/*
          회의실 토글 — **사이드바가 접히는 폭(<1024px)에서만** 나타난다.
          같은 것을 정하는 컨트롤이 둘이 되는 것 아니냐고 하면, 아니다: 둘은 절대
          동시에 보이지 않고 같은 상태(useRoomVisibility)를 읽고 쓴다. 사이드바가
          숨는 폭에서는 회의실을 켜고 끌 방법이 아예 없었다 — 주간이 켠 방에
          의존하게 되면서 그 구멍이 실제 기능 구멍이 됐다.

          모양은 사이드바와 같은 언어다: 채운 점 = 켜짐, 빈 링 = 꺼짐, 꺼진 것만
          글자가 흐리다. 켜졌다고 파랗게 채우지 않는다(§12-6 — 기본값에 강조를 주지 않는다).
        */}
        {ROOMS.length > 1 ? (
          <div className="grid-roomtoggle" role="group" aria-label="회의실 표시">
            {ROOMS.map((room) => {
              const on = roomVisibility.isVisible(room.id);
              const last = on && visibleRooms.length <= 1;
              return (
                <button
                  key={room.id}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  disabled={last}
                  className={cx("grid-roomtoggle__btn", on && "is-on")}
                  onClick={() => roomVisibility.toggle(room.id)}
                >
                  <span className="grid-roomtoggle__dot" aria-hidden="true" />
                  {room.name}
                </button>
              );
            })}
          </div>
        ) : null}

        {departments.length > 0 ? (
          <>
            <span className="grid-controlbar__divider" aria-hidden="true" />
            <label className="grid-deptselect">
              <span className="grid-deptselect__label">부서</span>
              <select
                className="grid-deptselect__input"
                value={deptFilter ?? ""}
                onChange={(e) => setDeptFilter(e.target.value === "" ? null : e.target.value)}
              >
                <option value="">전체</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <div className="grid-controlbar__right">
          {view === "day" || view === "agenda" ? (
            <Segmented
              items={DAY_MODES}
              active={view === "agenda" ? "agenda" : "day"}
              onChange={setView}
              label="표시 방식"
              small
            />
          ) : null}
          <Segmented
            items={RANGE_TABS}
            active={view === "agenda" ? "day" : view}
            onChange={(id) => setView(id === "day" && view === "agenda" ? "agenda" : id)}
            label="기간 전환"
          />
        </div>
      </div>

      {/*
       * 처음 보는 사람에게 무엇을 하면 되는지 한 줄로 알려준다.
       *
       * 이 화면은 격자만 보여주고 조작 방법을 아무 데도 적어두지 않았다 — 빈 시간을
       * 끌면 예약이 된다는 걸 알아내려면 그냥 해봐야 했다. DESIGN.md §12-1
       * ("처음 보는 사람이 읽고 바로 무엇을 할지 알 수 있게")의 정면 위반이다.
       *
       * 온보딩 투어나 닫기 버튼이 달린 배너를 만들지 않는다: 한 줄이면 되는 설명에
       * 상태(닫았는지 여부)를 저장하기 시작하면 그것부터 고장 난다.
       * 일간 뷰에만 둔다 — 드래그로 예약·이동이 되는 뷰가 여기뿐이다.
       */}
      {view === "day" && visibleRooms.length > 0 ? (
        <p className="grid-hint">
          비어있는 시간을 <b>끌어서</b> 예약하고, 내 예약은 <b>끌어서 옮기거나</b> 아래 끝을 잡아
          시간을 바꿀 수 있어요.
        </p>
      ) : null}

      {prefsState.error ? (
        <div style={{ marginTop: 16 }}>
          <Alert>기본 Zoom 링크를 불러오지 못했어요. 예약 시 Zoom 링크를 직접 입력해 주세요.</Alert>
        </div>
      ) : null}

      {/* 필터 때문에 비었을 때는 원인과 다음 행동을 말한다. 그냥 빈 격자로 두지 않는다. */}
      {/* 드래그 수정이 막혔거나 실패했을 때. 조용히 원래 자리로 되돌리면
          "왜 안 옮겨졌지" 로 남는다 — 사유와 다음 행동을 말한다. */}
      {editError ? (
        <div style={{ marginTop: 16 }}>
          <Alert>
            {editError}{" "}
            <button type="button" className="grid-retry" onClick={() => setEditError(null)}>
              닫기
            </button>
          </Alert>
        </div>
      ) : null}

      {/*
        "옮기는 중…" 문단을 격자 위에 끼워 넣었었다. 그 한 줄이 나타났다 사라지면서
        아래 격자 전체를 밀었다 당겼다 했다 — "화면이 줄었다 늘었다" 의 정체다.
        저장 중이라는 사실은 블록이 제자리에 그대로 있는 것으로 이미 보이고,
        실패하면 아래 Alert 가 사유를 말한다. 레이아웃을 흔드는 상태 표시는 두지 않는다.
      */}

      {deptFilterEmptied ? (
        <div style={{ marginTop: 16 }}>
          <Alert>
            {deptFilter}의 예약이 이 기간엔 없어요. 위의 &ldquo;전체&rdquo;를 누르면 다시 볼 수 있어요.
          </Alert>
        </div>
      ) : null}

      {visibleRooms.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <Alert>
            회의실이 등록되지 않았어요. src/config/rooms.json 을 확인해 주세요.
          </Alert>
        </div>
      ) : view === "day" ? (
        <div>
          {bookingsState.error ? (
            <div style={{ marginTop: 16 }}>
              <Alert>
                {READ_ERROR_MESSAGE}{" "}
                <button type="button" className="grid-retry" onClick={bookingsState.reload}>
                  다시 시도
                </button>
              </Alert>
            </div>
          ) : null}

          {/*
           * 로딩 중에도 .grid-desktop/.grid-scroll/.grid-table 구조를 그대로 유지한다.
           * 예전엔 로딩 중 이 구조 전체를 <p>텍스트로 바꿔치기해서 (a) pane 모드의
           * flex:1 규칙이 .grid-scroll 부재를 보고 꺼져 페이지 높이가 주저앉았다가
           * 데이터가 오면 다시 펴지며 점프했고 (b) 매 뷰 전환마다 격자가 사라졌다 나타났다.
           * 시간축·슬롯 격자선은 원래 데이터와 무관하므로 항상 그리고, 방 이름/예약만
           * 로딩 중엔 중립색 스켈레톤으로 채워 "이미 그 자리에 있던 것처럼" 만든다.
           */}
          <div className="grid-desktop" style={{ marginTop: 16 }}>
            <div className="grid-scroll" ref={dayGridScrollRef}>
              <div className={cx("grid-table", drag && "is-dragging", edit && "is-editing")} style={{ gridTemplateColumns }}>
                <div className="grid-corner" />

                {visibleRooms.map((room) => (
                  <div key={room.id} className="grid-room-header">
                    {firstLoad ? (
                      <>
                        <span className="grid-skeleton-bar" aria-hidden="true" />
                        <span className="grid-skeleton-bar grid-skeleton-bar--sm" aria-hidden="true" />
                      </>
                    ) : (
                      <>
                        <span className="grid-room-header__name">{room.name}</span>
                        <span className="grid-room-header__meta t-cap t-muted">{room.floor}</span>
                      </>
                    )}
                  </div>
                ))}

                <div className="grid-axis">
                  {slotIndices.map((i) => {
                    const label = slotHourLabel(dayStart, i, POLICY.slotMinutes);
                    return (
                      <div
                        key={i}
                        className={cx(
                          "grid-slot",
                          "grid-axis__cell",
                          slotIsHourBoundary(i, POLICY.slotMinutes) ? "grid-slot--hour" : "grid-slot--half",
                        )}
                      >
                        {label ? <span className="t-cap t-num grid-axis__label">{label}</span> : null}
                      </div>
                    );
                  })}
                </div>

                {visibleRooms.map((room) => {
                  const base = firstLoad
                    ? []
                    : (bookingsByRoom.get(room.id) ?? []).filter(
                        (b) =>
                          matchesDept(b) &&
                          b.end.getTime() > dayStart.getTime() &&
                          b.start.getTime() < dayEnd.getTime(),
                      );
                  /*
                   * 방을 옮기는 중이면 블록을 **목적지 열에 그린다.**
                   * 원래 열에 남겨두면 커서는 옆 열에 있는데 블록은 제자리에 있어
                   * "드래그가 안 먹는다" 로 읽힌다 — 실제로 그렇게 보였다.
                   */
                  const movingAway =
                    edit !== null && edit.mode === "move" && edit.targetRoomId !== room.id;
                  const movingHere =
                    edit !== null &&
                    edit.mode === "move" &&
                    edit.targetRoomId === room.id &&
                    edit.roomId !== room.id;
                  const incoming = movingHere
                    ? (bookingsState.data ?? []).filter((b) => b.id === edit.bookingId)
                    : [];
                  const roomBookings = [
                    ...(movingAway ? base.filter((b) => b.id !== edit.bookingId) : base),
                    ...incoming,
                  ];
                  return (
                    <div
                      key={room.id}
                      className={cx(
                        "grid-col",
                        edit !== null &&
                          edit.mode === "move" &&
                          edit.targetRoomId === room.id &&
                          edit.roomId !== room.id &&
                          "is-drop-target",
                      )}
                      data-room-id={room.id}
                    >
                      {slotIndices.map((i) => (
                        <button
                          key={i}
                          type="button"
                          data-room-id={room.id}
                          data-slot={i}
                          /*
                           * roving tabindex — 격자 전체에서 **한 칸만** 탭 대상이다.
                           * 48개 슬롯을 전부 탭 가능하게 두면 키보드 사용자가 격자를
                           * 지나가는 데만 탭을 48번 눌러야 한다. 진입은 한 번, 그 뒤는
                           * 화살표로 움직인다(캘린더 앱의 표준 동작).
                           */
                          tabIndex={isRovingCell(room.id, i) ? 0 : -1}
                          className={cx(
                            "grid-slot",
                            "grid-slot--cell",
                            slotIsHourBoundary(i, POLICY.slotMinutes) ? "grid-slot--hour" : "grid-slot--half",
                          )}
                          aria-label={
                            room.name + " " + hhmm(slotToDate(i)) + " 예약하기"
                          }
                          onFocus={() => setRovingCell({ roomId: room.id, slot: i })}
                          onKeyDown={(e) => onSlotKeyDown(e, room.id, i)}
                          onMouseDown={(e) => {
                            if (firstLoad) return;
                            e.preventDefault();
                            const col = e.currentTarget.parentElement;
                            startDrag(room.id, i, col ? col.getBoundingClientRect().top : 0);
                          }}
                        />
                      ))}

                      {(() => {
                        /*
                         * 드래그 중이면 지금 끌고 있는 구간을, 손을 떼고 다이얼로그가
                         * 열려 있으면 **그 확정된 구간을** 같은 모양으로 계속 그린다.
                         *
                         * 예전엔 mouseup 에서 선택을 바로 지웠다. 그래서 다이얼로그가
                         * 뜨는 순간 배경의 파란 사각형이 사라졌고, 뒤를 확인하려고 보면
                         * 방금 무엇을 골랐는지 격자에 아무 흔적이 없었다 — 다이얼로그의
                         * 시각 표시와 격자를 눈으로 대조할 수가 없었다.
                         */
                        const sel =
                          drag && drag.roomId === room.id
                            ? { min: Math.min(drag.anchor, drag.current), max: Math.max(drag.anchor, drag.current) }
                            : pendingSel && pendingSel.roomId === room.id
                              ? { min: pendingSel.min, max: pendingSel.max }
                              : null;
                        if (firstLoad || !sel) return null;
                        const info = selectionLabel(sel.min, sel.max);
                        return (
                          <div className="grid-selection" style={selectionStyle(sel.min, sel.max)}>
                            <span className="grid-selection__label t-num">{info.text}</span>
                            <span className="grid-selection__dur t-cap">
                              {humanDuration(info.minutes)}
                            </span>
                          </div>
                        );
                      })()}

                      {roomBookings.map((b) => {
                        const beingEdited = edit !== null && edit.bookingId === b.id;
                        /*
                         * 드래그 중인 블록은 저장 전 위치(프리뷰)에 그린다. 서버 응답을
                         * 기다려 그리면 손을 떼고 나서야 움직여 "안 먹었나?" 로 읽힌다.
                         * 프리뷰 좌표도 placeInGrid 로 만든다 — 손으로 계산하면 실제
                         * 저장될 시각과 화면이 갈라진다.
                         */
                        const clippedStart = beingEdited
                          ? slotToDate(edit.startSlot)
                          : b.start.getTime() < dayStart.getTime()
                            ? dayStart
                            : b.start;
                        const clippedEnd = beingEdited
                          ? slotToDate(edit.endSlot)
                          : b.end.getTime() > dayEnd.getTime()
                            ? dayEnd
                            : b.end;
                        const placement = placeInGrid(
                          clippedStart,
                          clippedEnd,
                          dayStart,
                          POLICY.slotMinutes,
                          slotPx,
                        );
                        return (
                          <GridEventBlock
                            key={b.id}
                            booking={
                              beingEdited ? { ...b, start: clippedStart, end: clippedEnd } : b
                            }
                            placement={placement}
                            now={now}
                            onSelect={(bk) => {
                              if (swallowClickRef.current) {
                                swallowClickRef.current = false;
                                return;
                              }
                              setDetailBooking(bk);
                            }}
                            onBeginEdit={(bk, mode, grabOffsetPx, colTop) => {
                              beginEdit(bk, mode, grabOffsetPx, colTop);
                            }}
                            editing={beingEdited}
                          />
                        );
                      })}
                    </div>
                  );
                })}

                {showNowLine && !firstLoad ? (
                  <div className="grid-now" aria-hidden="true">
                    <div className="grid-now__line" style={{ top: nowTop }} />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid-mobile">
            {/*
              QR 이 모바일의 주 진입점이라는 것은 맞지만, 그 말만 적어두고 **예약을 만들
              길을 하나도 두지 않았다.** 복도가 아니라 자리에서 폰으로 여는 경우에도
              방을 잡을 수 있어야 한다. 방마다 "예약" 을 두고, 화면이 다음 빈 30분을
              골라준다 — 좁은 화면에서 시간을 끌어 고르게 하지 않는다.
            */}
            <p className="t-cap grid-mobile__hint">
              회의실 문에 붙은 QR 을 스캔하면 그 자리에서 바로 예약·체크인할 수 있어요.
            </p>
            {visibleRooms.map((room) => {
              const roomBookings = firstLoad
                ? []
                : (bookingsByRoom.get(room.id) ?? []).filter(matchesDept);
              const free = firstLoad ? null : nextFreeRangeInRoom(room.id);
              return (
                <section key={room.id} className="grid-mobile__room">
                  <header className="grid-mobile__room-head">
                    <span className="t-body grid-mobile__room-name">{room.name}</span>
                    <span className="t-cap t-muted">{room.floor}</span>
                    {/* 비활성 사유를 상시 노출한다 — 오늘 남은 빈 시간이 없을 때 (DESIGN.md §4) */}
                    <ButtonWithReason
                      variant="secondary"
                      onClick={() => {
                        if (free) openBookingDialog(room.id, free.start, free.end);
                      }}
                      disabled={free === null}
                      reason={free === null && !firstLoad ? "오늘은 남은 시간이 없어요" : null}
                    >
                      {free ? hhmm(free.start) + " 예약" : "예약"}
                    </ButtonWithReason>
                  </header>
                  {firstLoad ? (
                    <div className="grid-skeleton-card" aria-hidden="true" />
                  ) : roomBookings.length === 0 ? (
                    <p className="t-small t-muted">오늘 예약이 없어요</p>
                  ) : (
                    <div className="mr-stack">
                      {roomBookings.map((b) => (
                        /*
                         * 카드가 눌리지 않아서, 모바일에서는 **내 예약도 취소·체크인할 수
                         * 없었다.** 격자에서 블록을 누르는 것과 같은 상세를 연다.
                         */
                        <button
                          key={b.id}
                          type="button"
                          className={cx("grid-mobile__item", b.isMine && "grid-mobile__item--mine")}
                          onClick={() => setDetailBooking(b)}
                        >
                          <span className="mr-row" style={{ justifyContent: "space-between" }}>
                            <span className="t-small grid-mobile__organizer">{b.organizerName}</span>
                            <span className="t-small t-num grid-mobile__time">
                              {hhmm(b.start)}–{hhmm(b.end)}
                            </span>
                          </span>
                          {isNoShow(b, now, POLICY.checkInGraceMinutes) ? (
                            <span style={{ marginTop: 6, display: "inline-flex" }}>
                              <Badge tone="attn">미체크인</Badge>
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      ) : view === "agenda" ? (
        <AgendaView
          bookings={(bookingsState.data ?? []).filter(matchesDept)}
          group={agendaGroup}
          onGroupChange={setAgendaGroup}
          visibleRooms={visibleRooms}
          loading={firstLoad}
          now={now}
          onSelectBooking={setDetailBooking}
          onCreate={() => {
            const next = nextFreeRange();
            if (next) openBookingDialog(next.roomId, next.start, next.end);
            else setEditError("오늘은 남은 빈 시간이 없어요. 다른 날짜를 골라주세요.");
          }}
        />
      ) : view === "week" ? (
        <WeekView
          visibleRooms={visibleRooms}
          weekStart={weekStart}
          bookings={weekBookings}
          loading={weekState.loading}
          error={weekState.error}
          onReload={weekState.reload}
          matchesDept={matchesDept}
          slotPx={slotPx}
          now={now}
          onSelectBooking={setDetailBooking}
          onCreate={(roomId, start, end) => setDialogRange({ roomId, start, end })}
        />
      ) : (
        <MonthView
          monthAnchor={monthAnchor}
          bookings={monthState.data ?? []}
          loading={monthState.loading}
          error={monthState.error}
          onReload={monthState.reload}
          visibleRooms={visibleRooms}
          matchesDept={matchesDept}
          onSelectDate={(d) => {
            setSelectedDate(startOfDay(d));
            setView("day");
          }}
          onSelectBooking={setDetailBooking}
          now={now}
        />
      )}

      {dialogRange ? (
        <BookingDialog
          roomId={dialogRange.roomId}
          start={dialogRange.start}
          end={dialogRange.end}
          prefs={prefsState.data ?? { defaultZoomUrl: null }}
          onClose={closeBookingDialog}
          onCreated={() => {
            closeBookingDialog();
            bookingsState.reload();
            weekState.reload();
            monthState.reload();
          }}
        />
      ) : null}

      {detailBooking ? (
        <EventDetail
          booking={detailBooking}
          room={roomById(detailBooking.roomId)}
          now={now}
          onClose={() => setDetailBooking(null)}
          onChanged={() => {
            setDetailBooking(null);
            bookingsState.reload();
            weekState.reload();
            monthState.reload();
          }}
          onRefresh={() => {
            bookingsState.reload();
            weekState.reload();
            monthState.reload();
          }}
          onCancelRequested={(b) => {
            setDetailBooking(null);
            setCancelTarget(b);
          }}
        />
      ) : null}

      {cancelTarget ? (
        <CancelConfirmDialog
          booking={cancelTarget}
          room={roomById(cancelTarget.roomId)}
          onClose={() => setCancelTarget(null)}
          onCanceled={() => {
            setCancelTarget(null);
            bookingsState.reload();
            weekState.reload();
            monthState.reload();
          }}
        />
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* 격자 이벤트 블록 — 일간·주간 뷰가 공유한다 (동일한 마크업/동작). */

function GridEventBlock({
  booking,
  placement,
  now,
  onSelect,
  onBeginEdit,
  editing = false,
}: {
  booking: Booking;
  placement: GridPlacement;
  now: Date;
  onSelect: (booking: Booking) => void;
  /**
   * 내 예약을 드래그로 옮기거나 길이를 바꾸기 시작한다. 넘기지 않으면(주간 뷰 등)
   * 드래그 수정이 꺼진다 — 주간 뷰는 하루 폭이 좁아 옮길 곳을 조준하기 어렵다.
   */
  onBeginEdit?: (
    booking: Booking,
    mode: "move" | "resize",
    grabOffsetPx: number,
    colTop: number,
  ) => void;
  /** 지금 이 블록을 끌고 있는지 — 커서·그림자로 "들려 있음" 을 표시한다 */
  editing?: boolean;
}) {
  const noShow = isNoShow(booking, now, POLICY.checkInGraceMinutes);
  const compact = placement.slots <= 1;
  const editable = booking.isMine && onBeginEdit !== undefined;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={booking.organizerName + " " + hhmm(booking.start) + "~" + hhmm(booking.end)}
      className={cx(
        "grid-event",
        booking.isMine ? "grid-event--mine" : "grid-event--other",
        editable && "grid-event--editable",
        editing && "is-editing",
      )}
      style={{ top: placement.top, height: placement.height }}
      onMouseDown={
        editable
          ? (e) => {
              // 슬롯의 mousedown(새 예약 선택 시작)까지 올라가지 않게 막는다
              e.stopPropagation();
              e.currentTarget.focus();
              e.preventDefault();
              /*
               * 잡은 지점을 **px 로** 넘긴다.
               *
               * 예전엔 여기서 슬롯 단위로 내림(floor)했다. 그러면 슬롯 한가운데를
               * 잡아도 "슬롯 맨 위를 잡은 것" 으로 취급돼, 첫 mousemove 에서
               * 블록이 최대 한 슬롯만큼 튀어 올랐다 — "처음 잡고 움직이는 게
               * 어색하다" 의 정체다. 반올림은 최종 슬롯을 정할 때 한 번만 한다.
               */
              const grabOffsetPx = Math.max(0, e.nativeEvent.offsetY);
              const col = e.currentTarget.parentElement;
              onBeginEdit(booking, "move", grabOffsetPx, col ? col.getBoundingClientRect().top : 0);
            }
          : undefined
      }
      onClick={() => onSelect(booking)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(booking);
        }
      }}
    >
      {compact ? (
        <div className="grid-event__compact">
          <span className="grid-event__name">{booking.organizerName}</span>
          {noShow ? (
            <Badge tone="attn">미체크인</Badge>
          ) : (
            <span className="grid-event__time t-num">
              {hhmm(booking.start)}–{hhmm(booking.end)}
            </span>
          )}
        </div>
      ) : (
        <div className="grid-event__full">
          <div className="grid-event__row">
            <span className="grid-event__name">{booking.organizerName}</span>
            {noShow ? <Badge tone="attn">미체크인</Badge> : null}
          </div>
          <span className="grid-event__time t-cap t-num">
            {hhmm(booking.start)}–{hhmm(booking.end)}
          </span>
        </div>
      )}

      {/*
        아래 끝 손잡이. 블록 전체는 "옮기기" 라서 길이 조절에는 별도 잡을 곳이 필요하다.
        키보드 사용자는 이 손잡이가 아니라 상세 다이얼로그의 ±15분 버튼을 쓴다 —
        그래서 aria-hidden 이고 tabIndex 도 주지 않는다(같은 일을 하는 접근 가능한
        경로가 이미 있다).
      */}
      {editable ? (
        <span
          className="grid-event__resize"
          aria-hidden="true"
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const col = e.currentTarget.parentElement?.parentElement;
            onBeginEdit(booking, "resize", 0, col ? col.getBoundingClientRect().top : 0);
          }}
        />
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* 주간 뷰 — 시간 x (요일 x 회의실). placeInGrid 는 그대로 재사용하고
 * 축이 회의실에서 요일로 바뀔 뿐이다. 각 요일 열의 dayStart 만 그 날짜로 넘긴다.
 *
 * 켜 둔 방이 둘 이상이면 요일 열을 방 수만큼 쪼개고 헤더를 2단으로 만든다
 * (1단 = 요일·날짜, 2단 = 방 약칭). 한 방만 켜져 있으면 쪼갤 것이 없으므로
 * 헤더도 1단으로 둔다 — 같은 약칭이 7번 반복되는 줄은 정보가 아니라 소음이다. */

function WeekView({
  visibleRooms,
  weekStart,
  bookings,
  loading,
  error,
  onReload,
  matchesDept,
  slotPx,
  now,
  onSelectBooking,
  onCreate,
}: {
  visibleRooms: readonly Room[];
  weekStart: Date;
  bookings: Booking[];
  loading: boolean;
  error: Error | null;
  onReload: () => void;
  matchesDept: (b: Booking) => boolean;
  slotPx: number;
  now: Date;
  onSelectBooking: (b: Booking) => void;
  /**
   * 빈 칸을 눌러 새 예약을 만든다. 주간 뷰는 하루 폭이 좁아 **드래그 선택을 두지 않는다**
   * — 대신 한 칸(30분)을 눌러 시작하고, 길이는 다이얼로그에서 정한다. 이게 없던 동안
   * 주간 뷰에서는 빈 칸을 아무리 끌거나 눌러도 아무 일도 일어나지 않았다.
   */
  onCreate: (roomId: string, start: Date, end: Date) => void;
}) {
  const slotCount = gridSlotCount(POLICY);
  const slotIndices = useMemo(() => Array.from({ length: slotCount }, (_, i) => i), [slotCount]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const axisDayStart = useMemo(() => gridDayStart(weekStart, POLICY), [weekStart]);
  const today = useMemo(() => startOfDay(now), [now]);

  /*
   * 모바일에서는 슬롯을 44px 로 유지한다. 24px 짜리 30분 블록은 손가락으로 누를 수 없다.
   * 주간 뷰를 일간처럼 리스트로 무너뜨리지 않는 이유는 이 화면의 목적이
   * "요일별로 같은 시간대가 비는 패턴" 을 보는 것이라 격자가 곧 정보이기 때문이다.
   *
   * 이 숫자는 JS 가 정하고 CSS 변수로 내려보낸다. CSS 에서 따로 바꾸면
   * placeInGrid 가 쓰는 값과 갈라져 이벤트가 엉뚱한 시간에 그려진다.
   */
  const isNarrow = useIsNarrow();
  const weekSlotPx = isNarrow ? Math.max(slotPx, 44) : slotPx;

  // --grid-slot-h 를 인라인으로 내려준다. placeInGrid 에 넘기는 weekSlotPx 와
  // 같은 숫자여야 CSS 행 높이와 이벤트 좌표가 갈라지지 않는다.
  const roomCount = Math.max(1, visibleRooms.length);
  const split = roomCount > 1;

  /*
   * 방을 쪼개면 열이 7개에서 7xN 개가 된다. 열 하한을 그대로 두면(160px) 방 둘에
   * 1120px 이 되어 1440px 창에서도 가로 스크롤이 생긴다 — 주간의 목적은 "요일별
   * 패턴을 한눈에" 라서 가로 스크롤이 그 목적을 정면으로 깎는다. 쪼갠 열은 하한을
   * 낮춰(88px) 방 둘까지는 스크롤 없이 들어가게 한다. 대신 그 폭에는 시각을 함께
   * 못 넣으므로 블록은 이름만 그린다(GridEventBlock 이 폭이 아니라 높이로 판단하던
   * 것과 별개로, 여기서는 열 폭이 이미 좁다는 사실을 CSS 가 말줄임으로 처리한다).
   */
  const weekScrollStyle = {
    marginTop: 16,
    "--grid-slot-h": String(weekSlotPx) + "px",
    // 좁은 화면은 어차피 가로 스크롤이므로 열을 더 좁히지 않는다 — 손가락으로 누를 폭이 먼저다
    /*
     * 열 하한. `minmax(하한, 1fr)` 이므로 폭이 남으면 열은 알아서 늘어난다 —
     * 이 값은 "여기부터는 가로 스크롤" 을 정하는 바닥이다.
     *
     * 쪼갠 열의 바닥을 76px 로 뒀더니 1024px 창(사이드바가 켜지는 첫 폭)에서
     * 가로 스크롤 394px 이 생겼다: 가용 685px / 14열 = 48.9px 밖에 안 된다.
     * 76px 은 "1440px 에서 스크롤이 안 생기는 값" 이었지 바닥이어야 할 이유가
     * 없었다 — 1440px 에서는 1fr 이 알아서 78px 로 늘린다.
     *
     * 바닥은 44px 로 내린다(터치 타깃 하한이자, 좌측 4px 막대 + 여백을 빼고도
     * 이름 두 글자가 남는 최소). 그러면 1024px 에서도 48.9px 씩 들어가 스크롤이
     * 사라진다. 좁은 화면은 반대로 96px 을 유지한다 — 거기서는 7일을 다 보는 것보다
     * 손가락으로 누를 수 있는 것이 먼저고, 가로 스크롤이 원래 그 뷰의 동작이다.
     */
    "--grid-week-col-min": isNarrow ? (split ? "96px" : "108px") : split ? "44px" : "132px",
  } as CSSProperties;

  const gridTemplateColumns =
    "var(--grid-axis-w) repeat(" + String(7 * roomCount) + ", minmax(var(--grid-week-col-min), 1fr))";

  return (
    <div>
      {error ? (
        <div style={{ marginTop: 16 }}>
          <Alert>
            {READ_ERROR_MESSAGE}{" "}
            <button type="button" className="grid-retry" onClick={onReload}>
              다시 시도
            </button>
          </Alert>
        </div>
      ) : null}

      {/*
       * 주간 뷰는 드래그 수정이 꺼져 있다 — 하루 폭이 좁아 옮길 곳을 조준하기
       * 어렵기 때문이다(의도된 제약). 그런데 그 사실을 아무 데도 적어두지 않아서,
       * 일간에서 끌어 옮기는 걸 배운 사람이 주간에서 시도하면 "고장났다" 로 읽혔다.
       * 비활성 컨트롤의 사유를 상시 노출한다는 규칙(§10)이 뷰 단위에도 적용된다.
       * 그래서 **되는 경로를 함께** 알려준다.
       */}
      <p className="grid-hint">
        빈 칸을 <b>누르면</b> 그 시간으로 예약돼요. 끌어서 옮기는 건 일간 보기에서 할 수 있어요.
      </p>

      {/* .grid-scroll 은 항상 마운트한다 — 로딩 중에만 사라지면 pane 모드의
       * flex:1 sizing 이 꺼졌다 켜지며 스크롤 위치와 페이지 높이가 튄다(day 뷰와 동일 이유). */}
      <div className={cx("grid-scroll", "grid-week", split && "grid-week--split")} style={weekScrollStyle}>
        <div className="grid-table" style={{ gridTemplateColumns }}>
          {/* 헤더가 2단이면 모서리도 2단을 덮어야 시간축 위가 뚫리지 않는다 */}
          <div className={cx("grid-corner", split && "grid-corner--tall")} />

          {weekDays.map((day, i) => (
            <div
              key={i}
              className={cx(
                "grid-room-header",
                "grid-week-day",
                sameYMD(day, today) && "grid-room-header--today",
              )}
              style={{ gridColumn: "span " + String(roomCount) }}
            >
              {loading ? (
                <>
                  <span className="grid-skeleton-bar" aria-hidden="true" />
                  <span className="grid-skeleton-bar grid-skeleton-bar--sm" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span className="grid-room-header__name">{WEEKDAY_LABELS[i]}</span>
                  <span className="grid-room-header__meta t-cap t-num">
                    {new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(day)}
                  </span>
                </>
              )}
            </div>
          ))}

          {/* 2단 헤더 — 요일 아래에 방 약칭. 방이 하나면 그리지 않는다. */}
          {split
            ? weekDays.map((day, i) =>
                visibleRooms.map((room) => (
                  <div
                    key={String(i) + ":" + room.id}
                    className={cx(
                      "grid-week-room",
                      room.id === visibleRooms[0]?.id && i > 0 && "grid-week-room--daystart",
                      sameYMD(day, today) && "grid-week-room--today",
                    )}
                    title={room.name}
                  >
                    {room.short}
                  </div>
                )),
              )
            : null}

          <div className="grid-axis">
            {slotIndices.map((i) => {
              const label = slotHourLabel(axisDayStart, i, POLICY.slotMinutes);
              return (
                <div
                  key={i}
                  className={cx(
                    "grid-slot",
                    "grid-axis__cell",
                    slotIsHourBoundary(i, POLICY.slotMinutes) ? "grid-slot--hour" : "grid-slot--half",
                  )}
                >
                  {label ? <span className="t-cap t-num grid-axis__label">{label}</span> : null}
                </div>
              );
            })}
          </div>

          {weekDays.map((day, i) => {
            const dStart = gridDayStart(day, POLICY);
            const dEnd = new Date(dStart.getTime() + slotCount * POLICY.slotMinutes * MINUTE);
            const dayLabel = new Intl.DateTimeFormat("ko-KR", {
              month: "numeric",
              day: "numeric",
            }).format(day);

            return visibleRooms.map((room, r) => {
              const colBookings = loading
                ? []
                : bookings.filter(
                    (b) =>
                      b.roomId === room.id &&
                      matchesDept(b) &&
                      b.end.getTime() > dStart.getTime() &&
                      b.start.getTime() < dEnd.getTime(),
                  );
              return (
                <div
                  key={String(i) + ":" + room.id}
                  /* 방 사이는 얇은 선, 요일 사이는 진한 선 — 그래야 스캔 중에
                   * "이 열이 어느 날의 어느 방인지" 가 유지된다 */
                  className={cx("grid-col", r === visibleRooms.length - 1 && "grid-col--dayend")}
                >
                  {slotIndices.map((s) => {
                    const slotStart = new Date(dStart.getTime() + s * POLICY.slotMinutes * MINUTE);
                    return (
                      <button
                        key={s}
                        type="button"
                        className={cx(
                          "grid-slot",
                          "grid-slot--clickable",
                          slotIsHourBoundary(s, POLICY.slotMinutes) ? "grid-slot--hour" : "grid-slot--half",
                        )}
                        aria-label={dayLabel + " " + hhmm(slotStart) + " " + room.name + " 예약하기"}
                        onClick={() =>
                          onCreate(
                            room.id,
                            slotStart,
                            new Date(slotStart.getTime() + POLICY.slotMinutes * MINUTE),
                          )
                        }
                      />
                    );
                  })}

                  {colBookings.map((b) => {
                    const clippedStart = b.start.getTime() < dStart.getTime() ? dStart : b.start;
                    const clippedEnd = b.end.getTime() > dEnd.getTime() ? dEnd : b.end;
                    const placement = placeInGrid(
                      clippedStart,
                      clippedEnd,
                      dStart,
                      POLICY.slotMinutes,
                      weekSlotPx,
                    );
                    return (
                      <GridEventBlock
                        key={b.id}
                        booking={b}
                        placement={placement}
                        now={now}
                        onSelect={onSelectBooking}
                      />
                    );
                  })}
                </div>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 월간 뷰 — 밀도를 낮춘 개요. 시간 격자를 그리지 않는다.
 * 날짜마다 예약 건수와 회의실별 점유 정도(중립색 막대)만 보여준다. */

function MonthView({
  monthAnchor,
  bookings,
  loading,
  error,
  onReload,
  visibleRooms,
  matchesDept,
  onSelectDate,
  onSelectBooking,
  now,
}: {
  monthAnchor: Date;
  bookings: Booking[];
  loading: boolean;
  error: Error | null;
  onReload: () => void;
  visibleRooms: readonly Room[];
  matchesDept: (b: Booking) => boolean;
  onSelectDate: (d: Date) => void;
  /** 월간에서도 예약을 눌러 상세(시간 변경·취소)를 연다 */
  onSelectBooking: (b: Booking) => void;
  now: Date;
}) {
  const today = useMemo(() => startOfDay(now), [now]);

  const cells = useMemo(() => {
    const firstCell = startOfWeek(monthAnchor);
    const lastOfMonth = addDays(addMonths(monthAnchor, 1), -1);
    const trailing = (lastOfMonth.getDay() + 6) % 7;
    const lastCell = addDays(lastOfMonth, 6 - trailing);
    const totalDays = Math.round((lastCell.getTime() - firstCell.getTime()) / (24 * 60 * MINUTE)) + 1;
    return Array.from({ length: totalDays }, (_, i) => addDays(firstCell, i));
  }, [monthAnchor]);

  return (
    <div>
      {error ? (
        <div style={{ marginTop: 16 }}>
          <Alert>
            {READ_ERROR_MESSAGE}{" "}
            <button type="button" className="grid-retry" onClick={onReload}>
              다시 시도
            </button>
          </Alert>
        </div>
      ) : null}

      {/* 월간 개요도 격자와 같은 원칙 — 셀 프레임(요일 헤딩 + 7xN 칸)은 데이터와 무관하니
       * 항상 그리고, 로딩 중엔 건수/막대 대신 중립색 스켈레톤만 채워 높이 점프를 없앤다. */}
      <div className="grid-month" style={{ marginTop: 16 }}>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="grid-month__weekday t-cap t-muted">
            {label}
          </div>
        ))}

        {loading
          ? cells.map((d) => (
              <div key={ymd(d)} className="grid-month__cell grid-month__cell--skeleton" aria-hidden="true">
                <span className="grid-skeleton-bar grid-skeleton-bar--sm" />
              </div>
            ))
          : cells.map((d) => {
            const inMonth = d.getMonth() === monthAnchor.getMonth();
            const cellStart = startOfDay(d);
            const cellEnd = addDays(cellStart, 1);
            const cellBookings = bookings.filter(
              (b) =>
                matchesDept(b) &&
                visibleRooms.some((r) => r.id === b.roomId) &&
                b.end.getTime() > cellStart.getTime() &&
                b.start.getTime() < cellEnd.getTime(),
            );


            return (
              /*
               * 칸 전체가 <button> 이었다. 그래서 안의 일정 칩을 누를 수 있게 만들 수가
               * 없었다(버튼 안에 버튼은 넣지 못한다) — 월간에서는 내 회의를 눌러도
               * 상세가 열리지 않고 그날로 이동만 됐다.
               *
               * 칸을 <div> 로 내리고, 그 안에 **날짜 숫자 버튼**(그날로 이동)과
               * **칩 버튼**(그 예약 상세)을 나란히 둔다. 중첩이 사라지고 키보드로도
               * 둘 다 닿는다. 칸 빈 곳 클릭은 마우스 편의로 남긴다.
               */
              <div
                key={ymd(d)}
                className={cx(
                  "grid-month__cell",
                  !inMonth && "grid-month__cell--outside",
                  sameYMD(d, today) && "grid-month__cell--today",
                )}
                onClick={() => onSelectDate(d)}
              >
                <button
                  type="button"
                  className="grid-month__daynum t-num"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDate(d);
                  }}
                  aria-label={
                    String(d.getMonth() + 1) +
                    "월 " +
                    String(d.getDate()) +
                    "일 열기 · 예약 " +
                    String(cellBookings.length) +
                    "건"
                  }
                >
                  {d.getDate()}
                </button>
                {/*
                  건수 + 회색 막대만 보여주면 "그날 뭐가 있는지" 를 알 수 없다.
                  캘린더 월간 뷰는 일정 자체를 보여준다 — 시각 · 방 약칭 · 주최자.
                  칸에 들어가는 만큼(3개)만 그리고 나머지는 "+N" 으로 접는다.
                */}
                {cellBookings.length > 0 ? (
                  <span className="grid-month__events">
                    {cellBookings
                      .slice()
                      .sort((x, y) => x.start.getTime() - y.start.getTime())
                      .slice(0, MONTH_CHIP_LIMIT)
                      .map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          className={cx("grid-month__chip", b.isMine && "grid-month__chip--mine")}
                          onClick={(e) => {
                            e.stopPropagation(); // 칸의 "그날로 이동" 이 함께 일어나지 않게
                            onSelectBooking(b);
                          }}
                          aria-label={
                            hhmm(b.start) + " " + b.organizerName + " 예약 상세 보기"
                          }
                        >
                          <span className="grid-month__chip-time t-num">{hhmm(b.start)}</span>
                          <span className="grid-month__chip-room">
                            {roomById(b.roomId)?.short ?? ""}
                          </span>
                          <span className="grid-month__chip-name">{b.organizerName}</span>
                        </button>
                      ))}
                    {cellBookings.length > MONTH_CHIP_LIMIT ? (
                      <span className="grid-month__more t-cap">
                        +{cellBookings.length - MONTH_CHIP_LIMIT}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            );
            })}
      </div>
    </div>
  );
}

/* ================================================================== */

function EventDetail({
  booking,
  room,
  now,
  onClose,
  onChanged,
  onRefresh,
  onCancelRequested,
}: {
  booking: Booking;
  room: Room | null;
  now: Date;
  onClose: () => void;
  onChanged: () => void;
  /** 다이얼로그를 닫지 않고 목록만 새로 읽는다 (체크인처럼 창을 유지해야 하는 동작) */
  onRefresh: () => void;
  onCancelRequested: (booking: Booking) => void;
}) {
  const [busyKind, setBusyKind] = useState<"extend" | "shorten" | "checkin" | null>(null);
  const [extendReason, setExtendReason] = useState<string | null>(null);
  const [checkedInAt, setCheckedInAt] = useState<Date | null>(booking.checkedInAt);
  const [actionError, setActionError] = useState<string | null>(null);

  /*
   * ±15분 연장 컨트롤의 지오메트리. DESIGN.md §4:
   * compact(36px)는 데스크톱 격자 인접 컨텍스트 전용이고, "모바일의 같은 연장 컨트롤은
   * Compact 가 아니라 Secondary(44px)를 쓴다 — 36px 는 터치 타깃 하한을 밑돈다".
   * 이 다이얼로그는 데스크톱 격자뿐 아니라 모바일 주간 뷰에서도 열리므로 폭에 따라 바꾼다.
   */
  const isNarrow = useIsNarrow();
  const extendVariant = isNarrow ? "secondary" : "compact-quiet";

  // 방금 이 창에서 체크인했다면 배지도 함께 내려간다 — booking 은 갱신되지 않는 스냅샷이다.
  const noShow = isNoShow({ ...booking, checkedInAt }, now, POLICY.checkInGraceMinutes);
  const canShortenNow = canShorten(booking, POLICY.extendStepMinutes, POLICY.slotMinutes);
  const meetingStarted = now.getTime() >= booking.start.getTime();
  const meetingEnded = now.getTime() >= booking.end.getTime();
  const durationMin = (booking.end.getTime() - booking.start.getTime()) / MINUTE;

  async function handleExtend() {
    setBusyKind("extend");
    setExtendReason(null);
    setActionError(null);
    try {
      // 연장 직전 재조회 — 오래된 화면 상태로 판단하면 조용히 이중 예약이 된다
      const fresh = await repo.listByRoom(booking.roomId, booking.start);
      const result = canExtend(booking, fresh, POLICY.extendStepMinutes, POLICY);
      if (!result.ok) {
        if (result.reason === "blocked") {
          setExtendReason(hhmm(result.blockedBy.start) + "에 " + result.blockedBy.organizerName + "님 예약 있음");
        } else {
          setExtendReason("한 번에 " + humanDuration(result.maxMinutes) + "까지 예약할 수 있어요");
        }
        return;
      }
      const changed = await repo.changeEnd(booking.id, result.newEnd);
      if (!changed.ok) {
        if (changed.reason === "blocked") {
          setExtendReason(changed.by + "님이 이 시간을 막고 있어요");
        } else {
          setActionError(changed.message);
        }
        return;
      }
      onChanged();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "연장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusyKind(null);
    }
  }

  /*
   * 체크인은 지금까지 QR 랜딩에만 있었다. 문 앞에 서 있는 사람에게는 그게 맞지만,
   * 자리에서 노트북으로 회의에 참석하는 경우(화상회의·다른 층)에는 체크인할 길이
   * 아예 없어서 "미체크인" 배지가 계속 붙어 있었다. 같은 repo.checkIn 을 이 화면에서도 부른다.
   */
  async function handleCheckIn() {
    setBusyKind("checkin");
    setActionError(null);
    try {
      await repo.checkIn(booking.id);
      /*
       * 체크인은 **다이얼로그를 닫지 않는다.** 연장·단축과 달리 눈에 보이는 변화가
       * 격자에 거의 없어서(막대 길이가 안 바뀐다), 창이 그냥 사라지면 됐는지 알 수 없다.
       * 완료 시각을 그 자리에 남기고, 목록만 조용히 새로 읽는다.
       *
       * booking 은 부모가 넘긴 스냅샷이라 재조회로 갱신되지 않는다 — 그래서 성공한
       * 쓰기의 결과를 여기서 들고 있는다.
       */
      setCheckedInAt(appNow());
      onRefresh();
    } catch (e: unknown) {
      setActionError(
        e instanceof Error ? e.message : "체크인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBusyKind(null);
    }
  }

  async function handleShorten() {
    setBusyKind("shorten");
    setActionError(null);
    try {
      const newEnd = new Date(booking.end.getTime() - POLICY.extendStepMinutes * MINUTE);
      const changed = await repo.changeEnd(booking.id, newEnd);
      if (!changed.ok) {
        setActionError(changed.reason === "blocked" ? changed.by + "님이 이 시간을 막고 있어요" : changed.message);
        return;
      }
      onChanged();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "단축 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusyKind(null);
    }
  }

  const subtitle =
    (room?.name ?? booking.roomId) +
    " · " +
    hhmm(booking.start) +
    "–" +
    hhmm(booking.end) +
    " (" +
    humanDuration(durationMin) +
    ")";

  return (
    <Dialog
      title="예약 정보"
      subtitle={subtitle}
      onClose={onClose}
      /* 파괴적 동작(예약 취소)을 안전한 기본 동작(닫기)에서 떨어뜨린다.
         같은 생김새로 나란히 두면 "닫기"인 줄 알고 예약을 지운다 —
         빨강(글자)과 거리를 둘 다 쓴다(DESIGN.md §4). */
      actionsLayout={booking.isMine ? "split" : "end"}
      actions={
        <>
          {booking.isMine ? (
            <Button variant="danger" onClick={() => onCancelRequested(booking)}>
              예약 취소
            </Button>
          ) : null}
          <Button onClick={onClose}>닫기</Button>
        </>
      }
    >
      {actionError ? (
        <div style={{ marginTop: 16 }}>
          <Alert>{actionError}</Alert>
        </div>
      ) : null}

      <div className="mr-stack" style={{ marginTop: 16 }}>
        <div className="mr-row" style={{ justifyContent: "space-between" }}>
          <span className="t-body" style={{ fontWeight: 600 }}>
            {booking.organizerName}
          </span>
          {noShow ? (
            <Badge tone="attn">미체크인</Badge>
          ) : booking.isMine ? (
            <Badge tone="mine">내 예약</Badge>
          ) : null}
        </div>

        {/* 인원(모이는 사람)과 초대(알림 받는 사람)는 다른 값이다 */}
        <p className="t-small t-muted">
          인원 {booking.headcount}명
          {booking.attendeeCount > 0 ? " · 초대 " + String(booking.attendeeCount) + "명" : null}
        </p>

        {booking.conference ? (
          booking.conference.url ? (
            <a className="t-small" href={booking.conference.url} target="_blank" rel="noreferrer">
              {booking.conference.kind === "meet" ? "Google Meet 링크 열기" : "Zoom 링크 열기"}
            </a>
          ) : (
            <p className="t-small t-muted">Google Meet 링크는 회의 시작 시 자동으로 생겨요</p>
          )
        ) : (
          <p className="t-small t-muted">화상회의 링크가 없어요</p>
        )}

        {booking.isMine && !meetingEnded ? (
          checkedInAt ? (
            <p className="t-small">체크인 완료 · {hhmm(checkedInAt)}</p>
          ) : (
            /* 시작 전에는 누를 수 없다. 숨기지 않고 **언제부터 되는지**를 적는다 —
               비활성 컨트롤은 사유를 상시 노출한다(DESIGN.md §4·§10). */
            <ButtonWithReason
              variant="secondary"
              onClick={handleCheckIn}
              disabled={!meetingStarted || busyKind !== null}
              reason={!meetingStarted ? hhmm(booking.start) + " 부터 체크인할 수 있어요" : null}
            >
              {busyKind === "checkin" ? "체크인하는 중…" : "체크인하기"}
            </ButtonWithReason>
          )
        ) : null}

        {booking.isMine ? (
          <div className="mr-row" style={{ marginTop: 8 }}>
            <ButtonWithReason
              variant={extendVariant}
              onClick={handleShorten}
              disabled={!canShortenNow || busyKind !== null}
              reason={!canShortenNow ? "더 이상 줄일 수 없어요" : null}
            >
              {busyKind === "shorten" ? "줄이는 중…" : "-" + humanDuration(POLICY.extendStepMinutes)}
            </ButtonWithReason>
            {/* -15분과 +15분은 한 쌍이므로 같은 무게로 둔다. 이 다이얼로그의
                유일한 채움 버튼은 안전한 기본 동작인 "닫기" 하나다 (DESIGN.md §12-2). */}
            <ButtonWithReason
              variant={extendVariant}
              onClick={handleExtend}
              disabled={busyKind !== null}
              reason={extendReason}
            >
              {busyKind === "extend" ? "연장하는 중…" : "+" + humanDuration(POLICY.extendStepMinutes)}
            </ButtonWithReason>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ================================================================== */

function CancelConfirmDialog({
  booking,
  room,
  onClose,
  onCanceled,
}: {
  booking: Booking;
  room: Room | null;
  onClose: () => void;
  onCanceled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seriesId = booking.recurringEventId;
  const isSeries = seriesId !== null;

  const notice =
    booking.attendeeCount > 0
      ? " 참석자 " + String(booking.attendeeCount) + "명에게 취소 알림이 갑니다."
      : "";

  const message =
    (room?.name ?? booking.roomId) +
    " · " +
    hhmm(booking.start) +
    "~" +
    hhmm(booking.end) +
    " 예약을 취소합니다." +
    notice;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onCanceled();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "취소 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="예약 취소"
      onClose={onClose}
      /* 파괴적 확정 버튼을 안전한 기본 동작에서 떨어뜨린다 (DESIGN.md §4) */
      actionsLayout="split"
      actions={
        <>
          {/* 안전한 쪽(유지)이 주 액션이다. 파괴적인 쪽은 빨간 글자로만 둔다. */}
          <Button onClick={onClose} disabled={busy}>
            유지
          </Button>
          <Button
            variant="danger"
            onClick={() => void run(() => repo.cancel(booking.id))}
            disabled={busy}
          >
            {busy ? "취소하는 중…" : isSeries ? "이 회차만 취소하기" : "예약 취소하기"}
          </Button>
        </>
      }
    >
      {error ? (
        <div style={{ marginTop: 16 }}>
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <p className="t-body" style={{ marginTop: 16 }}>
        {message}
      </p>

      {/* 반복 일정의 일부라는 사실과, 무엇이 남는지를 명시한다 (DESIGN.md §10).
          이걸 안 말하면 "취소했는데 다음 주에 또 잡혀 있다" 가 된다. */}
      {isSeries && seriesId !== null ? (
        <div className="mr-stack" style={{ marginTop: 16 }}>
          <Alert tone="info">
            이 예약은 반복 일정의 한 회차입니다. 위 버튼은 이 회차만 취소하고 나머지 회차는 그대로 둡니다.
          </Alert>
          <Button
            variant="secondary"
            onClick={() => void run(() => repo.cancelSeries(seriesId))}
            disabled={busy}
          >
            반복 일정 전체 취소
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
