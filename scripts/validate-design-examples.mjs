import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const exampleRoot = join(root, "docs", "design-examples");
const standaloneRoot = join(exampleRoot, "standalone");

const htmlFiles = [
  "index.html",
  "login.html",
  "calendar.html",
  "room.html",
  "my-bookings.html",
  "booking-dialog.html",
];

const screenshots = new Map([
  ["login-mobile.png", [390, 844]],
  ["calendar-desktop.png", [1440, 1000]],
  ["room-mobile.png", [390, 844]],
  ["my-bookings-mobile.png", [390, 844]],
  ["booking-dialog-desktop.png", [1440, 1000]],
]);

function fail(message) {
  console.error(`design examples: ${message}`);
  process.exitCode = 1;
}

for (const dependency of ["examples.css", "brand.svg"]) {
  const path = join(exampleRoot, dependency);
  if (!existsSync(path)) fail(`${dependency}가 없습니다. HTML만 복사하면 스타일 또는 로고가 깨집니다`);
  else if (statSync(path).size < 100) fail(`${dependency} 용량이 비정상적으로 작습니다`);
}

for (const file of htmlFiles) {
  const path = join(exampleRoot, file);
  try {
    const html = readFileSync(path, "utf8");
    if (!html.includes('name="viewport"')) fail(`${file}에 viewport meta가 없습니다`);
    if (!html.includes('href="examples.css"')) fail(`${file}이 examples.css를 사용하지 않습니다`);
    if (html.includes('src="brand.svg"') === false) fail(`${file}이 공통 brand.svg를 사용하지 않습니다`);
    if (/\bhttps?:\/\//i.test(html)) fail(`${file}에 외부 네트워크 의존성이 있습니다`);
  } catch (error) {
    fail(`${file}을 읽지 못했습니다: ${error.message}`);
  }
}

const index = readFileSync(join(exampleRoot, "index.html"), "utf8");
for (const [file, [expectedWidth, expectedHeight]] of screenshots) {
  const path = join(exampleRoot, "screenshots", file);
  try {
    const buffer = readFileSync(path);
    const signature = buffer.subarray(0, 8).toString("hex");
    if (signature !== "89504e470d0a1a0a") {
      fail(`${file}이 PNG가 아닙니다`);
      continue;
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width !== expectedWidth || height !== expectedHeight) {
      fail(`${file} 크기가 ${width}×${height}입니다. 기대값은 ${expectedWidth}×${expectedHeight}입니다`);
    }
    if (statSync(path).size < 10_000) fail(`${file} 용량이 비정상적으로 작습니다`);
    if (!index.includes(`screenshots/${file}`)) fail(`index.html에 ${file} 링크가 없습니다`);
  } catch (error) {
    fail(`${file}을 검증하지 못했습니다: ${error.message}`);
  }
}

for (const file of htmlFiles) {
  const path = join(standaloneRoot, file);
  try {
    const html = readFileSync(path, "utf8");
    if (!html.includes('name="molroom-artifact" content="standalone-generated"')) {
      fail(`standalone/${file}이 생성 스크립트 산출물이 아닙니다`);
    }
    if (!html.includes('<style data-molroom-source="examples.css">')) {
      fail(`standalone/${file}에 CSS가 인라인되지 않았습니다`);
    }
    if (/href=["']examples\.css["']/i.test(html)) fail(`standalone/${file}이 외부 CSS를 참조합니다`);
    if (/src=["']brand\.svg["']/i.test(html)) fail(`standalone/${file}이 외부 로고를 참조합니다`);
    if (/src=["']screenshots\//i.test(html)) fail(`standalone/${file}이 외부 스크린샷을 참조합니다`);
    if (/\bhttps?:\/\//i.test(html)) fail(`standalone/${file}에 외부 네트워크 의존성이 있습니다`);
  } catch (error) {
    fail(`standalone/${file}을 읽지 못했습니다. 먼저 build-design-standalone을 실행하세요: ${error.message}`);
  }
}

if (!process.exitCode) {
  console.log(
    `design examples: ${htmlFiles.length} canonical HTML, ${htmlFiles.length} standalone HTML, ${screenshots.size} screenshots OK`,
  );
}
