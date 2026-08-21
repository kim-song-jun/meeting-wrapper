import { useId, useState } from "react";
import { Alert, Button, Dialog, Field, RadioGroup } from "../components/ui";
import { POLICY, roomById } from "../app/config";
import { appNow } from "../app/clock";
import { repo } from "../data";
import { hhmm, humanDuration, validateDraft, MINUTE } from "../domain/time";
import type { DraftProblem } from "../domain/time";
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
import {
  ScheduleFields,
  scheduleDraftFrom,
  scheduleDraftRange,
  scheduleInputStepMinutes,
} from "./ScheduleFields";
import type { ScheduleDraft, ScheduleFieldErrors } from "./ScheduleFields";

const PROBLEM_TEXT: Record<string, string> = {
  "too-long": "한 번에 " + humanDuration(POLICY.maxDurationMinutes) + "까지 예약할 수 있어요",
  "too-far": String(POLICY.maxAdvanceDays) + "일 뒤까지만 예약할 수 있어요",
  "in-past": "이미 지난 시간이에요",
  "end-before-start": "종료 시각이 시작 시각보다 이르네요",
};

type VcKind = "none" | "meet" | "zoom";

function zoomUrlProblem(value: string): string | null {
  if (value.trim().length === 0) return "Zoom 링크를 입력해 주세요.";
  try {
    const url = new URL(value.trim());
    const isZoomHost = url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us");
    return url.protocol === "https:" && isZoomHost
      ? null
      : "https로 시작하는 zoom.us 링크를 입력해 주세요.";
  } catch {
    return "https로 시작하는 zoom.us 링크를 입력해 주세요.";
  }
}

function scheduleFieldErrors(
  schedule: ScheduleDraft,
  problems: readonly DraftProblem[],
): ScheduleFieldErrors {
  const errors: ScheduleFieldErrors = {};
  if (schedule.date.length === 0) errors.date = "날짜를 선택해 주세요.";
  if (schedule.startTime.length === 0) errors.startTime = "시작 시각을 선택해 주세요.";
  if (schedule.endTime.length === 0) errors.endTime = "종료 시각을 선택해 주세요.";

  for (const problem of problems) {
    if (problem.code === "too-far") {
      errors.date = `${problem.maxDays}일 뒤까지만 예약할 수 있어요.`;
    } else if (problem.code === "end-before-start") {
      errors.endTime = "종료 시각은 시작 시각보다 뒤여야 해요.";
    } else if (problem.code === "too-long") {
      errors.endTime = `한 번에 ${humanDuration(problem.maxMinutes)}까지 예약할 수 있어요.`;
    } else if (problem.code === "in-past") {
      errors.endTime = "이미 지난 시각이에요.";
    }
  }

  return errors;
}

export interface BookingDialogProps {
  roomId: string;
  start: Date;
  end: Date;
  prefs: UserPrefs;
  onClose: () => void;
  onCreated: (booking: Booking, notice?: string) => void;
}

export function BookingDialog({ roomId, start, end, prefs, onClose, onCreated }: BookingDialogProps) {
  const formId = useId();
  const [schedule, setSchedule] = useState(() => scheduleDraftFrom(roomId, start, end));
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
  const [recurrenceWarning, setRecurrenceWarning] = useState<string | null>(null);
  const [zoomTouched, setZoomTouched] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  const now = appNow();
  const selectedRange = scheduleDraftRange(schedule);
  const selectedStart = selectedRange?.start ?? start;
  const selectedEnd = selectedRange?.end ?? end;
  const room = roomById(schedule.roomId);
  const problems = selectedRange
    ? validateDraft({ start: selectedStart, end: selectedEnd }, POLICY, now)
    : [{ code: "end-before-start" } as const];
  const durationMin = (selectedEnd.getTime() - selectedStart.getTime()) / MINUTE;
  const zoomProblem = vc === "zoom" ? zoomUrlProblem(zoomUrl) : null;
  const showZoomProblem = zoomProblem !== null && (zoomTouched || attemptedSubmit);
  const fieldErrors = scheduleFieldErrors(schedule, problems);
  const scheduleStepMinutes = scheduleInputStepMinutes(start, end);

  const recurrence: RecurrenceRule | null = freq === "none" ? null : { freq, count };
  // 마지막 회차가 선행 예약 한도를 넘는지는 반복 날짜를 실제로 펼쳐봐야 안다
  // (다섯째 요일 없는 달을 건너뛰면 "12회 뒤" 가 산술로 계산한 날짜와 달라진다).
  const advanceExceeded =
    recurrence !== null &&
    lastOccurrenceExceedsAdvance(
      expandRecurrence(selectedStart, selectedEnd, recurrence),
      POLICY.maxAdvanceDays,
      now,
    );

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

  function focusFirstInvalidScheduleField() {
    requestAnimationFrame(() => {
      document
        .getElementById(formId)
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    });
  }

  async function submit() {
    if (busy) return;
    setAttemptedSubmit(true);
    if (problems.length > 0) {
      focusFirstInvalidScheduleField();
      return;
    }
    if (zoomProblem !== null) {
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
      roomId: schedule.roomId,
      title: title.trim().length > 0 ? title.trim() : "회의",
      start: selectedStart,
      end: selectedEnd,
      headcount,
      attendeeEmails: invitees.map((p) => p.email),
      conference,
      recurrence,
    };

    try {
      if (recurrence !== null) {
        const result = await repo.createRecurring(draft);

        let preferenceWarning: string | null = null;
        // 예약 결과와 개인 설정 저장은 서로 다른 계약이다. 설정 저장 실패가 이미
        // 만들어진 회차를 숨기거나 사용자가 다시 제출하게 만들면 중복 예약이 된다.
        if (result.booked.length > 0 && vc === "zoom" && saveZoom) {
          try {
            await repo.savePrefs({ defaultZoomUrl: zoomUrl.trim() });
          } catch {
            preferenceWarning = "예약은 완료됐지만 기본 Zoom 링크는 저장하지 못했어요. 설정에서 다시 저장해 주세요.";
          }
        }

        // 부분 성공이 정상 경로다 — 거절된 회차가 하나라도 있으면 조용히 닫지 않고
        // 결과 화면을 보여준다. "12회 다 잡혔겠지" 하고 넘어가면 그 방에 갔을 때
        // 다른 팀이 앉아 있다.
        if (result.rejected.length > 0) {
          setRecurrenceWarning(preferenceWarning);
          setRecurrenceResult(result);
          return;
        }

        const first = result.booked[0];
        if (first) {
          onCreated(first, preferenceWarning ?? undefined);
        } else {
          setFailure("반복 예약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
        }
        return;
      }

      const result = await repo.create(draft);

      if (result.ok) {
        let preferenceWarning: string | null = null;
        if (vc === "zoom" && saveZoom) {
          try {
            await repo.savePrefs({ defaultZoomUrl: zoomUrl.trim() });
          } catch {
            preferenceWarning = "예약은 완료됐지만 기본 Zoom 링크는 저장하지 못했어요. 설정에서 다시 저장해 주세요.";
          }
        }
        onCreated(result.booking, preferenceWarning ?? undefined);
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
            onCreated(first, recurrenceWarning ?? undefined);
          } else {
            onClose();
          }
        }}
      />
    );
  }

  const subtitle =
    (room?.name ?? schedule.roomId) +
    " · " +
    hhmm(selectedStart) +
    "–" +
    hhmm(selectedEnd) +
    " (" +
    humanDuration(durationMin) +
    ")";

  return (
    <Dialog
      title="회의실 예약"
      subtitle={subtitle}
      onClose={onClose}
      busy={busy}
      /* 데이터 입력 폼이므로 배경 클릭으로 닫지 않는다 (dialog safety rule).
         제목·인원·참석자·반복·Zoom 링크를 적다가 배경을 한 번 잘못 누르면 전부 사라진다. */
      dismissible={false}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button className="mr-booking-submit" type="submit" form={formId} disabled={busy}>
            {busy ? savingLabel : saveLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="mr-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {problems.length > 0 ? <Alert>{problems.map((p) => PROBLEM_TEXT[p.code]).join(" · ")}</Alert> : null}

        {failure ? <Alert>{failure}</Alert> : null}

        <ScheduleFields
          value={schedule}
          onChange={setSchedule}
          now={now}
          stepMinutes={scheduleStepMinutes}
          errors={fieldErrors}
        />

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

                  <p className="mr-field__hint">{describeRecurrence(selectedStart, recurrence)}</p>

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
                  <Field
                    id="molroom-zoom-url"
                    label="Zoom 링크"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://zoom.us/j/..."
                    value={zoomUrl}
                    onChange={(event) => {
                      setZoomUrl(event.target.value);
                      setZoomTouched(true);
                    }}
                    onBlur={() => setZoomTouched(true)}
                    aria-invalid={showZoomProblem || undefined}
                    hint={
                      showZoomProblem
                        ? (zoomProblem ?? undefined)
                        : prefs.defaultZoomUrl && zoomUrl === prefs.defaultZoomUrl
                          ? "저장된 기본 링크를 불러왔어요"
                          : "회의에 사용할 zoom.us 초대 링크를 붙여넣어 주세요"
                    }
                    hintTone={showZoomProblem ? "warn" : "muted"}
                  />
                  <label className="mr-row" style={{ gap: 8, marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={saveZoom}
                      onChange={(e) => setSaveZoom(e.target.checked)}
                    />
                    <span className="t-small">내 기본 링크로 저장 (폰에서도 자동으로 채워져요)</span>
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
