import { build } from "vite";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const sidebarDist = resolve(dist, "sidebar");
const firefoxTarget = "firefox126";

await rm(dist, { recursive: true, force: true });
await mkdir(sidebarDist, { recursive: true });

// Build the sidebar as one plain IIFE with a deterministic name. This avoids
// hashed module graphs and extension-root path resolution entirely: Firefox
// only needs sidebar/index.html, sidebar/sidebar.css and sidebar/sidebar.js.
await build({
  configFile: false,
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: {
    outDir: sidebarDist,
    emptyOutDir: false,
    target: firefoxTarget,
    minify: false,
    lib: {
      entry: resolve(root, "src/sidebar/main.tsx"),
      name: "FormFillAssistantSidebar",
      formats: ["iife"],
      fileName: () => "sidebar.js",
    },
  },
});

await cp(resolve(root, "src/sidebar/index.html"), resolve(sidebarDist, "index.html"));
await cp(resolve(root, "src/sidebar/sidebar.css"), resolve(sidebarDist, "sidebar.css"));

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

const amoIconBase64 = (await readFile(resolve(root, "src/icons/formfill-128.png.b64"), "utf8")).trim();
const amoIcon = Buffer.from(amoIconBase64, "base64");
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (amoIcon.length < 32 || !amoIcon.subarray(0, pngSignature.length).equals(pngSignature)) {
  throw new Error("src/icons/formfill-128.png.b64 is not a valid PNG payload");
}
await writeFile(resolve(dist, "icons/formfill-128.png"), amoIcon);

console.log("Built deterministic Firefox extension in dist/");
