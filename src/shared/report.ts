import type { FillResult, FormManifest, PrimitiveFillValue } from "./types";

interface FailedReportItem {
  id: string;
  label: string;
  status: "review" | "error";
  requested?: PrimitiveFillValue;
  actual?: PrimitiveFillValue;
  available?: string[];
  message?: string;
}

export interface GptFeedbackReport {
  version: 1;
  pageFingerprint: string;
  success: string[];
  unchanged: string[];
  failed: FailedReportItem[];
  note: string;
}

export function makeGptFeedbackReport(manifest: FormManifest, result: FillResult): GptFeedbackReport {
  const descriptors = new Map(manifest.fields.map((field) => [field.id, field]));
  const success: string[] = [];
  const unchanged: string[] = [];
  const failed: FailedReportItem[] = [];

  for (const fieldResult of result.fields) {
    const descriptor = descriptors.get(fieldResult.id);
    if (descriptor?.sensitive) continue;

    if (fieldResult.status === "filled") {
      success.push(fieldResult.id);
      continue;
    }
    if (fieldResult.status === "same") {
      unchanged.push(fieldResult.id);
      continue;
    }
    if (fieldResult.status !== "review" && fieldResult.status !== "error") continue;

    failed.push({
      id: fieldResult.id,
      label: descriptor?.label ?? fieldResult.label,
      status: fieldResult.status,
      requested: fieldResult.requestedValue,
      actual: fieldResult.actualValue,
      available: descriptor?.options?.slice(0, 30),
      message: fieldResult.message,
    });
  }

  return {
    version: 1,
    pageFingerprint: manifest.pageFingerprint,
    success,
    unchanged,
    failed,
    note: "Сформируй корректирующий JSON только для failed. Не добавляй неизвестные значения и не используй DOM selectors.",
  };
}

export function stringifyGptFeedbackReport(manifest: FormManifest, result: FillResult): string {
  return JSON.stringify(makeGptFeedbackReport(manifest, result), null, 2);
}
