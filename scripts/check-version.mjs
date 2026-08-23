import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"));

const packageVersion = String(packageJson.version ?? "");
const manifestVersion = String(manifest.version ?? "");

if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
  throw new Error(`package.json version must be semver X.Y.Z, got: ${packageVersion}`);
}
if (manifestVersion !== packageVersion) {
  throw new Error(`Version mismatch: package.json=${packageVersion}, src/manifest.json=${manifestVersion}`);
}

const refName = process.env.GITHUB_REF_NAME ?? "";
const refType = process.env.GITHUB_REF_TYPE ?? "";
if (refType === "tag" || refName.startsWith("v")) {
  const expectedTag = `v${packageVersion}`;
  if (refName !== expectedTag) {
    throw new Error(`Release tag mismatch: expected ${expectedTag}, got ${refName || "<empty>"}`);
  }
}

console.log(`Version verified: ${packageVersion}`);
