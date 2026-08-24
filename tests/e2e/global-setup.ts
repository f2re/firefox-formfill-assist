import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { build } from "vite";

const execFileAsync = promisify(execFile);

export default async function globalSetup(): Promise<void> {
  await execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    cwd: process.cwd(),
    env: process.env,
  });

  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      emptyOutDir: true,
      outDir: ".e2e-dist",
      sourcemap: true,
      minify: false,
      lib: {
        entry: resolve(process.cwd(), "tests/e2e/harness.ts"),
        name: "FormFillE2EHarness",
        formats: ["iife"],
        fileName: () => "harness.js",
      },
    },
  });
}
