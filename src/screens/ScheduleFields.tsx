import { useId } from "react";
import { POLICY, ROOMS } from "../app/config";

export interface ScheduleDraft {
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface ScheduleFieldErrors {
  roomId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

function dateValue(value: Date): string {
  return `${String(value.getFullYear())}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function timeValue(value: Date): string {
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

export function scheduleDraftFrom(roomId: string, start: Date, end: Date): ScheduleDraft {
  return {
    roomId,
    date: dateValue(start),
    startTime: timeValue(start),
    endTime: timeValue(end),
  };
}

function localDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const dateParts = date.split("-").map(Number);
  const timeParts = time.split(":").map(Number);
  const year = dateParts[0];
  const month = dateParts[1];
  const day = dateParts[2];
  const hour = timeParts[0];
  const minute = timeParts[1];
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    [year, month, day, hour, minute].some(Number.isNaN)
  ) {
    return null;
  }
  const value = new Date(0);
  value.setFullYear(year, month - 1, day);
  value.setHours(hour, minute, 0, 0);
  if (
    Number.isNaN(value.getTime()) ||
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  ) {
    return null;
  }
  return value;
}

export function scheduleDraftRange(draft: ScheduleDraft): { start: Date; end: Date } | null {
  const start = localDateTime(draft.date, draft.startTime);
  const end = localDateTime(draft.date, draft.endTime);
  return start && end ? { start, end } : null;
}

/**
 * 격자에서 시작한 예약은 정책 슬롯을 유지하고, QR의 "지금부터" 예약처럼 슬롯
 * 사이에서 시작한 예약은 그 시각을 잃지 않도록 분 단위 편집을 허용한다.
 */
export function scheduleInputStepMinutes(start: Date, end: Date): number {
  return start.getMinutes() % POLICY.slotMinutes === 0 && end.getMinutes() % POLICY.slotMinutes === 0
    ? POLICY.slotMinutes
    : 1;
}

export function ScheduleFields({
  value,
  onChange,
  now,
  stepMinutes = POLICY.slotMinutes,
  errors = {},
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  now: Date;
  stepMinutes?: number;
  errors?: ScheduleFieldErrors;
}) {
  const id = useId();
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + POLICY.maxAdvanceDays);
  const stepSeconds = stepMinutes * 60;

  return (
    <fieldset className="mr-schedule">
      <legend className="mr-field__label">예약 시간</legend>
      <div className="mr-schedule__grid">
        <label className="mr-field" htmlFor={`${id}-room`}>
          <span className="mr-field__label">회의실</span>
          <select
            id={`${id}-room`}
            className="mr-input"
            value={value.roomId}
            aria-invalid={errors.roomId ? true : undefined}
            aria-describedby={`${id}-room-help${errors.roomId ? ` ${id}-room-error` : ""}`}
            onChange={(event) => onChange({ ...value, roomId: event.target.value })}
          >
            {ROOMS.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name} · {room.floor}
              </option>
            ))}
          </select>
          <span id={`${id}-room-help`} className="mr-field__hint">
            사용할 방을 선택해 주세요
          </span>
          {errors.roomId ? (
            <span id={`${id}-room-error`} className="mr-field__hint mr-field__hint--warn">
              {errors.roomId}
            </span>
          ) : null}
        </label>

        <label className="mr-field" htmlFor={`${id}-date`}>
          <span className="mr-field__label">날짜</span>
          <input
            id={`${id}-date`}
            className="mr-input"
            type="date"
            min={dateValue(now)}
            max={dateValue(maxDate)}
            value={value.date}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby={`${id}-date-help${errors.date ? ` ${id}-date-error` : ""}`}
            onChange={(event) => onChange({ ...value, date: event.target.value })}
          />
          <span id={`${id}-date-help`} className="mr-field__hint">
            오늘부터 {POLICY.maxAdvanceDays}일 뒤까지 예약할 수 있어요
          </span>
          {errors.date ? (
            <span id={`${id}-date-error`} className="mr-field__hint mr-field__hint--warn">
              {errors.date}
            </span>
          ) : null}
        </label>

        <label className="mr-field" htmlFor={`${id}-start`}>
          <span className="mr-field__label">시작</span>
          <input
            id={`${id}-start`}
            className="mr-input t-num"
            type="time"
            step={stepSeconds}
            value={value.startTime}
            aria-invalid={errors.startTime ? true : undefined}
            aria-describedby={`${id}-time-help${errors.startTime ? ` ${id}-start-error` : ""}`}
            onChange={(event) => onChange({ ...value, startTime: event.target.value })}
          />
          {errors.startTime ? (
            <span id={`${id}-start-error`} className="mr-field__hint mr-field__hint--warn">
              {errors.startTime}
            </span>
          ) : null}
        </label>

        <label className="mr-field" htmlFor={`${id}-end`}>
          <span className="mr-field__label">종료</span>
          <input
            id={`${id}-end`}
            className="mr-input t-num"
            type="time"
            step={stepSeconds}
            value={value.endTime}
            aria-invalid={errors.endTime ? true : undefined}
            aria-describedby={`${id}-time-help${errors.endTime ? ` ${id}-end-error` : ""}`}
            onChange={(event) => onChange({ ...value, endTime: event.target.value })}
          />
          {errors.endTime ? (
            <span id={`${id}-end-error`} className="mr-field__hint mr-field__hint--warn">
              {errors.endTime}
            </span>
          ) : null}
        </label>
      </div>
      <p id={`${id}-time-help`} className="mr-field__hint">
        {stepMinutes === POLICY.slotMinutes
          ? `${POLICY.slotMinutes}분 단위로 시작과 종료를 정할 수 있어요`
          : "빠른 예약의 시작 시각을 유지하며 분 단위로 조정할 수 있어요"}
      </p>
    </fieldset>
  );
}
