import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Badge, Button, ButtonWithReason, Card } from "../components/ui";
import { BookingDialog } from "./BookingDialog";
import { useAsync } from "../app/useAsync";
import { repo } from "../data";
import { ROOMS, POLICY, roomById } from "../app/config";
import {
  currentBooking,
  hhmm,
  humanDuration,
  isNoShow,
  canExtend,
  nextGap,
  MINUTE,
} from "../domain/time";
import type { ExtendResult, Gap } from "../domain/time";
import type { Booking } from "../domain/types";
import "../styles/landing.css";

const AUTO_REFRESH_MS = 60_000;

/** 격자 시작 시각과 짝을 이루는 하루의 끝. 픽셀 배치가 아니라 날짜 경계 계산이라
 * placeInGrid 규칙(그리드 픽셀은 손계산 금지)의 대상이 아니다. */
function dayEndOf(day: Date): Date {
  const d = new Date(day);
  d.setHours(POLICY.gridEndHour, 0, 0, 0);
  return d;
}

interface Preset {
  label: string;
  start: Date;
  end: Date;
}

/** FREE 상태의 예약 프리셋. 다음 예약과 겹치거나 정책 최대 시간을 넘는 항목은 뺀다. */
function buildFreePresets(now: Date, boundEnd: Date | null): Preset[] {
  const presets: Preset[] = [];

  const tryAdd = (minutes: number, label: string) => {
    if (minutes > POLICY.maxDurationMinutes) return;
    const end = new Date(now.getTime() + minutes * MINUTE);
    if (boundEnd && end.getTime() > boundEnd.getTime()) return;
    presets.push({ label, start: now, end });
  };

  tryAdd(30, "30분 예약");
  tryAdd(60, "1시간 예약");

  if (boundEnd) {
    const minutes = Math.round((boundEnd.getTime() - now.getTime()) / MINUTE);
    if (minutes > 0 && minutes <= POLICY.maxDurationMinutes) {
      presets.push({ label: hhmm(boundEnd) + "까지 전부", start: now, end: boundEnd });
    }
  }

  return presets;
}

/** BUSY 상태에서 "다음 빈 시간에 예약" 보조 액션이 잡을 기본 구간 */
function suggestedSlot(gap: Gap): { start: Date; end: Date } {
  const availableMinutes = (gap.end.getTime() - gap.start.getTime()) / MINUTE;
  const minutes = Math.min(30, availableMinutes, POLICY.maxDurationMinutes);
  return { start: gap.start, end: new Date(gap.start.getTime() + minutes * MINUTE) };
}

function extendReasonText(result: ExtendResult): string {
  if (result.ok) return "";
  if (result.reason === "blocked") {
    return hhmm(result.blockedBy.start) + "에 " + result.blockedBy.organizerName + "님 예약 있음";
  }
  return "한 번에 " + humanDuration(result.maxMinutes) + "까지 예약할 수 있어요";
}

function LandingHeader() {
  return (
    <header className="mr-landing__header">
      <span className="mr-landing__brand">molroom</span>
    </header>
  );
}

export function RoomLandingScreen() {
  const params = useParams();
  const roomId = params.roomId;
  const room = roomId ? roomById(roomId) : null;

  const [autoTick, setAutoTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAutoTick((n) => n + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const bookingsState = useAsync(async () => {
    if (!roomId) return [];
    return repo.listByRoom(roomId, new Date());
  }, [roomId, autoTick]);

  const prefsState = useAsync(() => repo.getPrefs(), []);

  const [draft, setDraft] = useState<{ start: Date; end: Date } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  if (!room) {
    return (
      <div className="mr-landing">
        <LandingHeader />
        <main className="mr-landing__main">
          <p className="t-body">
            {roomId ? "“" + roomId + "” 회의실을 찾을 수 없어요." : "회의실 정보가 없어요."}
          </p>
          <p className="t-small t-muted mr-landing__sub">아래 목록에서 회의실을 선택해 주세요.</p>
          <ul className="mr-landing__roomlist">
            {ROOMS.map((r) => (
              <li key={r.id}>
                <Link to={"/r/" + r.id} className="mr-landing__roomlink">
                  {r.name} · {String(r.capacity)}인 · {r.floor}
                </Link>
              </li>
            ))}
          </ul>
        </main>
      </div>
    );
  }

  // room.id 를 별도 const 로 뽑아둔다 — 좁혀진 room 을 클로저(핸들러) 안에서 참조하면
  // TS 가 널 좁힘을 클로저 경계 밖으로 넘기지 않아 다시 null 로 취급한다.
  const safeRoomId = room.id;

  const bookings = bookingsState.data ?? [];
  const hasData = bookingsState.data !== null;
  const now = new Date();
  const dayEnd = dayEndOf(now);
  const activeBooking = currentBooking(bookings, now);
  const gap = nextGap(bookings, now, dayEnd);

  type LandingState =
    | { kind: "free" }
    | { kind: "busy"; booking: Booking }
    | { kind: "mine"; booking: Booking };

  const state: LandingState =
    activeBooking === null
      ? { kind: "free" }
      : activeBooking.isMine
        ? { kind: "mine", booking: activeBooking }
        : { kind: "busy", booking: activeBooking };

  const boundEnd: Date | null = gap && gap.end.getTime() < dayEnd.getTime() ? gap.end : null;
  const freePresets = state.kind === "free" ? buildFreePresets(now, boundEnd) : [];
  const nextLabel = boundEnd ? "다음 예약 " + hhmm(boundEnd) : "오늘 남은 시간 모두 비어있음";

  const mineBooking = state.kind === "mine" ? state.booking : null;
  const extendPreview = mineBooking
    ? canExtend(mineBooking, bookings, POLICY.extendStepMinutes, POLICY)
    : null;
  const extendBlockedReason = extendPreview && !extendPreview.ok ? extendReasonText(extendPreview) : null;

  async function handleCheckIn() {
    if (!mineBooking) return;
    setCheckingIn(true);
    setCheckInError(null);
    try {
      await repo.checkIn(mineBooking.id);
      bookingsState.reload();
    } catch (e) {
      setCheckInError(
        e instanceof Error ? e.message : "체크인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setCheckingIn(false);
    }
  }

  async function handleExtend() {
    if (!mineBooking) return;
    setExtending(true);
    setExtendError(null);
    try {
      // 연장 직전 재조회 — 오래된 화면 캐시로 판단하면 조용히 이중 예약이 된다 (설계 스펙 §6.2)
      const fresh = await repo.listByRoom(safeRoomId, new Date());
      const result = canExtend(mineBooking, fresh, POLICY.extendStepMinutes, POLICY);
      if (!result.ok) {
        setExtendError(extendReasonText(result));
        return;
      }
      const changed = await repo.changeEnd(mineBooking.id, result.newEnd);
      if (!changed.ok) {
        setExtendError(changed.reason === "blocked" ? changed.by + "님 예약과 겹쳐요" : changed.message);
        return;
      }
      bookingsState.reload();
    } catch (e) {
      setExtendError(
        e instanceof Error ? e.message : "연장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setExtending(false);
    }
  }

  async function handleEndNow() {
    if (!mineBooking) return;
    setEnding(true);
    setEndError(null);
    try {
      const result = await repo.changeEnd(mineBooking.id, new Date());
      if (!result.ok) {
        setEndError(result.reason === "blocked" ? result.by + "님 예약과 겹쳐요" : result.message);
        return;
      }
      bookingsState.reload();
    } catch (e) {
      setEndError(e instanceof Error ? e.message : "종료 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setEnding(false);
    }
  }

  const todayList = [...bookings].sort((a, b) => a.start.getTime() - b.start.getTime());
  const prefs = prefsState.data ?? { defaultZoomUrl: null };

  return (
    <div className="mr-landing">
      <LandingHeader />
      <main className="mr-landing__main">
        <h1 className="t-hero mr-landing__title">{room.name}</h1>
        <p className="t-body mr-landing__meta">
          {String(room.capacity)}인 · {room.floor}
        </p>

        {prefsState.error ? (
          <div className="mr-landing__alert">
            <Alert>기본 Zoom 링크를 불러오지 못했어요. 예약할 때 직접 입력해야 할 수 있어요.</Alert>
          </div>
        ) : null}

        {!hasData && bookingsState.loading ? (
          <p className="mr-state">예약 정보를 불러오는 중…</p>
        ) : !hasData && bookingsState.error ? (
          <div className="mr-landing__alert">
            <Alert>
              예약 정보를 불러오지 못했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.
              <div style={{ marginTop: 8 }}>
                <Button variant="secondary" onClick={bookingsState.reload}>
                  다시 시도
                </Button>
              </div>
            </Alert>
          </div>
        ) : (
          <>
            {bookingsState.error ? (
              <div className="mr-landing__alert">
                <Alert>
                  최신 정보를 불러오지 못해 화면이 오래된 정보일 수 있어요.
                  <div style={{ marginTop: 8 }}>
                    <Button variant="secondary" onClick={bookingsState.reload}>
                      다시 시도
                    </Button>
                  </div>
                </Alert>
              </div>
            ) : null}

            <div className="mr-landing__section">
              {state.kind === "free" ? (
                <>
                  <Card>
                    <div className="mr-landing__statusline">
                      <span className="mr-landing__dot" data-tone="free" />
                      <span className="t-body">지금 비어있음</span>
                    </div>
                    <p className="t-small t-muted mr-landing__sub">{nextLabel}</p>
                  </Card>
                  <div className="mr-landing__presets">
                    {/* 채움 버튼은 하나만. DESIGN.md §12-2(화면당 유채색 액센트 하나)와
                        §4(Apple 실측 패턴 = 채움 + 아웃라인 짝)를 따른다.
                        나머지 프리셋은 아웃라인으로 두되 높이는 44px 를 유지한다. */}
                    {freePresets.map((p, i) => (
                      <Button
                        key={p.label}
                        block
                        variant={i === 0 ? "primary" : "secondary"}
                        onClick={() => setDraft({ start: p.start, end: p.end })}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </>
              ) : state.kind === "busy" ? (
                <>
                  <Card>
                    <div className="mr-landing__statusline">
                      <span className="mr-landing__dot" data-tone="busy" />
                      <span className="t-body">
                        {state.booking.organizerName}님 사용 중 · {hhmm(state.booking.end)}까지
                      </span>
                    </div>
                  </Card>
                  <Card className="mr-landing__gapcard">
                    {gap ? (
                      <>
                        <p className="t-small mr-landing__gaplabel">다음 빈 시간</p>
                        <p className="t-body t-num mr-landing__gaptime">
                          {hhmm(gap.start)}–{hhmm(gap.end)}
                        </p>
                        <div className="mr-landing__gapaction">
                          <Button
                            variant="secondary"
                            block
                            onClick={() => setDraft(suggestedSlot(gap))}
                          >
                            {hhmm(gap.start)}에 예약하기
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="t-small mr-landing__gaplabel">오늘 남은 시간 동안 사용 중이에요</p>
                    )}
                  </Card>
                </>
              ) : (
                <Card mine>
                  <div className="mr-landing__mine-head">
                    <span className="mr-landing__dot" data-tone="busy" />
                    <span className="t-body">
                      내 회의 진행 중 · {hhmm(state.booking.start)}–{hhmm(state.booking.end)}
                    </span>
                  </div>

                  <div className="mr-landing__mine-actions">
                    {state.booking.checkedInAt ? (
                      <p className="t-small mr-landing__checkedin">
                        체크인 완료 · {hhmm(state.booking.checkedInAt)}
                      </p>
                    ) : (
                      <Button block onClick={handleCheckIn} disabled={checkingIn}>
                        {checkingIn ? "체크인하는 중…" : "체크인"}
                      </Button>
                    )}

                    <div className="mr-landing__mine-row">
                      <ButtonWithReason
                        variant="secondary"
                        onClick={handleExtend}
                        disabled={extending || Boolean(extendBlockedReason)}
                        reason={extendError ?? extendBlockedReason}
                      >
                        {extending ? "연장하는 중…" : "+" + String(POLICY.extendStepMinutes) + "분 연장"}
                      </ButtonWithReason>
                      <Button variant="secondary" onClick={handleEndNow} disabled={ending}>
                        {ending ? "종료하는 중…" : "지금 종료"}
                      </Button>
                    </div>

                    {checkInError ? <Alert>{checkInError}</Alert> : null}
                    {endError ? <Alert>{endError}</Alert> : null}
                  </div>
                </Card>
              )}
            </div>

            <section className="mr-landing__today">
              <h2 className="t-small mr-landing__today-title">오늘 이 방 예약</h2>
              {todayList.length === 0 ? (
                <p className="t-small mr-landing__empty">오늘 예약이 없어요</p>
              ) : (
                <ul className="mr-landing__list">
                  {todayList.map((b) => (
                    <li key={b.id} className="mr-landing__item">
                      <span className="mr-landing__item-main">
                        <span className="t-body mr-landing__item-name">{b.organizerName}</span>
                        <span className="t-small t-muted t-num">
                          {hhmm(b.start)}–{hhmm(b.end)}
                        </span>
                      </span>
                      <span className="mr-landing__item-badges">
                        {b.isMine ? <Badge tone="mine">내 예약</Badge> : null}
                        {isNoShow(b, now, POLICY.checkInGraceMinutes) ? (
                          <Badge tone="attn">미체크인</Badge>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <div className="mr-landing__footer">
          <Link to="/" className="t-small mr-landing__gridlink">
            전체 예약 현황 보기
          </Link>
        </div>
      </main>

      {draft ? (
        <BookingDialog
          roomId={room.id}
          start={draft.start}
          end={draft.end}
          prefs={prefs}
          onClose={() => setDraft(null)}
          onCreated={() => {
            setDraft(null);
            bookingsState.reload();
          }}
        />
      ) : null}
    </div>
  );
}
