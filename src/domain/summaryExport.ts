import { hhmm, humanDuration, MINUTE } from "./time";
import type { Booking } from "./types";

/**
 * 회의 요약을 다른 도구로 옮기기 위한 Markdown 변환.
 *
 * **왜 API 연동이 아니라 Markdown 인가.**
 * Notion API(`api.notion.com`)는 브라우저에서 오는 요청에 `Access-Control-Allow-Origin`
 * 을 주지 않는다 — 실측으로 확인했다(preflight 차단). 즉 서버를 한 대 두고 토큰을
 * 거기 보관하지 않는 한 브라우저에서 Notion 에 직접 쓸 방법이 없다. 이 제품의 전제는
 * "서버 0 · 시크릿 0"(DESIGN.md §11)이므로 그 전제를 지키는 쪽을 택했다.
 *
 * 대신 붙여넣기가 되는 형식을 준다. Notion 은 Markdown 을 붙여넣으면 블록으로
 * 파싱하고, Slack·메일·Google Docs 도 같은 텍스트를 그대로 받는다 — 한 벌로 넷을
 * 커버한다. 사람이 붙여넣기 한 번을 해야 하는 것이 대가다.
 */
export function summaryToMarkdown(booking: Booking, roomName: string): string {
  const dateLabel =
    String(booking.start.getMonth() + 1) + "월 " + String(booking.start.getDate()) + "일";
  const durationMin = (booking.end.getTime() - booking.start.getTime()) / MINUTE;

  /*
   * 제목 줄에 회의 제목을 쓴다. 격자 셀에는 제목을 노출하지 않지만(DESIGN.md §7 —
   * 남의 일정을 훑다가 제목이 읽히지 않게 하려는 규칙), 여기는 **주최자 본인이 자기
   * 회의를 자기 도구로 옮기는** 자리라 그 규칙이 적용되지 않는다.
   */
  const heading = "## " + dateLabel + " · " + booking.title;

  const meta =
    "**" +
    [
      roomName,
      hhmm(booking.start) + "–" + hhmm(booking.end) + " (" + humanDuration(durationMin) + ")",
      String(booking.headcount) + "명",
    ].join(" · ") +
    "**";

  // 요약 본문은 사용자가 쓴 그대로 옮긴다 — 줄바꿈도 보존한다.
  const body = (booking.summary ?? "").trim();

  return heading + "\n" + meta + "\n\n" + body + "\n";
}
