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

function requireTokenEvidence(token, evidence) {
  const line = read("src/styles/tokens.css").split(/\r?\n/).find((candidate) => candidate.includes(`${token}:`));
  if (!line || !line.includes(`[${evidence}]`)) {
    failures.push(`src/styles/tokens.css: ${token} must carry [${evidence}] evidence`);
  }
}

requireText("src/styles/tokens.css", [
  "--grid-slot-fine: 24px;",
  "--grid-slot-touch: 44px;",
  "--grid-split-column-min: 76px;",
  "--t-grid-fine-size: 12px;",
  "--t-grid-touch-size: 14px;",
  "--t-axis-fine-size: 11px;",
  "--t-axis-touch-size: 13px;",
  "--r-event-fine: 4px;",
  "--r-event-touch: 12px;",
  "--c-now: #4E5968;",
]);
forbidPattern(
  ["src/styles/tokens.css", "src/styles/grid.css", "src/screens/GridScreen.tsx"],
  /--(?:t-grid-size|t-grid-lh|t-axis-size|t-axis-lh|r-event|grid-slot-h|grid-col-min)(?=\s*[:),;])/g,
);
requirePattern("src/styles/grid.css", /\.grid-event\s*\{[\s\S]*?border-inline-start:\s*4px solid transparent;/, "grid ownership stripe geometry");
requirePattern("src/styles/grid.css", /\.grid-mobile__item--mine::before[\s\S]*?inline-size:\s*4px;/, "mobile ownership pseudo stripe");
requirePattern("src/styles/grid.css", /\.agenda-row--mine::before[\s\S]*?inline-size:\s*4px;/, "agenda ownership pseudo stripe");
forbidPattern(["src/styles/grid.css"], /box-shadow:\s*inset 4px 0 0 var\(--c-mine-border\)/g);
requirePattern("src/styles/tokens.css", /--grid-slot-fine:\s*24px;[^\n]*\[local\]/, "fine slot evidence");
requirePattern("src/styles/tokens.css", /--grid-slot-touch:\s*44px;[^\n]*\[a11y\]/, "touch slot evidence");
requirePattern("src/styles/tokens.css", /--c-now:\s*#4E5968;[^\n]*\[local\]/, "current-time evidence");
for (const [token, evidence] of [
  ["--grid-slot-fine", "local"], ["--grid-slot-touch", "a11y"],
  ["--grid-split-column-min", "local"], ["--t-grid-fine-size", "local"],
  ["--t-grid-touch-size", "local"], ["--t-axis-fine-size", "local"],
  ["--t-axis-touch-size", "local"], ["--r-event-fine", "local"],
  ["--r-event-touch", "local"], ["--c-now", "local"],
]) requireTokenEvidence(token, evidence);

function extractBalancedCall(source, name, startAt = 0) {
  const start = source.indexOf(`${name}(`, startAt);
  if (start === -1) return null;
  let depth = 0;
  for (let index = start + name.length; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return { start, text: source.slice(start, index + 1) };
    }
  }
  throw new Error(`Unclosed ${name} call at index ${String(start)}`);
}

function extractBalancedBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const brace = source.indexOf("{", markerIndex + marker.length);
  if (brace === -1) return null;
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, index);
    }
  }
  throw new Error(`Unclosed block after ${marker}`);
}

function extractCalls(source, name) {
  const calls = [];
  let offset = 0;
  while (true) {
    const call = extractBalancedCall(source, name, offset);
    if (!call) return calls;
    calls.push(call);
    offset = call.start + call.text.length;
  }
}

function extractDelimited(source, openIndex, open, close) {
  if (source[openIndex] !== open) return null;
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return { start: openIndex, end: index + 1, text: source.slice(openIndex, index + 1) };
    }
  }
  throw new Error(`Unclosed ${open}${close} pair at index ${String(openIndex)}`);
}

function extractContentModeBranches(source) {
  const condition = 'contentMode === "organizer-only"';
  const conditionStart = source.indexOf(condition);
  if (conditionStart === -1) return null;
  const compactOpen = source.indexOf("(", source.indexOf("?", conditionStart + condition.length));
  const compact = extractDelimited(source, compactOpen, "(", ")");
  if (!compact) return null;
  const fullOpen = source.indexOf("(", source.indexOf(":", compact.end));
  const full = extractDelimited(source, fullOpen, "(", ")");
  return full ? { compact, full } : null;
}

function extractFunctionBody(source, name) {
  const signature = extractBalancedCall(source, name, source.indexOf(`function ${name}`));
  if (!signature) return null;
  return extractBalancedBlock(source.slice(signature.start + signature.text.length), "");
}

const activeMappings = [
  ["--grid-slot-block-size", "--grid-slot-fine", "--grid-slot-touch"],
  ["--grid-week-single-column-min", "--grid-week-single-fine-min", "--grid-week-single-touch-min"],
  ["--t-grid-event-size", "--t-grid-fine-size", "--t-grid-touch-size"],
  ["--t-grid-event-lh", "--t-grid-fine-lh", "--t-grid-touch-lh"],
  ["--t-grid-axis-size", "--t-axis-fine-size", "--t-axis-touch-size"],
  ["--t-grid-axis-lh", "--t-axis-fine-lh", "--t-axis-touch-lh"],
  ["--r-grid-event", "--r-event-fine", "--r-event-touch"],
];

function gridRuntimeContractFailures(tokens, screen) {
  const contractFailures = [];
  const fineRoot = extractBalancedBlock(tokens, "@media (min-width: 768px) and (hover: hover) and (pointer: fine)");
  if (!fineRoot) {
    contractFailures.push("src/styles/tokens.css: missing exact fine-pointer query");
  } else {
    for (const [active, fine] of activeMappings) {
      if (!new RegExp(`${active}: var\\(${fine}\\);`).test(fineRoot)) {
        contractFailures.push(`src/styles/tokens.css: missing fine active mapping for ${active}`);
      }
    }
  }
  for (const [active, , touch] of activeMappings) {
    if (!new RegExp(`${active}: var\\(${touch}\\);`).test(tokens)) {
      contractFailures.push(`src/styles/tokens.css: missing touch-safe active mapping for ${active}`);
    }
  }
  if (!/minmax\(var\(--grid-day-column-min\), 1fr\)/.test(screen)) {
    contractFailures.push("src/screens/GridScreen.tsx: missing day column token");
  }
  if (!/split \? "var\(--grid-split-column-min\)" : "var\(--grid-week-single-column-min\)"/.test(screen)) {
    contractFailures.push("src/screens/GridScreen.tsx: missing split and single-week column token selection");
  }
  const eventPlacements = extractCalls(screen, "placeInGrid").filter((call) =>
    /\bclippedStart\s*,[\s\S]*?\bclippedEnd\s*,/.test(call.text),
  );
  if (eventPlacements.length !== 2 || eventPlacements.some((call) => !/,\s*slotPx\s*,?\s*\)$/.test(call.text))) {
    contractFailures.push("src/screens/GridScreen.tsx: day and week event placeInGrid calls must each use slotPx");
  }
  const eventCalls = screen.match(/<GridEventBlock\b[\s\S]*?\/>/g) ?? [];
  if (eventCalls.length !== 2 || eventCalls.some((call) => !/roomName=\{room\.name\}/.test(call))) {
    contractFailures.push("src/screens/GridScreen.tsx: every GridEventBlock caller must pass roomName");
  }
  const eventBlock = extractFunctionBody(screen, "GridEventBlock");
  if (!eventBlock?.includes("eventContentMode(placement.height)")) {
    contractFailures.push("src/screens/GridScreen.tsx: GridEventBlock must invoke eventContentMode(placement.height)");
  }
  const contentBranches = extractContentModeBranches(eventBlock ?? "");
  if (!contentBranches) {
    contractFailures.push("src/screens/GridScreen.tsx: missing content-mode render branches");
  } else {
    if (!contentBranches.compact.text.includes("grid-event__name")) {
      contractFailures.push("src/screens/GridScreen.tsx: compact event branch must render organizer name");
    }
    if (contentBranches.compact.text.includes("grid-event__time")) {
      contractFailures.push("src/screens/GridScreen.tsx: compact event branch must not render time");
    }
    if (!contentBranches.full.text.includes("grid-event__name") || !contentBranches.full.text.includes("grid-event__time")) {
      contractFailures.push("src/screens/GridScreen.tsx: full event branch must render organizer name and time");
    }
  }
  if (!/const accessibleLabel = `\$\{booking\.organizerName\}, \$\{roomName\}, \$\{hhmm\(booking\.start\)\}~\$\{hhmm\(booking\.end\)\}\$\{noShow \? ", 미체크인" : ""\}`;/.test(eventBlock ?? "")) {
    contractFailures.push("src/screens/GridScreen.tsx: missing complete grid event accessible label");
  }
  return contractFailures;
}

const gridTokens = read("src/styles/tokens.css");
const gridScreen = read("src/screens/GridScreen.tsx");
failures.push(...gridRuntimeContractFailures(gridTokens, gridScreen));
const actualEventPlacement = extractCalls(gridScreen, "placeInGrid").find((call) =>
  /\bclippedStart\s*,[\s\S]*?\bclippedEnd\s*,/.test(call.text),
);
const actualContentBranches = extractContentModeBranches(extractFunctionBody(gridScreen, "GridEventBlock") ?? "");
const mutations = [
  [
    "event placement slotPx",
    gridTokens,
    actualEventPlacement
      ? gridScreen.replace(actualEventPlacement.text, actualEventPlacement.text.replace("slotPx", "slotPixels"))
      : gridScreen,
  ],
  ["event line-height mapping", gridTokens.replace("--t-grid-event-lh: var(--t-grid-touch-lh);", "--t-grid-event-lh: var(--t-grid-touch-line-height);"), gridScreen],
  ["content-mode helper", gridTokens, gridScreen.replace("eventContentMode(placement.height)", "eventContentMode(placement.slots)")],
  [
    "compact organizer name",
    gridTokens,
    actualContentBranches
      ? gridScreen.replace(actualContentBranches.compact.text, actualContentBranches.compact.text.replace("grid-event__name", "grid-event__organizer"))
      : gridScreen,
  ],
  [
    "compact time insertion",
    gridTokens,
    actualContentBranches
      ? gridScreen.replace(actualContentBranches.compact.text, actualContentBranches.compact.text.replace("</div>", '<span className="grid-event__time" /></div>'))
      : gridScreen,
  ],
];
for (const [label, tokens, screen] of mutations) {
  if (tokens === gridTokens && screen === gridScreen) {
    failures.push(`validator negative mutation did not change source: ${label}`);
    continue;
  }
  if (gridRuntimeContractFailures(tokens, screen).length === 0) {
    failures.push(`validator negative mutation did not fail: ${label}`);
  }
}
forbidPattern(["src/styles/grid.css"], /\.grid-week--split \.grid-event__time\s*\{\s*display:\s*none;\s*\}/g);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("MolRoom design contract: valid");
}
