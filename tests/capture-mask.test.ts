import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { toggleCaptureMasks } from "../src/content/capture-mask";

const ROOT_ID = "__formfill_assist_capture_mask__";

function visible(element: HTMLElement, left = 10, top = 20): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: left,
      y: top,
      top,
      left,
      right: left + 160,
      bottom: top + 30,
      width: 160,
      height: 30,
      toJSON: () => ({}),
    }),
  });
}

describe("capture privacy masks", () => {
  it("covers visible editable controls without changing their values", () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><label>Имя <input id="name" value="Секрет"></label><textarea id="note">Текст</textarea></body></html>',
      { url: "https://example.test/form", pretendToBeVisual: true },
    );
    const input = dom.window.document.getElementById("name") as HTMLInputElement;
    const textarea = dom.window.document.getElementById("note") as HTMLTextAreaElement;
    visible(input);
    visible(textarea, 10, 60);

    expect(toggleCaptureMasks(dom.window.document, false)).toBe(true);
    const root = dom.window.document.getElementById(ROOT_ID)!;
    expect(root.children).toHaveLength(2);
    expect(input.value).toBe("Секрет");
    expect(textarea.value).toBe("Текст");

    expect(toggleCaptureMasks(dom.window.document, false)).toBe(false);
    expect(dom.window.document.getElementById(ROOT_ID)).toBeNull();
  });

  it("masks controls inside open shadow roots", () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
      url: "https://example.test/form",
      pretendToBeVisual: true,
    });
    const host = dom.window.document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<input id="shadow-input" value="hidden value">';
    visible(shadow.getElementById("shadow-input") as HTMLInputElement);

    toggleCaptureMasks(dom.window.document, false);
    expect(dom.window.document.getElementById(ROOT_ID)?.children).toHaveLength(1);
  });

  it("creates a separate mask layer in same-origin iframes", () => {
    const dom = new JSDOM('<!doctype html><html><body><iframe id="frame"></iframe></body></html>', {
      url: "https://example.test/form",
      pretendToBeVisual: true,
    });
    const frame = dom.window.document.getElementById("frame") as HTMLIFrameElement;
    const child = frame.contentDocument!;
    child.body.innerHTML = '<input id="inside" value="iframe secret">';
    visible(child.getElementById("inside") as HTMLInputElement);

    toggleCaptureMasks(dom.window.document, false);
    expect(dom.window.document.getElementById(ROOT_ID)).not.toBeNull();
    expect(child.getElementById(ROOT_ID)?.children).toHaveLength(1);
  });
});
