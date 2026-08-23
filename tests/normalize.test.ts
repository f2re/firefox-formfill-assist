import { describe, expect, it } from "vitest";
import { bestTextMatch, matchConfidence, normalizeText } from "../src/shared/normalize";

describe("text normalization and matching", () => {
  it("normalizes Russian text", () => {
    expect(normalizeText("  Г.  МОСКВА, ")).toBe("г москва");
  });

  it("treats city prefix as near-exact", () => {
    expect(matchConfidence("Санкт-Петербург", "г. Санкт-Петербург")).toBeGreaterThanOrEqual(0.95);
  });

  it("returns the best option", () => {
    expect(bestTextMatch("Ленинградская область", ["Москва", "Ленинградская обл."])?.value).toBe(
      "Ленинградская обл.",
    );
  });
});
