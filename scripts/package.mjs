import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import packageJson from "../package.json" with { type: "json" };

const root = process.cwd();
const dist = resolve(root, "dist");
const artifacts = resolve(root, "artifacts");
const UTF8_FLAG = 0x0800;
const ZIP_STORE = 0;
const ZIP_VERSION = 20;
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files = [];

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolute, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

function localHeader(nameBytes, bytes, checksum) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(ZIP_STORE, 8);
  header.writeUInt16LE(FIXED_DOS_TIME, 10);
  header.writeUInt16LE(FIXED_DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(bytes.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(nameBytes, bytes, checksum, localOffset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(ZIP_STORE, 10);
  header.writeUInt16LE(FIXED_DOS_TIME, 12);
  header.writeUInt16LE(FIXED_DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(bytes.length, 20);
  header.writeUInt32LE(bytes.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  return header;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(centralSize, 12);
  footer.writeUInt32LE(centralOffset, 16);
  footer.writeUInt16LE(0, 20);
  return footer;
}

async function createDeterministicZip(sourceDirectory, destination) {
  const files = await listFiles(sourceDirectory);
  if (files.length > 0xffff) throw new Error("ZIP contains too many files for the non-Zip64 package writer.");

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const relative of files) {
    const bytes = await readFile(join(sourceDirectory, ...relative.split("/")));
    if (bytes.length > 0xffffffff) throw new Error(`File is too large for non-Zip64 ZIP: ${relative}`);
    const nameBytes = Buffer.from(relative, "utf8");
    const checksum = crc32(bytes);
    const local = localHeader(nameBytes, bytes, checksum);
    const central = centralHeader(nameBytes, bytes, checksum, localOffset);

    localParts.push(local, nameBytes, bytes);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + bytes.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const archive = Buffer.concat([
    ...localParts,
    ...centralParts,
    endOfCentralDirectory(files.length, centralSize, localOffset),
  ]);
  await writeFile(destination, archive);
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });

const zipName = `formfill_assistant-${packageJson.version}.zip`;
const xpiName = `firefox-formfill-assist-${packageJson.version}-unsigned.xpi`;
const zipPath = resolve(artifacts, zipName);
const xpiPath = resolve(artifacts, xpiName);

await createDeterministicZip(dist, zipPath);
await copyFile(zipPath, xpiPath);

const packagedFiles = [zipName, xpiName].sort((a, b) => a.localeCompare(b));
const checksums = [];
for (const name of packagedFiles) {
  checksums.push(`${await sha256(resolve(artifacts, name))}  ${name}`);
}
await writeFile(resolve(artifacts, "SHA256SUMS"), `${checksums.join("\n")}\n`, "utf8");

console.log(`Created artifacts/${zipName}`);
console.log(`Created artifacts/${xpiName}`);
console.log("Created artifacts/SHA256SUMS");
