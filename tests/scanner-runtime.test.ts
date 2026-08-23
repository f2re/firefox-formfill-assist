import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { discoverObservationRoots, scanDocument } from "../src/content/scanner";

function visible(element: HTMLElement): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 140,
      bottom: 24,
      width: 140,
      height: 24,
      toJSON: () => ({}),
    }),
  });
}

function installDom(html = ""): JSDOM {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: "https://example.test/form",
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, "location", { configurable: true, value: dom.window.location });
  return dom;
}

describe("scanner runtime roots", () => {
  it("discovers open Shadow DOM and scans its controls", () => {
    const dom = installDom('<div id="host"></div>');
    const host = dom.window.document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<label>Поле Shadow <input name="shadow-value"></label>';
    const input = shadow.querySelector("input") as HTMLInputElement;
    visible(input);

    const discovery = discoverObservationRoots();
    expect(discovery.roots).toContain(shadow);

    const state = scanDocument(0);
    expect(state.manifest.fields.some((field) => field.label.includes("Поле Shadow"))).toBe(true);
  });

  it("discovers same-origin iframe documents", () => {
    const dom = installDom();
    const frame = dom.window.document.createElement("iframe");
    dom.window.document.body.append(frame);
    const child = frame.contentDocument!;
    child.body.innerHTML = '<label>Поле iframe <input name="inside"></label>';
    const input = child.querySelector("input") as HTMLInputElement;
    visible(input);

    const discovery = discoverObservationRoots();
    expect(discovery.roots).toContain(child);

    const state = scanDocument(0);
    expect(state.manifest.fields.some((field) => field.label.includes("Поле iframe"))).toBe(true);
  });

  it("keeps Fxx stable after a framework-style rerender", () => {
    const dom = installDom('<label>Организация <input name="organization"></label>');
    const firstInput = dom.window.document.querySelector("input") as HTMLInputElement;
    visible(firstInput);
    const first = scanDocument(0).manifest.fields[0]!;

    dom.window.document.body.innerHTML = '<label>Организация <input name="organization"></label>';
    const secondInput = dom.window.document.querySelector("input") as HTMLInputElement;
    visible(secondInput);
    const second = scanDocument(1).manifest.fields[0]!;

    expect(second.id).toBe(first.id);
    expect(second.fingerprint.domPath).toBe(first.fingerprint.domPath);
  });

  it("does not collide identical controls located in different iframes", () => {
    const dom = installDom();
    for (let index = 0; index < 2; index += 1) {
      const frame = dom.window.document.createElement("iframe");
      dom.window.document.body.append(frame);
      const child = frame.contentDocument!;
      child.body.innerHTML = '<label>Одинаковое поле <input name="same"></label>';
      visible(child.querySelector("input") as HTMLInputElement);
    }

    const fields = scanDocument(0).manifest.fields.filter((field) => field.label.includes("Одинаковое поле"));
    expect(fields).toHaveLength(2);
    expect(fields[0]!.id).not.toBe(fields[1]!.id);
    expect(fields[0]!.fingerprint.domPath).not.toBe(fields[1]!.fingerprint.domPath);
  });
});
