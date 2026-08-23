import type { FieldHandle } from "./scanner";
import type { PrimitiveFillValue } from "../shared/types";
import { getElementLabel } from "./labels";
import { eventFor, isInput, isSelect, isTextArea } from "./dom";

export function readValue(handle: FieldHandle): PrimitiveFillValue {
  const element = handle.elements[0];
  if (!element) return null;

  if (handle.descriptor.type === "protected") return null;

  if (handle.descriptor.type === "radio") {
    const selected = handle.elements.find((candidate) => isInput(candidate) && candidate.checked);
    if (!selected || !isInput(selected)) return null;
    return getElementLabel(selected) || selected.value;
  }

  if (isInput(element)) {
    if (element.type === "checkbox") return element.checked;
    return element.value;
  }
  if (isTextArea(element) || isSelect(element)) return element.value;
  if (element.isContentEditable) return element.textContent ?? "";
  return element.getAttribute("aria-valuetext") ?? element.textContent ?? "";
}

function nativeSetter(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  property: "value" | "checked",
): ((value: unknown) => void) | null {
  let prototype: object | null = Object.getPrototypeOf(element) as object | null;
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (descriptor?.set) return descriptor.set.bind(element);
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return null;
}

function dispatchValueEvents(element: HTMLElement): void {
  element.dispatchEvent(eventFor(element, "input", { bubbles: true, composed: true }));
  element.dispatchEvent(eventFor(element, "change", { bubbles: true, composed: true }));
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
