import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Alert, Badge, Button, ButtonWithReason, Card, Dialog } from "../components/ui";
import { BookingDialog } from "./BookingDialog";
import { ROOMS, POLICY, roomById } from "../app/config";
import { repo } from "../data";
import { useAsync } from "../app/useAsync";
import {
  canExtend,
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
import type { GridPlacement } from "../domain/time";
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

type ViewMode = "day" | "week" | "month";

const VIEW_TABS: readonly { id: ViewMode; label: string }[] = [
  { id: "day", label: "일간" },
  { id: "week", label: "주간" },
  { id: "month", label: "월간" },
];

/**
 * 일간·주간·월간은 상호 배타적인 3개 뷰다 — 언더라인 탭(공용 Tabs 컴포넌트,
 * MyBookingsScreen 과 공유)보다 하나의 폐곡선 안에 묶인 segmented control 이
 * "지금 무엇을 보고 있나"를 더 즉시 읽히게 한다. components.css 의 공유 Tabs
 * 를 건드리지 않기 위해 이 화면 전용 마크업/스타일을 grid.css 안에서 새로 정의한다.
 */
function GridViewSwitch({
  active,
  onChange,
}: {
  active: ViewMode;
  onChange: (id: ViewMode) => void;
}) {
  return (
    <div className="grid-viewswitch" role="tablist" aria-label="보기 전환">
      {VIEW_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className={cx("grid-viewswitch__btn", t.id === active && "is-active")}
          aria-selected={t.id === active}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
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

interface DragState {
  roomId: string;
  anchor: number;
  current: number;
}

/* ================================================================== */

export function GridScreen() {
  const [view, setView] = useState<ViewMode>("day");

  /* ---- 일간 뷰 상태 (기존, 손대지 않음) ---- */
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const dayKey = ymd(selectedDate);

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const bookingsState = useAsync<Booking[]>(() => repo.listByDay(selectedDate), [dayKey]);
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
    for (const room of ROOMS) map.set(room.id, []);
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
  const [weekRoomId, setWeekRoomId] = useState<string>(() => ROOMS[0]?.id ?? "");
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
  const weekState = useAsync<Booking[]>(
    () =>
      view === "week" && weekRoomId
        ? repo.listByRoomRange(weekRoomId, weekStart, weekEnd)
        : Promise.resolve([]),
    [view, weekRoomId, weekStart.getTime(), weekEnd.getTime()],
  );

  // 인원 필터로 현재 고른 방이 후보에서 빠지면 남은 후보 중 첫 방으로 옮긴다.
  useEffect(() => {
    if (ROOMS.length === 0) return;
    if (!ROOMS.some((r) => r.id === weekRoomId)) {
      const first = ROOMS[0];
      if (first) setWeekRoomId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ROOMS]);

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
    if (view === "day") return bookingsState.data ?? [];
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

  const activeFilterCount = deptFilter !== null ? 1 : 0;

  function resetFilters() {
    setDeptFilter(null);
  }

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

  function startDrag(roomId: string, slot: number) {
    setDrag({ roomId, anchor: slot, current: slot });
  }
  function continueDrag(roomId: string, slot: number) {
    setDrag((d) => (d && d.roomId === roomId ? { ...d, current: slot } : d));
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
      finalizeDrag();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dragRef.current) {
        setDrag(null);
      }
    }
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
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
    "var(--grid-axis-w) repeat(" + String(ROOMS.length) + ", minmax(var(--grid-col-min), 1fr))";

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

        {ROOMS.length > 0 ? (
          view === "day" ? (
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
          <div className="grid-filterbar mr-row">
            {departments.length > 0 ? (
              <div className="grid-deptchips" role="group" aria-label="부서 필터">
                <button
                  type="button"
                  className={cx("grid-deptchip", deptFilter === null && "is-active")}
                  aria-pressed={deptFilter === null}
                  onClick={() => setDeptFilter(null)}
                >
                  전체
                </button>
                {departments.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={cx("grid-deptchip", deptFilter === d && "is-active")}
                    aria-pressed={deptFilter === d}
                    onClick={() => setDeptFilter(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            ) : null}
  
            {activeFilterCount > 0 ? (
              <button type="button" className="grid-filter-reset" onClick={resetFilters}>
                필터 {activeFilterCount}개 · 해제
              </button>
            ) : null}
          </div>
          <GridViewSwitch active={view} onChange={setView} />
        </div>
      </div>

      {prefsState.error ? (
        <div style={{ marginTop: 16 }}>
          <Alert>기본 Zoom 링크를 불러오지 못했어요. 예약 시 Zoom 링크를 직접 입력해 주세요.</Alert>
        </div>
      ) : null}

      {/* 필터 때문에 비었을 때는 원인과 다음 행동을 말한다. 그냥 빈 격자로 두지 않는다. */}
      {deptFilterEmptied ? (
        <div style={{ marginTop: 16 }}>
          <Alert>
            {deptFilter}의 예약이 이 기간엔 없어요. 위의 &ldquo;전체&rdquo;를 누르면 다시 볼 수 있어요.
          </Alert>
        </div>
      ) : null}

      {ROOMS.length === 0 ? (
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
              <div className={cx("grid-table", drag && "is-dragging")} style={{ gridTemplateColumns }}>
                <div className="grid-corner" />

                {ROOMS.map((room) => (
                  <div key={room.id} className="grid-room-header">
                    {bookingsState.loading ? (
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

                {ROOMS.map((room) => {
                  const roomBookings = bookingsState.loading
                    ? []
                    : (bookingsByRoom.get(room.id) ?? []).filter(
                        (b) =>
                          matchesDept(b) &&
                          b.end.getTime() > dayStart.getTime() &&
                          b.start.getTime() < dayEnd.getTime(),
                      );
                  return (
                    <div key={room.id} className="grid-col">
                      {slotIndices.map((i) => (
                        <div
                          key={i}
                          className={cx(
                            "grid-slot",
                            slotIsHourBoundary(i, POLICY.slotMinutes) ? "grid-slot--hour" : "grid-slot--half",
                          )}
                          onMouseDown={(e) => {
                            if (bookingsState.loading) return;
                            e.preventDefault();
                            startDrag(room.id, i);
                          }}
                          onMouseEnter={() => {
                            if (!bookingsState.loading) continueDrag(room.id, i);
                          }}
                        />
                      ))}

                      {!bookingsState.loading && drag && drag.roomId === room.id ? (
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
                        const clippedStart = b.start.getTime() < dayStart.getTime() ? dayStart : b.start;
                        const clippedEnd = b.end.getTime() > dayEnd.getTime() ? dayEnd : b.end;
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
                            booking={b}
                            placement={placement}
                            now={now}
                            onSelect={setDetailBooking}
                          />
                        );
                      })}
                    </div>
                  );
                })}

                {showNowLine && !bookingsState.loading ? (
                  <div className="grid-now" aria-hidden="true">
                    <div className="grid-now__line" style={{ top: nowTop }} />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid-mobile">
            <p className="t-cap t-muted grid-mobile__hint">
              모바일에서는 회의실 문에 붙은 QR 코드가 예약의 시작점이에요. QR을 스캔하면 그 자리에서 바로
              예약·체크인할 수 있어요.
            </p>
            {ROOMS.map((room) => {
              const roomBookings = bookingsState.loading
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
                  {bookingsState.loading ? (
                    <div className="grid-skeleton-card" aria-hidden="true" />
                  ) : roomBookings.length === 0 ? (
                    <p className="t-small t-muted">오늘 예약이 없어요</p>
                  ) : (
                    <div className="mr-stack">
                      {roomBookings.map((b) => (
                        <Card key={b.id} mine={b.isMine}>
                          <div className="mr-row" style={{ justifyContent: "space-between" }}>
                            <span className="t-small grid-mobile__organizer">{b.organizerName}</span>
                            <span className="t-small t-num t-muted">
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
      ) : view === "week" ? (
        <WeekView
          ROOMS={ROOMS}
          weekRoomId={weekRoomId}
          onRoomChange={setWeekRoomId}
          weekStart={weekStart}
          bookings={weekState.data ?? []}
          loading={weekState.loading}
          error={weekState.error}
          onReload={weekState.reload}
          matchesDept={matchesDept}
          slotPx={slotPx}
          now={now}
          onSelectBooking={setDetailBooking}
        />
      ) : (
        <MonthView
          monthAnchor={monthAnchor}
          bookings={monthState.data ?? []}
          loading={monthState.loading}
          error={monthState.error}
          onReload={monthState.reload}
          ROOMS={ROOMS}
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
}: {
  booking: Booking;
  placement: GridPlacement;
  now: Date;
  onSelect: (booking: Booking) => void;
}) {
  const noShow = isNoShow(booking, now, POLICY.checkInGraceMinutes);
  const compact = placement.slots <= 1;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={booking.organizerName + " " + hhmm(booking.start) + "~" + hhmm(booking.end)}
      className={cx("grid-event", booking.isMine ? "grid-event--mine" : "grid-event--other")}
      style={{ top: placement.top, height: placement.height }}
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
    </div>
  );
}

/* ================================================================== */
/* 주간 뷰 — 회의실 하나 x 시간 x 요일. placeInGrid 는 그대로 재사용하고
 * 축이 회의실에서 요일로 바뀔 뿐이다. 각 요일 열의 dayStart 만 그 날짜로 넘긴다. */

function WeekView({
  ROOMS,
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
}: {
  ROOMS: readonly Room[];
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
      {ROOMS.length > 0 ? (
        <div className="grid-roomchips mr-row" role="group" aria-label="회의실 선택">
          {ROOMS.map((room) => (
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
                {slotIndices.map((s) => (
                  <div
                    key={s}
                    className={cx(
                      "grid-slot",
                      slotIsHourBoundary(s, POLICY.slotMinutes) ? "grid-slot--hour" : "grid-slot--half",
                    )}
                  />
                ))}

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
  ROOMS,
  matchesDept,
  onSelectDate,
  now,
}: {
  monthAnchor: Date;
  bookings: Booking[];
  loading: boolean;
  error: Error | null;
  onReload: () => void;
  ROOMS: readonly Room[];
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
                ROOMS.some((r) => r.id === b.roomId) &&
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
  onCancelRequested,
}: {
  booking: Booking;
  room: Room | null;
  now: Date;
  onClose: () => void;
  onChanged: () => void;
  onCancelRequested: (booking: Booking) => void;
}) {
  const [busyKind, setBusyKind] = useState<"extend" | "shorten" | null>(null);
  const [extendReason, setExtendReason] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /*
   * ±15분 연장 컨트롤의 지오메트리. DESIGN.md §4:
   * compact(36px)는 데스크톱 격자 인접 컨텍스트 전용이고, "모바일의 같은 연장 컨트롤은
   * Compact 가 아니라 Secondary(44px)를 쓴다 — 36px 는 터치 타깃 하한을 밑돈다".
   * 이 다이얼로그는 데스크톱 격자뿐 아니라 모바일 주간 뷰에서도 열리므로 폭에 따라 바꾼다.
   */
  const isNarrow = useIsNarrow();
  const extendVariant = isNarrow ? "secondary" : "compact-quiet";

  const noShow = isNoShow(booking, now, POLICY.checkInGraceMinutes);
  const canShortenNow = canShorten(booking, POLICY.extendStepMinutes, POLICY.slotMinutes);
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
         둘 다 아웃라인으로 붙여두면 "닫기"인 줄 알고 예약을 지운다. */
      actionsLayout={booking.isMine ? "split" : "end"}
      actions={
        <>
          {booking.isMine ? (
            <Button variant="secondary" onClick={() => onCancelRequested(booking)}>
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
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            유지
          </Button>
          <Button onClick={() => void run(() => repo.cancel(booking.id))} disabled={busy}>
            {busy ? "취소하는 중…" : isSeries ? "이 회차만 취소" : "취소 확정"}
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
