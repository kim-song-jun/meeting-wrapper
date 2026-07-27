import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Alert, Badge, Button, ButtonWithReason, Card, Dialog } from "../components/ui";
import { BookingDialog } from "./BookingDialog";
import { ROOMS, POLICY, roomById } from "../app/config";
import { useRoomVisibility } from "../app/roomVisibility";
import { repo } from "../data";
import { useAsync } from "../app/useAsync";
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
function readCssPx(varName: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
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
}: {
  bookings: readonly Booking[];
  group: AgendaGroup;
  onGroupChange: (g: AgendaGroup) => void;
  visibleRooms: readonly Room[];
  loading: boolean;
  now: Date;
  onSelectBooking: (b: Booking) => void;
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
          목록 보기에는 **새 예약을 만드는 길이 없다** — 이 화면은 있는 일정을 시간순으로
          읽는 곳이고, 없는 시간을 가리킬 좌표가 없다(격자에는 빈 슬롯이 있지만 목록에는
          빈 줄이 없다). 그 사실을 적어두지 않으면 "여기선 예약이 안 되나?" 로 남는다 —
          되는 경로를 함께 알려준다(DESIGN.md §10).
        */}
        <p className="agenda__hint">
          일정을 누르면 시간을 바꾸거나 취소할 수 있어요. 새로 예약하려면 <b>격자</b> 보기에서 빈 시간을
          끌어주세요.
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
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const dayKey = ymd(selectedDate);

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
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
  const prefsState = useAsync<UserPrefs>(() => repo.getPrefs(), []);

  const slotPx = useMemo(() => readCssPx("--grid-slot-h", 28), []);
  const dayStart = useMemo(() => gridDayStart(selectedDate, POLICY), [selectedDate]);
  const slotCount = useMemo(() => gridSlotCount(POLICY), []);
  const dayEnd = useMemo(
    () => new Date(dayStart.getTime() + slotCount * POLICY.slotMinutes * MINUTE),
    [dayStart, slotCount],
  );
  const slotIndices = useMemo(() => Array.from({ length: slotCount }, (_, i) => i), [slotCount]);
  const isToday = sameYMD(selectedDate, now);

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
  const [weekRoomId, setWeekRoomId] = useState<string>(() => visibleRooms[0]?.id ?? "");
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => startOfDay(new Date()));
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
  const weekRoomBookings = useMemo(
    () => (weekState.data ?? []).filter((b) => b.roomId === weekRoomId),
    [weekState.data, weekRoomId],
  );

  // 인원 필터로 현재 고른 방이 후보에서 빠지면 남은 후보 중 첫 방으로 옮긴다.
  useEffect(() => {
    if (visibleRooms.length === 0) return;
    if (!visibleRooms.some((r) => r.id === weekRoomId)) {
      const first = visibleRooms[0];
      if (first) setWeekRoomId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRooms]);

  /* ---- 월간 뷰 상태 ---- */
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(new Date()));
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
        new Date(),
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
      setDialogRange({ roomId: d.roomId, start: slotToDate(min), end: slotToDate(max + 1) });
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

  function selectionStyle(d: DragState): CSSProperties {
    const min = Math.min(d.anchor, d.current);
    const max = Math.max(d.anchor, d.current);
    const placement = placeInGrid(slotToDate(min), slotToDate(max + 1), dayStart, POLICY.slotMinutes, slotPx);
    return { top: placement.top, height: placement.height };
  }

  /**
   * 드래그 중 선택 구간의 시간 범위. 사각형만 보이면 지금 몇 시를 잡고 있는지
   * 왼쪽 시간축과 눈으로 맞춰야 한다 — 캘린더 앱은 끄는 동안 시각을 같이 보여준다.
   * 시각 계산은 selectionStyle 과 같은 slotToDate 를 쓴다(두 값이 갈라지지 않게).
   */
  function selectionLabel(d: DragState): { text: string; minutes: number } {
    const min = Math.min(d.anchor, d.current);
    const max = Math.max(d.anchor, d.current);
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
              <Button variant="secondary" onClick={() => setSelectedDate(startOfDay(new Date()))}>
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
              onToday={() => setWeekAnchor(startOfDay(new Date()))}
              prevLabel="이전 주"
              nextLabel="다음 주"
              todayLabel="이번 주"
              rangeLabel={weekRangeLabel}
            />
          ) : (
            <DateStepper
              onPrev={() => setMonthAnchor((d) => addMonths(d, -1))}
              onNext={() => setMonthAnchor((d) => addMonths(d, 1))}
              onToday={() => setMonthAnchor(startOfMonth(new Date()))}
              prevLabel="이전 달"
              nextLabel="다음 달"
              todayLabel="이번 달"
              rangeLabel={monthLabel}
            />
          )
        ) : null}

        <div className="grid-controlbar__right">
          {/*
            부서 필터는 **드롭다운**이다. 칩 네 개를 인라인으로 늘어놓으면 좁은
            폭에서 줄바꿈되며 툴바가 두세 줄로 터진다(440px 에서 실측 194px).
            Jobber 는 필터를 드롭다운 버튼 하나로 접고 켜진 개수만 배지로 보여준다.

            네이티브 <select> 를 쓰는 이유: 부서는 하나만 고르는 값이고,
            키보드·모바일 동작을 브라우저가 이미 정확히 해준다. 커스텀 팝오버를
            만들면 포커스 트랩·외부 클릭·Esc 를 우리가 다시 구현해야 한다.
          */}
          {departments.length > 0 ? (
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
          ) : null}
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
                예약 정보를 불러오지 못했어요: {bookingsState.error.message}{" "}
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
            <div className="grid-scroll">
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
                        <div
                          key={i}
                          className={cx(
                            "grid-slot",
                            slotIsHourBoundary(i, POLICY.slotMinutes) ? "grid-slot--hour" : "grid-slot--half",
                          )}
                          onMouseDown={(e) => {
                            if (firstLoad) return;
                            e.preventDefault();
                            const col = e.currentTarget.parentElement;
                            startDrag(room.id, i, col ? col.getBoundingClientRect().top : 0);
                          }}
                        />
                      ))}

                      {!firstLoad && drag && drag.roomId === room.id ? (
                        <div className="grid-selection" style={selectionStyle(drag)}>
                          <span className="grid-selection__label t-num">
                            {selectionLabel(drag).text}
                          </span>
                          <span className="grid-selection__dur t-cap">
                            {humanDuration(selectionLabel(drag).minutes)}
                          </span>
                        </div>
                      ) : null}

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
            <p className="t-cap grid-mobile__hint">
              모바일에서는 회의실 문에 붙은 QR 코드가 예약의 시작점이에요. QR을 스캔하면 그 자리에서 바로
              예약·체크인할 수 있어요.
            </p>
            {visibleRooms.map((room) => {
              const roomBookings = firstLoad
                ? []
                : (bookingsByRoom.get(room.id) ?? []).filter(matchesDept);
              return (
                <section key={room.id} className="grid-mobile__room">
                  <header className="grid-mobile__room-head">
                    <span className="t-body grid-mobile__room-name">{room.name}</span>
                    <span className="t-cap t-muted">
                      {room.floor}
                    </span>
                  </header>
                  {firstLoad ? (
                    <div className="grid-skeleton-card" aria-hidden="true" />
                  ) : roomBookings.length === 0 ? (
                    <p className="t-small t-muted">오늘 예약이 없어요</p>
                  ) : (
                    <div className="mr-stack">
                      {roomBookings.map((b) => (
                        <Card key={b.id} mine={b.isMine}>
                          <div className="mr-row" style={{ justifyContent: "space-between" }}>
                            <span className="t-small grid-mobile__organizer">{b.organizerName}</span>
                            <span className="t-small t-num grid-mobile__time">
                              {hhmm(b.start)}–{hhmm(b.end)}
                            </span>
                          </div>
                          {isNoShow(b, now, POLICY.checkInGraceMinutes) ? (
                            <div style={{ marginTop: 6 }}>
                              <Badge tone="attn">미체크인</Badge>
                            </div>
                          ) : null}
                        </Card>
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
        />
      ) : view === "week" ? (
        <WeekView
          visibleRooms={visibleRooms}
          weekRoomId={weekRoomId}
          onRoomChange={setWeekRoomId}
          weekStart={weekStart}
          bookings={weekRoomBookings}
          loading={weekState.loading}
          error={weekState.error}
          onReload={weekState.reload}
          matchesDept={matchesDept}
          slotPx={slotPx}
          now={now}
          onSelectBooking={setDetailBooking}
          onCreate={(start, end) => setDialogRange({ roomId: weekRoomId, start, end })}
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
          now={now}
        />
      )}

      {dialogRange ? (
        <BookingDialog
          roomId={dialogRange.roomId}
          start={dialogRange.start}
          end={dialogRange.end}
          prefs={prefsState.data ?? { defaultZoomUrl: null }}
          onClose={() => setDialogRange(null)}
          onCreated={() => {
            setDialogRange(null);
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
/* 주간 뷰 — 회의실 하나 x 시간 x 요일. placeInGrid 는 그대로 재사용하고
 * 축이 회의실에서 요일로 바뀔 뿐이다. 각 요일 열의 dayStart 만 그 날짜로 넘긴다. */

function WeekView({
  visibleRooms,
  weekRoomId,
  onRoomChange,
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
  weekRoomId: string;
  onRoomChange: (id: string) => void;
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
  onCreate: (start: Date, end: Date) => void;
}) {
  const slotCount = gridSlotCount(POLICY);
  const slotIndices = useMemo(() => Array.from({ length: slotCount }, (_, i) => i), [slotCount]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const axisDayStart = useMemo(() => gridDayStart(weekStart, POLICY), [weekStart]);
  const today = useMemo(() => startOfDay(now), [now]);

  /*
   * 모바일에서는 슬롯을 44px 로 키운다. 28px 짜리 30분 블록은 손가락으로 누를 수 없다.
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
  const weekScrollStyle = {
    marginTop: 16,
    "--grid-slot-h": String(weekSlotPx) + "px",
  } as CSSProperties;

  const gridTemplateColumns = "var(--grid-axis-w) repeat(7, minmax(var(--grid-col-min), 1fr))";

  return (
    <div>
      {visibleRooms.length > 0 ? (
        <div className="grid-roomchips mr-row" role="group" aria-label="회의실 선택">
          {visibleRooms.map((room) => (
            <button
              key={room.id}
              type="button"
              className={cx("grid-roomchip", room.id === weekRoomId && "is-active")}
              aria-pressed={room.id === weekRoomId}
              onClick={() => onRoomChange(room.id)}
            >
              {room.name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 16 }}>
          <Alert>
            예약 정보를 불러오지 못했어요: {error.message}{" "}
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
        빈 칸을 <b>누르면</b> 그 시간으로 예약할 수 있어요. 주간 보기에서는 <b>끌어서</b> 선택하거나
        옮길 수 없어요 — 일정을 눌러 시간을 바꾸거나, 일간 보기에서 끌어 옮길 수 있어요.
      </p>

      {/* .grid-scroll 은 항상 마운트한다 — 로딩 중에만 사라지면 pane 모드의
       * flex:1 sizing 이 꺼졌다 켜지며 스크롤 위치와 페이지 높이가 튄다(day 뷰와 동일 이유). */}
      <div className="grid-scroll grid-week" style={weekScrollStyle}>
        <div className="grid-table" style={{ gridTemplateColumns }}>
          <div className="grid-corner" />

          {weekDays.map((day, i) => (
            <div
              key={i}
              className={cx("grid-room-header", sameYMD(day, today) && "grid-room-header--today")}
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
            const dayBookings = loading
              ? []
              : bookings.filter(
                  (b) =>
                    matchesDept(b) &&
                    b.end.getTime() > dStart.getTime() &&
                    b.start.getTime() < dEnd.getTime(),
                );
            return (
              <div key={i} className="grid-col">
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
                      aria-label={
                        new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(day) +
                        " " +
                        hhmm(slotStart) +
                        " 예약하기"
                      }
                      onClick={() =>
                        onCreate(slotStart, new Date(slotStart.getTime() + POLICY.slotMinutes * MINUTE))
                      }
                    />
                  );
                })}

                {dayBookings.map((b) => {
                  const clippedStart = b.start.getTime() < dStart.getTime() ? dStart : b.start;
                  const clippedEnd = b.end.getTime() > dEnd.getTime() ? dEnd : b.end;
                  const placement = placeInGrid(clippedStart, clippedEnd, dStart, POLICY.slotMinutes, weekSlotPx);
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
            예약 정보를 불러오지 못했어요: {error.message}{" "}
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
              <button
                key={ymd(d)}
                type="button"
                className={cx(
                  "grid-month__cell",
                  !inMonth && "grid-month__cell--outside",
                  sameYMD(d, today) && "grid-month__cell--today",
                )}
                onClick={() => onSelectDate(d)}
                aria-label={
                  String(d.getMonth() + 1) +
                  "월 " +
                  String(d.getDate()) +
                  "일 · 예약 " +
                  String(cellBookings.length) +
                  "건"
                }
              >
                <span className="grid-month__daynum t-num">{d.getDate()}</span>
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
                        <span
                          key={b.id}
                          className={cx("grid-month__chip", b.isMine && "grid-month__chip--mine")}
                        >
                          <span className="grid-month__chip-time t-num">{hhmm(b.start)}</span>
                          <span className="grid-month__chip-room">
                            {roomById(b.roomId)?.short ?? ""}
                          </span>
                          <span className="grid-month__chip-name">{b.organizerName}</span>
                        </span>
                      ))}
                    {cellBookings.length > MONTH_CHIP_LIMIT ? (
                      <span className="grid-month__more t-cap">
                        +{cellBookings.length - MONTH_CHIP_LIMIT}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
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
      setCheckedInAt(new Date());
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
