import { bestTextMatch, normalizeText } from "../shared/normalize";
import { setInputValue, setContentEditable } from "./values";

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

export async function fillCombobox(element: HTMLElement, requested: string): Promise<{ ok: boolean; actual?: string; confidence?: number; message?: string }> {
  element.focus();
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
  element.click();

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setInputValue(element, requested);
  } else if (element.isContentEditable) {
    setContentEditable(element, requested);
  } else {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: requested[0] ?? "", bubbles: true }));
  }

  await sleep(140);
  const options = optionElements(element.ownerDocument);
  const labels = options.map((option) => option.textContent?.trim() ?? "").filter(Boolean);
  const best = bestTextMatch(requested, labels);

  if (!best || best.confidence < 0.75) {
    return { ok: false, confidence: best?.confidence, message: "В открытом списке не найден надёжный вариант." };
  }

  const option = options.find((candidate) => normalizeText(candidate.textContent) === normalizeText(best.value));
  if (!option) return { ok: false, confidence: best.confidence, message: "Опция исчезла до выбора." };

  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
  option.click();
  await sleep(60);

  const actual =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : element.getAttribute("aria-valuetext") ?? element.textContent ?? "";

  return {
    ok: normalizeText(actual) === normalizeText(best.value) || best.confidence >= 0.95,
    actual,
    confidence: best.confidence,
    message: best.confidence < 0.95 ? `Выбран близкий вариант: ${best.value}` : undefined,
  };
}
