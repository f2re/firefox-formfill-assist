import { build } from "vite";
import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const firefoxTarget = "firefox126";
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  configFile: false,
  root: resolve(root, "src/sidebar"),
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: resolve(dist, "sidebar"),
    emptyOutDir: false,
    target: firefoxTarget,
  },
});

for (const [entry, fileName] of [
  ["src/background/background.ts", "background.js"],
  ["src/content/index.ts", "content.js"],
  ["src/content/capture-mask.ts", "capture-mask.js"],
]) {
  await build({
    configFile: false,
    build: {
      outDir: dist,
      emptyOutDir: false,
      target: firefoxTarget,
      minify: false,
      lib: {
        entry: resolve(root, entry),
        name: fileName.replace(/\W/g, "_"),
        formats: ["iife"],
        fileName: () => fileName,
      },
    },
  });
}

await cp(resolve(root, "src/manifest.json"), resolve(dist, "manifest.json"));
await mkdir(resolve(dist, "icons"), { recursive: true });
await cp(resolve(root, "src/icons/formfill.svg"), resolve(dist, "icons/formfill.svg"));

console.log("Built extension in dist/");
