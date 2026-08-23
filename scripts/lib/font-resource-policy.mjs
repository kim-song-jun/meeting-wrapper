import { parse as parseHtml } from "parse5";
import { parse as parseCss } from "postcss";

const LOCAL_BASE = new URL("https://molroom.invalid/");
const PARSE_SOURCE_BYTE_LIMIT = 524_288;
const DATA_STYLESHEET_BYTE_LIMIT = 65_536;

export const PRETENDARD_FONT_ASSET_CONTRACT = Object.freeze({
  bundlePattern: /^assets\/PretendardVariable-v1\.3\.9-[A-Za-z0-9_-]+\.woff2$/,
  bytes: 2_057_688,
  sha256: "9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4",
  licensePath: "licenses/pretendard/SIL-OFL-1.1.txt",
  licenseBytes: 4_418,
  licenseSha256: "d31ddd9f2bed32fd7e302a205cf2380ba0de6529152d239ef99cfb6f261bfc04",
});

function push(findings, marker, path) {
  findings.push({ marker, path });
}

function decodeCss(source) {
  return source.replace(
    /\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|(\r\n|[\n\f\r])|([\s\S]))/gi,
    (_match, hexadecimal, newline, escaped) => {
      if (newline !== undefined) return "";
      if (hexadecimal === undefined) return escaped;
      const number = Number.parseInt(hexadecimal, 16);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : "\uFFFD";
    },
  );
}

function capturedValue(match, offset = 1) {
  return match?.slice(offset, offset + 3).find((value) => value !== undefined) ?? null;
}

function exactFontSource(value) {
  const match = decodeCss(value).match(
    /^\s*url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\)\s*format\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\)\s*$/i,
  );
  const url = capturedValue(match);
  const format = capturedValue(match, 4);
  return url && format ? { format: format.toLowerCase(), url } : null;
}

function fontUrls(value) {
  return [...decodeCss(value).matchAll(
    /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\)/gi,
  )].map((match) => capturedValue(match)).filter(Boolean);
}

function importUrl(params) {
  const match = decodeCss(params).match(
    /^\s*(?:"([^"]*)"|'([^']*)'|url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\))/i,
  );
  return match?.slice(1).find((value) => value !== undefined) ?? null;
}

function exactImportUrl(params) {
  const match = decodeCss(params).match(
    /^\s*(?:"([^"]*)"|'([^']*)'|url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"'()]+))\s*\))\s*$/i,
  );
  return match?.slice(1).find((value) => value !== undefined) ?? null;
}

function explicitScheme(url) {
  return /^[a-z][a-z\d+.-]*:/i.test(url);
}

function decodeDataStylesheet(url) {
  const comma = url.indexOf(",");
  if (comma === -1) return { error: "invalid" };
  const metadata = url.slice(5, comma).split(";");
  const mediaType = (metadata.shift() || "text/plain").toLowerCase();
  const base64 = metadata.at(-1)?.toLowerCase() === "base64";
  if (mediaType !== "text/css") return { error: "invalid" };
  const payload = url.slice(comma + 1);
  try {
    let css;
    if (base64) {
      const compact = payload.replace(/[\t\n\f\r ]/g, "");
      if (compact.length > Math.ceil(DATA_STYLESHEET_BYTE_LIMIT / 3) * 4 + 4) {
        return { error: "uninspectable" };
      }
      if (!/^[a-z\d+/]*={0,2}$/i.test(compact) || compact.length % 4 === 1) {
        return { error: "invalid" };
      }
      const bytes = Buffer.from(compact, "base64");
      if (bytes.byteLength > DATA_STYLESHEET_BYTE_LIMIT) return { error: "uninspectable" };
      css = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } else {
      if (payload.length > DATA_STYLESHEET_BYTE_LIMIT * 3) return { error: "uninspectable" };
      css = decodeURIComponent(payload);
      if (Buffer.byteLength(css) > DATA_STYLESHEET_BYTE_LIMIT) return { error: "uninspectable" };
    }
    return { css };
  } catch {
    return { error: "invalid" };
  }
}

function inspectUrl(rawUrl, kind, context) {
  const url = rawUrl.trim();
  if (/^data:/i.test(url)) {
    if (kind === "font") return push(context.findings, "font-resource:data-font", context.path);
    if (kind !== "stylesheet") return;
    if (context.dataDepth >= 1) {
      return push(context.findings, "font-resource:uninspectable", context.path);
    }
    const decoded = decodeDataStylesheet(url);
    if (decoded.error) return push(context.findings, `font-resource:${decoded.error}`, context.path);
    return inspectCss(decoded.css, { ...context, dataDepth: context.dataDepth + 1 });
  }
  try {
    if (/^\/\//.test(url) || explicitScheme(url)) {
      new URL(url, LOCAL_BASE);
      return push(context.findings, "font-resource:external", context.path);
    }
    const resolved = new URL(url, context.base.url);
    if (context.base.external || resolved.origin !== LOCAL_BASE.origin) {
      push(context.findings, "font-resource:external", context.path);
    }
  } catch {
    push(context.findings, "font-resource:invalid", context.path);
  }
}

function declarations(atRule) {
  const result = new Map();
  for (const node of atRule.nodes ?? []) {
    if (node.type !== "decl") continue;
    const property = decodeCss(node.prop).toLowerCase();
    if (!result.has(property)) result.set(property, []);
    result.get(property).push(node);
  }
  return result;
}

function inspectFace(atRule, context) {
  const face = { declarations: declarations(atRule), path: context.path };
  for (const source of face.declarations.get("src") ?? []) {
    for (const url of fontUrls(source.value)) inspectUrl(url, "font", context);
  }
  context.faces.push(face);
}

function parseStylesheet(source, context) {
  if (Buffer.byteLength(source) > PARSE_SOURCE_BYTE_LIMIT) {
    push(context.findings, "font-resource:uninspectable", context.path);
    return null;
  }
  try {
    return parseCss(source, { from: context.path });
  } catch {
    push(context.findings, "font-resource:invalid", context.path);
    return null;
  }
}

function inspectCss(source, context) {
  const root = parseStylesheet(source, context);
  if (!root) return;
  let importsAllowed = true;
  for (const node of root.nodes) {
    if (node.type === "comment" ||
      (node.type === "atrule" && ["charset", "layer"].includes(decodeCss(node.name).toLowerCase()) && !node.nodes)) {
      continue;
    }
    if (node.type === "atrule" && decodeCss(node.name).toLowerCase() === "import" && importsAllowed) {
      const url = importUrl(node.params);
      if (url === null) push(context.findings, "font-resource:invalid", context.path);
      else inspectUrl(url, "stylesheet", context);
    } else importsAllowed = false;
  }
  root.walkAtRules((atRule) => {
    if (decodeCss(atRule.name).toLowerCase() === "font-face") inspectFace(atRule, context);
  });
  return root;
}

function validateEntryStylesheet(source, context) {
  const root = inspectCss(source, context);
  if (!root) return;
  const imports = [];
  let importPositionValid = true;
  let importsAllowed = true;
  for (const node of root.nodes) {
    if (node.type === "comment" ||
      (node.type === "atrule" && decodeCss(node.name).toLowerCase() === "charset" && !node.nodes)) {
      continue;
    }
    if (node.type === "atrule" && decodeCss(node.name).toLowerCase() === "import") {
      if (!importsAllowed) importPositionValid = false;
      imports.push(exactImportUrl(node.params));
      continue;
    }
    importsAllowed = false;
  }
  if (!importPositionValid || imports.length !== 2 ||
    imports[0] !== "./fonts.css" || imports[1] !== "./tokens.css") {
    push(context.findings, "font-entry:order", context.path);
  }
}

function attributes(node) {
  return new Map((node.attrs ?? []).map(({ name, value }) => [name, value]));
}

function documentNodes(document) {
  const result = [];
  const stack = [document];
  while (stack.length) {
    const node = stack.pop();
    result.push(node);
    const children = node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return result;
}

function baseFor(nodes) {
  for (const node of nodes) {
    if (node.tagName !== "base") continue;
    const href = attributes(node).get("href");
    if (href === undefined) continue;
    try {
      return {
        external: /^\/\//.test(href.trim()) || explicitScheme(href.trim()),
        url: new URL(href, LOCAL_BASE),
      };
    } catch {
      continue;
    }
  }
  return { external: false, url: LOCAL_BASE };
}

function inspectLink(node, context) {
  const attrs = attributes(node);
  const rel = new Set((attrs.get("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  const href = attrs.get("href");
  const as = (attrs.get("as") ?? "").trim().toLowerCase();
  const type = (attrs.get("type") ?? "").trim().toLowerCase();
  let fontPreload = rel.has("preload") && (as === "font" || type.startsWith("font/"));
  if (rel.has("preload") && href !== undefined) {
    try {
      fontPreload ||= /\.(?:woff2?|ttf|otf|eot)$/i.test(new URL(href, context.base.url).pathname);
    } catch {
      push(context.findings, "font-resource:invalid", context.path);
    }
  }
  if (fontPreload) push(context.findings, "font-preload:forbidden", context.path);
  if (href === undefined) return;
  if (fontPreload) inspectUrl(href, "font", context);
  if (rel.has("stylesheet")) inspectUrl(href, "stylesheet", context);
  else if (rel.has("preconnect") || rel.has("dns-prefetch") ||
    (rel.has("preload") && as === "style")) inspectUrl(href, "hint", context);
}

function inspectHtml(source, context) {
  if (Buffer.byteLength(source) > PARSE_SOURCE_BYTE_LIMIT) {
    push(context.findings, "font-resource:uninspectable", context.path);
    return;
  }
  const nodes = documentNodes(parseHtml(source));
  context.base = baseFor(nodes);
  for (const node of nodes) {
    if (node.tagName === "link") inspectLink(node, context);
    if (node.tagName === "style") {
      const css = (node.childNodes ?? []).filter(({ nodeName }) => nodeName === "#text")
        .map(({ value }) => value).join("");
      inspectCss(css, context);
    }
  }
}

function scalar(declaration) {
  const value = decodeCss(declaration.value.trim());
  const quoted = value.match(/^(?:"([^"]*)"|'([^']*)')$/);
  return (quoted ? quoted[1] ?? quoted[2] : value).replace(/\s+/g, " ").trim();
}

function validFace(face, expectedSource) {
  if ([...face.declarations.values()].flat().some(({ important }) => important)) return false;
  const values = (property) => (face.declarations.get(property) ?? []).map(scalar);
  const family = values("font-family");
  const style = values("font-style");
  const weight = values("font-weight");
  const display = values("font-display");
  const sources = face.declarations.get("src") ?? [];
  const source = sources.length === 1 ? exactFontSource(sources[0].value) : null;
  return family.length === 1 && family[0].toLowerCase() === "pretendard variable" &&
    style.length === 1 && style[0].toLowerCase() === "normal" &&
    weight.length === 1 && weight[0] === "400 700" &&
    display.length === 1 && display[0].toLowerCase() === "optional" &&
    source?.url === expectedSource && source.format === "woff2-variations";
}

export function inspectFontResourcePolicy({
  cssSources = [], entryCssSources = [], expectedPretendardSource, htmlSources = [],
} = {}) {
  const findings = [];
  const faces = [];
  const context = (path) => ({
    base: { external: false, url: LOCAL_BASE }, dataDepth: 0, faces, findings, path,
  });
  for (const { path, source } of htmlSources) inspectHtml(source, context(path));
  for (const { path, source } of cssSources) inspectCss(source, context(path));
  for (const { path, source } of entryCssSources) validateEntryStylesheet(source, context(path));

  if (expectedPretendardSource !== undefined) {
    const path = cssSources[0]?.path ?? "styles";
    if (faces.length === 0) push(findings, "font-face:missing", path);
    else if (faces.length > 1) push(findings, "font-face:duplicate", path);
    else if (!validFace(faces[0], expectedPretendardSource)) {
      push(findings, "font-face:invalid", faces[0].path);
    }
  }
  const unique = new Map(findings.map((finding) => [`${finding.path}\0${finding.marker}`, finding]));
  return [...unique.values()].sort((left, right) =>
    left.path === right.path
      ? left.marker.localeCompare(right.marker)
      : left.path.localeCompare(right.path),
  );
}
