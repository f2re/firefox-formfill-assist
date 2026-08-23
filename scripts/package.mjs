import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const root = process.cwd();
const dist = resolve(root, "dist");
const artifacts = resolve(root, "artifacts");
const normalizedTime = new Date("2000-01-01T00:00:00.000Z");

async function normalizeTreeTimestamps(directory) {
  const names = (await readdir(directory)).sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const path = join(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) {
      await normalizeTreeTimestamps(path);
    } else if (info.isFile()) {
      await utimes(path, normalizedTime, normalizedTime);
    }
  }
  await utimes(directory, normalizedTime, normalizedTime);
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });
await normalizeTreeTimestamps(dist);

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

const packagedFiles = [zip, xpiName].sort((a, b) => a.localeCompare(b));
const checksums = [];
for (const name of packagedFiles) {
  checksums.push(`${await sha256(resolve(artifacts, name))}  ${name}`);
}
await writeFile(resolve(artifacts, "SHA256SUMS"), `${checksums.join("\n")}\n`, "utf8");

console.log(`Created artifacts/${zip}`);
console.log(`Created artifacts/${xpiName}`);
console.log("Created artifacts/SHA256SUMS");
