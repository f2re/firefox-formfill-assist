import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { fillCombobox } from "../src/content/combobox";
import { matchDisposition } from "../src/content/match";

function makeVisible(element: HTMLElement): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 120,
      bottom: 24,
      width: 120,
      height: 24,
      toJSON: () => ({}),
    }),
  });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [{ width: 120, height: 24 }],
  });
}

function createDom(): JSDOM {
  return new JSDOM(
    `<!doctype html><html><body><input id="combo" role="combobox" aria-expanded="false" aria-controls="list"><div id="mount"></div></body></html>`,
    { url: "https://example.test/form", pretendToBeVisual: true },
  );
}

describe("combobox hardening", () => {
  it("classifies confidence using the global auto/review thresholds", () => {
    expect(matchDisposition(0.99)).toBe("auto");
    expect(matchDisposition(0.9)).toBe("review");
    expect(matchDisposition(0.4)).toBe("reject");
  });

  it("waits for a dynamically rendered list and verifies the selected state", async () => {
    const dom = createDom();
    const document = dom.window.document;
    const combo = document.getElementById("combo") as HTMLInputElement;
    makeVisible(combo);

    combo.addEventListener("click", () => {
      combo.setAttribute("aria-expanded", "true");
      dom.window.setTimeout(() => {
        if (document.getElementById("list")) return;
        const list = document.createElement("div");
        list.id = "list";
        list.setAttribute("role", "listbox");
        const option = document.createElement("div");
        option.id = "spb";
        option.setAttribute("role", "option");
        option.textContent = "Санкт-Петербург";
        makeVisible(option);
        option.addEventListener("click", () => {
          option.setAttribute("aria-selected", "true");
          combo.value = "Санкт-Петербург";
          combo.setAttribute("aria-expanded", "false");
        });
        list.append(option);
        document.body.append(list);
      }, 15);
    });

    const result = await fillCombobox(combo, "Санкт-Петербург");
    expect(result.ok).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(combo.value).toBe("Санкт-Петербург");
  });

  it("does not click a merely similar option in the review band", async () => {
    const dom = createDom();
    const document = dom.window.document;
    const combo = document.getElementById("combo") as HTMLInputElement;
    makeVisible(combo);
    let optionClicks = 0;

    combo.addEventListener("click", () => {
      combo.setAttribute("aria-expanded", "true");
      if (document.getElementById("list")) return;
      const list = document.createElement("div");
      list.id = "list";
      list.setAttribute("role", "listbox");
      const option = document.createElement("div");
      option.setAttribute("role", "option");
      option.textContent = "Санкт-Петербург муниципальный округ";
      makeVisible(option);
      option.addEventListener("click", () => {
        optionClicks += 1;
      });
      list.append(option);
      document.body.append(list);
    });

    const result = await fillCombobox(combo, "Санкт-Петербург");
    expect(result.ok).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    expect(result.confidence).toBeLessThan(0.95);
    expect(result.message).toContain("требуется проверка");
    expect(optionClicks).toBe(0);
  });
});
