import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { fillRequest } from "../src/content/filler";
import { scanDocument } from "../src/content/scanner";

function installDom(): { dom: JSDOM; select: HTMLSelectElement } {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <label for="region">Регион</label>
      <select id="region">
        <option value="">—</option>
        <option value="spb-mo">Санкт-Петербург муниципальный округ</option>
        <option value="moscow">Москва</option>
      </select>
    </body></html>`,
    { url: "https://example.test/form", pretendToBeVisual: true },
  );
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "location", { configurable: true, value: dom.window.location });
  const select = dom.window.document.getElementById("region") as HTMLSelectElement;
  Object.defineProperty(select, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 160,
      bottom: 24,
      width: 160,
      height: 24,
      toJSON: () => ({}),
    }),
  });
  return { dom, select };
}

describe("fill option confidence safety", () => {
  it("does not write a select option in the review confidence band", async () => {
    const { select } = installDom();
    const state = scanDocument(0);
    const field = state.manifest.fields.find((item) => item.label === "Регион")!;

    const result = await fillRequest(
      state,
      { version: 1, fields: { [field.id]: "Санкт-Петербург" } },
      0,
    );

    expect(result.review).toBe(1);
    expect(result.filled).toBe(0);
    expect(select.value).toBe("");
  });

  it("still writes an exact select option", async () => {
    const { select } = installDom();
    const state = scanDocument(0);
    const field = state.manifest.fields.find((item) => item.label === "Регион")!;

    const result = await fillRequest(
      state,
      { version: 1, fields: { [field.id]: "Москва" } },
      0,
    );

    expect(result.filled).toBe(1);
    expect(result.review).toBe(0);
    expect(select.value).toBe("moscow");
  });
});
