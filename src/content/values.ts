import type { FieldHandle } from "./scanner";
import type { PrimitiveFillValue } from "../shared/types";
import { getElementLabel } from "./labels";

export function readValue(handle: FieldHandle): PrimitiveFillValue {
  const element = handle.elements[0];
  if (!element) return null;

  if (handle.descriptor.type === "protected") return null;

  if (handle.descriptor.type === "radio") {
    const selected = handle.elements.find(
      (candidate) => candidate instanceof HTMLInputElement && candidate.checked,
    );
    if (!(selected instanceof HTMLInputElement)) return null;
    return getElementLabel(selected) || selected.value;
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return element.checked;
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  if (element.isContentEditable) return element.textContent ?? "";
  return element.getAttribute("aria-valuetext") ?? element.textContent ?? "";
}

function nativeSetter(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, property: "value" | "checked"): ((value: unknown) => void) | null {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  if (!descriptor?.set) return null;
  return descriptor.set.bind(element);
}

function dispatchValueEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

export function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.focus();
  const set = nativeSetter(element, "value");
  if (set) set(value);
  else element.value = value;
  dispatchValueEvents(element);
  element.blur();
}

export function setSelectValue(element: HTMLSelectElement, value: string): void {
  element.focus();
  const set = nativeSetter(element, "value");
  if (set) set(value);
  else element.value = value;
  dispatchValueEvents(element);
  element.blur();
}

export function setChecked(element: HTMLInputElement, checked: boolean): void {
  element.focus();
  const set = nativeSetter(element, "checked");
  if (set) set(checked);
  else element.checked = checked;
  dispatchValueEvents(element);
  element.blur();
}

export function setContentEditable(element: HTMLElement, value: string): void {
  element.focus();
  element.textContent = value;
  dispatchValueEvents(element);
  element.blur();
}
