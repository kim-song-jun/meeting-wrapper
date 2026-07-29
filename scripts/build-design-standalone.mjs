import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "docs", "design-examples");
const outputRoot = join(sourceRoot, "standalone");

const htmlFiles = [
  "index.html",
  "login.html",
  "calendar.html",
  "room.html",
  "my-bookings.html",
  "booking-dialog.html",
];

const css = readFileSync(join(sourceRoot, "examples.css"), "utf8");
const logo = readFileSync(join(sourceRoot, "brand.svg"));
const logoDataUrl = `data:image/svg+xml;base64,${logo.toString("base64")}`;

const screenshotDataUrls = new Map(
  [
    "login-mobile.png",
    "calendar-desktop.png",
    "room-mobile.png",
    "my-bookings-mobile.png",
    "booking-dialog-desktop.png",
  ].map((file) => {
    const data = readFileSync(join(sourceRoot, "screenshots", file));
    return [file, `data:image/png;base64,${data.toString("base64")}`];
  }),
);

function inlineResources(file, source) {
  let html = source;

  html = html.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']examples\.css["']\s*\/?>(?:\s*)/gi,
    `<style data-molroom-source="examples.css">\n${css}\n</style>\n`,
  );
  html = html.replaceAll('src="brand.svg"', `src="${logoDataUrl}"`);
  html = html.replaceAll("src='brand.svg'", `src='${logoDataUrl}'`);

  // standalone 디렉터리 안에서 페이지 간 이동이 그대로 동작하도록 유지한다.
  // 저장소 README를 향하던 갤러리 로고 링크만 자기 자신으로 바꾼다.
  html = html.replaceAll('href="../../README.md"', 'href="index.html"');

  if (file === "index.html") {
    for (const [image, dataUrl] of screenshotDataUrls) {
      html = html.replaceAll(`src="screenshots/${image}"`, `src="${dataUrl}"`);
      html = html.replaceAll(`href="screenshots/${image}"`, `href="${dataUrl}" download="${image}"`);
    }
  }

  html = html.replace(
    /<head>/i,
    '<head>\n  <meta name="molroom-artifact" content="standalone-generated" />',
  );

  return html;
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

for (const file of htmlFiles) {
  const input = readFileSync(join(sourceRoot, file), "utf8");
  const output = inlineResources(file, input);
  writeFileSync(join(outputRoot, basename(file)), output, "utf8");
}

writeFileSync(
  join(outputRoot, "README.txt"),
  [
    "MolRoom standalone design examples",
    "",
    "각 HTML은 CSS, 로고, 갤러리 이미지까지 파일 내부에 포함합니다.",
    "브라우저에서 개별 파일을 직접 열어도 외부 상대 경로가 필요하지 않습니다.",
    "원본은 상위 docs/design-examples 디렉터리이며, 수동 수정하지 말고",
    "node scripts/build-design-standalone.mjs 로 다시 생성하세요.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`design standalone: ${htmlFiles.length} HTML generated in ${outputRoot}`);
