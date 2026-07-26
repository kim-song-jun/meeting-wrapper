# molroom

molcube 사내 회의실 예약. **서버 없음 · 데이터베이스 없음 · 시크릿 없음.**

예약의 원본은 Google Calendar 다. 회의실은 Workspace 캘린더 리소스이고, 예약 하나는
캘린더 이벤트 하나다. 저장·중복방지·초대·알림·개인 캘린더 동기화를 전부 구글이 운영한다.
molroom 은 그 위에 얹는 더 빠른 UI다.

```
정적 파일 (Vite 빌드)
        │  사용자 본인의 Google 토큰
        ├──▶ Calendar API   예약 읽기 · 쓰기
        └──▶ Drive API      개인 설정 (기본 Zoom 링크)
```

## 지금 상태

**화면 개발 단계.** 데이터는 인메모리 mock 이고, Google 연동은 아직 붙지 않았다.

```
화면 ──▶ BookingRepository ──▶ mockAdapter      ← 지금
                            └▶ googleAdapter    ← 스파이크 테스트 후
```

교체 지점은 `src/data/index.ts` 한 줄이다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5183
npm test           # 도메인 로직 테스트
npm run typecheck
npm run build
```

같은 네트워크의 폰에서 열어보려면(QR 흐름 검수) 호스트를 열어 실행한다:

```bash
npm run dev -- --host   # 터미널에 뜨는 Network 주소를 폰에서 연다
```

## mock 으로 실패 경로 재현하기

성공 경로만 눌러보면 실패 화면은 만들어도 죽은 코드다. mock 어댑터에
**결정적 트리거**를 심어 뒀으니 환경변수 없이도 전부 눌러볼 수 있다.

### 로그인 (URL 쿼리)

| URL | 재현되는 것 |
|---|---|
| `/login` | 정상 로그인 (성준 · sungjun@molcube.com) |
| `/login?mockAuth=wrong-domain` | molcube.com 계정이 아닐 때의 거부 화면 |
| `/login?mockAuth=denied` | 사용자가 Google 동의 화면에서 취소 (알림 없이 원상복귀) |
| `/login?mockAuth=error` | 네트워크 등 실패 → 사유 + 재시도 |

로그아웃은 앱바 오른쪽. 세션은 `sessionStorage` 라 탭을 닫으면 초기화된다.

### 예약 (회의 제목에 문자열 삽입)

| 제목에 넣는 말 | 재현되는 것 |
|---|---|
| `__taken` | 저장 직전 재조회에서 남이 먼저 잡은 경우 (2차 방어) |
| `__declined` | 캘린더가 200 을 준 뒤 회의실이 거절한 경우 (3차 방어) |

예) 제목을 `주간회의 __taken` 으로 두고 예약하면 "방금 …님이 이 시간을
예약했어요" 경로가 뜬다.

### 반복 예약 부분 성공

`대회의실 14:00~15:00` 을 **매주 4회** 로 잡으면 +7일 회차가 시드 예약과
겹쳐 거절된다 — "3회 예약됨 / 1회 거절됨" 결과 화면이 이 경로다.

### 그 밖에

- **미체크인 배지**: 시작 시각 + 10분(`POLICY.checkInGraceMinutes`)이 지나고
  체크인하지 않은 진행 중 예약에 붙는다. 시드가 오늘 날짜 기준이라 시간대에
  따라 보이거나 안 보인다.
- **주소록 검색 실패**: `mockAdapter.searchDirectory` 는 성공하도록 돼 있다.
  실패 안내(이메일 직접 입력으로 유도)를 보려면 그 함수에서 `throw` 를 한 번
  넣어보면 된다.
- **관리자 권한**: 현재 mock 사용자는 관리자다(`/me` 의 "전체 예약" 탭).
  `src/config/currentUser.ts` 와 `mockAdapter` 의 `ME.isAdmin` 을 바꿔 확인한다.

## 문서

| 문서 | 내용 |
|---|---|
| [설계 스펙](docs/superpowers/specs/2026-07-26-molroom-design.md) | 아키텍처·데이터 모델·화면·에러 처리·리스크 |
| [DESIGN.md](DESIGN.md) | 디자인 시스템. UI 를 만지기 전에 반드시 읽을 것 |
| [디자인 미리보기](docs/design-preview.html) | 토큰·컴포넌트를 실제로 렌더한 페이지 |

## 구조

```
src/
  domain/     순수 로직 — 겹침 판정, 격자 배치, 연장 가능 여부 (테스트 있음)
  data/       BookingRepository 인터페이스 + 어댑터
  components/ 디자인 시스템 프리미티브
  screens/    화면 4개
  styles/     tokens.css 가 DESIGN.md 와 코드를 잇는 지점
  config/     회의실 목록, 예약 규칙
```

`src/domain/time.ts` 의 로직은 틀리면 더블부킹으로 이어지므로 테스트가 붙어 있다.
격자 픽셀 위치를 손으로 계산하지 말 것 — `placeInGrid()` 를 쓴다.

## 연동 전에 반드시 확인할 것

설계 스펙 §10 의 스파이크 테스트 8건. **아직 하나도 하지 않았다.**
그중 2건은 실패하면 "인프라 제로" 설계가 깨지고 관리형 저장소가 필요해진다:

1. `extendedProperties.shared` 가 회의실 캘린더 사본에서도 읽히는가 (체크인 저장 위치)
8. 무음 토큰 재발급이 실제 브라우저에서 동작하는가 (1시간마다 재로그인 방지)

## 관리자 사전 작업

Workspace 관리자 콘솔에서 한 번 해야 하는 일 (설계 스펙 §10.1):

1. 회의실을 캘린더 리소스로 등록
2. 회의실 캘린더를 도메인 사용자에게 조회 가능하도록 공유
3. 회의실의 **초대 자동 수락** 확인 — 꺼져 있으면 중복 방지가 동작하지 않는다
4. Google Cloud 프로젝트 + OAuth 클라이언트를 **Internal** 로 생성
5. 관리자로 지정할 사람을 회의실 캘린더의 writer 로 추가
