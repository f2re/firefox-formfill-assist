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
  session?: { id: string; page: number };
  success: string[];
  unchanged: string[];
  failed: FailedReportItem[];
  note: string;
}

export interface GptFeedbackOptions {
  mapId?: (id: string) => string;
  session?: { id: string; page: number };
}

export function makeGptFeedbackReport(
  manifest: FormManifest,
  result: FillResult,
  options: GptFeedbackOptions = {},
): GptFeedbackReport {
  const descriptors = new Map(manifest.fields.map((field) => [field.id, field]));
  const mapId = options.mapId ?? ((id: string) => id);
  const success: string[] = [];
  const unchanged: string[] = [];
  const failed: FailedReportItem[] = [];

  for (const fieldResult of result.fields) {
    const descriptor = descriptors.get(fieldResult.id);
    if (descriptor?.sensitive) continue;

    if (fieldResult.status === "filled") {
      success.push(mapId(fieldResult.id));
      continue;
    }
    if (fieldResult.status === "same") {
      unchanged.push(mapId(fieldResult.id));
      continue;
    }
    if (fieldResult.status !== "review" && fieldResult.status !== "error") continue;

    failed.push({
      id: mapId(fieldResult.id),
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
    ...(options.session ? { session: options.session } : {}),
    success,
    unchanged,
    failed,
    note: options.session
      ? `Сформируй корректирующий JSON только для failed страницы P${options.session.page}. Не добавляй неизвестные значения и не используй DOM selectors.`
      : "Сформируй корректирующий JSON только для failed. Не добавляй неизвестные значения и не используй DOM selectors.",
  };
}

export function stringifyGptFeedbackReport(
  manifest: FormManifest,
  result: FillResult,
  options: GptFeedbackOptions = {},
): string {
  return JSON.stringify(makeGptFeedbackReport(manifest, result, options), null, 2);
}
