import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Badge, Button, ButtonWithReason, Card } from "../components/ui";
import { BookingDialog } from "./BookingDialog";
import { BrandMark } from "../auth/BrandMark";
import { useAsync } from "../app/useAsync";
import { appNow } from "../app/clock";
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

/** FREE 상태의 예약 프리셋. 정책 최소·최대 시간과 다음 예약 경계를 모두 지킨다. */
function buildFreePresets(now: Date, boundEnd: Date | null): Preset[] {
  const presets: Preset[] = [];
  const seenEnds = new Set<number>();

  const tryAdd = (minutes: number, label: string) => {
    if (minutes < POLICY.slotMinutes || minutes > POLICY.maxDurationMinutes) return;
    const end = new Date(now.getTime() + minutes * MINUTE);
    if (boundEnd && end.getTime() > boundEnd.getTime()) return;
    if (seenEnds.has(end.getTime())) return;
    seenEnds.add(end.getTime());
    presets.push({ label, start: now, end });
  };

  tryAdd(POLICY.slotMinutes, humanDuration(POLICY.slotMinutes) + " 예약하기");
  tryAdd(60, "1시간 예약하기");

  if (boundEnd) {
    const minutes = (boundEnd.getTime() - now.getTime()) / MINUTE;
    if (
      minutes >= POLICY.slotMinutes &&
      minutes <= POLICY.maxDurationMinutes &&
      !seenEnds.has(boundEnd.getTime())
    ) {
      presets.push({ label: hhmm(boundEnd) + "까지 예약하기", start: now, end: boundEnd });
    }
  }

  return presets;
}

/** BUSY 상태에서 "다음 빈 시간에 예약" 보조 액션이 잡을 기본 구간 */
function suggestedSlot(gap: Gap): { start: Date; end: Date } {
  return {
    start: gap.start,
    end: new Date(gap.start.getTime() + POLICY.slotMinutes * MINUTE),
  };
}

function gapFitsMinimum(gap: Gap): boolean {
  return gap.end.getTime() - gap.start.getTime() >= POLICY.slotMinutes * MINUTE;
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
      {/*
       * 로고 큐브를 여기 둔다. QR 랜딩은 "즉석에서 잡는 사람"(§13)이 가장 자주
       * 보는 화면인데, 정작 브랜드 앵커가 글자뿐이었다 — 정체성을 로고 한 자리에
       * 모은다는 규칙(§12-8)이 이 화면에서만 빠져 있었다.
       */}
      <BrandMark size={18} className="mr-landing__mark" />
      <span className="mr-landing__brand">MolRoom</span>
      <Link to="/" className="mr-landing__gridlink">
        전체 예약 현황
      </Link>
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
    return repo.listByRoom(roomId, appNow());
  }, [roomId, autoTick]);

  const prefsState = useAsync(() => repo.getPrefs(), []);

  const [draft, setDraft] = useState<{ start: Date; end: Date } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

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
                  {r.name} · {r.floor}
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
  const now = appNow();
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
  const nextLabel = boundEnd
    ? "다음 예약은 " + hhmm(boundEnd) + "에 있어요."
    : "오늘 남은 시간은 모두 비어 있어요.";

  const mineBooking = state.kind === "mine" ? state.booking : null;
  const extendPreview = mineBooking
    ? canExtend(mineBooking, bookings, POLICY.extendStepMinutes, POLICY)
    : null;
  const extendBlockedReason = extendPreview && !extendPreview.ok ? extendReasonText(extendPreview) : null;
  const roomLiveMessage =
    checkingIn
      ? "체크인하는 중이에요."
      : extending
        ? "연장하는 중이에요."
        : ending
          ? "회의를 끝내는 중이에요."
          : checkInError || extendError || endError
            ? ""
            : actionStatus ??
              (!hasData && bookingsState.loading
                ? "예약 정보를 불러오는 중이에요."
                : hasData && !bookingsState.loading && !bookingsState.error
                  ? "예약 정보를 불러왔어요."
                  : "");

  async function handleCheckIn() {
    if (!mineBooking) return;
    setCheckingIn(true);
    setCheckInError(null);
    setActionStatus(null);
    try {
      await repo.checkIn(mineBooking.id);
      setActionStatus("체크인했어요.");
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
    setActionStatus(null);
    try {
      // 연장 직전 재조회 — 오래된 화면 캐시로 판단하면 조용히 이중 예약이 된다 (설계 스펙 §6.2)
      const fresh = await repo.listByRoom(safeRoomId, appNow());
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
      setActionStatus(String(POLICY.extendStepMinutes) + "분 연장했어요.");
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
    setActionStatus(null);
    try {
      const result = await repo.changeEnd(mineBooking.id, appNow());
      if (!result.ok) {
        setEndError(result.reason === "blocked" ? result.by + "님 예약과 겹쳐요" : result.message);
        return;
      }
      setActionStatus("지금 회의를 끝냈어요.");
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
        <h1 className="t-display mr-landing__title">{room.name}</h1>
        <p className="t-body mr-landing__meta">
          {room.floor}
        </p>
        <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {roomLiveMessage}
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
                      <span className="t-body">지금 비어 있어요.</span>
                    </div>
                    <p className="t-small t-muted mr-landing__sub">{nextLabel}</p>
                  </Card>
                  <div className="mr-landing__presets">
                    {/* 채움 버튼은 하나만(§12-3). 나머지 프리셋은 **Weak 채움**이다 —
                        Toss 의 두 번째 액션은 아웃라인이 아니다(§4). 높이는 전부 동일. */}
                    {freePresets.length > 0 ? (
                      freePresets.map((p, i) => (
                        <Button
                          key={p.label}
                          block
                          variant={i === 0 ? "primary" : "secondary"}
                          onClick={() => setDraft({ start: p.start, end: p.end })}
                        >
                          {p.label}
                        </Button>
                      ))
                    ) : (
                      <p className="t-small mr-landing__empty">
                        다음 예약까지 {humanDuration(POLICY.slotMinutes)}보다 짧게 남아 새 예약을 만들 수
                        없어요.
                      </p>
                    )}
                  </div>
                </>
              ) : state.kind === "busy" ? (
                <>
                  <Card>
                    <div className="mr-landing__statusline">
                      <span className="mr-landing__dot" data-tone="busy" />
                      <span className="t-body">
                        {state.booking.organizerName}님이 사용 중이에요. {hhmm(state.booking.end)}에 끝나요.
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
                          {/*
                           * BUSY 상태에서도 이 버튼이 **주 액션**이다.
                           *
                           * 원래 Weak 채움(secondary)이었다. "사용 중인 방을 파랗게 권하는 건
                           * 과하다" 는 판단이었는데, 실제 화면에서 보면 이 화면에 액션이
                           * 이것뿐이라 사용자가 누를 것이 무엇인지 한 번 더 찾게 된다.
                           * 화면당 채움 하나(§12-3)는 "채움을 아껴라" 는 뜻이고,
                           * 유일한 액션을 흐리게 두라는 뜻이 아니다.
                           */}
                          {gapFitsMinimum(gap) ? (
                            <Button block onClick={() => setDraft(suggestedSlot(gap))}>
                              {hhmm(gap.start)}부터 예약하기
                            </Button>
                          ) : (
                            <p className="t-small mr-landing__empty">
                              빈 시간이 {humanDuration(POLICY.slotMinutes)}보다 짧아 새 예약을 만들 수 없어요.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="t-small mr-landing__gaplabel">오늘 남은 시간은 계속 사용 중이에요.</p>
                    )}
                  </Card>
                </>
              ) : (
                <Card mine>
                  <div className="mr-landing__mine-head">
                    <span className="mr-landing__dot" data-tone="busy" />
                    <span className="t-body">
                      내 회의가 진행 중이에요. {hhmm(state.booking.start)}–{hhmm(state.booking.end)}
                    </span>
                  </div>

                  <div className="mr-landing__mine-actions">
                    {state.booking.checkedInAt ? (
                      <p className="t-small mr-landing__checkedin">
                        체크인 완료 · {hhmm(state.booking.checkedInAt)}
                      </p>
                    ) : (
                      <Button block onClick={handleCheckIn} disabled={checkingIn}>
                        {checkingIn ? "체크인하는 중…" : "체크인하기"}
                      </Button>
                    )}

                    <div className="mr-landing__mine-row">
                      <ButtonWithReason
                        variant="secondary"
                        onClick={handleExtend}
                        disabled={extending || Boolean(extendBlockedReason)}
                        reason={extendBlockedReason}
                      >
                        {extending ? "연장하는 중…" : String(POLICY.extendStepMinutes) + "분 연장하기"}
                      </ButtonWithReason>
                      <Button variant="secondary" onClick={handleEndNow} disabled={ending}>
                        {ending ? "종료하는 중…" : "지금 종료하기"}
                      </Button>
                    </div>

                    {checkInError ? <Alert>{checkInError}</Alert> : null}
                    {extendError ? <Alert>{extendError}</Alert> : null}
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
                        <span className="t-small t-num mr-landing__item-time">
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

      </main>

      {draft ? (
        <BookingDialog
          roomId={room.id}
          start={draft.start}
          end={draft.end}
          prefs={prefs}
          onClose={() => setDraft(null)}
          onCreated={(_booking, notice) => {
            setDraft(null);
            setActionStatus(notice ?? "예약을 만들었어요.");
            bookingsState.reload();
          }}
        />
      ) : null}
    </div>
  );
}
