# MolRoom 페이지별 디자인 예시

이 디렉터리는 실제 제품 라우트와 핵심 상태를 Toss 파생 디자인 언어로 검토하기 위한 **정적 HTML 기준 화면**이다. 앱 런타임이나 mock 데이터에 의존하지 않는다.

## 두 가지 산출물

### 1. 유지보수 원본

`index.html`, `login.html` 등 상위 HTML은 공통 `examples.css`와 `brand.svg`를 참조한다. 저장소 전체를 checkout하거나 이 디렉터리를 통째로 내려받아 열 때 사용한다.

### 2. 단독 실행본

`standalone/*.html`은 CSS와 로고를 파일 안에 인라인한 생성물이다. 갤러리의 PNG도 data URL로 포함되어 있어 **HTML 파일 하나만 복사하거나 업로드해도 스타일이 깨지지 않는다.**

단독 실행본은 직접 수정하지 않는다.

```bash
node scripts/build-design-standalone.mjs
node scripts/validate-design-examples.mjs
```

## 포함 화면

| 원본 | 단독 실행본 | 화면 | 기준 캡처 |
|---|---|---|---|
| `login.html` | `standalone/login.html` | 로그인 | `390×844` |
| `calendar.html` | `standalone/calendar.html` | 예약 현황·일간 격자 | `1440×1000` |
| `room.html` | `standalone/room.html` | QR 회의실 랜딩 | `390×844` |
| `my-bookings.html` | `standalone/my-bookings.html` | 내 예약 | `390×844` |
| `booking-dialog.html` | `standalone/booking-dialog.html` | 새 예약 다이얼로그 | `1440×1000` |
| `index.html` | `standalone/index.html` | 예시·스크린샷 갤러리 | 반응형 |

## 역할

- **제품 코드의 대체물이 아니다.** `src/` 구현이 최종 동작의 진실 소스다.
- UI PR에서 레이아웃·카피·상태 우선순위를 빠르게 합의하는 시각 기준이다.
- 외부 폰트, 이미지 CDN, JavaScript 프레임워크를 사용하지 않는다.
- 색상·타입·곡률은 `DESIGN.md`와 `src/styles/tokens.css`의 현재 Toss 파생 값을 따른다.

## 업데이트 규칙

1. 제품의 정보 구조 또는 핵심 카피가 바뀌면 대응 원본 HTML을 먼저 또는 함께 갱신한다.
2. `node scripts/build-design-standalone.mjs`로 단독 실행본을 다시 생성한다.
3. 데스크톱은 `1440×1000`, 모바일은 `390×844`에서 다시 캡처한다.
4. 기존 PNG를 같은 파일명으로 교체해 PR의 이미지 링크가 끊기지 않게 한다.
5. `node scripts/validate-design-examples.mjs`로 의존 파일, HTML, 단독 실행본, PNG 규격을 검증한다.
6. 예시와 실제 구현이 의도적으로 다르면 PR 본문에 차이를 적는다.

## 2026-07-29 렌더링 사고 기록

사용자에게 개별 HTML만 전달하면서 `examples.css`와 `brand.svg`를 같은 폴더에 복사하지 않아 무스타일로 열린 적이 있다. 원본 ZIP에는 두 파일이 있었고 CSS 자체는 정상이었다.

재발 방지:

- validator가 `examples.css`와 `brand.svg`의 실제 존재·용량을 확인한다.
- 공유에는 `standalone/*.html`을 우선 사용한다.
- Chromium 재렌더 결과는 기존 기준 PNG 5개와 픽셀 단위로 동일함을 확인했다.

## 검수 포인트

- 흰 바닥에서 일정과 핵심 행동이 먼저 읽히는가
- 채움 파랑이 화면의 핵심 행동 하나에만 사용되는가
- 내 예약은 Weak 파랑, 남의 예약은 중립 회색으로 구분되는가
- 실패·비활성 상태가 원인과 다음 행동을 함께 말하는가
- 모바일 고정 내비게이션이 콘텐츠와 safe area를 덮지 않는가
- 새 색·그림자·유리 효과 없이 면과 선으로 깊이를 표현하는가
