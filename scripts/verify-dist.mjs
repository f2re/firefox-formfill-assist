import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const manifestPath = resolve(dist, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const panelPath = String(manifest?.sidebar_action?.default_panel ?? "");

if (!panelPath) throw new Error("dist/manifest.json does not define sidebar_action.default_panel");

const sidebarHtmlPath = resolve(dist, panelPath);
const sidebarHtml = await readFile(sidebarHtmlPath, "utf8");

if (!sidebarHtml.includes('id="boot-fallback"')) {
  throw new Error("sidebar/index.html must contain a visible boot fallback");
}
if (!sidebarHtml.includes('id="app"')) {
  throw new Error("sidebar/index.html is missing the single #app UI root");
}
if (sidebarHtml.includes('id="ai-handoff"')) {
  throw new Error("sidebar/index.html must not use the former split ai-handoff root");
}
if (/\b(?:src|href)=["']\//.test(sidebarHtml)) {
  throw new Error("sidebar/index.html contains an extension-root absolute asset URL");
}
if (!sidebarHtml.includes('src="./sidebar.js"')) {
  throw new Error("sidebar/index.html must load deterministic ./sidebar.js");
}
if (!sidebarHtml.includes('href="./sidebar.css"')) {
  throw new Error("sidebar/index.html must load deterministic ./sidebar.css");
}
if (/type=["']module["']/.test(sidebarHtml)) {
  throw new Error("sidebar/index.html must use the plain IIFE bootstrap, not a module graph");
}

const references = [...sidebarHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((value) => !/^(?:https?:|data:|#)/i.test(value));

const sidebarDir = dirname(sidebarHtmlPath);
for (const reference of references) {
  if (reference.startsWith("/")) throw new Error(`Absolute sidebar asset is forbidden: ${reference}`);
  const cleanReference = reference.split(/[?#]/, 1)[0];
  const filePath = resolve(sidebarDir, cleanReference);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size === 0) {
    throw new Error(`Sidebar asset does not exist or is empty: ${reference} -> ${filePath}`);
  }
}

const scriptPath = resolve(sidebarDir, "sidebar.js");
const stylePath = resolve(sidebarDir, "sidebar.css");
const script = await readFile(scriptPath, "utf8");
const style = await readFile(stylePath, "utf8");

for (const marker of [
  "FormFill Assistant",
  "Подготовить снимок и промпт",
  "parseAiFillResponse",
  "captureId",
  "formfillReady",
]) {
  if (!script.includes(marker) && !sidebarHtml.includes(marker)) {
    throw new Error(`Sidebar startup bundle is missing marker: ${marker}`);
  }
}
if (!style.includes(".fatal-card") || !style.includes(".workspace-card")) {
  throw new Error("sidebar/sidebar.css is missing fatal fallback or workflow styles");
}

const javascriptReferences = references.filter((reference) => extname(reference.split(/[?#]/, 1)[0]) === ".js");
if (javascriptReferences.length !== 1 || javascriptReferences[0] !== "./sidebar.js") {
  throw new Error(`Expected exactly one deterministic sidebar script, got: ${javascriptReferences.join(", ")}`);
}

console.log(`Verified deterministic sidebar: ${panelPath}; ${references.length} local assets.`);
