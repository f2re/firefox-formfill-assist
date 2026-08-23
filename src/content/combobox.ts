import { bestTextMatch, normalizeText } from "../shared/normalize";
import { setInputValue, setContentEditable } from "./values";
import { isInput, isTextArea, keyboardEventFor, mouseEventFor } from "./dom";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function optionElements(owner: Document): HTMLElement[] {
  return Array.from(
    owner.querySelectorAll<HTMLElement>(
      '[role="option"], [role="listbox"] li, [role="menu"] [role="menuitem"], .option, [class*="option"]',
    ),
  ).filter((element) => {
    const style = owner.defaultView?.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style?.display !== "none" && style?.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
}

export async function fillCombobox(element: HTMLElement, requested: string): Promise<{ ok: boolean; actual?: string; expected?: string; confidence?: number; message?: string }> {
  element.focus();
  element.dispatchEvent(mouseEventFor(element, "mousedown", { bubbles: true, composed: true }));
  element.click();

  if (isInput(element) || isTextArea(element)) {
    setInputValue(element, requested);
  } else if (element.isContentEditable) {
    setContentEditable(element, requested);
  } else {
    element.dispatchEvent(
      keyboardEventFor(element, "keydown", { key: requested[0] ?? "", bubbles: true, composed: true }),
    );
  }

  await sleep(140);
  const options = optionElements(element.ownerDocument);
  const labels = options.map((option) => option.textContent?.trim() ?? "").filter(Boolean);
  const best = bestTextMatch(requested, labels);

  if (!best || best.confidence < 0.75) {
    return { ok: false, confidence: best?.confidence, message: "В открытом списке не найден надёжный вариант." };
  }

  const option = options.find((candidate) => normalizeText(candidate.textContent) === normalizeText(best.value));
  if (!option) return { ok: false, expected: best.value, confidence: best.confidence, message: "Опция исчезла до выбора." };

  option.dispatchEvent(mouseEventFor(option, "mousedown", { bubbles: true, composed: true }));
  option.click();
  await sleep(80);

  const actual =
    isInput(element) || isTextArea(element)
      ? element.value
      : element.getAttribute("aria-valuetext") ?? element.textContent ?? "";

  const actualMatches =
    normalizeText(actual) === normalizeText(best.value) ||
    normalizeText(actual) === normalizeText(requested);
  const ariaSelected = option.getAttribute("aria-selected") === "true";
  const listClosed = element.getAttribute("aria-expanded") === "false" || !option.isConnected;
  const verified = actualMatches && (ariaSelected || listClosed);

  return {
    ok: verified,
    actual,
    expected: best.value,
    confidence: best.confidence,
    message: verified
      ? best.confidence < 0.95
        ? `Выбран близкий вариант: ${best.value}`
        : undefined
      : `Опция «${best.value}» была нажата, но компонент не подтвердил выбор.`,
  };
}
