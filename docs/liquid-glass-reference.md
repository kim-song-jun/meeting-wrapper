# Liquid Glass — 실제 구현 근거

MolRoom 의 유리 재질을 "대충 반투명"이 아니라 Apple 이 실제로 하는 것에 맞추기 위해 조사한 기록.
값을 바꾸기 전에 이 문서의 출처를 확인할 것. DESIGN.md §6 이 이 문서를 근거로 삼는다.

조사일: 2026-07-26

## 1. Apple 이 말하는 것 (규범)

WWDC25 "Meet Liquid Glass" 및 HIG 계열 자료에서 반복되는 규칙:

- **텍스트는 유리 위에 직접 놓지 않는다.** 글자는 항상 불투명한 레이어에 얹는다.
- 유리는 **콘텐츠 위의 기능 층**(내비게이션·컨트롤)이다. 콘텐츠 자체를 유리로 덮지 않는다.
- 접근성 설정에 자동으로 반응한다:
  | 설정 | 재질 변화 |
  |---|---|
  | Reduce Transparency | 더 불투명·더 프로스티해져 뒤가 가려진다 |
  | Increase Contrast | 거의 흑/백 단색 + 대비되는 **테두리**로 분리를 강화 |
  | Reduce Motion | 탄성(elastic) 성질과 전환 강도를 줄인다 |
- 유리 위 텍스트도 **4.5:1** 을 지켜야 한다.

→ MolRoom 은 이 셋을 이미 media query 로 구현하고 있다(`prefers-reduced-transparency`,
`prefers-contrast: more`, `prefers-reduced-motion`). "텍스트는 유리 위에 직접 놓지 않는다"는
격자 셀·이벤트 블록을 불투명하게 유지하는 우리 규칙과 같은 말이다.

## 2. 웹에서의 실제 기법 (측정된 값)

`deepika-builds/liquid-glass` (zero-dependency, 단일 파일)의 기본값이 가장 구체적이다:

| 파라미터 | 값 | 역할 |
|---|---|---|
| `backdrop-filter` (굴절 경로) | `url(#id) blur(3px) saturate(1.5)` | SVG 필터로 굴절 → 얕은 blur → 채도 |
| `backdrop-filter` (폴백) | `blur(16px) saturate(1.5)` | 굴절 미지원 브라우저의 프로스티 유리 |
| displacement `scale` | `-112` (음수 = 볼록 렌즈) | 굴절 강도 |
| `border` | 짧은 변의 `0.07` | 중앙을 중립화해 굴절을 **가장자리 띠**에만 남긴다 |
| `mapBlur` | `12px` | 그 가장자리 띠의 곡률 |
| 색 분산 | R/G/B 를 서로 다른 scale 로 3회 변위 후 screen 합성 | 가장자리의 옅은 프리즘 |

핵심 두 가지:

1. **굴절은 가장자리에서만 일어난다.** 변위 맵은 좌→우 빨강 램프(X)와 상→하 파랑 램프(Y)를
   `difference` 로 합친 뒤, 안쪽에 흐린 50% 회색 라운드 사각형을 덮어 중앙을 중립으로 만든다.
   그래서 판 한가운데는 왜곡되지 않고 테두리만 렌즈처럼 휜다 — 실제 유리판과 같다.
2. **`color-interpolation-filters: sRGB` 가 필수다.** SVG 필터는 기본이 linearRGB 라
   중립 회색 128 이 ~0.216 으로 재매핑돼 화면 전체가 상수만큼 밀린다.

## 3. 브라우저 지원 (이게 결정을 좌우한다)

`backdrop-filter: url(#filter)` 는 **Chromium 계열에서만** 동작한다. Safari·Firefox 는
SVG 필터를 backdrop 에 적용하지 못한다. 조사한 세 저장소가 모두 같은 말을 하고,
전부 프로스티 blur 폴백을 기본 경로로 둔다.

감지 방법(런타임 1줄):

```js
CSS.supports("backdrop-filter", "url(#lg)")
```

**아이러니:** Apple 의 디자인 언어인데 정작 Safari 에서 굴절이 안 된다. macOS/iOS 사용자가
주 타깃인 사내 도구에서 굴절 경로는 **대부분 실행되지 않는다.**

## 4. MolRoom 의 결정

- **굴절(SVG displacement)은 도입하지 않는다.** 주 사용자가 Safari/iOS 인데 그쪽에서
  동작하지 않는 코드를 위해 캔버스 변위 맵 생성기 + 리사이즈 핸들러 + 필터 트리를 얹는 것은
  실행되지 않는 복잡도다. Chromium 에서만 미묘하게 예뻐지고 유지보수는 항상 낸다.
- **대신 프로스티 경로를 정확한 값으로 맞춘다.** 조사한 폴백 값(`blur(16px) saturate(1.5)`)이
  우리가 쓰던 `saturate(180%) blur(20px)` 와 사실상 같은 자리다 — 우연이 아니라 둘 다
  같은 재질을 근사하고 있었다.
- **가장자리 처리에 투자한다.** 굴절 없이도 "유리"로 읽히게 하는 것은 blur 가 아니라
  **rim** 이다: 위쪽 1px 밝은 하이라이트 + 바깥 1px 어두운 경계. 이건 전 브라우저에서 된다.
- 접근성 3분기(reduce transparency / increase contrast / reduce motion)는 Apple 이
  규범으로 못박은 부분이므로 계속 유지한다.

이 결정이 바뀌려면: Safari 가 `backdrop-filter: url()` 를 지원하거나, 타깃이 Chromium 으로
바뀌어야 한다.

## 출처

- [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/)
- [deepika-builds/liquid-glass](https://github.com/deepika-builds/liquid-glass) — 단일 파일 구현, 위 수치의 출처
- [nikdelvin/liquid-glass](https://github.com/nikdelvin/liquid-glass) — CSS+SVG 재현, Safari 폴백 동작 확인
- [Zettersten/skills](https://github.com/Zettersten/skills) — 굴절 물리(Snell·SDF)에서 템플릿까지
- [Liquid Glass in the Browser — kube.io](https://kube.io/blog/liquid-glass-css-svg/)
- [iOS 26 Liquid Glass: Usability vs Accessibility — let's dev](https://letsdev.de/en/blog/ios-26-in-detail-liquid-glass-ui-between-usability-and-accessibility.php)
