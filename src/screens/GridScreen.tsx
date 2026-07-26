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

/* ---------------- drag selection ---------------- */

interface DragState {
  roomId: string;
  anchor: number;
  current: number;
}

/* ================================================================== */

export function GridScreen() {
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

  function slotToDate(slot: number): Date {
    return new Date(dayStart.getTime() + slot * POLICY.slotMinutes * MINUTE);
  }

  function isHourBoundary(slotIndex: number): boolean {
    return ((slotIndex + 1) * POLICY.slotMinutes) % 60 === 0;
  }

  function hourLabelAt(slotIndex: number): string | null {
    if ((slotIndex * POLICY.slotMinutes) % 60 !== 0) return null;
    return hhmm(slotToDate(slotIndex));
  }

  /* ---- drag selection ---- */
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

  /* ---- now indicator ---- */
  // 순간(점) 이므로 구간을 받는 placeInGrid 대신, 도메인이 제공하는
  // slotIndexOf 로 슬롯 인덱스만 구하고 슬롯 높이를 곱한다.
  const nowSlot = slotIndexOf(now, dayStart, POLICY.slotMinutes);
  const showNowLine = isToday && nowSlot >= 0 && nowSlot <= slotCount;
  const nowTop = nowSlot * slotPx;

  /* ---- event detail / cancel ---- */
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
      <div className="grid-toolbar mr-row">
        <Button variant="secondary" onClick={() => setSelectedDate(startOfDay(new Date()))}>
          오늘
        </Button>
        <Button variant="secondary" onClick={() => setSelectedDate(addDays(startOfDay(new Date()), 1))}>
          내일
        </Button>
        <input
          type="date"
          className="mr-input grid-date-input"
          value={ymd(selectedDate)}
          onChange={onDateInputChange}
          aria-label="날짜 선택"
        />
        <span className="t-small t-muted">{dateLabel}</span>
      </div>

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

      {prefsState.error ? (
        <div style={{ marginTop: 16 }}>
          <Alert>기본 Zoom 링크를 불러오지 못했어요. 예약 시 Zoom 링크를 직접 입력해 주세요.</Alert>
        </div>
      ) : null}

      {bookingsState.loading ? (
        <p className="mr-state">예약 현황을 불러오는 중…</p>
      ) : (
        <>
          <div className="grid-desktop">
            <div className="grid-scroll">
              <div className={cx("grid-table", drag && "is-dragging")} style={{ gridTemplateColumns }}>
                <div className="grid-corner" />

                {ROOMS.map((room) => (
                  <div key={room.id} className="grid-room-header">
                    <span className="t-small grid-room-header__name">{room.name}</span>
                    <span className="t-cap t-muted">
                      {room.capacity}인 · {room.floor}
                    </span>
                  </div>
                ))}

                <div className="grid-axis">
                  {slotIndices.map((i) => {
                    const label = hourLabelAt(i);
                    return (
                      <div
                        key={i}
                        className={cx("grid-slot", "grid-axis__cell", isHourBoundary(i) ? "grid-slot--hour" : "grid-slot--half")}
                      >
                        {label ? <span className="t-cap t-num grid-axis__label">{label}</span> : null}
                      </div>
                    );
                  })}
                </div>

                {ROOMS.map((room) => {
                  const roomBookings = (bookingsByRoom.get(room.id) ?? []).filter(
                    (b) => b.end.getTime() > dayStart.getTime() && b.start.getTime() < dayEnd.getTime(),
                  );
                  return (
                    <div key={room.id} className="grid-col">
                      {slotIndices.map((i) => (
                        <div
                          key={i}
                          className={cx("grid-slot", isHourBoundary(i) ? "grid-slot--hour" : "grid-slot--half")}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            startDrag(room.id, i);
                          }}
                          onMouseEnter={() => continueDrag(room.id, i)}
                        />
                      ))}

                      {drag && drag.roomId === room.id ? (
                        <div className="grid-selection" style={selectionStyle(drag)} />
                      ) : null}

                      {roomBookings.map((b) => {
                        const clippedStart = b.start.getTime() < dayStart.getTime() ? dayStart : b.start;
                        const clippedEnd = b.end.getTime() > dayEnd.getTime() ? dayEnd : b.end;
                        const placement = placeInGrid(clippedStart, clippedEnd, dayStart, POLICY.slotMinutes, slotPx);
                        const noShow = isNoShow(b, now, POLICY.checkInGraceMinutes);
                        const compact = placement.slots <= 1;
                        return (
                          <div
                            key={b.id}
                            role="button"
                            tabIndex={0}
                            aria-label={b.organizerName + " " + hhmm(b.start) + "~" + hhmm(b.end)}
                            className={cx("grid-event", b.isMine ? "grid-event--mine" : "grid-event--other")}
                            style={{ top: placement.top, height: placement.height }}
                            onClick={() => setDetailBooking(b)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setDetailBooking(b);
                              }
                            }}
                          >
                            {compact ? (
                              <div className="grid-event__compact">
                                <span className="grid-event__name">{b.organizerName}</span>
                                {noShow ? (
                                  <Badge tone="attn">미체크인</Badge>
                                ) : (
                                  <span className="grid-event__time t-num">
                                    {hhmm(b.start)}–{hhmm(b.end)}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="grid-event__full">
                                <div className="grid-event__row">
                                  <span className="grid-event__name">{b.organizerName}</span>
                                  {noShow ? <Badge tone="attn">미체크인</Badge> : null}
                                </div>
                                <span className="grid-event__time t-cap t-num">
                                  {hhmm(b.start)}–{hhmm(b.end)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {showNowLine ? (
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
              const roomBookings = bookingsByRoom.get(room.id) ?? [];
              return (
                <section key={room.id} className="grid-mobile__room">
                  <header className="grid-mobile__room-head">
                    <span className="t-body grid-mobile__room-name">{room.name}</span>
                    <span className="t-cap t-muted">
                      {room.capacity}인 · {room.floor}
                    </span>
                  </header>
                  {roomBookings.length === 0 ? (
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
        </>
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
          }}
        />
      ) : null}
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
    String(room?.capacity ?? 0) +
    "인 · " +
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
              variant="compact-quiet"
              onClick={handleShorten}
              disabled={!canShortenNow || busyKind !== null}
              reason={!canShortenNow ? "더 이상 줄일 수 없어요" : null}
            >
              {busyKind === "shorten" ? "줄이는 중…" : "-" + humanDuration(POLICY.extendStepMinutes)}
            </ButtonWithReason>
            {/* -15분과 +15분은 한 쌍이므로 같은 무게로 둔다. 이 다이얼로그의
                유일한 채움 버튼은 안전한 기본 동작인 "닫기" 하나다 (DESIGN.md §12-2). */}
            <ButtonWithReason
              variant="compact-quiet"
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

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await repo.cancel(booking.id);
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
          <Button onClick={confirm} disabled={busy}>
            {busy ? "취소하는 중…" : "취소 확정"}
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
    </Dialog>
  );
}
