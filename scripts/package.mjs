import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const root = process.cwd();
const artifacts = resolve(root, "artifacts");
await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });

const executable = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "web-ext.cmd" : "web-ext");
const result = spawnSync(
  executable,
  ["build", "--source-dir", "dist", "--artifacts-dir", "artifacts", "--overwrite-dest"],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const entries = await readdir(artifacts);
const zip = entries.find((name) => name.endsWith(".zip"));
if (!zip) throw new Error("web-ext did not produce a ZIP archive.");

const xpiName = `firefox-formfill-assist-${packageJson.version}-unsigned.xpi`;
await copyFile(resolve(artifacts, zip), resolve(artifacts, xpiName));
console.log(`Created artifacts/${zip}`);
console.log(`Created artifacts/${xpiName}`);
