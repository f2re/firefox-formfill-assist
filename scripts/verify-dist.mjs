import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const manifestPath = resolve(dist, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const panelPath = String(manifest?.sidebar_action?.default_panel ?? "");

if (!panelPath) {
  throw new Error("dist/manifest.json does not define sidebar_action.default_panel");
}

const sidebarHtmlPath = resolve(dist, panelPath);
const sidebarHtml = await readFile(sidebarHtmlPath, "utf8");

if (!sidebarHtml.includes('id="boot-fallback"')) {
  throw new Error("sidebar/index.html must contain a visible boot fallback");
}
if (!sidebarHtml.includes('id="ai-handoff"') || !sidebarHtml.includes('id="app"')) {
  throw new Error("sidebar/index.html is missing required UI roots");
}
if (/\b(?:src|href)=["']\//.test(sidebarHtml)) {
  throw new Error(
    "sidebar/index.html contains an extension-root absolute asset URL. Use Vite base './' so assets resolve under sidebar/.",
  );
}

const references = [...sidebarHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((value) => !/^(?:https?:|data:|#)/i.test(value));

if (!references.some((value) => extname(value.split(/[?#]/, 1)[0]) === ".js")) {
  throw new Error("sidebar/index.html does not reference a JavaScript bundle");
}
if (!references.some((value) => extname(value.split(/[?#]/, 1)[0]) === ".css")) {
  throw new Error("sidebar/index.html does not reference a stylesheet bundle");
}

const sidebarDir = dirname(sidebarHtmlPath);
const scripts = [];
for (const reference of references) {
  if (reference.startsWith("/")) {
    throw new Error(`Absolute sidebar asset is forbidden: ${reference}`);
  }

  const cleanReference = reference.split(/[?#]/, 1)[0];
  const filePath = resolve(sidebarDir, cleanReference);
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile() || info.size === 0) {
    throw new Error(`Sidebar asset does not exist or is empty: ${reference} -> ${filePath}`);
  }
  if (extname(cleanReference) === ".js") scripts.push(filePath);
}

const bundledCode = (await Promise.all(scripts.map((file) => readFile(file, "utf8")))).join("\n");
for (const marker of ["FormFill Assistant", "Заполнить форму с помощью ИИ"]) {
  if (!bundledCode.includes(marker)) {
    throw new Error(`Sidebar bundle is missing startup marker: ${marker}`);
  }
}

console.log(`Verified sidebar startup graph: ${panelPath}; ${references.length} local assets.`);
