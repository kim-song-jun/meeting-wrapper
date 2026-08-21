/**
 * 모의 환경의 "나".
 *
 * 두 mock 이 같은 사람을 가리켜야 한다:
 *   - src/auth/mockAuthAdapter.ts  — 로그인한 계정
 *   - src/data/mockAdapter.ts      — 예약 데이터의 주최자(isMine 판정 기준)
 *
 * 값을 양쪽에 각각 적으면 우연히 문자열이 같을 뿐이라, 한쪽만 바꿨을 때
 * "내 예약"이 남의 예약으로 보이는 조용한 어긋남이 생긴다. 그래서 참조 하나로 묶는다.
 *
 * 실제 Google OAuth 를 붙이면 이 파일은 사라진다 — 그때 identity 의 출처는
 * 토큰이고, mockAdapter 도 함께 실물 어댑터로 교체된다.
 */
export const MOCK_IDENTITY = {
  runtimeSource: "molroom.mock.identity",
  email: "sungjun@molcube.com",
  name: "성준",
} as const;
