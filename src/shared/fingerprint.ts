import type { FieldDescriptor } from "./types";
import { normalizeText } from "./normalize";

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function pageFingerprint(page: URL, fields: FieldDescriptor[]): string {
  const stable = fields.map((field) => [
    field.type,
    normalizeText(field.label),
    field.fingerprint.name ?? "",
    field.fingerprint.domId ?? "",
  ]);
  return fnv1a(JSON.stringify([page.hostname, page.pathname, stable]));
}
