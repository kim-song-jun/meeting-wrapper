import { Alert, Button, Dialog } from "../components/ui";
import { hhmm } from "../domain/time";
import type { Booking } from "../domain/types";

const WEEKDAY_KR = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "8월 4일 화" 형식. 시각은 별도로 hhmm() 을 붙인다. */
function formatOccurrenceDate(d: Date): string {
  // noUncheckedIndexedAccess: 배열 조회는 string | undefined 다. getDay() 는 0-6 이라
  // 실제로는 항상 값이 있지만 String() 으로 타입을 좁힌다 (recurrence.ts 의 describeRecurrence 와 동일 패턴).
  return String(d.getMonth() + 1) + "월 " + String(d.getDate()) + "일 " + String(WEEKDAY_KR[d.getDay()]);
}

export interface RecurrenceResultProps {
  /** 반복으로 요청한 총 회차 수 (booked + rejected) */
  totalRequested: number;
  booked: Booking[];
  rejected: Array<{ start: Date; end: Date; reason: string }>;
  onConfirm: () => void;
}

/**
 * 반복 예약의 부분 성공 화면.
 *
 * Google 은 반복 일정의 각 인스턴스에 대해 회의실이 개별적으로 수락/거절한다.
 * 12주 중 3주가 이미 차 있으면 9주만 예약되고 events.insert 는 그래도 200 을 준다.
 * 그래서 실패한 회차를 반드시 사용자에게 보여준다 — "12주 다 잡혔겠지" 하고
 * 조용히 넘어가면 그 방에 갔을 때 다른 팀이 앉아 있다.
 *
 * rejected 가 비어 있으면 이 화면을 띄우지 않는다 (BookingDialog 가 판단한다).
 * 성공은 축하할 일이 아니라 완료된 일이다.
 */
export function RecurrenceResult({ totalRequested, booked, rejected, onConfirm }: RecurrenceResultProps) {
  const summary =
    booked.length === 0
      ? String(totalRequested) + "회 모두 예약하지 못했어요. 이미 사용 중입니다."
      : String(totalRequested) +
        "회 중 " +
        String(booked.length) +
        "회 예약됐어요. " +
        String(rejected.length) +
        "회는 이미 사용 중입니다.";

  return (
    <Dialog title="반복 예약 결과" onClose={onConfirm} actions={<Button onClick={onConfirm}>확인</Button>}>
      <div className="mr-form">
        <Alert>{summary}</Alert>

        {rejected.length > 0 ? (
          <div>
            <span className="mr-field__label">예약하지 못한 회차</span>
            <ul className="mr-recur-fail__list">
              {rejected.map((r) => (
                <li key={r.start.toISOString()} className="mr-recur-fail__item">
                  <span className="t-num">{formatOccurrenceDate(r.start) + " " + hhmm(r.start)}</span>
                  <span className="mr-recur-fail__reason">{" — " + r.reason}</span>
                </li>
              ))}
            </ul>
            <p className="mr-field__hint">실패한 회차는 개별로 다시 잡아주세요</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
