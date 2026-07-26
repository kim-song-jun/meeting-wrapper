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
