# MolRoom 역할·입력 방식별 디자인 계약 재정렬

**상태:** 사용자 승인된 설계 방향  
**결정:** C3 — 역할·입력 방식별 계약  
**승인일:** 2026-08-20  
**적용 대상:** `DESIGN.md`, `src/styles/tokens.css`, 격자·입력·내비게이션 토큰 소비자

## 1. 배경

현재 `DESIGN.md`는 MolRoom의 권위 있는 디자인 계약이지만, 격자 밀도와 일부 역할 토큰은 runtime과 충돌한다.

- 문서의 Grid Event는 `14px/20px`, runtime은 `12px/14px`다.
- 문서의 시간축 Caption은 `13px/18px`, runtime은 `11px/14px`다.
- 문서의 이벤트 radius는 `12px`, runtime은 `4px`다.
- 문서의 주간 분할 열 하한은 `76px`, runtime은 미세 포인터에서 `44px`다.
- 문서는 입력 radius를 `12px`로 고정하지만, runtime의 generic `--r-md`는 모바일에서 `14px`로 바뀌며 입력·칩·내비게이션을 함께 바꾼다.
- 문서는 layout spacing에서 `12px`과 `20px`을 금지하지만, 버튼과 모바일 인라인 패딩에는 `20px`을 별도로 요구한다.
- 문서는 빨강을 파괴적 동작 전용으로 제한하지만, runtime은 현재 시각선에도 danger red를 사용한다.

24px 높이의 30분 슬롯에 `14px/20px` 두 줄을 항상 표시하는 것은 기하학적으로 성립하지 않는다. 문서를 그대로 runtime에 복사하거나 runtime을 그대로 문서에 승격하는 대신, C3는 **브랜드 역할은 하나로 고정하고 격자 밀도만 입력 방식에 따라 명시적으로 분리**한다.

## 2. 목표

1. `DESIGN.md`와 runtime이 같은 값을 말하게 한다.
2. 미세 포인터 데스크톱에서 08:00–20:00 전체를 576px에 유지한다.
3. 터치·거친 포인터에서는 44px 슬롯과 읽을 수 있는 글자를 유지한다.
4. generic 토큰 하나가 서로 다른 역할의 컴포넌트를 연쇄 변경하지 못하게 한다.
5. 새 예외는 역할 이름, 증거 등급, 적용 조건, 근거를 한곳에 기록한다.
6. migration이 끝난 뒤 임시 alias, fallback, dead token을 남기지 않는다.

## 3. 비목표

- 라우트, 내비게이션 정보 구조, 화면별 기능을 재설계하지 않는다.
- 예약 데이터 모델, `BookingRepository`, Google Workspace 연동 방향을 바꾸지 않는다.
- QR 예약, 반복 예약, 체크인 정책을 바꾸지 않는다.
- 현재 발견된 기능·접근성 버그를 이 계약 변경과 한 커밋에 섞지 않는다.
- deprecated 디자인 문서를 현재 계약으로 되돌리지 않는다.

## 4. 계약 권위와 예외 규칙

권위 순서는 다음과 같다.

1. 사용자가 채팅에서 승인한 결정
2. 현재 `DESIGN.md`
3. 역할 토큰과 해당 토큰의 증거 태그
4. 컴포넌트 CSS
5. 코드 주석

코드 주석은 `DESIGN.md`를 조용히 덮어쓸 수 없다. runtime에서 새 값이 필요하면 먼저 `DESIGN.md`에 역할·조건·근거를 적고, 그 뒤 토큰을 바꾼다.

`toss`, `logo`, `local`, `a11y` 증거 등급은 유지한다. 입력 방식에 따른 격자 밀도 값은 Toss에 대응물이 없으므로 `local`, 44px 터치 하한은 `a11y`다.

## 5. 확정 계약

| 역할 | 미세 포인터 데스크톱 | 터치·거친 포인터 | 증거 | 비고 |
|---|---:|---:|---|---|
| 30분 슬롯 높이 | `24px` | `44px` | `local` / `a11y` | 08:00–20:00을 자르지 않는다 |
| Grid Event 글자 | `12px/14px` | `14px/20px` | `local` | 슬롯 밀도에만 적용 |
| 시간축 글자 | `11px/14px` | `13px/18px` | `local` | 정시 라벨만 표시 |
| 이벤트 radius | `4px` | `12px` | `local` | 격자 블록과 터치 카드의 역할을 분리 |
| 주간 분할 열 하한 | `76px` | `76px` 이상 | `local` | 좁은 화면은 가로 스크롤을 허용 |
| 입력 radius | `12px` | `12px` | `local` | 입력 방식으로 바뀌지 않음 |
| 필터 radius | `12px` | `12px` | `local` | 입력과 값이 같아도 토큰 소유권은 분리 |
| 세그먼트 radius | `12px` | `12px` | `local` | 필터와 값이 같아도 독립 변경 가능 |
| 현재 시각 | `#4E5968` 선+점 | 동일 | `local` | 빨강은 파괴적 동작 전용 |
| 내 예약 좌측 막대 | border 또는 pseudo-element | 동일 | `local` | inset shadow 사용 금지 |

### 5.1 이벤트 콘텐츠 적합 규칙

- 미세 포인터의 30분 이벤트는 **주최자 한 줄**을 우선한다.
- 시각 두 줄째는 실제 이벤트 높이에 두 줄과 내부 여백이 모두 들어갈 때만 표시한다.
- 두 줄이 들어가지 않으면 시각을 억지로 축소하거나 잘린 상태로 남기지 않는다.
- 시각·회의실·주최자 전체 정보는 버튼의 접근 가능한 이름과 상세 다이얼로그에서 항상 제공한다.
- 터치·모바일 목록은 `14px/20px`과 12px radius를 사용하며, 읽을 수 있는 두 줄을 유지한다.

### 5.2 주간 열 규칙

- 회의실이 둘 이상이면 각 `(요일 × 회의실)` 열의 `min-width`는 76px이다.
- 1440px에서 방 둘 × 7일은 사이드바와 시간축을 포함해 가로 스크롤 없이 보이는 것을 목표로 한다.
- 1024px처럼 공간이 부족하면 열을 44px까지 압축하지 않고 격자 자체의 가로 스크롤을 허용한다.
- 방이 하나면 반복되는 2단 방 헤더를 생략한다.

## 6. 역할 토큰 구조

generic `--r-md`처럼 여러 역할을 동시에 소유하는 토큰은 제거하고 역할 토큰으로 대체한다. migration 중 alias나 fallback은 두지 않는다.

### 6.1 타입과 격자 밀도

```css
--grid-slot-fine: 24px;        /* [local] */
--grid-slot-touch: 44px;       /* [a11y] */
--grid-split-column-min: 76px; /* [local] */
--t-grid-fine-size: 12px;       /* [local] */
--t-grid-fine-lh: 14px;        /* [local] */
--t-grid-touch-size: 14px;      /* [local] */
--t-grid-touch-lh: 20px;       /* [local] */
--t-axis-fine-size: 11px;       /* [local] */
--t-axis-fine-lh: 14px;        /* [local] */
--t-axis-touch-size: 13px;      /* [local] */
--t-axis-touch-lh: 18px;        /* [local] */
--r-event-fine: 4px;           /* [local] */
--r-event-touch: 12px;         /* [local] */
```

기본값은 터치 안전값으로 두고, `(min-width: 768px) and (hover: hover) and (pointer: fine)`에서만 fine 값을 활성화한다. width만으로 입력 방식을 추정하지 않는다.

### 6.2 컴포넌트 역할 radius

```css
--r-action: 14px;              /* [toss] desktop */
--r-action-mobile: 16px;       /* [toss] mobile */
--r-input: 12px;               /* [local] */
--r-filter: 12px;              /* [local] */
--r-segment: 12px;             /* [local] */
--r-nav-item: 12px;            /* [local] */
--r-card: 16px;                /* [local] */
--r-dialog: 20px;              /* [local] */
```

모바일 media query가 `--r-input`, `--r-filter`, `--r-segment`, `--r-nav-item`을 한꺼번에 덮어쓰지 않는다. 버튼만 `--r-action-mobile`을 사용한다.

### 6.3 간격과 컴포넌트 지오메트리

- layout spacing은 `4/8/16/24/32px`만 사용한다.
- `6px`은 격자 내부의 좁은 micro spacing에만 허용한다.
- `12px`은 layout gap, margin, padding으로 사용하지 않는다.
- `20px`은 layout scale이 아니라 문서화된 component geometry에서만 허용한다.
- 허용되는 20px은 `--pad-action-inline`과 `--pad-mobile-inline`처럼 역할 이름을 가진 토큰으로만 사용한다.
- radius, icon size, hit area, transform offset은 spacing 규칙의 대상이 아니지만 역할과 근거가 있어야 한다.

## 7. 색과 깊이

- `#E42939`은 예약 취소·시리즈 삭제처럼 되돌릴 수 없는 동작에만 쓴다.
- 현재 시각선은 `--c-now: #4E5968` `local`을 사용하고 선+점으로 형태를 함께 제공한다.
- 내 예약의 4px 좌측 막대는 logical border 또는 pseudo-element로 그린다.
- ownership 막대에 `box-shadow`를 사용하지 않는다. focus ring과 ownership 표시가 동시에 보여야 한다.
- 다이얼로그와 focus ring 외에는 기존 shadow 금지 원칙을 유지한다.

## 8. 적용 순서

1. `DESIGN.md`의 타입, 격자, 주간 열, spacing, color 예외를 이 문서와 일치시킨다.
2. `tokens.css`에 역할 토큰을 추가하고 generic 토큰 소비자를 전수 교체한다.
3. 격자 CSS를 fine/touch 역할 토큰으로 분리한다.
4. 이벤트 콘텐츠 적합 규칙과 주간 76px 하한을 적용한다.
5. 현재 시각 색과 내 예약 막대 표현을 교체한다.
6. generic 토큰, 임시 alias, 오래된 주석과 dead CSS를 완전히 삭제한다.
7. 정적 검증 후 실제 화면을 fine pointer와 touch 조건에서 비교한다.

각 단계는 관련 파일의 동시 수정 소유권이 정리된 뒤 시작한다. 현재 `DESIGN.md`, `tokens.css`, `grid.css`, `components.css`, `GridScreen.tsx`는 다른 세션의 미커밋 변경이 있으므로 이 설계 문서 작성 세션에서는 수정하지 않는다.

## 9. 검증 계약

### 9.1 정적 검증

- 삭제 대상 generic 토큰과 alias가 `rg` 결과 0건이어야 한다.
- layout 선언의 `12px` 사용을 전수 분류하고 허용되지 않은 값은 0건이어야 한다.
- `toss`/`logo`/`local`/`a11y` evidence tag validator가 통과해야 한다.
- `node scripts/build-design-standalone.mjs` 실행 뒤 생성 diff가 의도한 변경만 포함해야 한다.
- `node scripts/validate-design-examples.mjs`가 통과해야 한다.
- TypeScript typecheck와 변경 계약을 증명하는 가장 좁은 테스트를 직렬·단일 worker로 실행한다.

### 9.2 라이브 검증

- `1440×1000` fine pointer: 08:00–20:00 전체 높이, 30분/60분 이벤트 정보 적합, 방 둘 주간 열을 확인한다.
- `1024×768` fine pointer: 주간 열이 76px 아래로 줄지 않고 격자 내부 가로 스크롤만 생기는지 확인한다.
- `1024×768` coarse pointer: 44px 슬롯, 14/20 글자, 12px 이벤트 radius, 터치 동작을 확인한다.
- `390×844`: 목록·bottom sheet·입력 radius와 44px 터치 타깃을 확인한다.
- 각 viewport에서 내 예약 막대와 focus ring이 동시에 보이는지 확인한다.
- 동일 상태의 before/after 스크린샷을 사용자 보고에 inline으로 포함한다.

브라우저 캡처, 키보드, touch emulation, axe 검증이 끝나기 전에는 UI 작업 완료로 보고하지 않는다.

## 10. 실패 처리와 롤백

- CSS custom property는 누락돼도 조용히 fallback될 수 있으므로 migration fallback을 두지 않는다. 누락은 정적 검색과 실제 렌더에서 실패로 드러나게 한다.
- fine pointer에서 두 줄이 맞지 않으면 글자를 더 줄이지 않는다. 콘텐츠 적합 규칙을 적용한다.
- 주간 열이 좁은 화면을 넘으면 열을 축소하지 않고 격자 가로 스크롤을 유지한다.
- 기존 상태로 되돌리는 rollback은 별도 사용자 승인 없이는 실행하지 않는다.

## 11. 완료 기준

- `DESIGN.md`와 runtime token 값이 이 문서와 일치한다.
- generic radius·grid typography 토큰 소비가 남지 않는다.
- 금지된 shadow와 danger red의 비파괴적 사용이 남지 않는다.
- fine/touch 네 viewport의 라이브 검증과 before/after 증거가 있다.
- 좁은 검증 명령이 통과하고, 시작한 dev server·browser·test 프로세스가 기준선으로 회수된다.
- 사용자 승인 없이 기능 범위나 인접 화면 polish가 추가되지 않는다.
