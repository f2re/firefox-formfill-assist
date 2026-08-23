import { bestTextMatch, normalizeText } from "../shared/normalize";
import { isInput } from "./dom";
import { getElementLabel } from "./labels";

export const AUTO_MATCH_THRESHOLD = 0.95;
export const REVIEW_MATCH_THRESHOLD = 0.75;

export type MatchDisposition = "auto" | "review" | "reject";

export function matchDisposition(confidence: number): MatchDisposition {
  if (confidence >= AUTO_MATCH_THRESHOLD) return "auto";
  if (confidence >= REVIEW_MATCH_THRESHOLD) return "review";
  return "reject";
}

export interface OptionMatch {
  value: string;
  label: string;
  confidence: number;
}

export function matchSelectOption(select: HTMLSelectElement, requested: unknown): OptionMatch | null {
  const requestedText = String(requested ?? "");
  const options = Array.from(select.options).filter((option) => !option.disabled);

  const exactValue = options.find((option) => option.value === requestedText);
  if (exactValue) return { value: exactValue.value, label: exactValue.text.trim(), confidence: 1 };

  const exactLabel = options.find((option) => option.text.trim() === requestedText);
  if (exactLabel) return { value: exactLabel.value, label: exactLabel.text.trim(), confidence: 1 };

  const byNormalizedValue = options.find(
    (option) => normalizeText(option.value) === normalizeText(requestedText),
  );
  if (byNormalizedValue) {
    return { value: byNormalizedValue.value, label: byNormalizedValue.text.trim(), confidence: 0.99 };
  }

  const labels = options.map((option) => option.text.trim());
  const best = bestTextMatch(requestedText, labels);
  if (!best) return null;
  const matched = options.find((option) => option.text.trim() === best.value);
  return matched ? { value: matched.value, label: matched.text.trim(), confidence: best.confidence } : null;
}

export function matchRadioOption(elements: HTMLElement[], requested: unknown): { element: HTMLInputElement; label: string; confidence: number } | null {
  const radios = elements.filter(
    (element): element is HTMLInputElement => isInput(element) && element.type === "radio",
  );
  const labels = radios.map((radio) => {
    const label = getElementLabel(radio);
    return label && label !== "Поле без подписи" ? label : radio.value;
  });

  const best = bestTextMatch(requested, labels);
  if (!best) return null;
  const index = labels.indexOf(best.value);
  const element = radios[index];
  return element ? { element, label: best.value, confidence: best.confidence } : null;
}

export function formatDateForElement(element: HTMLInputElement | HTMLTextAreaElement, isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;

  if (isInput(element) && element.type === "date") return isoDate;
  const hint = `${element.getAttribute("placeholder") ?? ""} ${element.getAttribute("pattern") ?? ""}`.toLowerCase();
  if (hint.includes("dd.mm") || hint.includes("дд.мм")) return `${day}.${month}.${year}`;
  if (hint.includes("dd/mm") || hint.includes("дд/мм")) return `${day}/${month}/${year}`;
  if (hint.includes("mm/dd")) return `${month}/${day}/${year}`;
  return isoDate;
}
