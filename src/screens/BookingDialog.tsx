import { useState } from "react";
import { Alert, Button, Dialog, Field, RadioGroup } from "../components/ui";
import { POLICY, roomById } from "../app/config";
import { appNow } from "../app/clock";
import { repo } from "../data";
import { hhmm, humanDuration, validateDraft, MINUTE } from "../domain/time";
import {
  describeRecurrence,
  expandRecurrence,
  lastOccurrenceExceedsAdvance,
  FREQ_LABEL,
  MAX_OCCURRENCES,
} from "../domain/recurrence";
import type { RecurrenceFreq, RecurrenceRule } from "../domain/recurrence";
import type { Booking, BookingDraft, Conference, DirectoryPerson, UserPrefs } from "../domain/types";
import type { RecurringCreateResult } from "../data/BookingRepository";
import { AttendeePicker } from "./AttendeePicker";
import { RecurrenceResult } from "./RecurrenceResult";

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
  const [headcount, setHeadcount] = useState(2);
  const [invitees, setInvitees] = useState<DirectoryPerson[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [vc, setVc] = useState<VcKind>("meet");
  const [zoomUrl, setZoomUrl] = useState(prefs.defaultZoomUrl ?? "");
  const [saveZoom, setSaveZoom] = useState(true);
  const [freq, setFreq] = useState<RecurrenceFreq | "none">("none");
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [recurrenceResult, setRecurrenceResult] = useState<RecurringCreateResult | null>(null);

  const now = appNow();
  const problems = validateDraft({ start, end }, POLICY, now);
  const durationMin = (end.getTime() - start.getTime()) / MINUTE;
  const zoomMissing = vc === "zoom" && zoomUrl.trim().length === 0;

  const recurrence: RecurrenceRule | null = freq === "none" ? null : { freq, count };
  // 마지막 회차가 선행 예약 한도를 넘는지는 반복 날짜를 실제로 펼쳐봐야 안다
  // (다섯째 요일 없는 달을 건너뛰면 "12회 뒤" 가 산술로 계산한 날짜와 달라진다).
  const advanceExceeded =
    recurrence !== null &&
    lastOccurrenceExceedsAdvance(expandRecurrence(start, end, recurrence), POLICY.maxAdvanceDays, now);

  const saveLabel = recurrence !== null ? String(recurrence.count) + "회 예약하기" : "예약하기";
  const savingLabel = recurrence !== null ? String(recurrence.count) + "회 예약하는 중…" : "예약하는 중…";

  const optionSummary = [
    invitees.length > 0 ? "참석자 " + String(invitees.length) + "명" : null,
    recurrence !== null ? FREQ_LABEL[recurrence.freq] + " " + String(recurrence.count) + "회" : null,
    vc === "meet" ? "Google Meet 자동 생성" : vc === "zoom" ? "Zoom" : "화상회의 없음",
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");

  function revealInvalidOption(id: string) {
    setOptionsOpen(true);
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function submit() {
    if (busy) return;
    if (problems.length > 0) return;
    if (zoomMissing) {
      revealInvalidOption("molroom-zoom-url");
      return;
    }
    if (advanceExceeded) {
      revealInvalidOption("molroom-recurrence-count");
      return;
    }
    setBusy(true);
    setFailure(null);

    let conference: Conference | null = null;
    if (vc === "meet") conference = { kind: "meet", url: null };
    if (vc === "zoom") conference = { kind: "zoom", url: zoomUrl.trim() };

    const draft: BookingDraft = {
      roomId,
      title: title.trim().length > 0 ? title.trim() : "회의",
      start,
      end,
      headcount,
      attendeeEmails: invitees.map((p) => p.email),
      conference,
      recurrence,
    };

    try {
      if (recurrence !== null) {
        const result = await repo.createRecurring(draft);

        // 최소 한 회차가 잡혔으면 그 회의들에 걸린 Zoom 링크이니 저장해도 된다.
        if (result.booked.length > 0 && vc === "zoom" && saveZoom) {
          await repo.savePrefs({ defaultZoomUrl: zoomUrl.trim() });
        }

        // 부분 성공이 정상 경로다 — 거절된 회차가 하나라도 있으면 조용히 닫지 않고
        // 결과 화면을 보여준다. "12회 다 잡혔겠지" 하고 넘어가면 그 방에 갔을 때
        // 다른 팀이 앉아 있다.
        if (result.rejected.length > 0) {
          setRecurrenceResult(result);
          return;
        }

        const first = result.booked[0];
        if (first) {
          onCreated(first);
        } else {
          setFailure("반복 예약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
        }
        return;
      }

      const result = await repo.create(draft);

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

  if (recurrenceResult) {
    return (
      <RecurrenceResult
        totalRequested={recurrenceResult.booked.length + recurrenceResult.rejected.length}
        booked={recurrenceResult.booked}
        rejected={recurrenceResult.rejected}
        onConfirm={() => {
          const first = recurrenceResult.booked[0];
          if (first) {
            onCreated(first);
          } else {
            onClose();
          }
        }}
      />
    );
  }

  const subtitle =
    (room?.name ?? roomId) +
    " · " +
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
      busy={busy}
      /* 데이터 입력 폼이므로 배경 클릭으로 닫지 않는다 (omd:feel MODAL 🟢).
         제목·인원·참석자·반복·Zoom 링크를 적다가 배경을 한 번 잘못 누르면 전부 사라진다. */
      dismissible={false}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? savingLabel : saveLabel}
          </Button>
        </>
      }
    >
      <div className="mr-form">
        {problems.length > 0 ? <Alert>{problems.map((p) => PROBLEM_TEXT[p.code]).join(" · ")}</Alert> : null}

        {failure ? <Alert>{failure}</Alert> : null}

        <Field
          label="회의 제목"
          placeholder="주간 기획회의"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          hint="격자에는 주최자만 보이고 제목은 표시되지 않아요"
        />

        {/* 인원은 항상 받는다 — 정원 검사의 기준이고, 초대와는 다른 값이다.
            ± 스테퍼라 QR 모바일에서 타이핑 없이 정할 수 있다. */}
        <div>
          <span className="mr-field__label">인원</span>
          <div className="mr-stepper">
            {/* 함수형 업데이터를 쓴다. setHeadcount(headcount + 1) 로 하면 연타할 때
                같은 렌더의 옛 값을 읽어 증가분이 유실된다 (실제로 4번 눌러 +1만 됨).
                secondary(44px)를 쓰는 이유: 이 다이얼로그는 모바일 QR 랜딩에서도 열린다.
                compact(36px)는 DESIGN.md §4 가 "데스크톱 격자 인접 컨텍스트에서만" 으로
                못박은 값이고, 모바일 터치 타깃 하한(44px)을 밑돈다. */}
            <Button
              variant="secondary"
              onClick={() => setHeadcount((n) => Math.max(1, n - 1))}
              disabled={headcount <= 1}
              aria-label="인원 줄이기"
            >
              −
            </Button>
            <span className="mr-stepper__value">{headcount}명</span>
            <Button
              variant="secondary"
              onClick={() => setHeadcount((n) => n + 1)}
              aria-label="인원 늘리기"
            >
              +
            </Button>
            {/* 정원 제한이 없으므로 초과 경고가 없다. 인원은 초대와 별개의 기록이라
                무엇에 쓰이는지만 밝힌다. */}
            <span className="mr-stepper__note">참석 인원 기록용 — 초대와 별개예요</span>
          </div>
        </div>

        <div>
          <button
            type="button"
            className="mr-disclosure"
            aria-expanded={optionsOpen}
            aria-controls="molroom-booking-options"
            onClick={() => {
              setOptionsOpen((open) => !open);
            }}
          >
            추가 옵션 · {optionSummary}
          </button>

          {optionsOpen ? (
            <div id="molroom-booking-options" className="mr-subsection">
              <span className="mr-field__label">참석자 초대 (선택)</span>
              <AttendeePicker selected={invitees} onChange={setInvitees} />
              <p className="mr-field__hint">초대장과 캘린더 알림이 자동으로 갑니다</p>

              <RadioGroup
                name="molroom-recurrence-freq"
                legend="반복 (선택)"
                value={freq}
                onChange={setFreq}
                options={[
                  { value: "none", label: "없음" },
                  { value: "weekly", label: FREQ_LABEL.weekly },
                  { value: "biweekly", label: FREQ_LABEL.biweekly },
                  { value: "monthly-nth-weekday", label: FREQ_LABEL["monthly-nth-weekday"] },
                ]}
              />

              {recurrence !== null ? (
                <div className="mr-subsection">
                  <label className="mr-field" htmlFor="molroom-recurrence-count">
                    <span className="mr-field__label">횟수</span>
                    <select
                      id="molroom-recurrence-count"
                      className="mr-input"
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                    >
                      {Array.from({ length: MAX_OCCURRENCES }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}회
                        </option>
                      ))}
                    </select>
                  </label>

                  <p className="mr-field__hint">{describeRecurrence(start, recurrence)}</p>

                  {advanceExceeded ? (
                    <div className="mr-subsection">
                      <Alert>
                        {"마지막 회차가 " + String(POLICY.maxAdvanceDays) + "일 선행 예약 한도를 넘어요. 횟수를 줄이거나 반복 주기를 바꿔 주세요."}
                      </Alert>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <RadioGroup
                name="molroom-vc"
                legend="화상회의"
                value={vc}
                onChange={setVc}
                options={[
                  { value: "none", label: "없음" },
                  { value: "meet", label: "Google Meet 자동 생성" },
                  { value: "zoom", label: "Zoom" },
                ]}
              />

              {vc === "zoom" ? (
                <div className="mr-subsection">
                  {zoomMissing ? <Alert>Zoom 링크를 입력해 주세요.</Alert> : null}
                  <input
                    id="molroom-zoom-url"
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
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
