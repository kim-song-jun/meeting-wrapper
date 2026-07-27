import { describe, it, expect } from "vitest";
import { summaryToMarkdown } from "./summaryExport";
import type { Booking } from "./types";

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    roomId: "room-small",
    title: "주간 기획회의",
    organizerName: "성준",
    organizerEmail: "sungjun@molcube.com",
    organizerDepartment: "개발팀",
    recurringEventId: null,
    start: new Date(2026, 6, 26, 14, 0),
    end: new Date(2026, 6, 26, 15, 0),
    headcount: 4,
    attendeeCount: 2,
    conference: null,
    checkedInAt: null,
    summary: "다음 스프린트 범위 확정",
    isMine: true,
    ...over,
  };
}

describe("summaryToMarkdown", () => {
  it("Notion 이 파싱하는 Markdown 문법으로 제목·메타·본문을 낸다", () => {
    expect(summaryToMarkdown(booking(), "소회의실")).toBe(
      "## 7월 26일 · 주간 기획회의\n" +
        "**소회의실 · 14:00–15:00 (1시간) · 4명**\n" +
        "\n" +
        "다음 스프린트 범위 확정\n",
    );
  });

  it("여러 줄 요약의 줄바꿈을 보존한다", () => {
    const md = summaryToMarkdown(booking({ summary: "- 범위 확정\n- QA 2일 앞당김" }), "대회의실");
    expect(md).toContain("- 범위 확정\n- QA 2일 앞당김");
  });

  it("요약 앞뒤 공백은 다듬되 본문은 건드리지 않는다", () => {
    const md = summaryToMarkdown(booking({ summary: "  결론 없음  " }), "소회의실");
    expect(md.endsWith("결론 없음\n")).toBe(true);
  });

  it("초대 인원이 아니라 실제 모인 인원(headcount)을 쓴다", () => {
    // 10명이 모이는데 팀장 2명만 초대하는 경우가 흔하다 — 기록은 모인 사람 수다
    const md = summaryToMarkdown(booking({ headcount: 10, attendeeCount: 2 }), "대회의실");
    expect(md).toContain("· 10명**");
    expect(md).not.toContain("2명");
  });

  it("요약이 없으면 본문 없이 제목과 메타만 남긴다", () => {
    const md = summaryToMarkdown(booking({ summary: null }), "소회의실");
    expect(md).toBe("## 7월 26일 · 주간 기획회의\n**소회의실 · 14:00–15:00 (1시간) · 4명**\n\n\n");
  });
});
