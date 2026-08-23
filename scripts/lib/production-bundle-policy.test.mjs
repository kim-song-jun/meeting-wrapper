import { execFile as execFileCallback } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdtemp,
  mkdir,
  open,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as productionBundlePolicy from "./production-bundle-policy.mjs";

const { FORBIDDEN_PRODUCTION_MARKERS, scanProductionBundle } = productionBundlePolicy;
const execFile = promisify(execFileCallback);

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceFontPath = join(
  projectRoot,
  "src/assets/fonts/PretendardVariable-v1.3.9.woff2",
);
const sourceLicensePath = join(
  projectRoot,
  "public/licenses/pretendard/SIL-OFL-1.1.txt",
);
const bundledFontName = "PretendardVariable-v1.3.9-TestHash.woff2";
const bundledFontPath = `assets/${bundledFontName}`;
const bundledLicensePath = "licenses/pretendard/SIL-OFL-1.1.txt";
const validFontCss = `
@font-face {
  font-family: "Pretendard Variable";
  font-style: normal;
  font-weight: 400 700;
  font-display: optional;
  src: url("/${bundledFontPath}") format("woff2-variations");
}
`;

const temporaryRoots = [];

async function makeBundleRoot() {
  const root = await mkdtemp(join(tmpdir(), "molroom-production-bundle-"));
  temporaryRoots.push(root);
  return root;
}

async function makeValidBundleRoot({
  indexHtml = "<!doctype html>\n",
  css = validFontCss,
} = {}) {
  const root = await makeBundleRoot();
  await Promise.all([
    mkdir(join(root, "assets"), { recursive: true }),
    mkdir(join(root, "licenses/pretendard"), { recursive: true }),
  ]);
  await Promise.all([
    copyFile(sourceFontPath, join(root, bundledFontPath)),
    copyFile(sourceLicensePath, join(root, bundledLicensePath)),
    writeFile(join(root, "index.html"), indexHtml),
    writeFile(join(root, "assets/app.css"), css),
  ]);
  return root;
}

async function makeSparseFile(path, bytes) {
  const handle = await open(path, "w");
  try {
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
}

function boundedReader() {
  const reader = productionBundlePolicy.readBoundedBundleFile;
  expect(reader).toBeTypeOf("function");
  return reader;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("production bundle policy", () => {
  it("rejects a missing scan root", async () => {
    const root = join(tmpdir(), `molroom-missing-${process.pid}-${Date.now()}`);

    await expect(scanProductionBundle(root)).rejects.toThrow(
      `Production bundle scan root does not exist: ${root}`,
    );
  });

  it("rejects an empty bundle", async () => {
    const root = await makeBundleRoot();

    await expect(scanProductionBundle(root)).rejects.toThrow(
      `Production bundle scan root is empty: ${root}`,
    );
  });

  it("accepts a complete self-hosted font bundle", async () => {
    const root = await makeValidBundleRoot();

    await expect(scanProductionBundle(root)).resolves.toEqual([]);
  });

  it("keeps the mock-runtime marker contract stable", async () => {
    const root = await makeValidBundleRoot();
    await writeFile(
      join(root, "marker.html"),
      `${FORBIDDEN_PRODUCTION_MARKERS[0]}\n${FORBIDDEN_PRODUCTION_MARKERS[2]}\n`,
    );

    await expect(scanProductionBundle(root)).resolves.toEqual([
      { marker: "[MolRoom QA]", path: "marker.html" },
      { marker: "molroom.mock.identity", path: "marker.html" },
    ]);
  });

  it("rejects an arbitrary external stylesheet despite case, attribute order, and HTML entities", async () => {
    const root = await makeValidBundleRoot({
      indexHtml:
        '<!doctype html><LiNk HREF = "hTtPs&colon;&sol;&sol;ArBiTrArY.Example/fonts.css" REL = "StyleSheet">',
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:external",
      path: "index.html",
    });
  });

  it("rejects an arbitrary external preconnect resource hint", async () => {
    const root = await makeValidBundleRoot({
      indexHtml:
        '<!doctype html><LINK HREF="//Arbitrary.Example" REL="PrEcOnNeCt">',
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:external",
      path: "index.html",
    });
  });

  it("resolves a relative stylesheet against the first external base URL", async () => {
    const root = await makeValidBundleRoot({
      indexHtml: `<!doctype html>
<base href="https://assets.example/fonts/">
<base href="/ignored/">
<link rel="stylesheet" href="pretendard.css">`,
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:external",
      path: "index.html",
    });
  });

  it("rejects an explicit HTTP URL even when its host matches the parser sentinel", async () => {
    const root = await makeValidBundleRoot({
      indexHtml:
        '<!doctype html><link rel="stylesheet" href="https://molroom.invalid/font.css">',
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:external",
      path: "index.html",
    });
  });

  it("decodes a data stylesheet and rejects its external import", async () => {
    const dataCss = encodeURIComponent('@import url("https://evil.example/font.css");');
    const root = await makeValidBundleRoot({
      indexHtml: `<!doctype html><link rel="stylesheet" href="data:text/css,${dataCss}">`,
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:external",
      path: "index.html",
    });
  });

  it("decodes a base64 data stylesheet and rejects its external font-face source", async () => {
    const dataCss = Buffer.from(
      '@font-face { font-family: Evil; src: url("https://evil.example/font.woff2"); }',
    ).toString("base64");
    const root = await makeValidBundleRoot({
      indexHtml: `<!doctype html><link rel="stylesheet" href="data:text/css;base64,${dataCss}">`,
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:external",
      path: "index.html",
    });
  });

  it("rejects malformed and oversized data stylesheets without decoding them unboundedly", async () => {
    const malformedRoot = await makeValidBundleRoot({
      indexHtml:
        '<!doctype html><link rel="stylesheet" href="data:text/css,%E0%A4%A">',
    });
    const oversizedRoot = await makeValidBundleRoot({
      indexHtml: `<!doctype html><link rel="stylesheet" href="data:text/css,${"%20".repeat(65_537)}">`,
    });

    await expect(scanProductionBundle(malformedRoot)).resolves.toContainEqual({
      marker: "font-resource:invalid",
      path: "index.html",
    });
    await expect(scanProductionBundle(oversizedRoot)).resolves.toContainEqual({
      marker: "font-resource:uninspectable",
      path: "index.html",
    });
  });

  it("forbids embedded data fonts in an active font-face", async () => {
    const root = await makeValidBundleRoot({
      css: `@font-face {
        font-family: "Pretendard Variable";
        font-style: normal;
        font-weight: 400 700;
        font-display: optional;
        src: url("data:font/woff2;base64,d09GMg==") format("woff2-variations");
      }`,
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:data-font",
      path: "assets/app.css",
    });
  });

  it("rejects external CSS font resources hidden by CSS escapes and an encoded host", async () => {
    const root = await makeValidBundleRoot({
      css: `${String.raw`@import url("\68\54\54\70\53\3a\2f\2f %65vil.Example/font.css");`}\n${validFontCss}`,
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:external",
      path: "assets/app.css",
    });
  });

  it("rejects an external URL in an active font-face src declaration", async () => {
    const escapedExternalUrl = String.raw`\68\54\54\70\53\3a\2f\2f %65vil.Example/font.woff2`;
    const root = await makeValidBundleRoot({
      css: validFontCss.replace(`/${bundledFontPath}`, escapedExternalUrl),
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-resource:external",
      path: "assets/app.css",
    });
  });

  it("rejects font preload attributes regardless of order, whitespace, or case", async () => {
    const root = await makeValidBundleRoot({
      indexHtml: `<!doctype html><LINK AS = 'FoNt' HREF = '/${bundledFontPath}' REL = 'PreLoad'>`,
    });

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-preload:forbidden",
      path: "index.html",
    });
  });

  it("ignores comments, prose, scripts, non-font CSS URLs, and browser-relative encoded schemes", async () => {
    const root = await makeValidBundleRoot({
      indexHtml: `<!doctype html>
<!-- <link rel="stylesheet" href="https://comment.example/font.css"> -->
<script>
  fetch("https://api.example/data");
  const prose = '<link rel="stylesheet" href="https://script.example/font.css">';
</script>
<p>https://prose.example/font.css</p>`,
      css: `@import url("https%3A%2F%2Frelative.example/font.css");
${validFontCss}
/* @import url("https://comment.example/font.css"); */
.example::before { content: 'url("https://string.example/font.woff2")'; }
.hero { background-image: url("https://images.example/hero.png"); }`,
    });
    await writeFile(join(root, "assets/app.js"), 'fetch("https://api.example/data");\n');

    const findings = await scanProductionBundle(root);
    expect(findings).not.toContainEqual({
      marker: "font-resource:external",
      path: "assets/app.css",
    });
    expect(findings).toEqual([]);
  });

  it("ignores example links in HTML raw-text and escapable-raw-text elements", async () => {
    const root = await makeValidBundleRoot({
      indexHtml: `<!doctype html>
<title><link rel="stylesheet" href="https://title.example/font.css"></title>
<textarea><link rel="stylesheet" href="https://textarea.example/font.css"></textarea>
<script>const example = '<link rel="stylesheet" href="https://script.example/font.css">';</script>`,
    });

    await expect(scanProductionBundle(root)).resolves.toEqual([]);
  });

  it("rejects a missing fingerprinted Pretendard font", async () => {
    const root = await makeValidBundleRoot();
    await unlink(join(root, bundledFontPath));

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-asset:missing",
      path: "assets",
    });
  });

  it("rejects a fingerprinted Pretendard font with wrong bytes", async () => {
    const root = await makeValidBundleRoot();
    await writeFile(join(root, bundledFontPath), "wrong font");

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-asset:integrity",
      path: bundledFontPath,
    });
  });

  it("rejects duplicate fingerprinted Pretendard fonts", async () => {
    const root = await makeValidBundleRoot();
    const duplicate = "assets/PretendardVariable-v1.3.9-AnotherHash.woff2";
    await copyFile(sourceFontPath, join(root, duplicate));

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-asset:duplicate",
      path: "assets",
    });
  });

  it("rejects a missing pinned font license", async () => {
    const root = await makeValidBundleRoot();
    await unlink(join(root, bundledLicensePath));

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-license:missing",
      path: bundledLicensePath,
    });
  });

  it("rejects a pinned font license with wrong bytes", async () => {
    const root = await makeValidBundleRoot();
    await writeFile(join(root, bundledLicensePath), "wrong license");

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-license:integrity",
      path: bundledLicensePath,
    });
  });

  it("rejects duplicate pinned font licenses", async () => {
    const root = await makeValidBundleRoot();
    const duplicate = "licenses/pretendard/backup/SIL-OFL-1.1.txt";
    await mkdir(join(root, "licenses/pretendard/backup"), { recursive: true });
    await copyFile(sourceLicensePath, join(root, duplicate));

    await expect(scanProductionBundle(root)).resolves.toContainEqual({
      marker: "font-license:duplicate",
      path: "licenses/pretendard",
    });
  });

  it("rejects too many bundle entries before reading their contents", async () => {
    const root = await makeValidBundleRoot();
    const directory = join(root, "many");
    await mkdir(directory);
    for (let index = 0; index < 253; index += 1) {
      await writeFile(join(directory, `${index}.txt`), "");
    }

    await expect(scanProductionBundle(root)).rejects.toThrow(/entry count exceeds limit/i);
  });

  it("counts directories toward the bundle entry cap", async () => {
    const root = await makeValidBundleRoot();
    const directory = join(root, "many-directories");
    await mkdir(directory);
    for (let index = 0; index < 250; index += 1) {
      await mkdir(join(directory, `${index}`));
    }

    await expect(scanProductionBundle(root)).rejects.toThrow(/entry count exceeds limit/i);
  });

  it("rejects a bundle tree deeper than the traversal cap", async () => {
    const root = await makeValidBundleRoot();
    let directory = join(root, "deep");
    await mkdir(directory);
    for (let depth = 0; depth < 18; depth += 1) {
      directory = join(directory, `${depth}`);
      await mkdir(directory);
    }

    await expect(scanProductionBundle(root)).rejects.toThrow(/depth exceeds limit/i);
  });

  it("rejects a nested symbolic link instead of skipping it", async () => {
    const root = await makeValidBundleRoot();
    const directory = join(root, "nested-link");
    await mkdir(directory);
    await symlink("../index.html", join(directory, "index-link.html"));

    await expect(scanProductionBundle(root)).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a FIFO without blocking on it", async () => {
    const root = await makeValidBundleRoot();
    const directory = join(root, "nested-fifo");
    const fifoPath = join(directory, "font.pipe");
    await mkdir(directory);
    await execFile("mkfifo", [fifoPath]);

    await expect(scanProductionBundle(root)).rejects.toThrow(/non-regular entry/i);
  }, 2_000);

  it("rejects a same-size inode replacement through the bounded reader", async () => {
    const root = await makeBundleRoot();
    const file = join(root, "replace.txt");
    const replacement = join(root, "replacement.txt");
    await writeFile(file, "first");
    await writeFile(replacement, "other");
    const expectedStat = await lstat(file, { bigint: true });
    await rename(replacement, file);
    const handle = await open(file, "r");
    try {
      await expect(boundedReader()(handle, {
        expectedStat,
        path: "replace.txt",
      })).rejects.toThrow(/changed during scan/i);
    } finally {
      await handle.close();
    }
  });

  it("rejects file growth beyond the bounded byte contract", async () => {
    const root = await makeBundleRoot();
    const file = join(root, "growth.txt");
    await writeFile(file, "base");
    const handle = await open(file, "r+");
    try {
      const expectedStat = await handle.stat({ bigint: true });
      await handle.truncate(5);
      await expect(boundedReader()(handle, {
        expectedStat,
        path: "growth.txt",
      })).rejects.toThrow(/changed during scan/i);
    } finally {
      await handle.close();
    }
  });

  it("rejects a short read before returning partial contents", async () => {
    const root = await makeBundleRoot();
    const file = join(root, "short.txt");
    await writeFile(file, "full");
    const handle = await open(file, "r+");
    try {
      const expectedStat = await handle.stat({ bigint: true });
      await handle.truncate(3);
      await expect(boundedReader()(handle, {
        expectedStat,
        path: "short.txt",
      })).rejects.toThrow(/changed during scan/i);
    } finally {
      await handle.close();
    }
  });

  it("rejects an oversized file from metadata before attempting to read it", async () => {
    const root = await makeValidBundleRoot();
    const oversizedPath = join(root, "oversized.bin");
    await makeSparseFile(oversizedPath, 4_194_305);
    await chmod(oversizedPath, 0o000);

    await expect(scanProductionBundle(root)).rejects.toThrow(/file exceeds byte limit/i);
  });

  it("rejects an oversized aggregate bundle before reading file contents", async () => {
    const root = await makeValidBundleRoot();
    await Promise.all([
      makeSparseFile(join(root, "aggregate-a.bin"), 3_200_000),
      makeSparseFile(join(root, "aggregate-b.bin"), 3_200_000),
    ]);

    await expect(scanProductionBundle(root)).rejects.toThrow(/total bytes exceed limit/i);
  });

  it("scans nested text and binary files without decoding assumptions", async () => {
    const root = await makeValidBundleRoot();
    await mkdir(join(root, "nested"), { recursive: true });
    await Promise.all([
      writeFile(join(root, "nested/app.js"), "const safe = true;\n"),
      writeFile(join(root, "nested/data.bin"), Buffer.from([0, 1, 2, 3])),
      writeFile(join(root, "nested/fixture.txt"), "mockNow"),
    ]);

    await expect(scanProductionBundle(root)).resolves.toEqual([
      { marker: "mockNow", path: "nested/fixture.txt" },
    ]);
  });

  it("exports only mock-runtime strings as raw byte markers", () => {
    expect(FORBIDDEN_PRODUCTION_MARKERS).toEqual([
      "molroom.mock.identity",
      "molroom.mockAuth.session",
      "[MolRoom QA]",
      "QA fixture:",
      "mockSaveDelayMs",
      "mockReadError",
      "mockPrefsSaveError",
      "mockNow",
      "__taken",
      "__declined",
    ]);
  });
});
