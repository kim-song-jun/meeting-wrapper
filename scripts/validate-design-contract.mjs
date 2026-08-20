import { readFileSync, readdirSync } from "node:fs";
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

const styleFiles = readdirSync(join(root, "src/styles"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
  .map((entry) => `src/styles/${entry.name}`);
requireText("src/styles/tokens.css", [
  "--r-action: 14px;", "--r-action-mobile: 16px;", "--r-input: 12px;",
  "--r-filter: 12px;", "--r-segment: 12px;", "--r-nav-item: 12px;",
  "--r-card: 16px;", "--r-dialog: 20px;",
]);
forbidPattern(styleFiles, /--r-(?:sm|md|lg|xl|seg)(?=\s*[:),;])/g);
for (const [token, evidence] of [
  ["--r-action", "toss"], ["--r-action-mobile", "toss"],
  ["--r-input", "local"], ["--r-filter", "local"],
  ["--r-segment", "local"], ["--r-nav-item", "local"],
  ["--r-card", "local"], ["--r-dialog", "local"],
]) requireTokenEvidence(token, evidence);

const radiusStylePaths = [
  "src/styles/components.css", "src/styles/grid.css", "src/styles/landing.css",
  "src/styles/login.css", "src/styles/mine.css", "src/styles/navigation.css",
  "src/styles/rooms.css", "src/styles/screens.css",
];
const mobileRadiusQuery = "@media (max-width: 767px)";

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractCssRules(source, contexts = []) {
  const rules = [];
  let start = 0;
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("/*", index)) {
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? source.length : close + 2;
      continue;
    }
    if (source[index] !== "{") {
      index += 1;
      continue;
    }
    const header = stripCssComments(source.slice(start, index)).trim();
    let depth = 1;
    let cursor = index + 1;
    while (cursor < source.length && depth > 0) {
      if (source.startsWith("/*", cursor)) {
        const close = source.indexOf("*/", cursor + 2);
        cursor = close === -1 ? source.length : close + 2;
        continue;
      }
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) throw new Error(`Unclosed CSS block after ${header}`);
    const rawBody = source.slice(index + 1, cursor - 1);
    const body = stripCssComments(rawBody);
    if (header.startsWith("@")) {
      rules.push(...extractCssRules(body, [...contexts, header]));
    } else if (header.length > 0) {
      rules.push({ selectors: header.split(",").map((selector) => selector.trim()), body, rawBody, contexts });
    }
    start = cursor;
    index = cursor;
  }
  return rules;
}

function radiusDeclarations(rule) {
  return [...rule.body.matchAll(/\bborder-radius\s*:\s*([^;]+);/g)].map((match) => match[1].trim());
}

function radiusContractFailures(radiusSources) {
  const contractFailures = [];
  const ruleSets = new Map(radiusStylePaths.map((path) => [path, extractCssRules(radiusSources.get(path))]));
  const rulesFor = (path, selector) => (ruleSets.get(path) ?? []).filter((rule) => rule.selectors.includes(selector));
  const baseRulesFor = (path, selector) => rulesFor(path, selector).filter((rule) => rule.contexts.length === 0);
  const mobileRulesFor = (path, selector) => rulesFor(path, selector).filter((rule) =>
    rule.contexts.length === 1 && rule.contexts[0] === mobileRadiusQuery,
  );
  const requireExactRadius = (path, selector, token, label, requireBaseRule) => {
    const matchingRules = (requireBaseRule ? baseRulesFor(path, selector) : rulesFor(path, selector))
      .filter((rule) => radiusDeclarations(rule).length > 0);
    if (matchingRules.length === 0 || matchingRules.some((rule) => radiusDeclarations(rule).join("|") !== `var(${token})`)) {
      contractFailures.push(`${path}: ${label} must own exactly ${token}`);
    }
  };

  for (const [path, selectors, token, requireBaseRule] of [
    ["src/styles/components.css", [".mr-btn--primary", ".mr-btn--secondary", ".mr-btn--compact", ".mr-btn--danger"], "--r-action", true],
    ["src/styles/grid.css", [".grid-viewswitch", ".grid-datestepper", ".grid-datepick"], "--r-action", true],
    ["src/styles/screens.css", [".mr-page-action"], "--r-action", true],
    ["src/styles/components.css", [".mr-input"], "--r-input"],
    ["src/styles/grid.css", [".grid-deptselect__input"], "--r-input"],
    ["src/styles/grid.css", [".grid-roomtoggle__btn", ".grid-deptchip"], "--r-filter"],
    ["src/styles/rooms.css", [".rooms-time-option"], "--r-filter"],
    ["src/styles/grid.css", [".grid-viewswitch__btn"], "--r-segment"],
    ["src/styles/navigation.css", [".mr-skip-link", ".mr-navlink", ".mr-mobile-nav__item"], "--r-nav-item"],
    ["src/styles/screens.css", [".mr-sidebar__item", ".mr-sidebar__room"], "--r-nav-item"],
    ["src/styles/components.css", [".mr-card", ".mr-alert", ".mr-picker__results", ".mr-recur-fail__list"], "--r-card"],
    ["src/styles/grid.css", [".grid-skeleton-card", ".grid-mobile__list", ".grid-mobile__empty", ".agenda__list", ".agenda__empty"], "--r-card"],
    ["src/styles/landing.css", [".mr-landing__item", ".mr-landing__roomlink"], "--r-card"],
    ["src/styles/login.css", [".mr-login__failure .mr-alert div:focus-visible"], "--r-card"],
    ["src/styles/mine.css", [".mine-list"], "--r-card"],
    ["src/styles/rooms.css", [".rooms-card"], "--r-card"],
    ["src/styles/components.css", [".mr-dialog"], "--r-dialog", true],
  ]) {
    for (const selector of selectors) requireExactRadius(path, selector, token, selector, requireBaseRule);
  }

  const actionSelectors = [
    ["src/styles/components.css", ".mr-btn--primary"], ["src/styles/components.css", ".mr-btn--secondary"],
    ["src/styles/components.css", ".mr-btn--compact"], ["src/styles/components.css", ".mr-btn--danger"],
    ["src/styles/grid.css", ".grid-viewswitch"], ["src/styles/grid.css", ".grid-datestepper"],
    ["src/styles/grid.css", ".grid-datepick"], ["src/styles/screens.css", ".mr-page-action"],
  ];
  for (const [path, selector] of actionSelectors) {
    const actionRadiusRules = rulesFor(path, selector).filter((rule) => radiusDeclarations(rule).length > 0);
    const hasOnlyPermittedActionRadii = actionRadiusRules.length === 2 && actionRadiusRules.every((rule) => {
      const value = radiusDeclarations(rule).join("|");
      return (rule.contexts.length === 0 && value === "var(--r-action)") ||
        (rule.contexts.length === 1 && rule.contexts[0] === mobileRadiusQuery && value === "var(--r-action-mobile)");
    });
    if (!hasOnlyPermittedActionRadii) {
      contractFailures.push(`${path}: ${selector} may use only base --r-action and the exact mobile override`);
    }
    const mobileRules = mobileRulesFor(path, selector);
    if (mobileRules.length !== 1 || radiusDeclarations(mobileRules[0]).join("|") !== "var(--r-action-mobile)") {
      contractFailures.push(`${path}: ${selector} must use --r-action-mobile only in ${mobileRadiusQuery}`);
    }
  }
  for (const [path, rules] of ruleSets) {
    for (const rule of rules) {
      if (!radiusDeclarations(rule).some((value) => /var\(\s*--r-action-mobile\b/.test(value))) continue;
      if (rule.contexts.length !== 1 || rule.contexts[0] !== mobileRadiusQuery ||
        rule.selectors.some((selector) => !actionSelectors.some(([actionPath, actionSelector]) => actionPath === path && actionSelector === selector))) {
        contractFailures.push(`${path}: --r-action-mobile is limited to required action selectors in ${mobileRadiusQuery}`);
      }
    }
  }

  for (const [path, selector] of [["src/styles/components.css", ".mr-input"], ["src/styles/grid.css", ".grid-deptselect__input"]]) {
    if (rulesFor(path, selector).some((rule) => radiusDeclarations(rule).some((value) => value !== "var(--r-input)"))) {
      contractFailures.push(`${path}: ${selector} must remain --r-input in every context`);
    }
  }

  const dialogMobileRules = mobileRulesFor("src/styles/components.css", ".mr-dialog");
  if (dialogMobileRules.length !== 1 || radiusDeclarations(dialogMobileRules[0]).join("|") !== "var(--r-dialog) var(--r-dialog) 0 0") {
    contractFailures.push("src/styles/components.css: mobile dialog top corners must use --r-dialog");
  }
  const dialogRadiusRules = rulesFor("src/styles/components.css", ".mr-dialog").filter((rule) => radiusDeclarations(rule).length > 0);
  if (dialogRadiusRules.length !== 2 || dialogRadiusRules.some((rule) => {
    const value = radiusDeclarations(rule).join("|");
    return !((rule.contexts.length === 0 && value === "var(--r-dialog)") ||
      (rule.contexts.length === 1 && rule.contexts[0] === mobileRadiusQuery && value === "var(--r-dialog) var(--r-dialog) 0 0"));
  })) {
    contractFailures.push("src/styles/components.css: .mr-dialog may use only its base role and exact mobile top-corner shorthand");
  }

  const pillAllowlist = new Map([
    ["src/styles/components.css", new Set([".mr-badge", ".mr-radio__dot", ".mr-radio__dot::after", ".mr-picker__team", ".mr-picker__chip", ".mr-picker__remove"])],
    ["src/styles/grid.css", new Set([".grid-roomtoggle__dot", ".grid-now__line::before", ".grid-month__daynum"])],
    ["src/styles/screens.css", new Set([".mr-sidebar__roomdot"])],
  ]);
  for (const [path, rules] of ruleSets) {
    for (const rule of rules) {
      if (!radiusDeclarations(rule).some((value) => /var\(\s*--r-pill\b/.test(value))) continue;
      const allowedSelectors = pillAllowlist.get(path);
      if (!allowedSelectors || rule.selectors.some((selector) => !allowedSelectors.has(selector))) {
        contractFailures.push(`${path}: --r-pill consumer must be an approved capsule, badge, dot, or circle selector`);
      }
    }
  }
  return contractFailures;
}

const radiusSources = new Map(radiusStylePaths.map((path) => [path, read(path)]));
failures.push(...radiusContractFailures(radiusSources));
const radiusMutations = [
  ["radius role swap", "src/styles/components.css", (source) => source.replace("border-radius: var(--r-input);", "border-radius: var(--r-filter);")],
  ["mobile action override removal", "src/styles/components.css", (source) => source.replace("border-radius: var(--r-action-mobile);", "border-radius: var(--r-action);")],
  ["non-mobile action override", "src/styles/components.css", (source) => `${source}\n@media (min-width: 1024px) { .mr-btn--primary { border-radius: var(--r-action-mobile); } }\n`],
  ["mobile dialog shorthand", "src/styles/components.css", (source) => source.replace("border-radius: var(--r-dialog) var(--r-dialog) 0 0;", "border-radius: var(--r-card) var(--r-card) 0 0;")],
  ["unapproved pill consumer", "src/styles/components.css", (source) => `${source}\n.radius-contract-negative { border-radius: var(--r-pill); }\n`],
  ["unapproved pill fallback and multi-value consumer", "src/styles/components.css", (source) => `${source}\n.radius-contract-negative-fallback { border-radius: var(--r-pill, 980px) var(--r-pill); }\n`],
];
for (const [label, path, mutate] of radiusMutations) {
  const mutated = mutate(radiusSources.get(path));
  if (mutated === radiusSources.get(path)) {
    failures.push(`validator radius negative mutation did not change source: ${label}`);
    continue;
  }
  const mutatedSources = new Map(radiusSources);
  mutatedSources.set(path, mutated);
  if (radiusContractFailures(mutatedSources).length === 0) {
    failures.push(`validator radius negative mutation did not fail: ${label}`);
  }
}

const spacingStylePaths = styleFiles.filter((path) => path !== "src/styles/tokens.css");
const spacingTokens = [
  ["--pad-action-inline", "20px", "toss"],
  ["--pad-action-compact-inline", "16px", "toss"],
  ["--pad-card", "16px", "toss"],
  ["--pad-mobile-inline", "20px", "local"],
];
const spacingProperty = /^(?:gap|row-gap|column-gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)$/;
const forbiddenSpacingDimension = /(?<![\d.])(?:12|20)px(?![\d.])/;

function declarations(rule) {
  return rule.body.split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.match(/^([\w-]+)\s*:\s*([\s\S]*?)\s*$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].trim()]);
}

function spacingContractFailures(sources) {
  const contractFailures = [];
  const tokens = sources.get("src/styles/tokens.css");
  const tokenRules = extractCssRules(tokens).filter((rule) =>
    rule.contexts.length === 0 && rule.selectors.length === 1 && rule.selectors[0] === ":root",
  );
  if (tokenRules.length !== 1) {
    contractFailures.push("src/styles/tokens.css: expected one base :root rule for spacing geometry");
  } else {
    const tokenRule = tokenRules[0];
    for (const [token, value, evidence] of spacingTokens) {
      const tokenDeclarations = extractCssRules(tokens)
        .flatMap((rule) => declarations(rule).filter(([property]) => property === token));
      const rootDeclarations = declarations(tokenRule).filter(([property]) => property === token);
      const matchingLines = tokenRule.rawBody.split(/\r?\n/).filter((line) =>
        new RegExp(`^\\s*${token}:\\s*${value};\\s*/\\*\\s*\\[${evidence}\\][^*]*\\*/\\s*$`).test(line),
      );
      if (tokenDeclarations.length !== 1 || rootDeclarations.length !== 1 || rootDeclarations[0][1] !== value || matchingLines.length !== 1) {
        contractFailures.push(`src/styles/tokens.css: ${token} must be a unique base :root ${value} declaration with [${evidence}] evidence`);
      }
    }
  }

  const ruleSets = new Map(spacingStylePaths.map((path) => [path, extractCssRules(sources.get(path))]));
  for (const [path, rules] of ruleSets) {
    for (const rule of rules) {
      for (const [property, value] of declarations(rule)) {
        if (spacingProperty.test(property) && forbiddenSpacingDimension.test(value)) {
          contractFailures.push(`${path}: forbidden ${property}: ${value}; in ${rule.selectors.join(", ")}`);
        }
      }
    }
  }

  const baseContext = [];
  const mobileContext = ["@media (max-width: 767px)"];
  const tabletContext = ["@media (min-width: 768px) and (max-width: 1023px)"];
  const consumer = (path, selector, contexts, expected) => ({ path, selector, contexts, expected });
  const spacingConsumers = [
    ...[".mr-btn--primary", ".mr-btn--secondary", ".mr-btn--danger", ".mr-picker__team"].map((selector) =>
      consumer("src/styles/components.css", selector, baseContext, [["padding-block", "0"], ["padding-inline", "var(--pad-action-inline)"]]),
    ),
    consumer("src/styles/components.css", ".mr-btn--compact", baseContext, [["padding-block", "0"], ["padding-inline", "var(--pad-action-compact-inline)"]]),
    consumer("src/styles/grid.css", ".grid-viewswitch__btn", baseContext, [["padding-block", "0"], ["padding-inline", "var(--pad-action-inline)"]]),
    ...[
      ["src/styles/components.css", ".mr-card"], ["src/styles/grid.css", ".grid-mobile__item"], ["src/styles/mine.css", ".mine-item"],
    ].map(([path, selector]) => consumer(path, selector, baseContext, [["padding", "var(--pad-card)"]])),
    consumer("src/styles/landing.css", ".mr-landing__header", baseContext, [["padding-block", "0"], ["padding-inline", "var(--pad-mobile-inline)"]]),
    consumer("src/styles/landing.css", ".mr-landing__main", baseContext, [["padding-block", "24px calc(48px + env(safe-area-inset-bottom))"], ["padding-inline", "var(--pad-mobile-inline)"]]),
    consumer("src/styles/landing.css", ".mr-landing__main", ["@media (min-width: 768px)"], [["padding-top", "32px"]]),
    consumer("src/styles/login.css", ".mr-login", baseContext, [["padding-block", "24px"], ["padding-inline", "var(--pad-mobile-inline)"], ["padding-top", "max(24px, env(safe-area-inset-top))"], ["padding-bottom", "max(24px, env(safe-area-inset-bottom))"]]),
    consumer("src/styles/login.css", ".mr-login", mobileContext, [["padding-block", "16px"], ["padding-inline", "var(--pad-mobile-inline)"], ["padding-top", "max(16px, env(safe-area-inset-top))"], ["padding-bottom", "max(16px, env(safe-area-inset-bottom))"]]),
    consumer("src/styles/navigation.css", ".mr-navlink", tabletContext, [["padding-block", "0"], ["padding-inline", "16px"]]),
    consumer("src/styles/screens.css", ".mr-sidebar__room", baseContext, [["padding-block", "0"], ["padding-inline", "16px"]]),
  ];
  const contextMatches = (actual, expected) => actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  const isPaddingProperty = (property) => property === "padding" || property === "padding-block" || property === "padding-inline" ||
    /^padding-(?:top|right|bottom|left|inline-(?:start|end)|block-(?:start|end))$/.test(property);
  const consumerGroups = new Map();
  for (const consumerDefinition of spacingConsumers) {
    const key = `${consumerDefinition.path}\u0000${consumerDefinition.selector}`;
    consumerGroups.set(key, [...(consumerGroups.get(key) ?? []), consumerDefinition]);
  }
  for (const definitions of consumerGroups.values()) {
    const [{ path, selector }] = definitions;
    const rules = (ruleSets.get(path) ?? []).filter((rule) => rule.selectors.includes(selector));
    for (const { contexts, expected } of definitions) {
      const expectedRule = rules.filter((rule) =>
        contextMatches(rule.contexts, contexts) && declarations(rule).some(([property]) => isPaddingProperty(property)),
      );
      if (expectedRule.length !== 1) {
        contractFailures.push(`${path}: ${selector} must have one padding rule in ${contexts.join(" > ") || "base"}`);
      }
    }
    for (const rule of rules) {
      const paddingDeclarations = declarations(rule).filter(([property]) => isPaddingProperty(property));
      if (paddingDeclarations.length === 0) continue;
      const approved = definitions.find(({ contexts }) => contextMatches(rule.contexts, contexts));
      if (!approved || paddingDeclarations.length !== approved.expected.length ||
        approved.expected.some(([property, value]) => !paddingDeclarations.some(([actualProperty, actualValue]) => actualProperty === property && actualValue === value)) ||
        paddingDeclarations.some(([property, value]) => !approved.expected.some(([expectedProperty, expectedValue]) => expectedProperty === property && expectedValue === value))) {
        contractFailures.push(`${path}: ${selector} has an unapproved padding declaration in ${rule.contexts.join(" > ") || "base"}`);
      }
    }
  }

  return contractFailures;
}

const spacingSources = new Map([
  ["src/styles/tokens.css", read("src/styles/tokens.css")],
  ...spacingStylePaths.map((path) => [path, read(path)]),
]);
failures.push(...spacingContractFailures(spacingSources));
forbidPattern(styleFiles, /--pad-(?:action|action-compact|content)(?=\s*[:),;])/g);

const spacingMutations = [
  ["spacing token value", "src/styles/tokens.css", (source) => source.replace("--pad-action-inline: 20px;", "--pad-action-inline: 16px;")],
  ["spacing token evidence", "src/styles/tokens.css", (source) => source.replace("--pad-mobile-inline: 20px;          /* [local] */", "--pad-mobile-inline: 20px;          /* [toss] */")],
  ["duplicate spacing token", "src/styles/tokens.css", (source) => `${source}\n@media (min-width: 1px) { :root { --pad-action-inline: 16px; } }\n`],
  ["one-line forbidden gap", "src/styles/components.css", (source) => `${source}\n.bad { gap: 12px; }\n`],
  ["semicolonless forbidden gap", "src/styles/components.css", (source) => `${source}\n.bad { gap: 12px }\n`],
  ["multiline forbidden gap", "src/styles/components.css", (source) => `${source}\n.bad {\n  gap:\n    12px;\n}\n`],
  ["commented forbidden gap control", "src/styles/components.css", (source) => `${source}\n/* .bad { gap: 12px; } */\n`],
  ["normal action token swap", "src/styles/components.css", (source) => source.replace("padding-inline: var(--pad-action-inline);", "padding-inline: var(--pad-card);")],
  ["compact action token removal", "src/styles/components.css", (source) => source.replace("padding-inline: var(--pad-action-compact-inline);", "padding-inline: 16px;")],
  ["card token swap", "src/styles/components.css", (source) => source.replace("padding: var(--pad-card);", "padding: var(--pad-mobile-inline);")],
  ["mobile inline token removal", "src/styles/landing.css", (source) => source.replace("padding-inline: var(--pad-mobile-inline);", "padding-inline: 16px;")],
  ["navigation padding-block reset", "src/styles/navigation.css", (source) => source.replace("    padding-block: 0;\n", "")],
  ["sidebar padding-block reset", "src/styles/screens.css", (source) => source.replace("  padding-block: 0;\n  padding-inline: 16px;", "  padding-inline: 16px;")],
  ["wrong action context", "src/styles/components.css", (source) => `${source}\n@media (max-width: 767px) { .mr-btn--primary { padding-block: 0; padding-inline: var(--pad-action-inline); } }\n`],
  ["later action shorthand override", "src/styles/components.css", (source) => `${source}\n.mr-btn--primary { padding: 0; }\n`],
  ["logical-side action override", "src/styles/components.css", (source) => `${source}\n.mr-btn--primary { padding-inline-start: 8px; }\n`],
  ["non-padding selector control", "src/styles/components.css", (source) => `${source}\n.mr-btn--primary { min-width: 1px; }\n`],
];
const acceptedMutationLabels = new Set(["commented forbidden gap control", "non-padding selector control"]);
for (const [label, path, mutate] of spacingMutations) {
  const mutated = mutate(spacingSources.get(path));
  if (mutated === spacingSources.get(path)) {
    failures.push(`validator spacing negative mutation did not change source: ${label}`);
    continue;
  }
  const mutatedSources = new Map(spacingSources);
  mutatedSources.set(path, mutated);
  const mutationFailures = spacingContractFailures(mutatedSources);
  if (acceptedMutationLabels.has(label) ? mutationFailures.length !== 0 : mutationFailures.length === 0) {
    failures.push(`validator spacing negative mutation did not fail: ${label}`);
  }
}
const acceptedDimensionMutation = `${spacingSources.get("src/styles/components.css")}\n.okay { gap: 112px; }\n`;
if (acceptedDimensionMutation === spacingSources.get("src/styles/components.css")) {
  failures.push("validator spacing 112px control mutation did not change source");
}
if (spacingContractFailures(new Map(spacingSources).set("src/styles/components.css", acceptedDimensionMutation)).length > 0) {
  failures.push("validator spacing 112px control mutation must remain accepted");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("MolRoom design contract: valid");
}
