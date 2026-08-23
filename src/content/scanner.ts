import type { FieldDescriptor, FieldFingerprint, FieldType, FormManifest } from "../shared/types";
import { fnv1a, pageFingerprint } from "../shared/fingerprint";
import { getElementLabel, isSensitiveField } from "./labels";
import { framePathFor, isInput, isSelect, isTextArea } from "./dom";

export interface FieldHandle {
  id: string;
  descriptor: FieldDescriptor;
  elements: HTMLElement[];
}

export interface ScanState {
  manifest: FormManifest;
  handles: Map<string, FieldHandle>;
}

const selector = [
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])",
  "textarea",
  "select",
  "[contenteditable=true]",
  "[role=textbox]",
  "[role=combobox]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=spinbutton]",
].join(",");

const elementIds = new WeakMap<Element, string>();
const fingerprintIds = new Map<string, string>();
let sequence = 1;

function nextId(): string {
  return `F${String(sequence++).padStart(2, "0")}`;
}

function isVisible(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function formIndex(element: HTMLElement): number {
  const form = element.closest("form");
  if (!form) return -1;
  return Array.from(element.ownerDocument.forms).indexOf(form as HTMLFormElement);
}

function localDomPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const parent: Element | null = current.parentElement;
    const siblings: Element[] = parent
      ? Array.from(parent.children).filter((child: Element) => child.tagName === current!.tagName)
      : [];
    const index = siblings.length > 1 ? siblings.indexOf(current) + 1 : 0;
    parts.unshift(`${current.tagName.toLowerCase()}${index ? `:nth-of-type(${index})` : ""}`);
    current = parent;
  }
  return parts.join(">");
}

function domPath(element: Element): string {
  const framePath = framePathFor(element);
  const localPath = localDomPath(element);
  return framePath ? `${framePath}::${localPath}` : localPath;
}

function inferType(element: HTMLElement, sensitive: boolean): FieldType {
  if (sensitive) return "protected";
  if (isTextArea(element)) return "textarea";
  if (isSelect(element)) return "select";
  if (isInput(element)) {
    switch (element.type) {
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "date":
      case "datetime-local":
        return "date";
      case "number":
      case "range":
        return "number";
      case "email":
        return "email";
      case "tel":
        return "tel";
      default:
        return "text";
    }
  }
  const role = element.getAttribute("role");
  if (role === "combobox") return "combobox";
  if (role === "checkbox") return "checkbox";
  if (role === "radio") return "radio";
  if (role === "spinbutton") return "number";
  if (element.isContentEditable) return "contenteditable";
  return "text";
}

function readonly(element: HTMLElement): boolean {
  if (isInput(element) || isTextArea(element)) return element.readOnly;
  return element.getAttribute("aria-readonly") === "true";
}

function disabled(element: HTMLElement): boolean {
  if (isInput(element) || isTextArea(element) || isSelect(element)) return element.disabled;
  return element.getAttribute("aria-disabled") === "true";
}

function required(element: HTMLElement): boolean {
  if (isInput(element) || isTextArea(element) || isSelect(element)) return element.required;
  return element.getAttribute("aria-required") === "true";
}

function optionsOf(element: HTMLElement): string[] | undefined {
  if (isSelect(element)) {
    return Array.from(element.options)
      .filter((option) => !option.disabled)
      .map((option) => option.text.trim())
      .filter(Boolean);
  }
  return undefined;
}

function fingerprintOf(element: HTMLElement, label: string, type: FieldType): FieldFingerprint {
  return {
    tag: element.tagName.toLowerCase(),
    inputType: isInput(element) ? element.type : type,
    name: element.getAttribute("name") || undefined,
    domId: element.id || undefined,
    label,
    ariaLabel: element.getAttribute("aria-label") || undefined,
    formIndex: formIndex(element),
    domPath: domPath(element),
  };
}

function stableFingerprintKey(fingerprint: FieldFingerprint): string {
  return fnv1a(
    JSON.stringify([
      fingerprint.tag,
      fingerprint.inputType,
      fingerprint.name ?? "",
      fingerprint.domId ?? "",
      fingerprint.label,
      fingerprint.formIndex,
      fingerprint.domPath,
    ]),
  );
}

function idFor(element: HTMLElement, fingerprint: FieldFingerprint): string {
  const elementId = elementIds.get(element);
  if (elementId) return elementId;

  const key = stableFingerprintKey(fingerprint);
  const persisted = fingerprintIds.get(key);
  const id = persisted ?? nextId();
  elementIds.set(element, id);
  fingerprintIds.set(key, id);
  return id;
}

function collectCandidates(root: Document | ShadowRoot, output: HTMLElement[], frameCounter: { unsupported: number }): void {
  output.push(...Array.from(root.querySelectorAll<HTMLElement>(selector)));

  for (const host of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (host.shadowRoot) collectCandidates(host.shadowRoot, output, frameCounter);
  }

  for (const frame of Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe"))) {
    try {
      const childDocument = frame.contentDocument;
      if (childDocument) collectCandidates(childDocument, output, frameCounter);
      else frameCounter.unsupported += 1;
    } catch {
      frameCounter.unsupported += 1;
    }
  }
}

function radioGroup(candidates: HTMLElement[], element: HTMLInputElement): HTMLInputElement[] {
  if (!element.name) return [element];
  return candidates.filter(
    (candidate): candidate is HTMLInputElement =>
      isInput(candidate) &&
      candidate.type === "radio" &&
      candidate.name === element.name &&
      candidate.form === element.form &&
      candidate.ownerDocument === element.ownerDocument,
  );
}

export function scanDocument(mutationRevision: number): ScanState {
  const candidates: HTMLElement[] = [];
  const frameCounter = { unsupported: 0 };
  collectCandidates(document, candidates, frameCounter);

  const handles = new Map<string, FieldHandle>();
  const handled = new Set<HTMLElement>();

  for (const element of candidates) {
    if (handled.has(element) || !isVisible(element)) continue;

    const elementDisabled = disabled(element);
    const elementReadonly = readonly(element);
    const label = getElementLabel(element);
    const sensitive = isSensitiveField(element, label);
    const type = inferType(element, sensitive);

    if (!sensitive && (elementDisabled || elementReadonly)) continue;

    let elements = [element];
    let options = optionsOf(element);

    if (isInput(element) && element.type === "radio") {
      elements = radioGroup(candidates, element);
      for (const radio of elements) handled.add(radio);
      options = elements.map((radio) => getElementLabel(radio)).filter(Boolean);
    } else {
      handled.add(element);
    }

    const fingerprint = fingerprintOf(element, label, type);
    const id = idFor(element, fingerprint);
    for (const groupedElement of elements) elementIds.set(groupedElement, id);

    const descriptor: FieldDescriptor = {
      id,
      type,
      label,
      required: required(element),
      disabled: elementDisabled,
      readonly: elementReadonly,
      sensitive,
      options,
      optionsDynamic: type === "combobox" && !options?.length,
      fingerprint,
    };

    handles.set(id, { id, descriptor, elements });
  }

  const fields = Array.from(handles.values())
    .map((handle) => handle.descriptor)
    .sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")));

  const page = new URL(location.href);
  const manifest: FormManifest = {
    version: 1,
    page: page.href,
    pageFingerprint: pageFingerprint(page, fields),
    createdAt: new Date().toISOString(),
    fields,
    unsupportedCrossOriginFrames: frameCounter.unsupported,
    mutationRevision,
  };

  return { manifest, handles };
}
