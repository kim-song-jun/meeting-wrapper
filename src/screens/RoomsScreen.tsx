import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appNow } from "../app/clock";
import { POLICY, ROOMS, roomById } from "../app/config";
import { useAsync } from "../app/useAsync";
import { Alert, Button, Card } from "../components/ui";
import { repo } from "../data";
import {
  bookingsForLocalDay,
  deriveRoomAvailability,
  findExactQuickBookingOption,
  hasLocalDayChanged,
  millisecondsUntilNextMinute,
} from "../domain/roomAvailability";
import { hhmm } from "../domain/time";
import type { Booking, UserPrefs } from "../domain/types";
import type { LocalDayBookings, QuickBookingOption } from "../domain/roomAvailability";
import { BookingDialog } from "./BookingDialog";
import "../styles/rooms.css";

interface SelectedTime {
  roomId: string;
  option: QuickBookingOption;
}

function statusCopy(state: "free" | "busy" | "mine"): string {
  if (state === "busy") return "지금 사용 중이에요";
  if (state === "mine") return "내 회의가 진행 중이에요";
  return "지금 비어 있어요";
}

function nextBookingCopy(next: { start: Date } | null): string {
  return next ? `다음 예약은 ${hhmm(next.start)}에 있어요.` : "오늘 남은 시간은 모두 비어 있어요.";
}

export function RoomsScreen() {
  const [now, setNow] = useState(appNow);
  const todayRef = useRef(now);
  const optionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const fallbackFocusRef = useRef<HTMLAnchorElement>(null);
  const focusRestoreFrameRef = useRef<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<SelectedTime | null>(null);
  const [dialogSlot, setDialogSlot] = useState<SelectedTime | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /*
   * 이 화면의 방 상태는 하루 전체 예약 한 번으로만 그린다. 설정은 별도의
   * 비동기 상태로 둬서 Zoom 기본값 실패가 회의실 카드까지 비우지 않게 한다.
   */
  const dayState = useAsync<LocalDayBookings>(async () => {
    const day = new Date(todayRef.current.getTime());
    return { day, bookings: await repo.listByDay(day) };
  }, []);
  const prefsState = useAsync<UserPrefs>(() => repo.getPrefs(), []);

  useEffect(() => {
    let timerId: number | null = null;

    function observeClock() {
      const current = appNow();
      if (hasLocalDayChanged(todayRef.current, current)) {
        todayRef.current = current;
        dayState.reload();
      }
      setNow((previous) => previous.getTime() === current.getTime() ? previous : current);
    }

    function scheduleNextMinute() {
      if (timerId !== null) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        observeClock();
        scheduleNextMinute();
      }, millisecondsUntilNextMinute(appNow()));
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      observeClock();
      scheduleNextMinute();
    }

    scheduleNextMinute();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dayState.reload]);

  useEffect(() => () => {
    if (focusRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(focusRestoreFrameRef.current);
      focusRestoreFrameRef.current = null;
    }
  }, []);

  const currentDayBookings = bookingsForLocalDay(dayState.data, now);
  const bookingsByRoom = useMemo(() => {
    const grouped = new Map<string, Booking[]>();
    for (const room of ROOMS) grouped.set(room.id, []);
    for (const booking of currentDayBookings ?? []) {
      const roomBookings = grouped.get(booking.roomId);
      if (roomBookings) roomBookings.push(booking);
    }
    for (const roomBookings of grouped.values()) {
      roomBookings.sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    return grouped;
  }, [currentDayBookings]);

  const roomAvailabilities = useMemo(() => ROOMS.map((room) => ({
    room,
    availability: currentDayBookings === null
      ? null
      : deriveRoomAvailability(bookingsByRoom.get(room.id) ?? [], now, POLICY),
  })), [bookingsByRoom, currentDayBookings, now]);

  useEffect(() => {
    function isStillOffered(selection: SelectedTime): boolean {
      const roomAvailability = roomAvailabilities.find(({ room }) => room.id === selection.roomId);
      return roomAvailability?.availability
        ? findExactQuickBookingOption(roomAvailability.availability.options, selection.option) !== null
        : false;
    }

    if (!dialogSlot && selectedTime && !isStillOffered(selectedTime)) setSelectedTime(null);
  }, [dialogSlot, roomAvailabilities, selectedTime]);

  const prefsPending = prefsState.data === null && prefsState.error === null;
  const prefsReady = prefsState.data !== null || prefsState.error !== null;
  const dialogPrefs = prefsState.data ?? (prefsState.error ? { defaultZoomUrl: null } : null);
  const hasLoadedBookings = dayState.data !== null;
  const liveMessage = hasLoadedBookings && dayState.loading ? "최신 상태를 확인하는 중…" : announcement;
  const waitingForCurrentDay = currentDayBookings === null && dayState.error === null;
  const unavailableDayCopy = dayState.loading || waitingForCurrentDay
    ? "새 날짜의 예약을 불러오는 중이에요."
    : "새 날짜의 예약을 불러오지 못했어요. 다시 불러와 주세요.";

  function reloadDay() {
    dayState.reload();
  }

  function reloadPrefs() {
    prefsState.reload();
  }

  function closeDialogWithFocus(preferredFocusKey: string | null) {
    setDialogSlot(null);
    setSelectedTime(null);

    if (focusRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(focusRestoreFrameRef.current);
    }
    focusRestoreFrameRef.current = window.requestAnimationFrame(() => {
      focusRestoreFrameRef.current = window.requestAnimationFrame(() => {
        focusRestoreFrameRef.current = null;
        const preferredTarget = preferredFocusKey
          ? optionButtonRefs.current.get(preferredFocusKey) ?? null
          : null;
        const target = preferredTarget && !preferredTarget.disabled
          ? preferredTarget
          : fallbackFocusRef.current;
        if (
          target?.isConnected &&
          target.offsetParent !== null &&
          !target.closest("[inert]")
        ) {
          target.focus();
        }
      });
    });
  }

  function closeDialog() {
    closeDialogWithFocus(
      dialogSlot ? `${dialogSlot.roomId}:${dialogSlot.option.id}` : null,
    );
  }

  function selectTime(roomId: string, option: QuickBookingOption) {
    setAnnouncement("");
    setSelectedTime((current) =>
      current?.roomId === roomId && findExactQuickBookingOption([option], current.option)
        ? null
        : { roomId, option },
    );
  }

  if (!hasLoadedBookings && dayState.loading) {
    return <p className="mr-state" role="status">회의실 상태를 불러오는 중…</p>;
  }

  if (!hasLoadedBookings && dayState.error) {
    return (
      <div className="rooms-state-alert">
        <Alert>
          회의실 상태를 불러오지 못했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.
          <div className="rooms-alert__action">
            <Button variant="secondary" onClick={reloadDay}>
              다시 불러오기
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  return (
    <section className="rooms-screen" aria-labelledby="rooms-title">
      <header className="mr-page-head rooms-head">
        <div>
          <h1 id="rooms-title" className="t-title mr-page-head__title">어느 방을 사용할까요?</h1>
          <p className="mr-page-head__description">
            지금 상태와 다음 예약을 비교하고, 가능한 시간을 골라보세요.
          </p>
        </div>
        <Link ref={fallbackFocusRef} className="mr-page-action" to="/">전체 일정 보기</Link>
      </header>

      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </p>

      {dayState.error ? (
        <Alert>
          표시된 상태가 최신이 아닐 수 있어요. 다시 불러와 주세요.
          <div className="rooms-alert__action">
            <Button variant="secondary" onClick={reloadDay}>
              다시 불러오기
            </Button>
          </div>
        </Alert>
      ) : null}

      {prefsState.error ? (
        <Alert>
          기본 Zoom 링크를 불러오지 못했어요. 예약할 때 직접 입력해야 할 수 있어요.
          <div className="rooms-alert__action">
            <Button variant="secondary" onClick={reloadPrefs}>
              다시 불러오기
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="rooms-grid">
        {roomAvailabilities.map(({ room, availability }) => {
          const bookings = bookingsByRoom.get(room.id) ?? [];
          const selectedOption =
            availability && selectedTime?.roomId === room.id
              ? findExactQuickBookingOption(availability.options, selectedTime.option)
              : null;
          const actionReason = availability
            ? availability.unavailableReason ?? (
              prefsPending ? "사용자 설정을 확인하는 중이에요." : selectedOption ? null : "예약할 시간을 골라 주세요."
            )
            : unavailableDayCopy;

          return (
            <Card key={room.id} className="rooms-card">
              <div className="rooms-card__head">
                <div>
                  <h2 className="t-section rooms-card__name">{room.name}</h2>
                  <p className="t-small rooms-card__floor">{room.floor}</p>
                </div>
                <p className="t-body rooms-card__status">
                  {availability ? statusCopy(availability.state) : unavailableDayCopy}
                </p>
              </div>

              <p className="t-small rooms-card__next">
                {availability ? nextBookingCopy(availability.next) : unavailableDayCopy}
              </p>

              <div className="rooms-card__choices" role="group" aria-label={`${room.name} 예약 시간 선택`}>
                {(availability?.options ?? []).map((option) => {
                  const isSelected = selectedOption?.id === option.id;
                  return (
                    <button
                      key={option.id}
                      ref={(element) => {
                        const key = `${room.id}:${option.id}`;
                        if (element) optionButtonRefs.current.set(key, element);
                        else optionButtonRefs.current.delete(key);
                      }}
                      type="button"
                      className="rooms-time-option"
                      aria-pressed={isSelected}
                      onClick={() => selectTime(room.id, option)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="rooms-card__action">
                <Button
                  variant="secondary"
                  disabled={actionReason !== null}
                  onClick={() => {
                    if (selectedOption && prefsReady) setDialogSlot({ roomId: room.id, option: selectedOption });
                  }}
                >
                  이 시간 예약하기
                </Button>
                {actionReason ? <span className="rooms-card__reason">{actionReason}</span> : null}
              </div>

              <div className="rooms-card__bookings">
                <h3 className="t-small rooms-card__bookings-title">오늘 예약</h3>
                {!availability ? (
                  <p className="t-small rooms-card__empty">{unavailableDayCopy}</p>
                ) : bookings.length === 0 ? (
                  <p className="t-small rooms-card__empty">오늘 예약이 없어요.</p>
                ) : (
                  <ul className="rooms-card__booking-list">
                    {bookings.map((booking) => (
                      <li key={booking.id} className="t-small t-num">
                        {hhmm(booking.start)}–{hhmm(booking.end)} 예약됨
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {dialogSlot && dialogPrefs ? (
        <BookingDialog
          roomId={dialogSlot.roomId}
          start={dialogSlot.option.start}
          end={dialogSlot.option.end}
          prefs={dialogPrefs}
          onClose={closeDialog}
          onCreated={(booking, notice) => {
            closeDialogWithFocus(null);
            const success = `${roomById(booking.roomId)?.name ?? "회의실"} ${hhmm(booking.start)}–${hhmm(booking.end)} 예약을 만들었어요.`;
            setAnnouncement(notice ? `${success} ${notice}` : success);
            dayState.reload();
            prefsState.reload();
          }}
        />
      ) : null}
    </section>
  );
}
