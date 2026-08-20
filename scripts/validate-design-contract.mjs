import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const designPath = process.argv[2] ?? "DESIGN.md";
const failures = [];
const read = (relativePath) => readFileSync(join(root, relativePath), "utf8");

function requireText(relativePath, fragments) {
  const source = read(relativePath);
  for (const fragment of fragments) {
    if (!source.includes(fragment)) failures.push(`${relativePath}: missing ${JSON.stringify(fragment)}`);
  }
}

function forbidPattern(relativePaths, pattern) {
  for (const relativePath of relativePaths) {
    const source = read(relativePath);
    const matches = source.match(pattern) ?? [];
    for (const match of matches) failures.push(`${relativePath}: forbidden ${JSON.stringify(match)}`);
  }
}

function requirePattern(relativePath, pattern, label) {
  if (!pattern.test(read(relativePath))) failures.push(`${relativePath}: missing ${label}`);
}

const design = read(designPath);
const c3Headings = design.match(/^### C3 — 역할·입력 방식별 계약$/gm) ?? [];

if (c3Headings.length !== 1) {
  failures.push(`${designPath}: expected exactly one C3 role/input contract section; found ${c3Headings.length}`);
}

requirePattern(
  designPath,
  /^### C3 — 역할·입력 방식별 계약\n\n\| 역할 \| 미세 포인터 \| 터치·거친 포인터 \| 증거 \|\n\|---\|---:\|---:\|---\|\n\| 30분 슬롯 \| `24px` \| `44px` \| `local` \/ `a11y` \|\n\| Grid Event \| `12px\/14px` \| `14px\/20px` \| `local` \|\n\| 시간축 \| `11px\/14px` \| `13px\/18px` \| `local` \|\n\| 이벤트 radius \| `4px` \| `12px` \| `local` \|\n\| 주간 분할 열 하한 \| `76px` \| `76px` 이상 \| `local` \|\n\n기본값은 터치 안전값이다\. `\(min-width: 768px\) and \(hover: hover\) and \(pointer: fine\)`에서만 미세 포인터 값을 활성화한다\.$/m,
  "exact C3 role/input table and fine-pointer query",
);
requirePattern(
  designPath,
  /입력은 `12px`, 필터는 `12px`, 세그먼트는 `12px`, 내비게이션 항목은 `12px` radius를 각각 소유한다\. 값이 같아도 역할 토큰은 공유하지 않는다\. 카드 radius는 `16px`, 다이얼로그 radius는 `20px`, 액션 radius는 `14px`, 모바일 액션 radius는 `16px`이다\./,
  "independent component-radius ownership",
);
requirePattern(
  designPath,
  /현재 시각은 중립 `#4E5968` 선과 점으로 표시한다\. 빨강은 파괴적 동작 전용이다\./,
  "neutral current-time semantics",
);
requirePattern(
  designPath,
  /내 예약의 4px 좌측 막대는 logical border 또는 pseudo-element로 그려 focus ring과 함께 보여야 한다\./,
  "logical ownership stripe treatment",
);
requirePattern(
  designPath,
  /\*\*12px은 layout spacing이 아니며\*\*, \*\*20px은 `--pad-action-inline`과 `--pad-mobile-inline`처럼 이름 있는 component-geometry token에서만\*\* 허용한다/,
  "named component-geometry spacing constraints",
);
requirePattern(
  designPath,
  /### MolRoom Compact Action `local`\n- Height \*\*36px\*\*\(미세 포인터\) \/ \*\*44px\*\*\(터치·거친 포인터\) \/ Radius \*\*14px\*\*\(`--r-action`, `>=768px` 데스크톱\) \/ \*\*16px\*\*\(`--r-action-mobile`, `<768px` 모바일\) \/ Padding `0 16px` \/ Font 14px\n- 높이는 입력 방식에 따라 바뀌고, radius는 뷰포트에 따라 바뀐다\./,
  "Compact Action input-mode height and viewport radius boundary",
);
requirePattern(
  designPath,
  /본문·일반 컴포넌트의 타입 스케일은 전 구간에서 같다\. Grid Event와 시간축은 C3 입력 방식별 타입 규칙을 따른다\./,
  "responsive typography C3 qualification",
);
forbidPattern([designPath], /현재 시각[\s\S]{0,80}`#E42939`/g);
forbidPattern([designPath], /### MolRoom Compact Action `local`[\s\S]*?Radius 10px \/ 12px/g);
forbidPattern([designPath], /### MolRoom Compact Action `local`[\s\S]*?Height \*\*38px\*\*[\s\S]*?\*\*48px\*\*/g);
forbidPattern([designPath], /### MolRoom Compact Action `local`[\s\S]*?`--r-action-mobile`, 터치·거친 포인터와 모바일/g);
forbidPattern([designPath], /타입 스케일은 전 구간 동일하다\(§3\)\./g);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("MolRoom design contract: valid");
}
