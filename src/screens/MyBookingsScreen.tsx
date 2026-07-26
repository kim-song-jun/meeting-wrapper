import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, Dialog, Field, Tabs } from "../components/ui";
import type { TabItem } from "../components/ui";
import { roomById } from "../app/config";
import { repo } from "../data";
import { useAsync } from "../app/useAsync";
import { hhmm, humanDuration, MINUTE } from "../domain/time";
import type { Booking, UserPrefs } from "../domain/types";
import "../styles/mine.css";

const MINE_TABS: TabItem[] = [
  { id: "mine", label: "내 예약" },
  { id: "all", label: "전체 예약" },
  { id: "settings", label: "설정" },
];

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
      <p className="mine-user">
        {user.name} · {user.email}
        {user.isAdmin ? " · 관리자" : ""}
      </p>
      <Tabs items={tabs} active={effectiveTab} onChange={setActive} />
      <div className="mine-section">
        {effectiveTab === "mine" ? <MineTab /> : null}
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

function BookingItem({ booking, onCancel }: { booking: Booking; onCancel: () => void }) {
  const room = roomById(booking.roomId);
  const durationMin = (booking.end.getTime() - booking.start.getTime()) / MINUTE;
  const link = conferenceUrl(booking);

  return (
    <Card mine>
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
        </div>
        <div className="mine-item__actions">
          {/* "취소" 단독은 예약 모달의 "닫기" 뜻과 혼동된다. 무엇을 지우는지 밝힌다. */}
          <Button variant="secondary" onClick={onCancel}>
            예약 취소
          </Button>
        </div>
      </div>
    </Card>
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
      actions={
        <>
          {/* "닫기" 가 아니라 "유지" — 무엇이 남는지를 말한다. GridScreen 과 같은 라벨 */}
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            유지
          </Button>
          <Button onClick={confirmCancel} disabled={busy}>
            {busy ? "취소하는 중…" : "취소 확정"}
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
    <Card mine={booking.isMine}>
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
          <Button variant="secondary" onClick={onCancel}>
            예약 취소
          </Button>
        </div>
      </div>
    </Card>
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
          {saving ? "저장하는 중…" : "저장"}
        </Button>
        {saved ? <span className="mine-settings-success">저장했어요</span> : null}
      </div>
    </Card>
  );
}
