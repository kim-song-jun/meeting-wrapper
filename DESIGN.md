<!-- omd:unresolved: radius.app-control — 레퍼런스가 검증한 radius 는 980px 마케팅 pill 과 18px HIG 문서 카드뿐이며, 밀도 높은 앱 컨트롤용 검증값이 없다. §4 의 molroom 앱 컨트롤 radius 는 local extension 으로 표기했다. -->
---
omd: 0.1
brand: molroom
bootstrapped_from: apple
bootstrapped_at: 2026-07-26
---

# molroom Design System

molcube 사내 회의실 예약 웹앱. Apple 레퍼런스(2026-07-11 검증)의 톤&매너를 보존하되, 마케팅 표면이 아니라 **밀도 높은 애플리케이션 표면**에 맞게 해석했다.

**증거 등급 표기 규칙.** 이 문서의 모든 값은 셋 중 하나로 표시된다. 등급을 지우거나 승격시키지 말 것.

| 표기 | 의미 |
|---|---|
| `verified` | Apple 공개 표면에서 2026-07-11 실측된 값. 그대로 사용 |
| `local` | molroom 로컬 확장. Apple 이 보증하지 않음. 검증된 팔레트·타입에서 파생 |
| `unresolved` | 근거가 없어 정하지 않음. 필요해지면 실측하거나 명시적으로 결정 |

---

## 1. Visual Theme & Atmosphere

Apple 의 현재 디자인 언어는 하드웨어·소프트웨어·콘텐츠·컨트롤이 하나의 연속된 시스템으로 느껴지게 만든다. 공개 웹에서는 작은 중립 팔레트, SF Pro 옵티컬 패밀리, 눈에 띄는 파란 액션이 쓰이고, 드라마는 대부분 제품 사진과 페이지 구성이 짊어진다. 절제는 그 자체가 목적이 아니다. 정확한 위계, 익숙한 동작, 제한된 장식이 복잡한 기능을 즉시 쓸 수 있게 만든다.

molroom 에서 **주인공은 제품 사진이 아니라 일정 그 자체다.** 예약 격자가 곧 콘텐츠이며, 컨트롤은 물러나 있어야 한다. 사용자가 화면을 처음 봤을 때 읽어야 하는 것은 버튼이 아니라 "언제가 비어 있는가" 라는 패턴이다. 색은 그 패턴을 방해하지 않는 선에서만 쓴다.

이 문서는 두 종류의 표면을 구분한다. **데스크톱 격자**(밀도 우선, 훑어보기)와 **모바일 QR 랜딩**(터치 우선, 단일 결정). 두 표면은 같은 토큰을 쓰되 지오메트리가 다르다. 한쪽 값을 다른 쪽에 기계적으로 옮기지 말 것.

**Key Characteristics:**
- SF Pro Text 를 본문·컨트롤에, SF Pro Display 를 큰 위계에 사용 `verified`
- 유채색 액션 액센트는 화면당 하나 — `#0071e3` `verified`
- 44px 는 검증된 컨트롤 높이이자 터치 타깃 최솟값. 모바일 컨트롤의 하한 `verified`
- 데스크톱 격자는 30분 슬롯당 28px 로 조밀하게 `local`
- 빈 시간은 색을 부여하지 않는다. 부재가 기본 상태다 `local`

## 2. Color Palette & Roles

### 검증된 팔레트 `verified`

- **Primary Action** (`#0071e3`): 채워진 버튼. 흰 텍스트 대비 4.70:1
- **Brand / Dark Canvas** (`#000000`): 다크 섹션
- **Fog Canvas** (`#f5f5f7`): 밝은 섹션·격자 배경
- **Surface** (`#ffffff`): 카드·다이얼로그·예약된 셀 표면
- **Foreground** (`#1d1d1f`): 주 텍스트. 흰 배경 대비 16.83:1
- **Muted** (`#6e6e73`): 보조 텍스트. 흰 배경 대비 5.07:1
- **Secondary** (`#515154`): 또 하나의 중립. 흰 배경 대비 7.91:1
- **On Primary** (`#ffffff`): 파란 채움 위 텍스트
- **Link** (`#0066cc`): 밝은 표면의 링크·아웃라인 버튼 텍스트/보더. 흰 배경 대비 5.57:1
- **Link on Dark** (`#2997ff`): 다크 섹션의 밝은 파랑

### 예약 상태 색 `local`

레퍼런스 팔레트에는 상태색이 없다. molroom 은 가용성 표현이 필수이므로 아래를 로컬 확장으로 정의한다. **Apple 이 보증한 값이 아니다.** 대비비는 실측 계산값이다.

| 상태 | 처리 | 근거 |
|---|---|---|
| **비어있음** | 전용 색 없음. Fog Canvas `#f5f5f7` 그대로 | 부재는 색을 요구하지 않는다. 빈 시간에 색을 주면 격자 전체가 시끄러워진다 |
| **남의 예약** | Surface `#ffffff` + Foreground 텍스트 | 정상 상태이므로 경고색을 쓰지 않는다 |
| **내 예약** | 배경 `#e8f2fd` + Foreground 텍스트 | 화면당 하나의 유채색 액센트(§12-2)를 "내 것" 에 배정. 배경 대비 14.87:1 |
| **주의 (미체크인)** | 텍스트 `#8a5300`, 배경 `#fff4e5` | 진짜 예외 상태에만 쓰는 단 하나의 경고색. 흰 배경 대비 6.33:1, tint 위 5.82:1 |

`#e8f2fd` 위에서 `#0071e3` 는 4.15:1 로 본문 AA 를 통과하지 못한다. **내 예약 셀의 텍스트는 파랑이 아니라 `#1d1d1f` 를 쓴다.** 링크가 필요하면 `#0066cc`(4.92:1).

빨강은 정의하지 않는다. 예약된 방은 오류가 아니다. 파괴적 확인(취소)에만 필요해지면 그때 실측해 추가한다 `unresolved`.

## 3. Typography Rules

### Font Family
- **Display**: `SF Pro Display` `verified` — 큰 위계 전용
- **Text**: `SF Pro Text` `verified` — 본문·컨트롤·격자 셀
- SF Mono 는 레퍼런스에서 선언만 되고 실제 사용이 확인되지 않았다. 승격하지 않는다

molcube 환경은 macOS 가 아닐 수 있다. 폴백 스택은 `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", "Pretendard", sans-serif` `local` — 한글은 `Apple SD Gothic Neo`(macOS 기본)로, 그 외 환경은 `Pretendard` 로 받는다.

| Role | Family | Size | Weight | Line Height | Tracking | 등급 |
|---|---|---:|---:|---:|---:|---|
| Display Hero | SF Pro Display | 56px | 600 | 60px | -0.28px | `verified` |
| Section | SF Pro Display | 40px | 600 | 44px | normal | `verified` |
| Tile Heading | SF Pro Display | 28px | 400 | 32px | 0.196px | `verified` |
| Body | SF Pro Text | 17px | 400 | 25px | -0.374px | `verified` |
| Body Small | SF Pro Text | 14px | 400 | 18px | -0.224px | `verified` |
| Caption | SF Pro Text | 12px | 400 | 16px | -0.12px | `verified` |

**molroom 적용 지침.** Display Hero(56px)는 QR 랜딩의 회의실 이름에만 쓴다 — 복도에서 폰을 들고 1초 안에 "여기가 어디인지" 를 읽어야 하는 유일한 자리다. 데스크톱 격자에는 Display 를 쓰지 않는다. 격자 셀은 Body Small(14px), 시간 축 눈금은 Caption(12px) `local`.

## 4. Component Stylings

### molroom Primary Action
- Background: `#0071e3` `verified`
- Text: `#ffffff` `verified`
- Radius: 980px (pill) `verified` — 마케팅 pill 지오메트리를 그대로 유지
- Padding: 11px 21px / Height: 44px / Font: 17px 400 SF Pro Text `verified`
- Use: QR 랜딩의 예약 버튼, 예약 모달의 확정 버튼. **화면당 하나**
- 모바일에서 높이를 44px 아래로 줄이지 말 것 (터치 타깃 하한)

### molroom Secondary Action
- Background: transparent / Text·Border: `#0066cc` 1px `verified`
- Radius: 980px / Padding: 11px 21px / Height: 44px / Font: 17px 400 `verified`
- Use: Primary 와 짝을 이루는 보조 액션 (취소, 다른 시간 보기)

### molroom Compact Action
- Background: `#0071e3` / Text: `#ffffff` `verified`
- Radius: 980px / Padding: 8px 15px / Height: 36px / Font: 14px 400 `verified`
- Use: **데스크톱 격자 인접 컨텍스트에서만.** 격자 위 인라인 액션, 격자 상세 다이얼로그의 `+15분` / `-15분`
- 모바일(QR 랜딩)의 같은 연장 컨트롤은 Compact 를 쓰지 않고 **Secondary(44px)** 를 쓴다.
  36px 는 터치 타깃 하한을 밑돈다. 같은 동작이라도 표면에 따라 지오메트리가 다른 것이 맞다 `local`
- 비활성(다음 예약과 충돌): opacity 는 쓰지 말 것. 배경 `#f5f5f7`, 텍스트 `#6e6e73`, 커서 not-allowed, 사유를 툴팁이 아니라 **버튼 옆 캡션으로 상시 노출** `local`

### molroom Input
- Background: `#ffffff` / Text: `#1d1d1f` / Placeholder: `#6e6e73` `verified` (팔레트)
- Border: 1px `#d2d2d7` / Radius: 8px / Height: 40px / Padding: 0 12px / Font: 17px 400 `local`
- Focus: 보더를 `#0071e3` 로 바꾸고 2px 외곽 링 `#0071e3` 20% `local`
- 17px 를 유지하는 이유: 모바일 Safari 는 16px 미만 입력에서 자동 확대한다. QR 예약 흐름이 깨진다
- Use: 회의 제목, 참석자 이메일, Zoom 링크

### molroom Booking Grid
가장 중요한 컴포넌트. 세로축 시간, 가로축 회의실.

- Container background: `#f5f5f7` `verified`
- Slot height: 28px / 30분 `local` — 08:00~20:00 이 스크롤 없이 한 화면에 들어가는 밀도
- Column min-width: 132px `local`
- Grid line: 1px `#d2d2d7`, 정시 라인만 진하게 `#c7c7cc` `local`
- Cell text: Body Small 14px, 주최자 이름만. **회의 제목은 표시하지 않는다** (프라이버시)
- Time axis: Caption 12px `#6e6e73`, 정시만 라벨
- 셀 배경은 §2 상태 색 표를 따른다
- 드래그 선택 중: 선택 영역 `#e8f2fd` + 1px `#0071e3` 보더 `local`

### molroom Card
- Background: `#ffffff` / Radius: 18px `verified` (HIG 문서 카드 실측값)
- Padding: 20px `verified` (레퍼런스가 확인한 콘텐츠 클러스터 간격)
- Shadow: 없음. §6 참조
- Use: QR 랜딩의 회의실 상태 카드, 내 예약 목록 항목
- 레퍼런스는 이 18px 를 "네이티브 플랫폼 카드 토큰" 으로 부르지 말라고 명시한다. molroom 은 웹이므로 사용해도 되지만, 네이티브 앱을 만들게 되면 다시 정할 것

### molroom Badge
- Height: 20px / Radius: 980px / Padding: 0 8px / Font: Caption 12px 400 `local`
- 기본(내 예약): 배경 `#e8f2fd`, 텍스트 `#1d1d1f`
- 주의(미체크인): 배경 `#fff4e5`, 텍스트 `#8a5300`
- 배지는 화면당 총량을 제한한다. 격자의 모든 셀에 배지가 붙으면 아무것도 강조되지 않는다

### molroom Tabs
- Text: `#1d1d1f` / Height: 53px / Font: 17px 400 SF Pro Text `verified` (Apple Store 갤러리 탭 실측)
- 선택 상태: 텍스트 `#1d1d1f` + 하단 2px `#0071e3` 인디케이터 `local`
- 비선택: 텍스트 `#6e6e73` `verified`
- Use: 내 예약 / 전체 예약(관리자) 전환. **선택 상태를 반드시 명시적으로 표시할 것** — 레퍼런스의 검증된 유일한 탭 상태가 selected/unselected 구분이다

### molroom Dialog
- Background: `#ffffff` / Radius: 18px `verified`
- Max-width: 480px / Padding: 24px `local`
- Backdrop: `#000000` 40% `local`
- 액션은 하단 우측, Secondary 왼쪽 · Primary 오른쪽
- Use: 예약 모달, 취소 확인
- 데스크톱은 중앙 모달, 모바일은 하단 시트로 전환 `local` — 모바일에서 중앙 모달은 엄지가 닿지 않는다

## 5. Layout Principles

- 데스크톱 격자는 전체 폭을 쓰되 좌측 시간 축을 sticky 로 고정한다. 가로 스크롤 시 축이 사라지면 격자를 읽을 수 없다
- 여기서 승격된 간격은 컴포넌트 로컬이다: 컴팩트 액션 8px/15px, 큰 pill 11px/21px, 콘텐츠 클러스터 20px `verified`
- Apple 페이지 구성에서 샘플링한 모든 여백을 보편 시스템 토큰처럼 다루지 말 것
- molroom 은 밀도를 한 단계 올린다(`density.shift: +1`). 이는 **격자와 리스트에만** 적용되며, 컨트롤 지오메트리(44px/36px)는 검증값 그대로 유지한다

## 6. Depth & Elevation

이 리비전에서 canonical 한 그림자 토큰은 없다. 실측된 버튼과 카드는 그림자가 없었다 `verified`.

molroom 에서 깊이는 그림자가 아니라 **배경 색 단차**로 표현한다: 격자 배경 `#f5f5f7` → 카드/셀 `#ffffff`. 유일한 예외는 다이얼로그로, backdrop 이 그 역할을 대신한다. 격자 셀에 그림자를 넣지 말 것 — 24개 슬롯 × N개 방에 그림자가 깔리면 밀도가 무너진다.

## 7. Do's and Don'ts

### Do
- 큰 위계에 SF Pro Display, 본문·컨트롤에 SF Pro Text 를 쓴다
- 채워진 액션에 `#0071e3`, 밝은 표면 링크·아웃라인에 `#0066cc` 를 쓴다
- 탭의 선택 상태를 명시적으로 유지한다
- 모든 값에 증거 등급(`verified` / `local` / `unresolved`)을 유지한다
- 모바일 컨트롤 높이를 44px 이상으로 유지한다
- 비활성 이유를 항상 눈에 보이게 적는다 (연장 불가 사유 등)

### Don't
- HIG 웹사이트의 18px 카드를 보편 Apple 플랫폼 카드라고 부르지 않는다
- 선언만 되고 사용이 확인되지 않은 SF Mono 를 UI 패밀리로 승격하지 않는다
- `#0066cc` 를 채움 버튼 배경으로 쓰지 않는다
- 36px 와 44px 컨트롤을 하나의 발명된 기본값으로 뭉개지 않는다
- 실측되지 않은 hover·disabled·focus 를 임의로 추론하지 않는다
- **빈 시간 슬롯에 색을 부여하지 않는다**
- **예약된 방을 빨강으로 칠하지 않는다.** 정상 상태다
- **격자 셀에 회의 제목을 노출하지 않는다** (설계 스펙 §2.6)
- 마케팅 지오메트리(56px hero, 980px pill)를 데스크톱 격자 안으로 끌고 들어오지 않는다

## 8. Responsive Behavior

레퍼런스는 보편 브레이크포인트를 승격하지 않는다. molroom 은 두 표면이 **다른 일을 하므로** 스케일링이 아니라 전환으로 다룬다 `local`.

| 폭 | 표면 | 동작 |
|---|---|---|
| `>= 1024px` | 데스크톱 격자 | 전체 회의실을 가로로 나열. 시간 축 sticky. 드래그 선택 |
| `768~1023px` | 축소 격자 | 회의실 3개까지 표시 + 가로 스크롤. 드래그 유지 |
| `< 768px` | 모바일 | 격자는 하루 단위 세로 리스트로 축약. **주 진입점은 QR 랜딩** |

모바일은 데스크톱의 축소판이 아니다. 복도에서 폰을 든 사람은 격자를 훑지 않는다 — "지금 비었나" 하나만 확인하고 탭한다. QR 랜딩(`/r/:roomId`)은 그 단일 결정에 최적화하고, 격자로 가는 링크는 부차적으로 둔다.

## 9. Agent Prompt Guide

- "molroom Primary Action 을 만들어라: `#0071e3` 배경, 흰 텍스트, 44px 높이, 980px radius, 11px 21px 패딩, SF Pro Text 17px/400."
- "예약 격자 셀은 28px 높이, Body Small 14px, 주최자 이름만. 내 예약은 `#e8f2fd` 배경에 `#1d1d1f` 텍스트."
- "미체크인 배지는 `#fff4e5` 배경에 `#8a5300` 텍스트, Caption 12px, 980px radius."
- "모바일 다이얼로그는 중앙 모달이 아니라 하단 시트로 전환하라."
- "값을 새로 만들어야 하면 `local` 로 표시하고, 근거가 없으면 만들지 말고 `unresolved` 로 남겨라."

## 10. Voice & Tone

Apple 의 현재 가이드는 언어를 단순함과 주체성의 일부로 다룬다. 레이블은 짧고, 알아볼 수 있고, 다음에 무슨 일이 일어나는지에 직결돼야 한다. 피드백은 사용자가 상황을 파악하고 통제하고 있다고 느끼게 해야 한다.

명료함이 성격을 없애는 것은 아니다. **단순함**은 **정교함**·**즐거움**과 짝을 이룬다. 불필요한 것을 걷어내되 모든 디테일에 신경 쓰고, 작업을 방해하지 않으면서 결정적인 순간을 만든다. 권한·파괴적 동작에는 완곡어법이 아니라 투명한 언어와 복구 가능성이 필요하다.

molroom 의 구체적 적용:

- 실패는 원인과 다음 행동을 함께 말한다. `"예약 실패"` 가 아니라 `"방금 다른 분이 이 시간을 예약했어요. 다른 시간을 골라주세요."`
- 비활성 컨트롤은 사유를 상시 노출한다. `"+15분"` 이 회색이면 그 옆에 `"14:00에 이영희님 예약 있음"`
- 느낌표를 쓰지 않는다. 예약 성공은 축하할 일이 아니라 완료된 일이다
- 이모지를 제품 카피에 쓰지 않는다. 상태 아이콘은 별개다
- 취소는 되돌릴 수 없으므로 무엇이 사라지는지 명시한다. `"이 예약을 취소합니다"` 가 아니라 `"3층 회의실 A · 오늘 14:00~15:00 예약을 취소합니다. 참석자 4명에게 취소 알림이 갑니다."`

## 11. Brand Narrative

molroom 은 2026년 7월 molcube 사내 도구로 시작했다. 전제는 하나다: **회의실 예약은 복도에서 두 번 탭하면 끝나야 한다.**

기존 회의실 예약 제품들이 기본으로 깔고 가는 것들 — 문 앞 태블릿 도어사이니지, 체크인 안 하면 자동 취소, 관리자 대시보드 — 을 molroom 은 의도적으로 거부한다. 수십 명 규모의 사무실에서 그 무게는 문제를 푸는 것보다 문제를 늘린다. 태블릿은 사지 않고 종이 QR 을 붙인다. 예약을 자동으로 지우지 않고 표시만 한다. 관리자 대시보드 대신 설정 파일에 이메일 몇 줄을 적는다.

같은 절제가 아키텍처에도 적용된다. molroom 은 데이터베이스를 운영하지 않는다. 회사는 이미 Google Workspace 를 쓰고 있고, Google Calendar 에는 이미 회의실 리소스가 있다. 예약의 원본을 거기 두면 저장·중복방지·초대·알림·개인 캘린더 동기화를 구글이 운영한다. molroom 은 그 위에 얹는 더 빠른 UI다. 서버 코드 0줄, 시크릿 0개.

이 절제는 게으름이 아니라 선택이다. 만들지 않은 것 하나하나가 고장 나지 않고 유지보수를 요구하지 않는다.

## 12. Principles

검증된 표면과 molroom 의 실제 사용 맥락에서 도출한 구현 원칙:

1. 일정이 지배하게 두고 컨트롤은 시각적으로 물러난다. 격자를 봤을 때 먼저 읽히는 것은 가용성 패턴이어야 한다.
2. 화면당 유채색 액션 액센트는 하나. molroom 에서 그 하나는 "내 것" 이다.
3. 타이포그래피 옵티컬 역할을 크기에 맞춘다. 큰 위계는 Display, 읽기·컨트롤은 Text.
4. 증거 등급을 섞지 않는다. `verified` 를 `local` 로 오염시키지 않고, `local` 을 `verified` 로 승격하지 않는다.
5. 발명된 보편 스케일보다 검증된 컴포넌트 로컬 측정값을 택한다.
6. 부재는 색을 요구하지 않는다. 빈 시간, 정상 상태, 기본값에는 강조를 주지 않는다.
7. 데스크톱과 모바일은 축소 관계가 아니라 서로 다른 작업이다. 스케일링하지 말고 전환한다.

## 13. Personas

molcube 구성원의 실제 사용 맥락이다. 인구통계 페르소나가 아니라 **행동 맥락**으로 정의한다.

- **미리 잡는 사람:** 자리에서 노트북으로 다음 주 회의를 계획한다. 여러 시간대와 여러 방을 비교해야 하므로 격자 전체를 훑는다. 참석자와 화상 링크를 함께 챙긴다. 데스크톱 격자가 이 사람의 화면이다.
- **즉석에서 잡는 사람:** 복도에 서 있고 지금 회의를 시작해야 한다. 비교하지 않고 "여기 지금 되나" 만 확인한다. 폰을 한 손에 들고 있으며 타이핑할 의사가 없다. QR 랜딩이 이 사람의 화면이고, 저장된 Zoom 링크 자동완성이 여기서 값을 한다.
- **회의실을 관리하는 사람:** 방이 유령 예약으로 막혀 있을 때 개입한다. 남의 예약을 볼 수 있어야 하고 필요하면 비울 수 있어야 하지만, 이 일은 드물게 일어난다. 전용 대시보드가 아니라 기존 화면의 추가 권한으로 충분하다.
- **회의에 초대받은 사람:** molroom 을 열지 않는다. 이 사람의 경험 전체는 Google 캘린더 초대장 하나다. 그래서 초대장의 정확성 — 방 이름, 시간, 화상 링크 — 이 molroom UI 만큼 중요하다.

## 14. States

| Component | 상태 근거 |
|---|---|
| Primary / Secondary / Compact Action | default 지오메트리 `verified`. hover·pressed 는 실측되지 않음 `unresolved` |
| Compact Action (비활성) | 배경 `#f5f5f7` + 텍스트 `#6e6e73` + 사유 캡션 `local` |
| Input | default `local`. focus 는 `#0071e3` 보더 + 외곽 링 `local` |
| Booking Grid Cell | 비어있음 / 남의 예약 / 내 예약 / 주의 — §2 상태 표 `local` |
| Grid Cell (드래그 선택 중) | `#e8f2fd` + 1px `#0071e3` `local` |
| Tabs | selected / unselected `verified` |
| Card, Dialog | default 만 `verified`. hover 는 실측되지 않음 |
| Badge | 기본 / 주의 2종 `local` |

hover·pressed 가 필요해지면 추론하지 말고 실제 Apple 표면에서 다시 실측하거나 `local` 로 명시 정의할 것.

## 15. Motion & Easing

이 웹 캡처에서 승격된 Apple 모션 토큰은 없다 `verified` (없음이 확인됨).

molroom 의 모션은 로컬 확장이며 최소로 유지한다 `local`:

- 다이얼로그 진입 200ms, 종료 150ms, `cubic-bezier(0.32, 0.72, 0, 1)`
- 격자 셀 상태 변경 120ms 배경색 전환
- 그 외 애니메이션 없음. 격자는 데이터 표시 화면이며 움직이면 읽기 어려워진다
- `prefers-reduced-motion: reduce` 에서 위 전환을 전부 0으로 만든다. 예외 없음

레퍼런스는 웹 애니메이션 값을 검증 전까지 로컬 확장으로 표기하라고 명시한다. 위 값들은 그 표기를 따른다.

---

## Included Components

이 디자인 시스템이 정의하는 컴포넌트:

- Button (Primary / Secondary / Compact)
- Input
- Table (Booking Grid)
- Card
- Badge
- Tabs
- Dialog
