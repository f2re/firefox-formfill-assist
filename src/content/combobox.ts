import { bestTextMatch, normalizeText } from "../shared/normalize";
import { setContentEditable } from "./values";
import { eventFor, isInput, isTextArea, keyboardEventFor, mouseEventFor, ownerWindow } from "./dom";
import { matchDisposition } from "./match";

export interface ComboboxFillResult {
  ok: boolean;
  actual?: string;
  expected?: string;
  confidence?: number;
  message?: string;
}

const OPTION_SELECTOR = [
  '[role="option"]',
  '[role="listbox"] > li',
  '[role="listbox"] [data-value]',
  '[role="menu"] [role="menuitem"]',
  '.option',
  '[class*="option"]',
].join(",");

function elementText(element: Element): string {
  return (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function isVisible(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 || element.getClientRects().length > 0;
}

function isUnsafeOption(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute("type") ?? "").toLowerCase();
  if ((tag === "button" || tag === "input") && ["submit", "reset"].includes(type)) return true;
  if (element.matches('[role="button"]:not([role="option"])')) return true;
  return false;
}

function controlledRoots(element: HTMLElement): Element[] {
  const owner = element.ownerDocument;
  const ids = `${element.getAttribute("aria-controls") ?? ""} ${element.getAttribute("aria-owns") ?? ""}`
    .split(/\s+/)
    .filter(Boolean);
  return ids.map((id) => owner.getElementById(id)).filter((root): root is Element => Boolean(root));
}

function optionElements(element: HTMLElement): HTMLElement[] {
  const roots = controlledRoots(element);
  const searchRoots: ParentNode[] = roots.length ? roots : [element.ownerDocument];
  const seen = new Set<HTMLElement>();
  const options: HTMLElement[] = [];

  for (const root of searchRoots) {
    if (root instanceof Element && root.matches(OPTION_SELECTOR)) {
      const candidate = root as HTMLElement;
      if (!seen.has(candidate) && isVisible(candidate) && !isUnsafeOption(candidate)) {
        seen.add(candidate);
        options.push(candidate);
      }
    }
    for (const candidate of Array.from(root.querySelectorAll<HTMLElement>(OPTION_SELECTOR))) {
      if (seen.has(candidate) || !isVisible(candidate) || isUnsafeOption(candidate)) continue;
      seen.add(candidate);
      options.push(candidate);
    }
  }

  return options.filter((candidate) => Boolean(elementText(candidate)));
}

function waitForOptions(element: HTMLElement, timeoutMs = 1400): Promise<HTMLElement[]> {
  const immediate = optionElements(element);
  if (immediate.length) return Promise.resolve(immediate);

  const owner = element.ownerDocument;
  const root = owner.body ?? owner.documentElement;
  const MutationObserverCtor = owner.defaultView?.MutationObserver;
  if (!root || !MutationObserverCtor) return Promise.resolve([]);

  return new Promise((resolve) => {
    let done = false;
    const finish = (options: HTMLElement[]) => {
      if (done) return;
      done = true;
      observer.disconnect();
      owner.defaultView?.clearTimeout(timer);
      resolve(options);
    };
    const observer = new MutationObserverCtor(() => {
      const options = optionElements(element);
      if (options.length) finish(options);
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "aria-expanded", "class", "style"],
    });
    const timer = owner.defaultView?.setTimeout(() => finish(optionElements(element)), timeoutMs) ?? 0;
  });
}

function setEditableQuery(element: HTMLElement, requested: string): void {
  if (isInput(element) || isTextArea(element)) {
    const view = ownerWindow(element);
    const prototype = isInput(element) ? view?.HTMLInputElement.prototype : view?.HTMLTextAreaElement.prototype;
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : undefined;
    element.focus();
    if (descriptor?.set) descriptor.set.call(element, requested);
    else element.value = requested;
    element.dispatchEvent(eventFor(element, "input", { bubbles: true, composed: true }));
    return;
  }

  if (element.isContentEditable) {
    setContentEditable(element, requested);
    element.focus();
    return;
  }

  if (requested) {
    element.dispatchEvent(
      keyboardEventFor(element, "keydown", { key: requested[0] ?? "", bubbles: true, composed: true }),
    );
  }
}

function openCombobox(element: HTMLElement): void {
  element.focus();
  element.dispatchEvent(mouseEventFor(element, "mousedown", { bubbles: true, composed: true }));
  element.dispatchEvent(mouseEventFor(element, "mouseup", { bubbles: true, composed: true }));
  element.click();
  if (element.getAttribute("aria-expanded") === "false") {
    element.dispatchEvent(keyboardEventFor(element, "keydown", { key: "ArrowDown", bubbles: true, composed: true }));
  }
}

function activateOption(option: HTMLElement): void {
  option.dispatchEvent(mouseEventFor(option, "mousemove", { bubbles: true, composed: true }));
  option.dispatchEvent(mouseEventFor(option, "mousedown", { bubbles: true, composed: true }));
  option.dispatchEvent(mouseEventFor(option, "mouseup", { bubbles: true, composed: true }));
  option.click();
}

function explicitSelected(option: HTMLElement): boolean {
  if (option.getAttribute("aria-selected") === "true") return true;
  if (option.getAttribute("data-selected") === "true") return true;
  const state = normalizeText(option.getAttribute("data-state"));
  if (["selected", "checked", "active"].includes(state)) return true;
  return false;
}

function observableValues(element: HTMLElement): string[] {
  const values: string[] = [];
  const push = (value: unknown) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text && !values.includes(text)) values.push(text);
  };

  if (isInput(element) || isTextArea(element)) push(element.value);
  push(element.getAttribute("aria-valuetext"));
  push(element.getAttribute("data-value"));
  if (!isInput(element) && !isTextArea(element)) push(element.textContent);

  let container: HTMLElement | null = element.parentElement;
  for (let depth = 0; container && depth < 3; depth += 1, container = container.parentElement) {
    for (const input of Array.from(container.querySelectorAll<HTMLInputElement>('input[type="hidden"], input[aria-hidden="true"]'))) {
      push(input.value);
    }
    const selected = container.querySelector<HTMLElement>('[aria-selected="true"], [data-selected="true"], [data-state="selected"]');
    if (selected) push(elementText(selected));
  }
  return values;
}

function matchesExpected(value: string, expected: string, requested: string): boolean {
  const normalized = normalizeText(value);
  return normalized === normalizeText(expected) || normalized === normalizeText(requested);
}

function selectionConfirmed(element: HTMLElement, option: HTMLElement, expected: string, requested: string): boolean {
  const valuesMatch = observableValues(element).some((value) => matchesExpected(value, expected, requested));
  const activeDescendant = element.getAttribute("aria-activedescendant");
  const activeSelected = Boolean(option.id && activeDescendant === option.id && explicitSelected(option));
  const selected = explicitSelected(option) || activeSelected;
  const listClosed = element.getAttribute("aria-expanded") === "false";
  return selected || (valuesMatch && (listClosed || !option.isConnected));
}

function waitForSelection(
  element: HTMLElement,
  option: HTMLElement,
  expected: string,
  requested: string,
  timeoutMs = 900,
): Promise<boolean> {
  if (selectionConfirmed(element, option, expected, requested)) return Promise.resolve(true);
  const owner = element.ownerDocument;
  const root = owner.body ?? owner.documentElement;
  const MutationObserverCtor = owner.defaultView?.MutationObserver;
  if (!root || !MutationObserverCtor) return Promise.resolve(false);

  return new Promise((resolve) => {
    let done = false;
    const finish = (confirmed: boolean) => {
      if (done) return;
      done = true;
      observer.disconnect();
      owner.defaultView?.clearTimeout(timer);
      resolve(confirmed);
    };
    const observer = new MutationObserverCtor(() => {
      if (selectionConfirmed(element, option, expected, requested)) finish(true);
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-selected", "aria-expanded", "aria-activedescendant", "data-selected", "data-state", "value"],
    });
    const timer = owner.defaultView?.setTimeout(
      () => finish(selectionConfirmed(element, option, expected, requested)),
      timeoutMs,
    ) ?? 0;
  });
}

export async function fillCombobox(element: HTMLElement, requested: string): Promise<ComboboxFillResult> {
  openCombobox(element);
  setEditableQuery(element, requested);

  const options = await waitForOptions(element);
  const labels = options.map(elementText);
  const best = bestTextMatch(requested, labels);

  if (!best) {
    return { ok: false, message: "В открытом списке нет доступных вариантов." };
  }

  const disposition = matchDisposition(best.confidence);
  if (disposition === "reject") {
    return {
      ok: false,
      expected: best.value,
      confidence: best.confidence,
      message: `Надёжный вариант не найден. Лучшее совпадение: «${best.value}» (${Math.round(best.confidence * 100)}%).`,
    };
  }
  if (disposition === "review") {
    return {
      ok: false,
      expected: best.value,
      confidence: best.confidence,
      message: `Найден близкий вариант «${best.value}» (${Math.round(best.confidence * 100)}%). Автоматический выбор запрещён — требуется проверка.`,
    };
  }

  const option = options.find((candidate) => normalizeText(elementText(candidate)) === normalizeText(best.value));
  if (!option || !option.isConnected) {
    return {
      ok: false,
      expected: best.value,
      confidence: best.confidence,
      message: "Опция исчезла до выбора.",
    };
  }

  activateOption(option);
  const verified = await waitForSelection(element, option, best.value, requested);
  const values = observableValues(element);
  const actual = values.find((value) => matchesExpected(value, best.value, requested)) ?? values[0];

  return {
    ok: verified,
    actual,
    expected: best.value,
    confidence: best.confidence,
    message: verified
      ? undefined
      : `Опция «${best.value}» была нажата, но компонент не подтвердил выбранное значение.`,
  };
}
