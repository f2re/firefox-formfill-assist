import { normalizeText } from "../shared/normalize";

function textOf(element: Element | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function getElementLabel(element: HTMLElement): string {
  const owner = element.ownerDocument;

  if (element.id) {
    try {
      const explicit = owner.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      const value = textOf(explicit);
      if (value) return value;
    } catch {
      // Malformed IDs are handled by later fallbacks.
    }
  }

  const parentLabel = element.closest("label");
  const parentValue = textOf(parentLabel);
  if (parentValue) return parentValue;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const value = labelledBy
      .split(/\s+/)
      .map((id) => textOf(owner.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (value) return value.slice(0, 180);
  }

  const aria = element.getAttribute("aria-label")?.trim();
  if (aria) return aria.slice(0, 180);

  const container = element.closest("fieldset, [role=group], td, th, li, .field, .form-group, div");
  if (container) {
    const candidates = Array.from(
      container.querySelectorAll(":scope > label, :scope > legend, :scope > .label, :scope > [class*=label]"),
    )
      .filter((candidate) => candidate !== element && candidate.getAttribute("aria-hidden") !== "true")
      .map(textOf)
      .filter(Boolean);

    if (candidates[0] && candidates[0].length <= 180) return candidates[0];
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const placeholder = element.placeholder.trim();
    if (placeholder) return placeholder.slice(0, 180);
  }

  const title = element.getAttribute("title")?.trim();
  if (title) return title.slice(0, 180);

  const name = element.getAttribute("name")?.trim();
  if (name) return name.slice(0, 180);

  const id = element.id.trim();
  if (id) return id.slice(0, 180);

  return "Поле без подписи";
}

const sensitivePattern =
  /\b(password|passwd|парол|cvv|cvc|one.?time|otp|однораз|api.?key|secret.?key|token|security.?code|код.?безопасности)\b/i;

export function isSensitiveField(element: HTMLElement, label: string): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.type === "password") return true;
    const autocomplete = normalizeText(element.autocomplete);
    if (
      autocomplete.includes("one-time-code") ||
      autocomplete.includes("cc-number") ||
      autocomplete.includes("cc-csc") ||
      autocomplete.includes("new-password") ||
      autocomplete.includes("current-password")
    ) {
      return true;
    }
  }

  const technical = [
    label,
    element.getAttribute("name"),
    element.id,
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
  ]
    .filter(Boolean)
    .join(" ");
  return sensitivePattern.test(technical);
}
