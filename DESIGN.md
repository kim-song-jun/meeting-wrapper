---
omd: 0.1
brand: MolRoom
bootstrapped_from: apple
rederived_from: apple
rederived_at: 2026-07-26
note: MolCube 파생 판본은 DESIGN_DEPRECATED_MOLCUBE.md 에 보존
---

# MolRoom Design System

molcube 사내 회의실 예약. **얼굴은 Apple, 로고만 우리 것.**

한때 사내 디자인 시스템(`molcube-web`)에서 값을 도출한 판본이 있었지만, 제품이 원하는 인상이 Apple 쪽이라 되돌렸다. 색·타입·지오메트리·모션은 전부 Apple 실측값을 쓰고, MolCube 에서 가져오는 것은 **로고 하나**다. 이전 판본은 `DESIGN_DEPRECATED_MOLCUBE.md` 에 남겨 뒀다.

**출처:** `DESIGN_DEPRECATED.md` 에 박제된 apple.com · Apple Store · Apple HIG 실측 토큰(oh-my-design `apple` 레퍼런스). 로고 색은 MolCube 로고 이미지 픽셀에서 추출.

## 증거 등급

이 문서의 모든 값은 넷 중 하나다. 등급을 지우거나 승격시키지 말 것.

| 표기 | 의미 |
|---|---|
| `apple` | apple.com / Apple Store / HIG 에서 실측된 값. 임의로 바꾸지 않는다 |
| `logo` | MolCube 로고에서 추출한 값. 워드마크·파비콘 전용 |
| `local` | MolRoom 로컬 확장. Apple 레퍼런스에 없다 |
| `a11y` | 접근성 때문에 레퍼런스에서 의도적으로 벗어난 값. 사유가 함께 적혀 있다 |

---

## 1. Visual Theme & Atmosphere

Apple 의 얼굴은 **차가운 중립 위의 선명한 파랑**이다. 캔버스가 `#F5F5F7` — 순백도, 따뜻한 오프화이트도 아닌 미세하게 푸른 회색이다. 이 위에 흰 표면(`#FFFFFF`)이 얹히면서 단차가 생긴다. 테두리는 `#D2D2D7` 헤어라인 하나로 끝난다.

형태 언어의 핵심은 **역할별 곡률**이다. 버튼은 완전한 pill(980px), 카드는 18px, 입력은 12px. Apple 은 버튼을 사각형으로 두지 않는다 — 누를 수 있는 것과 담는 것을 곡률로 구분한다.

로고는 아이소메트릭 큐브에 분자 결합 모티프를 얹은 MolCube 의 것이다. 세 면(민트·파랑·노랑)이 짙은 인디고 외곽선 안에 묶여 있다. **이 네 색은 워드마크와 파비콘에만 쓴다** — UI 에 풀면 Apple 블루와 충돌한다. 남의 팔레트를 입은 대신 정체성은 이 한 자리에 모아 둔다.

MolRoom 에서 **주인공은 일정이다.** 예약 격자가 곧 콘텐츠이고 컨트롤은 물러나 있어야 한다. 화면을 처음 봤을 때 읽어야 하는 것은 버튼이 아니라 "언제가 비어 있는가" 라는 패턴이다.

두 표면을 구분한다: **데스크톱 격자**(밀도 우선, 훑어보기)와 **모바일 QR 랜딩**(터치 우선, 단일 결정). 같은 토큰을 쓰되 지오메트리가 다르다. 한쪽 값을 다른 쪽에 기계적으로 옮기지 말 것.

**Key Characteristics:**
- SF Pro(Apple 기기) → Pretendard(그 외 한글) 한 계열로 위계를 낸다 `apple`
- 유채색 액션 액센트는 화면당 하나 `local`
- 캔버스가 차갑다 — `#F5F5F7`, 순백 아님 `apple`
- 버튼은 pill, 카드는 18px, 입력은 12px `apple`
- 데스크톱 격자는 30분 슬롯당 28px `local`
- 빈 시간에는 색을 부여하지 않는다. 부재가 기본 상태다 `local`

## 2. Color Palette & Roles

### 로고 (장식 전용)

- **Logo Indigo** (`#202362`) `logo` — 로고 외곽선. 워드마크 텍스트
- **Logo Blue** (`#4279BC`) `logo` — 로고 파란 면
- **Logo Mint** (`#73FEDD`) `logo` — 로고 윗면
- **Logo Amber** (`#FFC006`) `logo` — 로고 오른면

**로고 안에서만** 쓴다. 앰비언트 배경에도 풀지 않는다.

### 액션

apple.com 의 채움 CTA 는 `#0071e3` + 흰 텍스트다. 실측 대비 **4.72:1** 로 WCAG AA 본문 기준(4.5:1)을 넘는다 — 레퍼런스 값을 그대로 쓸 수 있다. (이전 MolCube 판본은 브랜드 `primary` 가 3.61:1 이라 `a11y` 사유로 벗어나야 했다. 그 제약이 사라졌다.)

| 역할 | 값 | 출처 | 대비 |
|---|---|---|---|
| **Action** | `#0071E3` | marketing primary `apple` | 흰 텍스트 4.72:1 |
| **Action Hover** | `#0062C4` | `local` (Apple 은 hover 를 노출하지 않는다) | 흰 텍스트 5.86:1 |
| **Action Tint** | `#E8F1FC` | `local` | — |
| **Action Border** | `#B0D2F5` | `local` | — |
| **Link** | `#0066CC` | light-surface link `apple` | 흰 배경 5.56:1 |
| **Link on Dark** | `#2997FF` | dark-section link `apple` | — |

Apple 은 채움 배경(`#0071e3`)과 링크(`#0066cc`)를 구분해서 쓴다. 섞지 말 것.

### 중립 `apple`

| 역할 | 값 | 대비 (캔버스 위) |
|---|---|---|
| Canvas | `#F5F5F7` (fog) | — |
| Surface | `#FFFFFF` | — |
| Surface Muted | `#E8E8ED` `local` | — |
| Border | `#D2D2D7` | — |
| Border Strong | `#C7C7CC` `local` | — |
| Foreground | `#1D1D1F` | 16.24:1 |
| Secondary | `#515154` | 7.86:1 |
| Muted | `#6E6E73` | 4.58:1 |
| Stage (다크) | `#000000` | — |

### 예약 상태

| 상태 | 처리 | 출처 | 근거 |
|---|---|---|---|
| **비어있음** | 전용 색 없음. Canvas 그대로 | — | 부재는 색을 요구하지 않는다. 빈 시간에 색을 주면 격자의 80%가 시끄러워진다 |
| **남의 예약** | Surface + Foreground | — | 정상 상태다. 경고색을 쓰지 않는다 |
| **내 예약** | 배경 `#E8F1FC` · 강조 `#0066CC` · 보더 `#B0D2F5` | `local` (action tint 계열) | 화면당 하나의 유채색 액센트를 "내 것" 에 배정. 배경 대비 14.86:1 |
| **주의 (미체크인)** | 배경 `#FFF3E5` · 텍스트 `#8F4B00` | `local` | Apple 레퍼런스에 경고색이 없어 시스템 오렌지를 AA 까지 어둡게 잡았다. tint 위 6.11:1 |

빨강은 정의하지 않는다 — 예약된 방은 오류가 아니다.

## 3. Typography Rules

### Font Family `apple`

- **Sans**: `-apple-system` → `SF Pro Text/Display` → `Pretendard Variable` → system
- **Mono**: `ui-monospace` → `SF Mono` → `IBM Plex Mono` — 시간 눈금처럼 자릿수가 맞아야 하는 곳

**SF Pro 는 웹에 배포되는 폰트가 아니다.** Apple 기기에서는 `-apple-system` 이 SF Pro 를 그대로 집고, 그 밖의 환경에서는 한글 대응을 위해 Pretendard 로 떨어진다 — 광학적으로 SF 에 가장 가까운 국문 폰트다. 자간은 조정하지 않는다.

### 스케일 `apple`

apple.com 의 타입 스케일. 본문이 **17px** 로 일반적인 업무 도구(16px)보다 한 단 크다 — Apple 은 밀도보다 읽기를 우선한다.

| Role | Size | Line | Weight | 쓰는 곳 |
|---|---:|---:|---:|---|
| Display | 40px | 44px | 600 | QR 랜딩의 회의실 이름 **한 자리뿐** |
| Title | 28px | 34px | 600 | 다이얼로그 제목 |
| Section | 21px | 28px | 600 | 날짜 헤딩, 섹션 |
| Body | 17px | 25px | 400 | 본문·컨트롤·입력 |
| Body Small | 14px | 20px | 400 | 격자 셀, 보조 정보 |
| Caption | 12px | 16px | 400 | 시간 눈금, 힌트 |
| Label | — | — | 500 | 필드 레이블, 버튼 |

입력 필드는 Body(17px)를 쓴다 — 16px 미만이면 모바일 Safari 가 자동 확대해 QR 예약 흐름을 깬다.

데스크톱 격자에는 Display 를 쓰지 않는다. 격자 셀은 Body Small, 시간 축은 Caption + mono.

## 4. Component Stylings

apple.com 의 실제 CTA 가 기준이다: pill radius 980px, 높이 44px, 패딩 `11px 21px`, 17px.

### MolRoom Primary Action
- Background `#0071E3` `apple` / Text `#FFFFFF` / 보더 없음
- Radius **980px (pill)** `apple`
- Padding `11px 21px` `apple` / Height 44px `apple`
- Font 17px / 400 `apple`
- Hover `#0062C4` `local` / Focus `0 0 0 4px rgba(0,113,227,0.35)` `local`
- Use: 예약 확정, QR 랜딩의 첫 예약 버튼. **화면당 하나**

### MolRoom Secondary Action
- Background transparent / Text `#0066CC` / Border 1px `#0066CC` `apple` (marketing-outline)
- 나머지 지오메트리는 Primary 와 동일 (pill, 44px)
- Hover 시에만 `#E8F1FC` 로 아주 옅게 채운다 `local`
- Use: 취소, 두 번째 이후 프리셋, 파괴적 동작의 반대편

### MolRoom Compact Action
- Height 36px / Padding `8px 15px` / Font 14px `apple` (marketing-compact)
- Use: **데스크톱 격자 인접 컨텍스트에서만.** 격자 상세의 `+15분` / `-15분`
- 모바일의 같은 연장 컨트롤은 Compact 가 아니라 **Secondary(44px)** 를 쓴다. 36px 는 터치 타깃 하한을 밑돈다

### 비활성 처리
opacity 로 흐리지 않는다 — 왜 못 누르는지 알 수 없다.
배경 `#E8E8ED` + 텍스트 `#6E6E73`, 그리고 **사유를 버튼 옆에 상시 노출**한다. 툴팁 금지.

### MolRoom Input
- Background `#FFFFFF` / Border 1px `#D2D2D7` / Radius **12px** `local`
- Height 44px / Padding `0 12px` / Font 17px
- Focus: 보더 `#0071E3` + `--shadow-focus`

### MolRoom Booking Grid
가장 중요한 컴포넌트. 세로축 시간, 가로축 회의실.

- Container `#F5F5F7`, radius 18px
- Slot 28px / 30분 `local` — 08:00~20:00 이 한 화면에 들어가는 밀도
- Column min-width 132px `local`
- 30분선 `#D2D2D7`, 정시선 `#C7C7CC`
- 셀 텍스트 Body Small, **주최자 이름만.** 회의 제목은 표시하지 않는다
- 시간 축 Caption + mono, 정시만 라벨
- 이벤트 블록 radius 12px. 셀 배경은 §2 상태 표를 따른다
- 드래그 선택 중: `#E8F1FC` + 1px `#0071E3`
- **격자는 이 화면의 유일한 세로 스크롤러다.** 페이지는 스크롤하지 않는다 (§5)

### MolRoom Card
- Background `#FFFFFF` / Radius **18px** `apple` (HIG reference card)
- Padding 16px / Border 1px `#D2D2D7` / 그림자 없음 (§6)

### MolRoom Badge
- Height 22px / Radius **pill** `apple` / Padding `0 8px` / Caption 12px
- 기본(내 예약) `#E8F1FC` + `#0066CC` / 주의(미체크인) `#FFF3E5` + `#8F4B00`
- 화면당 총량을 제한한다. 모든 셀에 배지가 붙으면 아무것도 강조되지 않는다

### MolRoom Tabs
- Height 53px `apple` (Apple Store 갤러리 탭) / Font 17px
- 선택: 텍스트 `#1D1D1F` + 하단 2px `#0071E3` / 비선택 `#6E6E73`
- **선택 상태를 반드시 명시적으로 표시할 것**

### MolRoom Dialog
- Background `#FFFFFF` / Radius 20px / Padding 24px / Max-width 480px
- Shadow `0 8px 32px rgba(0,0,0,0.12)` / Backdrop `rgba(0,0,0,0.48)` `local`
- 데스크톱은 중앙 모달, 모바일은 하단 시트로 전환 `local`
- 데이터 입력·파괴적 확인 다이얼로그는 **배경 클릭으로 닫히지 않는다**
- 파괴적 동작이 있으면 안전한 기본 동작에서 **떨어뜨린다**(space-between). 빨강이 없으므로 거리로 구분한다

## 5. Layout Principles

- 데스크톱 격자는 전체 폭을 쓰되 좌측 시간 축을 sticky 로 고정한다
- **스크롤러는 화면당 하나.** 격자 화면(≥768px)은 문서 스크롤을 잠그고 격자 판 하나에 전량 위임한다. 페이지를 굴린 뒤 격자 안에서 또 굴리게 하지 않는다
- 간격은 4의 배수. Apple 의 `11px 21px` 패딩은 예외(레퍼런스 실측값)
- 읽기 영역은 720px 로 제한한다 — 1440px 화면에서 리스트 카드가 통째로 늘어나면 액션이 저 멀리 떨어진다
- 밀도는 격자와 리스트에만 올린다. 컨트롤 지오메트리(44px/36px)는 유지

## 6. Depth & Elevation

**그림자를 거의 쓰지 않는다.** 깊이는 배경 색 단차로 표현한다: 캔버스 `#F5F5F7` → 카드 `#FFFFFF`.

예외는 둘뿐이다:
- 다이얼로그: `--shadow-modal`
- 포커스 링: `--shadow-focus`

격자 셀에 그림자를 넣지 말 것 — 24슬롯 × N방에 그림자가 깔리면 밀도가 무너진다.

유리(Liquid Glass)는 **크롬에만** 쓴다 — 앱바, 다이얼로그, 하단 시트, 격자의 sticky 헤더/시간축. Apple HIG 가 명시하듯 반투명 층은 콘텐츠 위의 기능 층이지 콘텐츠 자체를 덮는 장식이 아니다. 격자 셀과 이벤트 블록은 불투명하게 둔다.

## 7. Do's and Don'ts

### Do
- SF Pro/Pretendard 한 계열로 크기·굵기만 써서 위계를 낸다
- 채움 액션에 `#0071E3`, 링크와 아웃라인 버튼에 `#0066CC`
- 버튼은 pill, 카드 18px, 입력 12px, 다이얼로그 20px
- 모든 값에 증거 등급(`apple`/`logo`/`local`/`a11y`)을 유지한다
- 모바일 컨트롤 높이를 44px 이상으로 유지한다
- 비활성 이유를 항상 눈에 보이게 적는다

### Don't
- `#0066CC` 를 채움 버튼 배경으로 쓰지 않는다 (Apple 은 링크색으로만 쓴다)
- **로고의 네 색(인디고·파랑·민트·앰버)을 UI 에 풀지 않는다.** 워드마크·파비콘 전용
- 버튼에 사각형 radius 를 쓰지 않는다
- 자간을 조정하지 않는다
- **빈 시간 슬롯에 색을 부여하지 않는다**
- **예약된 방을 빨강으로 칠하지 않는다.** 정상 상태다
- **격자 셀에 회의 제목을 노출하지 않는다**
- opacity 만으로 비활성을 표현하지 않는다
- **한 화면에 세로 스크롤러를 둘 두지 않는다**

## 8. Responsive Behavior

두 표면이 **다른 일을 하므로** 스케일링이 아니라 전환으로 다룬다 `local`.

| 폭 | 표면 | 동작 |
|---|---|---|
| `>= 1024px` | 데스크톱 격자 | 전체 회의실 가로 나열. 시간 축 sticky. 드래그 선택. 격자가 유일한 스크롤러 |
| `768~1023px` | 축소 격자 | 가로 스크롤. 드래그 유지. 격자가 유일한 스크롤러 |
| `< 768px` | 모바일 | 격자는 세로 리스트로 축약. 페이지 스크롤로 돌아간다. **주 진입점은 QR 랜딩** |

모바일은 데스크톱의 축소판이 아니다. 복도에서 폰을 든 사람은 격자를 훑지 않는다 — "지금 비었나" 하나만 확인하고 탭한다.

## 9. Agent Prompt Guide

- "MolRoom Primary Action: `#0071E3` 배경, 흰 텍스트, 44px 높이, pill radius, 11px 21px 패딩, 17px/400."
- "격자 셀은 28px 높이, 14px, 주최자 이름만. 내 예약은 `#E8F1FC` 배경에 `#0066CC` 텍스트."
- "미체크인 배지는 `#FFF3E5` 배경에 `#8F4B00`, 12px, pill radius."
- "모바일 다이얼로그는 중앙 모달이 아니라 하단 시트."
- "로고 색은 워드마크에만. UI 에 쓰지 마라."
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

디자인에서도 새로 만들지 않았다. Apple 이 수십 년 다듬은 색·타입·곡률·모션을 그대로 가져다 썼다. 사내 도구를 위해 브랜드를 발명하는 것은 만들지 않아도 될 것을 만드는 일이다. 대신 **로고 한 자리**를 우리 것으로 남겨, 이게 누구의 도구인지만 분명히 한다.

만들지 않은 것 하나하나가 고장 나지 않고 유지보수를 요구하지 않는다.

## 12. Principles

1. 일정이 지배하게 두고 컨트롤은 물러난다. 먼저 읽히는 것은 가용성 패턴이어야 한다.
2. 화면당 유채색 액션 액센트는 하나. MolRoom 에서 그 하나는 "내 것" 이다.
3. 폰트가 한 계열이므로 위계는 크기와 굵기로만 낸다.
4. 증거 등급을 섞지 않는다. `apple` 을 `local` 로 오염시키지 않고, `local` 을 `apple` 로 승격하지 않는다.
5. 접근성이 우선한다. 벗어날 때는 측정값과 사유를 남긴다.
6. 부재는 색을 요구하지 않는다. 빈 시간, 정상 상태, 기본값에는 강조를 주지 않는다.
7. 데스크톱과 모바일은 축소 관계가 아니라 서로 다른 작업이다.
8. 정체성은 로고 한 자리에 모은다. 팔레트에 흩뿌리지 않는다.

## 13. Personas

인구통계가 아니라 **행동 맥락**으로 정의한다.

- **미리 잡는 사람:** 자리에서 노트북으로 다음 주 회의를 계획한다. 여러 시간대와 방을 비교하므로 격자 전체를 훑는다. 데스크톱 격자가 이 사람의 화면이다.
- **즉석에서 잡는 사람:** 복도에 서 있고 지금 시작해야 한다. 비교하지 않고 "여기 지금 되나" 만 확인한다. 폰을 한 손에 들었고 타이핑할 의사가 없다. QR 랜딩이 이 사람의 화면이고, 인원 스테퍼와 저장된 Zoom 링크가 여기서 값을 한다.
- **회의실을 관리하는 사람:** 유령 예약이 방을 막을 때 개입한다. 드물게 일어나므로 전용 대시보드가 아니라 기존 화면의 추가 권한으로 충분하다.
- **회의에 초대받은 사람:** MolRoom 을 열지 않는다. 이 사람의 경험 전체는 Google 캘린더 초대장 하나다. 그래서 초대장의 정확성이 UI 만큼 중요하다.

## 14. States

| Component | 상태 |
|---|---|
| Primary / Secondary / Compact | default `apple` · hover `local` · focus `local` · 비활성은 배경+사유 `local` · press scale 0.97 `local` |
| Input | default `apple` · focus 보더 + `--shadow-focus` |
| Booking Grid Cell | 비어있음 / 남의 예약 / 내 예약 / 주의 — §2 표 |
| Grid Cell (드래그 중) | `#E8F1FC` + 1px `#0071E3` `local` |
| Tabs | selected / unselected `local` |
| Card, Dialog | default. hover 없음 |
| Badge | 기본 / 주의 2종 |

## 15. Motion & Easing

역할별로 duration 과 ease 를 나눈다. 전부 50ms 그리드에 양자화한다 `local`.

- hover·색 전환 150ms / 다이얼로그 진입 300ms
- enter 는 `cubic-bezier(0, 0, 0.2, 1)`(ease-out), exit 는 `cubic-bezier(0.4, 0, 1, 1)`(accelerate), 이미 보이는 요소의 morph 만 ease-in-out
- 누를 때 `scale(0.97)`, 150ms — 격자 이벤트 블록은 폭이 좁아 0.98
- 격자 셀 상태 변경 150ms
- 그 외 애니메이션 없음. 격자는 데이터 표시 화면이며 움직이면 읽기 어려워진다
- `prefers-reduced-motion: reduce` 에서 이동·스케일 전부 0. 예외 없음. 색 전환은 신호로 남긴다

---

## Included Components

- Button (Primary / Secondary / Compact)
- Input
- Table (Booking Grid)
- Card
- Badge
- Tabs
- Dialog
