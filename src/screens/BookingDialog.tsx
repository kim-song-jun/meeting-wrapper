import { useState } from "react";
import { Alert, Button, Dialog, Field } from "../components/ui";
import { POLICY, roomById } from "../app/config";
import { repo } from "../data";
import { hhmm, humanDuration, validateDraft, MINUTE } from "../domain/time";
import type { Booking, Conference, UserPrefs } from "../domain/types";

const PROBLEM_TEXT: Record<string, string> = {
  "too-long": "한 번에 " + humanDuration(POLICY.maxDurationMinutes) + "까지 예약할 수 있어요",
  "too-far": String(POLICY.maxAdvanceDays) + "일 뒤까지만 예약할 수 있어요",
  "in-past": "이미 지난 시간이에요",
  "end-before-start": "종료 시각이 시작 시각보다 이르네요",
};

type VcKind = "none" | "meet" | "zoom";

export interface BookingDialogProps {
  roomId: string;
  start: Date;
  end: Date;
  prefs: UserPrefs;
  onClose: () => void;
  onCreated: (booking: Booking) => void;
}

export function BookingDialog({ roomId, start, end, prefs, onClose, onCreated }: BookingDialogProps) {
  const room = roomById(roomId);
  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState("");
  const [vc, setVc] = useState<VcKind>("meet");
  const [zoomUrl, setZoomUrl] = useState(prefs.defaultZoomUrl ?? "");
  const [saveZoom, setSaveZoom] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const problems = validateDraft({ start, end }, POLICY, new Date());
  const durationMin = (end.getTime() - start.getTime()) / MINUTE;
  const zoomMissing = vc === "zoom" && zoomUrl.trim().length === 0;
  const blocked = problems.length > 0 || zoomMissing;

  async function submit() {
    if (blocked || busy) return;
    setBusy(true);
    setFailure(null);

    let conference: Conference | null = null;
    if (vc === "meet") conference = { kind: "meet", url: null };
    if (vc === "zoom") conference = { kind: "zoom", url: zoomUrl.trim() };

    try {
      const result = await repo.create({
        roomId,
        title: title.trim().length > 0 ? title.trim() : "회의",
        start,
        end,
        attendeeEmails: attendees
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        conference,
      });

      if (result.ok) {
        if (vc === "zoom" && saveZoom) {
          await repo.savePrefs({ defaultZoomUrl: zoomUrl.trim() });
        }
        onCreated(result.booking);
        return;
      }

      // 실패를 삼키지 않는다 — 원인과 다음 행동을 함께 말한다 (DESIGN.md §10)
      if (result.reason === "taken") {
        setFailure("방금 " + result.by + "님이 이 시간을 예약했어요. 다른 시간을 골라주세요.");
      } else if (result.reason === "room-declined") {
        setFailure("회의실이 예약을 거절했어요. 이미 사용 중일 수 있습니다. 화면을 새로고침해 주세요.");
      } else {
        setFailure(result.message);
      }
    } catch (e: unknown) {
      setFailure(e instanceof Error ? e.message : "예약 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const subtitle =
    (room?.name ?? roomId) +
    " · " +
    String(room?.capacity ?? 0) +
    "인 · " +
    hhmm(start) +
    "–" +
    hhmm(end) +
    " (" +
    humanDuration(durationMin) +
    ")";

  return (
    <Dialog
      title="회의실 예약"
      subtitle={subtitle}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} disabled={blocked || busy}>
            {busy ? "예약하는 중…" : "예약하기"}
          </Button>
        </>
      }
    >
      {problems.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Alert>{problems.map((p) => PROBLEM_TEXT[p.code]).join(" · ")}</Alert>
        </div>
      ) : null}

      {failure ? (
        <div style={{ marginTop: 16 }}>
          <Alert>{failure}</Alert>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Field
          label="회의 제목"
          placeholder="주간 기획회의"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          hint="격자에는 주최자만 보이고 제목은 표시되지 않아요"
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <Field
          label="참석자"
          placeholder="name@molcube.com, name2@molcube.com"
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          hint="쉼표로 구분. 초대장과 캘린더 알림이 자동으로 갑니다"
        />
      </div>

      <fieldset style={{ marginTop: 16, border: "none", padding: 0, margin: "16px 0 0" }}>
        <legend className="mr-field__label" style={{ padding: 0 }}>
          화상회의
        </legend>
        {(
          [
            ["none", "없음"],
            ["meet", "Google Meet 자동 생성"],
            ["zoom", "Zoom"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="mr-row" style={{ gap: 8, padding: "4px 0" }}>
            <input
              type="radio"
              name="molroom-vc"
              checked={vc === value}
              onChange={() => setVc(value)}
            />
            <span>{label}</span>
          </label>
        ))}

        {vc === "zoom" ? (
          <div style={{ marginTop: 6 }}>
            <input
              className="mr-input"
              placeholder="https://zoom.us/j/..."
              value={zoomUrl}
              onChange={(e) => setZoomUrl(e.target.value)}
              aria-label="Zoom 링크"
            />
            <label className="mr-row" style={{ gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={saveZoom}
                onChange={(e) => setSaveZoom(e.target.checked)}
              />
              <span className="t-small">내 기본 링크로 저장 (폰에서도 자동으로 채워져요)</span>
            </label>
            {prefs.defaultZoomUrl && zoomUrl === prefs.defaultZoomUrl ? (
              <p className="mr-field__hint">저장된 기본 링크를 불러왔어요</p>
            ) : null}
            {zoomMissing ? <p className="mr-field__hint mr-field__hint--warn">Zoom 링크를 입력해 주세요</p> : null}
          </div>
        ) : null}
      </fieldset>
    </Dialog>
  );
}
