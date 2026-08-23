import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectFontResourcePolicy,
  PRETENDARD_FONT_ASSET_CONTRACT,
} from "./font-resource-policy.mjs";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

const PRETENDARD_SOURCE = Object.freeze({
  release: "https://github.com/orioncactus/pretendard/releases/tag/v1.3.9",
  commit: "5c41199ea0024a9e0b2cb31735265056e5472d76",
  fontUrl:
    "https://raw.githubusercontent.com/orioncactus/pretendard/5c41199ea0024a9e0b2cb31735265056e5472d76/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  fontBytes: PRETENDARD_FONT_ASSET_CONTRACT.bytes,
  fontSha256: PRETENDARD_FONT_ASSET_CONTRACT.sha256,
  licenseUrl: "https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/LICENSE",
  licenseBytes: PRETENDARD_FONT_ASSET_CONTRACT.licenseBytes,
  licenseSha256: PRETENDARD_FONT_ASSET_CONTRACT.licenseSha256,
});

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function read(relativePath) {
  return readFile(join(projectRoot, relativePath));
}

describe("self-hosted font asset policy", () => {
  it("ships the complete Pretendard 1.3.9 variable font pinned by bytes and digest", async () => {
    const font = await read("src/assets/fonts/PretendardVariable-v1.3.9.woff2");

    expect(new URL(PRETENDARD_SOURCE.release).pathname).toBe(
      "/orioncactus/pretendard/releases/tag/v1.3.9",
    );
    expect(new URL(PRETENDARD_SOURCE.fontUrl).pathname).toBe(
      `/orioncactus/pretendard/${PRETENDARD_SOURCE.commit}/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2`,
    );
    expect(font.byteLength).toBe(PRETENDARD_SOURCE.fontBytes);
    expect(sha256(font)).toBe(PRETENDARD_SOURCE.fontSha256);
  });

  it("ships the pinned upstream OFL license without alteration", async () => {
    const license = await read("public/licenses/pretendard/SIL-OFL-1.1.txt");

    expect(new URL(PRETENDARD_SOURCE.licenseUrl).pathname).toBe(
      "/orioncactus/pretendard/v1.3.9/LICENSE",
    );
    expect(license.byteLength).toBe(PRETENDARD_SOURCE.licenseBytes);
    expect(sha256(license)).toBe(PRETENDARD_SOURCE.licenseSha256);
  });

  it("declares one local variable face with an optional display strategy", async () => {
    const fontsCss = (await read("src/styles/fonts.css")).toString("utf8");

    expect(
      inspectFontResourcePolicy({
        cssSources: [{ path: "src/styles/fonts.css", source: fontsCss }],
        expectedPretendardSource:
          "../assets/fonts/PretendardVariable-v1.3.9.woff2",
      }),
    ).toEqual([]);
  });

  it("does not count a fully commented-out Pretendard face", async () => {
    const fontsCss = (await read("src/styles/fonts.css")).toString("utf8");

    expect(
      inspectFontResourcePolicy({
        cssSources: [
          {
            path: "src/styles/fonts.css",
            source: `/* ${fontsCss} */`,
          },
        ],
        expectedPretendardSource:
          "../assets/fonts/PretendardVariable-v1.3.9.woff2",
      }),
    ).toContainEqual({
      marker: "font-face:missing",
      path: "src/styles/fonts.css",
    });
  });

  it("rejects trailing tokens after the exact font-face src grammar", async () => {
    const fontsCss = (await read("src/styles/fonts.css")).toString("utf8");
    const mutatedCss = fontsCss.replace(
      'format("woff2-variations");',
      'format("woff2-variations") unexpected;',
    );

    expect(mutatedCss).not.toBe(fontsCss);
    expect(
      inspectFontResourcePolicy({
        cssSources: [{ path: "src/styles/fonts.css", source: mutatedCss }],
        expectedPretendardSource:
          "../assets/fonts/PretendardVariable-v1.3.9.woff2",
      }),
    ).toContainEqual({
      marker: "font-face:invalid",
      path: "src/styles/fonts.css",
    });
  });

  it("rejects an important flag normalized outside the font-face src value", async () => {
    const fontsCss = (await read("src/styles/fonts.css")).toString("utf8");
    const mutatedCss = fontsCss.replace(
      'format("woff2-variations");',
      'format("woff2-variations") !important;',
    );

    expect(mutatedCss).not.toBe(fontsCss);
    expect(
      inspectFontResourcePolicy({
        cssSources: [{ path: "src/styles/fonts.css", source: mutatedCss }],
        expectedPretendardSource:
          "../assets/fonts/PretendardVariable-v1.3.9.woff2",
      }),
    ).toContainEqual({
      marker: "font-face:invalid",
      path: "src/styles/fonts.css",
    });
  });

  it("loads the local face before tokens without relying on byte-zero positioning", async () => {
    const [baseCss, indexHtml] = await Promise.all([
      read("src/styles/base.css").then((contents) => contents.toString("utf8")),
      read("index.html").then((contents) => contents.toString("utf8")),
    ]);
    const decoratedBaseCss = `\uFEFF@charset "UTF-8";
/* leading contract comment */
  ${baseCss}`;

    expect(
      inspectFontResourcePolicy({
        entryCssSources: [
          { path: "src/styles/base.css", source: decoratedBaseCss },
        ],
        htmlSources: [{ path: "index.html", source: indexHtml }],
      }),
    ).toEqual([]);
  });

  it("rejects tokens imported before the local font face", async () => {
    const baseCss = (await read("src/styles/base.css")).toString("utf8");
    const reversedImports = baseCss.replace(
      '@import "./fonts.css";\n@import "./tokens.css";',
      '@import "./tokens.css";\n@import "./fonts.css";',
    );

    expect(reversedImports).not.toBe(baseCss);
    expect(
      inspectFontResourcePolicy({
        entryCssSources: [
          { path: "src/styles/base.css", source: reversedImports },
        ],
      }),
    ).toContainEqual({
      marker: "font-entry:order",
      path: "src/styles/base.css",
    });
  });

  it("inspects an external import before the canonical entry imports", async () => {
    const baseCss = (await read("src/styles/base.css")).toString("utf8");
    const externalEntry = `@import "https://assets.example/font.css";\n${baseCss}`;

    expect(
      inspectFontResourcePolicy({
        entryCssSources: [
          { path: "src/styles/base.css", source: externalEntry },
        ],
      }),
    ).toContainEqual({
      marker: "font-resource:external",
      path: "src/styles/base.css",
    });
  });

  it("rejects canonical entry imports that follow a style rule", async () => {
    const baseCss = (await read("src/styles/base.css")).toString("utf8");
    const lateEntry = `body { color: black; }\n${baseCss}`;

    expect(
      inspectFontResourcePolicy({
        entryCssSources: [
          { path: "src/styles/base.css", source: lateEntry },
        ],
      }),
    ).toContainEqual({
      marker: "font-entry:order",
      path: "src/styles/base.css",
    });
  });

  it("inspects and rejects an active extra entry import", async () => {
    const baseCss = (await read("src/styles/base.css")).toString("utf8");
    const extraEntry = baseCss.replace(
      '@import "./tokens.css";',
      '@import "./tokens.css";\n@import "https://extra.example/font.css";',
    );

    expect(extraEntry).not.toBe(baseCss);
    expect(
      inspectFontResourcePolicy({
        entryCssSources: [
          { path: "src/styles/base.css", source: extraEntry },
        ],
      }),
    ).toEqual(expect.arrayContaining([
      {
        marker: "font-entry:order",
        path: "src/styles/base.css",
      },
      {
        marker: "font-resource:external",
        path: "src/styles/base.css",
      },
    ]));
  });

  it("rejects HTML and CSS above the 512 KiB pre-parse source cap", () => {
    const oversizedSource = " ".repeat(524_289);

    expect(
      inspectFontResourcePolicy({
        cssSources: [{ path: "oversized.css", source: oversizedSource }],
        htmlSources: [{ path: "oversized.html", source: oversizedSource }],
      }),
    ).toEqual([
      { marker: "font-resource:uninspectable", path: "oversized.css" },
      { marker: "font-resource:uninspectable", path: "oversized.html" },
    ]);
  });

  it("detects a font preload despite attribute order, whitespace, and case", async () => {
    const indexHtml = (await read("index.html")).toString("utf8");
    const mutatedIndex = indexHtml.replace(
      "</head>",
      "<LINK AS = 'FoNt' HREF = '/font.woff2' REL = 'PreLoad'>\n</head>",
    );

    expect(mutatedIndex).not.toBe(indexHtml);
    expect(
      inspectFontResourcePolicy({
        htmlSources: [{ path: "index.html", source: mutatedIndex }],
      }),
    ).toContainEqual({
      marker: "font-preload:forbidden",
      path: "index.html",
    });
  });

  it("keeps the mono role on system fonts after removing IBM Plex Mono", async () => {
    const tokensCss = (await read("src/styles/tokens.css")).toString("utf8");

    expect(tokensCss).toContain(
      '--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;',
    );
    expect(tokensCss).not.toContain("IBM Plex Mono");
  });
});
