---
omd: 0.1
brand: MolRoom
bootstrapped_from: apple
rederived_from: molcube-web
rederived_at: 2026-07-26
---

# MolRoom Design System

molcube 사내 회의실 예약. **자사 브랜드에서 파생했다.**

초기 버전은 Apple 레퍼런스에서 톤&매너를 빌려왔지만, 사내에 이미 살아 있는 디자인 시스템(`molcube-web/molcube-frontend`)이 있으므로 그쪽으로 다시 도출했다. 남의 브랜드를 흉내내는 것보다 우리 제품군과 같은 얼굴을 하는 편이 낫다.

**출처:** `molcube-web/molcube-frontend/tailwind.config.js`, `src/components/buttons/styles.ts`, `index.html` (2026-07-26 실측). 로고 색은 `public/images/molcube/molcube.png` 픽셀에서 추출.

## 증거 등급

이 문서의 모든 값은 넷 중 하나다. 등급을 지우거나 승격시키지 말 것.

| 표기 | 의미 |
|---|---|
| `brand` | molcube-web 에 실제로 있는 토큰. 임의로 바꾸지 않는다 |
| `logo` | MolCube 로고 이미지에서 추출한 값 |
| `local` | MolRoom 로컬 확장. MolCube 에 없다 |
| `a11y` | 접근성 때문에 브랜드 값에서 의도적으로 벗어난 값. 사유가 함께 적혀 있다 |

---

## 1. Visual Theme & Atmosphere

MolCube 의 얼굴은 **따뜻한 중립 위의 차분한 파랑**이다. 캔버스가 순백이 아니라 `#FAFAF8` 이라는 점이 핵심이다 — 미묘하게 따뜻한 오프화이트가 하루 종일 들여다보는 도구를 덜 날카롭게 만든다. 테두리도 회색이 아니라 `#E4E4E0` 으로 같은 온도를 유지한다. 형태는 라운드 사각형이고(rounded-lg 811회 · md 467 · xl 315), 완전한 pill 은 배지와 칩에만 쓴다.

로고는 아이소메트릭 큐브에 분자 결합 모티프를 얹은 것이다. 세 면(민트·파랑·노랑)이 짙은 인디고 외곽선 안에 묶여 있다. 이 세 색은 **장식일 뿐 UI 색이 아니다** — 워드마크와 파비콘에만 쓴다.

MolRoom 에서 **주인공은 일정이다.** 예약 격자가 곧 콘텐츠이고 컨트롤은 물러나 있어야 한다. 화면을 처음 봤을 때 읽어야 하는 것은 버튼이 아니라 "언제가 비어 있는가" 라는 패턴이다.

두 표면을 구분한다: **데스크톱 격자**(밀도 우선, 훑어보기)와 **모바일 QR 랜딩**(터치 우선, 단일 결정). 같은 토큰을 쓰되 지오메트리가 다르다. 한쪽 값을 다른 쪽에 기계적으로 옮기지 말 것.

**Key Characteristics:**
- Pretendard Variable 하나로 모든 위계를 낸다. 자간은 조정하지 않는다 `brand`
- 유채색 액션 액센트는 화면당 하나 `local`
- 캔버스가 따뜻하다 — `#FAFAF8`, 순백 아님 `brand`
- 라운드 사각형. pill 은 배지·칩 전용 `brand`
- 데스크톱 격자는 30분 슬롯당 28px `local`
- 빈 시간에는 색을 부여하지 않는다. 부재가 기본 상태다 `local`

## 2. Color Palette & Roles

### 브랜드 (장식 전용)

- **Brand Indigo** (`#202362`) `brand` — 로고 외곽선. 워드마크 텍스트
- **Brand Blue** (`#4281FF`) `brand` — `primary`. 로고 파란 면
- **Brand Mint** (`#73FEDD`) `logo` — 로고 윗면
- **Brand Amber** (`#FFC006`) `logo` — 로고 오른면

민트와 앰버는 **로고 안에서만** 쓴다. UI 에 풀면 상태색과 충돌한다.

### ⚠️ 액션 색이 브랜드 값과 다른 이유 `a11y`

MolCube 자신은 채움 버튼에 `bg-primary`(`#4281FF`) + 흰 텍스트 14px 를 쓴다. 실측 대비 **3.61:1** 로 WCAG AA 본문 기준(4.5:1)에 못 미친다. 14px medium 은 큰 텍스트 예외(18.66px bold 이상)에도 해당하지 않는다.

브랜드를 그대로 베끼면 접근성 결함을 물려받는다. 같은 블루 계열의 **실제 MolCube 토큰**인 `accent.hover`(`#185FA5`)를 채움 배경으로 쓴다 — 색상환을 벗어나지 않으면서 읽히는 유일한 방법이다.

| 역할 | 값 | 출처 | 대비 |
|---|---|---|---|
| **Action** | `#185FA5` | `accent.hover` `a11y` | 흰 텍스트 6.52:1 |
| **Action Hover** | `#0C447C` | `accent.text` `brand` | 흰 텍스트 9.84:1 |
| **Action Tint** | `#E6F1FB` | `accent.light` · `dna-bg` `brand` | — |
| **Action Border** | `#B5D4F4` | `accent.border` `brand` | — |
| **Link** | `#185FA5` | `a11y` (같은 사유) | 흰 배경 6.52:1 |

`#4281FF` 를 텍스트나 텍스트 배경으로 쓰지 말 것.

### 중립 `brand`

| 역할 | 값 | 대비 (캔버스 위) |
|---|---|---|
| Canvas | `#FAFAF8` (`surface.subtle`) | — |
| Surface | `#FFFFFF` | — |
| Surface Muted | `#F5F5F2` | — |
| Border | `#E4E4E0` | — |
| Border Strong | `#CFCFCA` | — |
| Foreground | `#171717` (neutral-900) | 17.15:1 |
| Secondary | `#525252` (neutral-600) | 7.48:1 |
| Muted | `#737373` (neutral-500) | 4.54:1 |
| Stage (다크) | `#071B33` (`viewer.stage`) | — |

MolCube 는 Tailwind `gray` 를 `neutral` 로 별칭한다. 따뜻한 캔버스와 짝이 맞는다.

### 예약 상태

**상태색을 새로 발명하지 않았다.** MolCube 는 이미 분자 종류별 의미색 쌍(protein/dna/rna/ligand)을 갖고 있어 그중 둘을 빌려 왔다.

| 상태 | 처리 | 출처 | 근거 |
|---|---|---|---|
| **비어있음** | 전용 색 없음. Canvas 그대로 | — | 부재는 색을 요구하지 않는다. 빈 시간에 색을 주면 격자의 80%가 시끄러워진다 |
| **남의 예약** | Surface + Foreground | — | 정상 상태다. 경고색을 쓰지 않는다 |
| **내 예약** | 배경 `#E6F1FB` · 강조 `#185FA5` · 보더 `#B5D4F4` | `dna-bg`/`dna-text` `brand` | 화면당 하나의 유채색 액센트를 "내 것" 에 배정. 배경 대비 15.66:1 |
| **주의 (미체크인)** | 배경 `#FAEEDA` · 텍스트 `#854F0B` | `rna-bg`/`rna-text` `brand` | 진짜 예외에만 쓰는 단 하나의 경고색. tint 위 5.87:1 |

빨강은 정의하지 않는다 — 예약된 방은 오류가 아니다. 파괴적 확인에 필요해지면 그때 MolCube 에서 찾아 온다.

## 3. Typography Rules

### Font Family `brand`

- **Sans**: `Pretendard Variable` → `Pretendard` → `-apple-system` → system
- **Mono**: `IBM Plex Mono` — 시간 눈금처럼 자릿수가 맞아야 하는 곳

molcube-web 과 동일하게 jsDelivr(Pretendard) · Google Fonts(IBM Plex Mono) 에서 로드한다.

**폰트가 하나다.** Apple 처럼 Display/Text 광학 사이즈가 나뉘지 않으므로 위계는 **크기와 굵기로만** 낸다. 자간은 조정하지 않는다 — Pretendard 기본값이 한글에 맞춰져 있다.

### 스케일 `brand`

MolCube 의 Tailwind 스케일을 따른다. Apple 마케팅 스케일(56/40/28/17)보다 조밀하다 — 우리는 마케팅 페이지가 아니라 업무 도구다.

| Role | Size | Line | Weight | Tailwind | 쓰는 곳 |
|---|---:|---:|---:|---|---|
| Display | 36px | 44px | 700 | `4xl` | QR 랜딩의 회의실 이름 **한 자리뿐** |
| Title | 24px | 32px | 600 | `2xl` | 다이얼로그 제목 |
| Section | 20px | 28px | 600 | `xl` | 날짜 헤딩, 섹션 |
| Body | 16px | 24px | 400 | `base` | 본문·컨트롤·입력 |
| Body Small | 14px | 20px | 400 | `sm` | 격자 셀, 보조 정보 |
| Caption | 12px | 16px | 400 | `xs` | 시간 눈금, 힌트 |
| Label | — | — | 500 | `font-medium` | 필드 레이블, 버튼 |

**16px 아래로 내리지 말 것 (입력 필드 한정).** 모바일 Safari 는 16px 미만 입력에서 자동 확대해 QR 예약 흐름을 깬다.

데스크톱 격자에는 Display 를 쓰지 않는다. 격자 셀은 Body Small, 시간 축은 Caption + mono.

## 4. Component Stylings

MolCube 의 실제 버튼 클래스가 기준이다:

```
rounded-md border border-primary bg-primary px-5 py-2.5
text-sm font-medium text-white
focus:ring-2 focus:ring-primary/30 focus:ring-offset-1
```

### MolRoom Primary Action
- Background `#185FA5` `a11y` / Text `#FFFFFF` / Border 1px 같은 색
- Radius **6px** (`rounded-md`) `brand` — pill 아님
- Padding `10px 20px` (`px-5 py-2.5`) `brand` / Height 44px `a11y` (터치 타깃 하한)
- Font 16px / 500 `brand`
- Hover `#0C447C` / Focus `0 0 0 3px rgba(55,138,221,0.18)` `brand`
- Use: 예약 확정, QR 랜딩의 첫 예약 버튼. **화면당 하나**

### MolRoom Secondary Action
- Background transparent / Text `#185FA5` / Border 1px `#B5D4F4` `brand`
- 나머지 지오메트리는 Primary 와 동일
- Use: 취소, 두 번째 이후 프리셋, 파괴적 동작의 반대편

### MolRoom Compact Action
- Height 36px / Padding `6px 14px` / Font 14px `local`
- Use: **데스크톱 격자 인접 컨텍스트에서만.** 격자 상세의 `+15분` / `-15분`
- 모바일의 같은 연장 컨트롤은 Compact 가 아니라 **Secondary(44px)** 를 쓴다. 36px 는 터치 타깃 하한을 밑돈다

### 비활성 처리
MolCube 는 `disabled:opacity-50` 을 쓰지만 **따라가지 않는다.** opacity 로 흐리면 왜 못 누르는지 알 수 없다.
배경 `#F5F5F2` + 텍스트 `#737373`, 그리고 **사유를 버튼 옆에 상시 노출**한다. 툴팁 금지.

### MolRoom Input
- Background `#FFFFFF` / Border 1px `#E4E4E0` / Radius **8px** `brand`
- Height 40px / Padding `0 12px` / Font 16px
- Focus: 보더 `#185FA5` + `--shadow-focus` `brand`

### MolRoom Booking Grid
가장 중요한 컴포넌트. 세로축 시간, 가로축 회의실.

- Container `#FAFAF8`, radius 12px
- Slot 28px / 30분 `local` — 08:00~20:00 이 한 화면에 들어가는 밀도
- Column min-width 132px `local`
- 30분선 `#E4E4E0`, 정시선 `#CFCFCA`
- 셀 텍스트 Body Small, **주최자 이름만.** 회의 제목은 표시하지 않는다
- 시간 축 Caption + mono, 정시만 라벨
- 이벤트 블록 radius 8px. 셀 배경은 §2 상태 표를 따른다
- 드래그 선택 중: `#E6F1FB` + 1px `#185FA5`

### MolRoom Card
- Background `#FFFFFF` / Radius **12px** (`rounded-lg`, 하우스 최다 사용) `brand`
- Padding 16px `brand` / Border 1px `#E4E4E0` / 그림자 없음 (§6)

### MolRoom Badge
- Height 22px / Radius **pill** `brand` (`rounded-full` 이 실제로 쓰이는 자리) / Padding `0 8px` / Caption 12px
- 기본(내 예약) `#E6F1FB` + `#171717` / 주의(미체크인) `#FAEEDA` + `#854F0B`
- 화면당 총량을 제한한다. 모든 셀에 배지가 붙으면 아무것도 강조되지 않는다

### MolRoom Tabs
- Height 44px / Font 16px
- 선택: 텍스트 `#171717` + 하단 2px `#185FA5` / 비선택 `#737373`
- **선택 상태를 반드시 명시적으로 표시할 것**

### MolRoom Dialog
- Background `#FFFFFF` / Radius 16px / Padding 24px / Max-width 480px
- Shadow `0 8px 32px rgba(0,0,0,0.12)` `brand` / Backdrop `rgba(7,27,51,0.45)` `local` (stage 색)
- 데스크톱은 중앙 모달, 모바일은 하단 시트로 전환 `local`
- 파괴적 동작이 있으면 안전한 기본 동작에서 **떨어뜨린다**(space-between). 빨강이 없으므로 거리로 구분한다

## 5. Layout Principles

- 데스크톱 격자는 전체 폭을 쓰되 좌측 시간 축을 sticky 로 고정한다
- 간격은 4의 배수. MolCube 의 `px-5 py-2.5`(20/10), `p-4`(16) 가 기준점
- 읽기 영역은 720px 로 제한한다 — 1440px 화면에서 리스트 카드가 통째로 늘어나면 액션이 저 멀리 떨어진다
- 밀도는 격자와 리스트에만 올린다. 컨트롤 지오메트리(44px/36px)는 유지

## 6. Depth & Elevation

**그림자를 거의 쓰지 않는다.** 깊이는 배경 색 단차로 표현한다: 캔버스 `#FAFAF8` → 카드 `#FFFFFF`.

예외는 둘뿐이다:
- 다이얼로그: `--shadow-modal` `brand`
- 포커스 링: `--shadow-focus` `brand`

격자 셀에 그림자를 넣지 말 것 — 24슬롯 × N방에 그림자가 깔리면 밀도가 무너진다.

## 7. Do's and Don'ts

### Do
- Pretendard 하나로 크기·굵기만 써서 위계를 낸다
- 채움 액션에 `#185FA5`, 링크에 같은 값을 쓴다
- 버튼은 라운드 사각형(6px), 카드 12px, 입력 8px, pill 은 배지·칩만
- 모든 값에 증거 등급(`brand`/`logo`/`local`/`a11y`)을 유지한다
- 모바일 컨트롤 높이를 44px 이상으로 유지한다
- 비활성 이유를 항상 눈에 보이게 적는다

### Don't
- `#4281FF` 를 텍스트나 텍스트 배경으로 쓰지 않는다 (흰 배경 3.61:1, AA 미달)
- 로고의 민트·앰버를 UI 에 풀지 않는다
- 버튼에 pill radius 를 쓰지 않는다
- 자간을 조정하지 않는다
- **빈 시간 슬롯에 색을 부여하지 않는다**
- **예약된 방을 빨강으로 칠하지 않는다.** 정상 상태다
- **격자 셀에 회의 제목을 노출하지 않는다**
- opacity 만으로 비활성을 표현하지 않는다

## 8. Responsive Behavior

두 표면이 **다른 일을 하므로** 스케일링이 아니라 전환으로 다룬다 `local`.

| 폭 | 표면 | 동작 |
|---|---|---|
| `>= 1024px` | 데스크톱 격자 | 전체 회의실 가로 나열. 시간 축 sticky. 드래그 선택 |
| `768~1023px` | 축소 격자 | 가로 스크롤. 드래그 유지 |
| `< 768px` | 모바일 | 격자는 세로 리스트로 축약. **주 진입점은 QR 랜딩** |

모바일은 데스크톱의 축소판이 아니다. 복도에서 폰을 든 사람은 격자를 훑지 않는다 — "지금 비었나" 하나만 확인하고 탭한다.

## 9. Agent Prompt Guide

- "MolRoom Primary Action: `#185FA5` 배경, 흰 텍스트, 44px 높이, 6px radius, 10px 20px 패딩, Pretendard 16px/500."
- "격자 셀은 28px 높이, 14px, 주최자 이름만. 내 예약은 `#E6F1FB` 배경에 `#171717` 텍스트."
- "미체크인 배지는 `#FAEEDA` 배경에 `#854F0B`, 12px, pill radius."
- "모바일 다이얼로그는 중앙 모달이 아니라 하단 시트."
- "값을 새로 만들어야 하면 `local` 로 표시하고, 근거가 없으면 만들지 마라."

## 10. Voice & Tone

레이블은 짧고, 알아볼 수 있고, 다음에 무슨 일이 일어나는지에 직결돼야 한다. 피드백은 사용자가 상황을 파악하고 통제하고 있다고 느끼게 해야 한다.

- 실패는 원인과 다음 행동을 함께 말한다. `"예약 실패"` 가 아니라 `"방금 다른 분이 이 시간을 예약했어요. 다른 시간을 골라주세요."`
- 비활성 컨트롤은 사유를 상시 노출한다. `"+15분"` 이 회색이면 그 옆에 `"14:00에 이영희님 예약 있음"`
- 느낌표를 쓰지 않는다. 예약 성공은 축하할 일이 아니라 완료된 일이다
- 이모지를 제품 카피에 쓰지 않는다
- 취소는 되돌릴 수 없으므로 무엇이 사라지는지 명시한다

## 11. Brand Narrative

MolRoom 은 2026년 7월 molcube 사내 도구로 시작했다. 전제는 하나다: **회의실 예약은 복도에서 두 번 탭하면 끝나야 한다.**

기존 회의실 예약 제품들이 기본으로 깔고 가는 것들 — 문 앞 태블릿 도어사이니지, 체크인 안 하면 자동 취소, 관리자 대시보드 — 을 MolRoom 은 의도적으로 거부한다. 수십 명 규모 사무실에서 그 무게는 문제를 푸는 것보다 문제를 늘린다. 태블릿 대신 종이 QR 을 붙이고, 예약을 지우는 대신 표시만 하고, 대시보드 대신 설정 파일에 이메일 몇 줄을 적는다.

같은 절제가 아키텍처에도 적용된다. MolRoom 은 데이터베이스를 운영하지 않는다. 회사는 이미 Google Workspace 를 쓰고 Google Calendar 에는 이미 회의실 리소스가 있다. 예약의 원본을 거기 두면 저장·중복방지·초대·알림·개인 캘린더 동기화를 구글이 운영한다. 서버 코드 0줄, 시크릿 0개.

디자인도 마찬가지다. 새 브랜드를 만들지 않았다. MolCube 가 이미 쓰는 색과 글꼴을 그대로 가져와, 사내 사람이 열었을 때 **다른 회사 제품처럼 보이지 않게** 했다. 하나 벗어난 곳(액션 색)은 접근성 때문이고 그 사유를 문서에 남겼다.

만들지 않은 것 하나하나가 고장 나지 않고 유지보수를 요구하지 않는다.

## 12. Principles

1. 일정이 지배하게 두고 컨트롤은 물러난다. 먼저 읽히는 것은 가용성 패턴이어야 한다.
2. 화면당 유채색 액션 액센트는 하나. MolRoom 에서 그 하나는 "내 것" 이다.
3. 폰트가 하나이므로 위계는 크기와 굵기로만 낸다.
4. 증거 등급을 섞지 않는다. `brand` 를 `local` 로 오염시키지 않고, `local` 을 `brand` 로 승격하지 않는다.
5. 브랜드보다 접근성이 우선한다. 벗어날 때는 측정값과 사유를 남긴다.
6. 부재는 색을 요구하지 않는다. 빈 시간, 정상 상태, 기본값에는 강조를 주지 않는다.
7. 데스크톱과 모바일은 축소 관계가 아니라 서로 다른 작업이다.

## 13. Personas

인구통계가 아니라 **행동 맥락**으로 정의한다.

- **미리 잡는 사람:** 자리에서 노트북으로 다음 주 회의를 계획한다. 여러 시간대와 방을 비교하므로 격자 전체를 훑는다. 데스크톱 격자가 이 사람의 화면이다.
- **즉석에서 잡는 사람:** 복도에 서 있고 지금 시작해야 한다. 비교하지 않고 "여기 지금 되나" 만 확인한다. 폰을 한 손에 들었고 타이핑할 의사가 없다. QR 랜딩이 이 사람의 화면이고, 인원 스테퍼와 저장된 Zoom 링크가 여기서 값을 한다.
- **회의실을 관리하는 사람:** 유령 예약이 방을 막을 때 개입한다. 드물게 일어나므로 전용 대시보드가 아니라 기존 화면의 추가 권한으로 충분하다.
- **회의에 초대받은 사람:** MolRoom 을 열지 않는다. 이 사람의 경험 전체는 Google 캘린더 초대장 하나다. 그래서 초대장의 정확성이 UI 만큼 중요하다.

## 14. States

| Component | 상태 |
|---|---|
| Primary / Secondary / Compact | default `brand` · hover `brand` · focus `brand` · 비활성은 배경+사유 `local` |
| Input | default `brand` · focus 보더 + `--shadow-focus` `brand` |
| Booking Grid Cell | 비어있음 / 남의 예약 / 내 예약 / 주의 — §2 표 |
| Grid Cell (드래그 중) | `#E6F1FB` + 1px `#185FA5` `local` |
| Tabs | selected / unselected `local` |
| Card, Dialog | default. hover 없음 |
| Badge | 기본 / 주의 2종 |

## 15. Motion & Easing

molcube-web 의 실제 애니메이션을 따른다 `brand`: `fade-in-down 0.3s ease-out`, `fade-out-up 0.2s ease-in`.

- 다이얼로그 진입 300ms, 종료 200ms, `cubic-bezier(0, 0, 0.2, 1)`
- 격자 셀 상태 변경 200ms
- 그 외 애니메이션 없음. 격자는 데이터 표시 화면이며 움직이면 읽기 어려워진다
- `prefers-reduced-motion: reduce` 에서 전부 0. 예외 없음

---

## Included Components

- Button (Primary / Secondary / Compact)
- Input
- Table (Booking Grid)
- Card
- Badge
- Tabs
- Dialog
