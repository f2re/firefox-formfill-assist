import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"),
) as { icons?: Record<string, string> };
const encodedIcon = readFileSync(
  new URL("../src/icons/formfill-128.png.b64", import.meta.url),
  "utf8",
).trim();
const png = Buffer.from(encodedIcon, "base64");

describe("branding assets", () => {
  it("ships a real 128x128 PNG for Firefox and AMO", () => {
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
    expect(png.length).toBeGreaterThan(1024);
  });

  it("declares the raster product icon in the extension manifest", () => {
    expect(manifest.icons?.["128"]).toBe("icons/formfill-128.png");
  });
});
