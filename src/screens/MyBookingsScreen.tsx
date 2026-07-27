import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  ButtonWithReason,
  Card,
  Dialog,
  Field,
  Tabs,
  TextAreaField,
} from "../components/ui";
import type { TabItem } from "../components/ui";
import { roomById } from "../app/config";
import { repo } from "../data";
import { useAsync } from "../app/useAsync";
import { hhmm, humanDuration, MINUTE } from "../domain/time";
import { summaryToMarkdown } from "../domain/summaryExport";
import type { Booking, UserPrefs } from "../domain/types";
import "../styles/mine.css";

const MINE_TABS: TabItem[] = [
  { id: "mine", label: "내 예약" },
  { id: "past", label: "지난 예약" },
  { id: "all", label: "전체 예약" },
  { id: "settings", label: "설정" },
];

/**
 * 지난 예약을 한 번에 몇 건까지 가져올지. 지난 것은 끝없이 쌓이므로 화면이 감당할
 * 만큼만 읽는다. "더 보기" 는 두지 않았다 — 회의 기록을 뒤로 넘겨가며 찾는 화면이
 * 아니라 방금 끝난 회의에 한 줄 남기는 화면이다.
 */
const PAST_LIMIT = 30;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayLabel(d: Date, now: Date): string {
  const diffDays = Math.round(
    (startOfDay(d).getTime() - startOfDay(now).getTime()) / (24 * 60 * MINUTE),
  );
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "내일";
  return String(d.getMonth() + 1) + "월 " + String(d.getDate()) + "일";
}

function conferenceUrl(booking: Booking): string | null {
  if (booking.conference && booking.conference.url) return booking.conference.url;
  return null;
}

/** 취소 대상. 셀 프라이버시 규칙과 무관하게 이 목록은 내 예약 또는 관리자 뷰이므로 이름을 보여준다. */
/**
 * 실패했을 때 한 번에 다시 시도할 수 있게 한다.
 * useAsync 가 reload() 를 이미 주는데 "새로고침해 주세요" 로만 끝내면
 * 사용자가 브라우저를 직접 새로고침해야 한다.
 */
function LoadError({ what, error, onRetry }: { what: string; error: Error; onRetry: () => void }) {
  return (
    <Alert>
      <span>
        {what}을 불러오지 못했어요 ({error.message}).
      </span>{" "}
      {/* secondary(44px) — /me 는 모바일에서도 그대로 열리고 데스크톱 격자 인접 컨텍스트가 아니다 */}
      <Button variant="secondary" onClick={onRetry}>
        다시 시도
      </Button>
    </Alert>
  );
}

interface CancelTarget {
  booking: Booking;
  /** 관리자가 남의 예약을 취소하는 경우 문구가 달라진다 */
  isAdminAction: boolean;
}

export function MyBookingsScreen() {
  const [active, setActive] = useState("mine");
  const userState = useAsync(() => repo.getCurrentUser(), []);

  const tabs = useMemo(() => {
    if (userState.data?.isAdmin) return MINE_TABS;
    return MINE_TABS.filter((t) => t.id !== "all");
  }, [userState.data?.isAdmin]);

  if (userState.loading) {
    return <p className="mr-state">불러오는 중…</p>;
  }
  if (userState.error) {
    return <LoadError what="사용자 정보" error={userState.error} onRetry={userState.reload} />;
  }
  const user = userState.data;
  if (!user) return null;

  // 관리자가 아닌데 URL 조작 등으로 all 탭이 선택돼 있으면 mine 으로 되돌린다
  const effectiveTab = active === "all" && !user.isAdmin ? "mine" : active;

  return (
    <div>
      <h1 className="t-title mine-title">내 예약</h1>
      <p className="mine-user t-small t-muted">
        {user.name} · {user.email}
        {user.isAdmin ? " · 관리자" : ""}
      </p>
      <Tabs items={tabs} active={effectiveTab} onChange={setActive} />
      <div className="mine-section">
        {effectiveTab === "mine" ? <MineTab /> : null}
        {effectiveTab === "past" ? <PastTab /> : null}
        {effectiveTab === "all" && user.isAdmin ? <AllTab /> : null}
        {effectiveTab === "settings" ? <SettingsTab /> : null}
      </div>
    </div>
  );
}

/* ---------------- 내 예약 ---------------- */

function MineTab() {
  const state = useAsync(() => repo.listMine(), []);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  if (state.loading) return <p className="mr-state">불러오는 중…</p>;
  if (state.error) {
    return (
      <LoadError what="예약 목록" error={state.error} onRetry={state.reload} />
    );
  }
  const bookings = state.data ?? [];

  if (bookings.length === 0) {
    return (
      <p className="mine-empty">
        앞으로 잡힌 예약이 없어요. <Link to="/">예약 현황</Link>에서 회의실을 잡아보세요.
      </p>
    );
  }

  const now = new Date();
  const groups: { label: string; items: Booking[] }[] = [];
  for (const b of [...bookings].sort((a, c) => a.start.getTime() - c.start.getTime())) {
    const label = dayLabel(b.start, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(b);
    } else {
      groups.push({ label, items: [b] });
    }
  }

  return (
    <>
      {groups.map((g) => (
        <div key={g.label} className="mine-section">
          <h2 className="mine-day-heading">{g.label}</h2>
          <div className="mine-list">
            {g.items.map((b) => (
              <BookingItem
                key={b.id}
                booking={b}
                now={now}
                onChanged={state.reload}
                onCancel={() => setCancelTarget({ booking: b, isAdminAction: false })}
              />
            ))}
          </div>
        </div>
      ))}

      {cancelTarget ? (
        <CancelDialog
          target={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            setCancelTarget(null);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

function BookingItem({
  booking,
  now,
  onChanged,
  onCancel,
}: {
  booking: Booking;
  now: Date;
  onChanged: () => void;
  onCancel: () => void;
}) {
  const room = roomById(booking.roomId);
  const durationMin = (booking.end.getTime() - booking.start.getTime()) / MINUTE;
  const link = conferenceUrl(booking);

  const [checkedInAt, setCheckedInAt] = useState<Date | null>(booking.checkedInAt);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const started = now.getTime() >= booking.start.getTime();

  /*
   * 체크인은 QR 랜딩과 격자 상세에만 있었다. 이 화면은 "내 오늘 일정" 을 보는 곳이라
   * 회의 직전에 여는 경우가 많은데, 여기서만 체크인이 안 되면 QR 을 찾으러 가야 했다.
   */
  async function checkIn() {
    setCheckingIn(true);
    setCheckInError(null);
    try {
      await repo.checkIn(booking.id);
      setCheckedInAt(new Date());
      onChanged();
    } catch (e: unknown) {
      setCheckInError(
        e instanceof Error ? e.message : "체크인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setCheckingIn(false);
    }
  }

  return (
    <div className="mine-item">
      <div className="mine-item__main">
        <span className="mine-item__room">{room?.name ?? booking.roomId}</span>
        <span className="mine-item__meta t-num">
          {hhmm(booking.start)}–{hhmm(booking.end)} ({humanDuration(durationMin)}) · 인원{" "}
          {booking.headcount}명
          {booking.attendeeCount > 0 ? " · 초대 " + String(booking.attendeeCount) + "명" : null}
        </span>
        {link ? (
          <a className="mine-item__link" href={link} target="_blank" rel="noreferrer">
            {link}
          </a>
        ) : null}
        {checkedInAt ? (
          <span className="mine-item__checkedin t-small">체크인 완료 · {hhmm(checkedInAt)}</span>
        ) : null}
        {checkInError ? (
          <div style={{ marginTop: 8 }}>
            <Alert>{checkInError}</Alert>
          </div>
        ) : null}
      </div>
      <div className="mine-item__actions">
        {checkedInAt ? null : (
          /* 시작 전에는 누를 수 없다. 숨기지 않고 언제부터 되는지 적는다 (DESIGN.md §4·§10). */
          <ButtonWithReason
            variant="secondary"
            onClick={checkIn}
            disabled={!started || checkingIn}
            reason={!started ? hhmm(booking.start) + " 부터 체크인할 수 있어요" : null}
          >
            {checkingIn ? "체크인하는 중…" : "체크인하기"}
          </ButtonWithReason>
        )}
        {/* "취소" 단독은 예약 모달의 "닫기" 뜻과 혼동된다. 무엇을 지우는지 밝힌다. */}
        <Button variant="danger" onClick={onCancel}>
          예약 취소
        </Button>
      </div>
    </div>
  );
}

/* ---------------- 지난 예약 ---------------- */

/**
 * 이미 끝난 내 회의. 여기서 하는 일은 하나다 — **무엇을 정했는지 한 줄 남기기.**
 *
 * 취소·체크인 버튼을 함께 두지 않는다. 끝난 회의에는 할 수 없는 동작이고,
 * 회색으로 비활성만 걸어두면 화면 절반이 못 누르는 버튼이 된다.
 */
function PastTab() {
  const state = useAsync(() => repo.listMinePast(PAST_LIMIT), []);

  if (state.loading) return <p className="mr-state">불러오는 중…</p>;
  if (state.error) {
    return <LoadError what="지난 예약" error={state.error} onRetry={state.reload} />;
  }
  const bookings = state.data ?? [];

  if (bookings.length === 0) {
    return <p className="mine-empty">아직 끝난 회의가 없어요.</p>;
  }

  return (
    <>
      <p className="mine-admin-note">
        회의에서 정한 것을 남겨두면 초대받은 분들의 캘린더에서도 그대로 보여요. 최근 {PAST_LIMIT}건까지
        보여드려요.
      </p>
      <div className="mine-list">
        {bookings.map((b) => (
          <PastBookingItem key={b.id} booking={b} />
        ))}
      </div>
    </>
  );
}

function PastBookingItem({ booking }: { booking: Booking }) {
  const room = roomById(booking.roomId);
  const durationMin = (booking.end.getTime() - booking.start.getTime()) / MINUTE;

  const [summary, setSummary] = useState<string | null>(booking.summary);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(booking.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * 복사 결과. 성공했으면 무슨 일이 일어났는지, 실패했으면 원인과 다음 행동을
   * 말한다(§10). 조용히 실패하면 사용자는 붙여넣기를 하고 나서야 알게 된다.
   */
  const [copyState, setCopyState] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = draft.trim() !== (summary ?? "");

  async function copyMarkdown() {
    const md = summaryToMarkdown({ ...booking, summary }, room?.name ?? booking.roomId);
    try {
      await navigator.clipboard.writeText(md);
      setCopyState({ ok: true, text: "복사했어요. Notion·Slack 어디든 붙여넣으면 돼요" });
    } catch {
      /*
       * 클립보드는 권한·보안 컨텍스트에 따라 막힌다(http, 권한 거부 등).
       * 빈 catch 로 넘기면 "눌렀는데 아무 일도 안 일어남" 이 된다 — 사유를 말한다.
       */
      setCopyState({ ok: false, text: "복사가 막혀 있어요. 위에 보이는 요약을 직접 끌어서 복사해 주세요" });
    }
  }

  async function save() {
    setSaving(true);
    setFailure(null);
    // 요약이 바뀌면 직전 복사 안내는 거짓말이 된다(복사해 둔 것은 옛 내용이다)
    setCopyState(null);
    try {
      await repo.saveSummary(booking.id, draft);
      const trimmed = draft.trim();
      setSummary(trimmed.length > 0 ? trimmed : null);
      setEditing(false);
    } catch (e: unknown) {
      setFailure(e instanceof Error ? e.message : "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  const dateLabel =
    String(booking.start.getMonth() + 1) + "월 " + String(booking.start.getDate()) + "일";

  return (
    <div className="mine-item mine-item--past">
      <div className="mine-item__main">
        <span className="mine-item__room">{room?.name ?? booking.roomId}</span>
        <span className="mine-item__meta t-num">
          {dateLabel} {hhmm(booking.start)}–{hhmm(booking.end)} ({humanDuration(durationMin)})
          {booking.attendeeCount > 0 ? " · 초대 " + String(booking.attendeeCount) + "명" : null}
        </span>
        {booking.checkedInAt === null ? (
          <span className="mine-item__meta">체크인하지 않은 회의예요</span>
        ) : null}

        {editing ? (
          <div className="mine-summary-edit">
            <TextAreaField
              label="회의 요약"
              placeholder="무엇을 정했는지 한두 줄로 남겨주세요"
              value={draft}
              rows={3}
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              hint={"초대받은 " + String(booking.attendeeCount) + "명의 캘린더에도 함께 보여요"}
            />
            {failure ? (
              <div style={{ marginTop: 12 }}>
                <Alert>{failure}</Alert>
              </div>
            ) : null}
            <div className="mine-summary-actions">
              <Button onClick={save} disabled={saving || !dirty}>
                {saving ? "저장하는 중…" : "요약 저장하기"}
              </Button>
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setDraft(summary ?? "");
                  setFailure(null);
                  setEditing(false);
                }}
              >
                그만두기
              </Button>
              {!saving && !dirty ? <span className="mr-reason">바뀐 내용이 없어요</span> : null}
            </div>
          </div>
        ) : summary ? (
          <p className="mine-summary t-body">{summary}</p>
        ) : null}
      </div>

      {editing ? null : (
        <div className="mine-item__actions">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {summary ? "요약 고치기" : "회의 요약 남기기"}
          </Button>
          {/*
            요약이 있을 때만 내보내기를 연다 — 없는 것을 복사할 이유가 없다.
            Notion API 는 브라우저에서 직접 못 부르므로(CORS, summaryExport.ts 참고)
            "복사 → 붙여넣기" 두 걸음으로 나눈다. 두 번째 버튼은 붙여넣을 빈 페이지를
            열어 줄 뿐이고, 내용을 실어 보내지는 않는다 — 그래서 라벨도 "열기" 다.
          */}
          {summary ? (
            <>
              <Button variant="secondary" onClick={() => void copyMarkdown()}>
                요약 복사하기
              </Button>
              <a
                className="mine-item__link"
                href="https://www.notion.new"
                target="_blank"
                rel="noreferrer noopener"
              >
                Notion 새 페이지 열기
              </a>
            </>
          ) : null}
        </div>
      )}
      {copyState ? (
        <p className={copyState.ok ? "mine-item__copied" : "mine-item__copyfail"} role="status">
          {copyState.text}
        </p>
      ) : null}
    </div>
  );
}

function CancelDialog({
  target,
  onClose,
  onCancelled,
}: {
  target: CancelTarget;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const { booking, isAdminAction } = target;
  const room = roomById(booking.roomId);
  const now = new Date();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // 참석자가 없으면 알림 문구를 붙이지 않는다.
  // 무조건 붙이면 "참석자 0명에게 취소 알림이 갑니다" 라는 말이 안 되는 문장이 나온다.
  const message =
    (room?.name ?? booking.roomId) +
    " · " +
    dayLabel(booking.start, now) +
    " " +
    hhmm(booking.start) +
    "~" +
    hhmm(booking.end) +
    " 예약을 취소합니다." +
    (booking.attendeeCount > 0
      ? " 참석자 " + String(booking.attendeeCount) + "명에게 취소 알림이 갑니다."
      : "");

  async function confirmCancel() {
    setBusy(true);
    setFailure(null);
    try {
      await repo.cancel(booking.id);
      onCancelled();
    } catch (e: unknown) {
      setFailure(e instanceof Error ? e.message : "취소 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
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
          {/* "닫기" 가 아니라 "유지" — 무엇이 남는지를 말한다. GridScreen 과 같은 라벨 */}
          {/* 안전한 쪽(유지)이 주 액션이다. 파괴적인 쪽은 빨간 글자로만 둔다. */}
          <Button onClick={onClose} disabled={busy}>
            유지
          </Button>
          <Button variant="danger" onClick={confirmCancel} disabled={busy}>
            {busy ? "취소하는 중…" : "예약 취소하기"}
          </Button>
        </>
      }
    >
      <p className="t-body">{message}</p>
      {isAdminAction ? (
        <p className="mine-admin-note" style={{ marginTop: 12 }}>
          주최자 {booking.organizerName}님에게 관리자 취소 알림이 갑니다.
        </p>
      ) : null}
      {failure ? (
        <div style={{ marginTop: 16 }}>
          <Alert>{failure}</Alert>
        </div>
      ) : null}
    </Dialog>
  );
}

/* ---------------- 전체 예약 (관리자) ---------------- */

function AllTab() {
  const todayRef = useRef(new Date());
  const state = useAsync(() => repo.listByDay(todayRef.current), []);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  if (state.loading) return <p className="mr-state">불러오는 중…</p>;
  if (state.error) {
    return (
      <LoadError what="오늘 예약 전체" error={state.error} onRetry={state.reload} />
    );
  }
  const bookings = state.data ?? [];

  const byRoom = new Map<string, Booking[]>();
  for (const b of [...bookings].sort((a, c) => a.start.getTime() - c.start.getTime())) {
    const list = byRoom.get(b.roomId);
    if (list) list.push(b);
    else byRoom.set(b.roomId, [b]);
  }

  return (
    <>
      <p className="mine-admin-note">
        관리자 취소는 그 방에서 예약을 제거하고 주최자에게 알림을 보냅니다. 오늘 예약만 표시됩니다.
      </p>

      {byRoom.size === 0 ? (
        <p className="mine-empty">오늘 잡힌 예약이 없어요.</p>
      ) : (
        [...byRoom.entries()].map(([roomId, items]) => (
          <div key={roomId} className="mine-section">
            <h2 className="mine-room-heading">{roomById(roomId)?.name ?? roomId}</h2>
            <div className="mine-list">
              {items.map((b) => (
                <AdminBookingItem
                  key={b.id}
                  booking={b}
                  onCancel={() => setCancelTarget({ booking: b, isAdminAction: true })}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {cancelTarget ? (
        <CancelDialog
          target={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            setCancelTarget(null);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

function AdminBookingItem({ booking, onCancel }: { booking: Booking; onCancel: () => void }) {
  const durationMin = (booking.end.getTime() - booking.start.getTime()) / MINUTE;
  return (
    <div className="mine-item">
      <div className="mine-item__main">
        <span className="mine-item__room">{booking.organizerName}</span>
        <span className="mine-item__meta t-num">
          {hhmm(booking.start)}–{hhmm(booking.end)} ({humanDuration(durationMin)})
        </span>
        {booking.isMine ? <Badge tone="mine">내 예약</Badge> : null}
      </div>
      <div className="mine-item__actions">
        {/* "취소" 단독은 예약 모달의 "닫기" 뜻과 혼동된다. 무엇을 지우는지 밝힌다. */}
        <Button variant="danger" onClick={onCancel}>
          예약 취소
        </Button>
      </div>
    </div>
  );
}

/* ---------------- 설정 ---------------- */

function looksLikeHttpsUrl(v: string): boolean {
  if (v.trim().length === 0) return true; // 빈 값 = 기본 링크 없음, 허용
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function SettingsTab() {
  const state = useAsync(() => repo.getPrefs(), []);

  if (state.loading) return <p className="mr-state">불러오는 중…</p>;
  if (state.error) {
    return (
      <LoadError what="설정" error={state.error} onRetry={state.reload} />
    );
  }
  if (!state.data) return null;

  return <SettingsForm initial={state.data} />;
}

function SettingsForm({ initial }: { initial: UserPrefs }) {
  const [value, setValue] = useState(initial.defaultZoomUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const valid = looksLikeHttpsUrl(value);
  const dirty = value !== (initial.defaultZoomUrl ?? "");

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      const trimmed = value.trim();
      await repo.savePrefs({ defaultZoomUrl: trimmed.length > 0 ? trimmed : null });
      setSaved(true);
    } catch (e: unknown) {
      setFailure(e instanceof Error ? e.message : "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mine-settings-card">
      <Field
        label="기본 Zoom 링크"
        placeholder="https://zoom.us/j/..."
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        hint={!valid ? "https 로 시작하는 링크를 입력해 주세요. 비워두면 기본 링크가 없어요" : undefined}
        hintTone={!valid ? "warn" : "muted"}
      />
      <p className="mine-settings-note">
        기기가 아니라 클라우드에 저장돼요. 그래야 복도에서 QR 로 예약할 때 폰에서도 같은 링크가 자동으로
        채워집니다.
      </p>

      {failure ? (
        <div style={{ marginTop: 16 }}>
          <Alert>{failure}</Alert>
        </div>
      ) : null}

      <div className="mine-settings-actions">
        <Button onClick={save} disabled={!valid || !dirty || saving}>
          {saving ? "저장하는 중…" : "이 링크로 저장하기"}
        </Button>
        {/*
         * 비활성 사유는 항상 눈에 보여야 한다 (DESIGN.md §4·§10 — 툴팁 금지).
         * 저장 중일 때는 버튼 레이블이 이미 사유를 말하므로 겹쳐 적지 않는다.
         */}
        {!saving && !valid ? <span className="mr-reason">위 링크를 확인해 주세요</span> : null}
        {!saving && valid && !dirty ? (
          <span className="mr-reason">바뀐 내용이 없어요</span>
        ) : null}
        {saved ? <span className="mine-settings-success">저장했어요</span> : null}
      </div>
    </Card>
  );
}
