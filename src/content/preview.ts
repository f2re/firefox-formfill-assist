import type {
  FillOperation,
  FillRequest,
  PreviewItem,
  PreviewResult,
  PrimitiveFillValue,
} from "../shared/types";
import { normalizeText } from "../shared/normalize";
import type { ScanState } from "./scanner";
import { readValue } from "./values";
import { matchDisposition, matchRadioOption, matchSelectOption } from "./match";
import { isSelect } from "./dom";

function operationValue(raw: PrimitiveFillValue | FillOperation): PrimitiveFillValue {
  if (typeof raw === "object" && raw !== null && "action" in raw) {
    if (raw.action === "clear") return "";
    if (raw.action === "check") return raw.value ?? true;
    if (raw.action === "uncheck") return raw.value ?? false;
    if (raw.action === "skip") return null;
    return raw.value ?? null;
  }
  return raw;
}

function isSkip(raw: PrimitiveFillValue | FillOperation): boolean {
  return typeof raw === "object" && raw !== null && "action" in raw && raw.action === "skip";
}

function sameValue(current: PrimitiveFillValue, requested: PrimitiveFillValue): boolean {
  if (typeof current === "boolean" || typeof requested === "boolean") return current === requested;
  return normalizeText(current) === normalizeText(requested);
}

function previewStatus(confidence: number): "ok" | "review" | "error" {
  const disposition = matchDisposition(confidence);
  if (disposition === "auto") return "ok";
  if (disposition === "review") return "review";
  return "error";
}

export function previewFill(state: ScanState, request: FillRequest): PreviewResult {
  const items: PreviewItem[] = [];
  const pageMismatch =
    Boolean(request.pageFingerprint) && request.pageFingerprint !== state.manifest.pageFingerprint;

  for (const [id, raw] of Object.entries(request.fields)) {
    const handle = state.handles.get(id);
    const requestedValue = operationValue(raw);

    if (isSkip(raw)) {
      items.push({
        id,
        label: handle?.descriptor.label ?? "Неизвестное поле",
        currentValue: handle ? readValue(handle) : null,
        requestedValue,
        status: "skip",
        message: "Поле явно пропущено.",
      });
      continue;
    }

    if (!handle) {
      items.push({
        id,
        label: "Неизвестное поле",
        currentValue: null,
        requestedValue,
        status: "error",
        message: "Такого Fxx нет в текущем анализе.",
      });
      continue;
    }

    const currentValue = readValue(handle);
    if (handle.descriptor.sensitive) {
      items.push({
        id,
        label: "Защищённое поле",
        currentValue: null,
        requestedValue: null,
        status: "error",
        message: "Заполнение чувствительных полей заблокировано.",
      });
      continue;
    }

    if (sameValue(currentValue, requestedValue)) {
      items.push({
        id,
        label: handle.descriptor.label,
        currentValue,
        requestedValue,
        status: "same",
      });
      continue;
    }

    const element = handle.elements[0];
    if (element && isSelect(element)) {
      const match = matchSelectOption(element, requestedValue);
      if (!match) {
        items.push({
          id,
          label: handle.descriptor.label,
          currentValue,
          requestedValue,
          status: "error",
          message: "Подходящий вариант не найден.",
        });
      } else {
        const status = previewStatus(match.confidence);
        items.push({
          id,
          label: handle.descriptor.label,
          currentValue,
          requestedValue: match.label,
          status,
          confidence: match.confidence,
          message:
            status === "ok"
              ? undefined
              : status === "review"
                ? `Лучшее совпадение: ${match.label}. Автоматическая запись не выполняется без проверки.`
                : `Надёжный вариант не найден. Лучшее совпадение: ${match.label}.`,
        });
      }
      continue;
    }

    if (handle.descriptor.type === "radio") {
      const match = matchRadioOption(handle.elements, requestedValue);
      const status = match ? previewStatus(match.confidence) : "error";
      items.push({
        id,
        label: handle.descriptor.label,
        currentValue,
        requestedValue: match?.label ?? requestedValue,
        status,
        confidence: match?.confidence,
        message: !match
          ? "Вариант radio не найден."
          : status === "ok"
            ? undefined
            : status === "review"
              ? `Лучшее совпадение: ${match.label}. Автоматическая запись не выполняется без проверки.`
              : `Надёжный radio-вариант не найден. Лучшее совпадение: ${match.label}.`,
      });
      continue;
    }

    if (handle.descriptor.type === "combobox") {
      items.push({
        id,
        label: handle.descriptor.label,
        currentValue,
        requestedValue,
        status: "review",
        message: "Динамический combobox будет проверен при заполнении; неоднозначный вариант автоматически не выбирается.",
      });
      continue;
    }

    items.push({
      id,
      label: handle.descriptor.label,
      currentValue,
      requestedValue,
      status: "ok",
    });
  }

  const counts: PreviewResult["counts"] = { ok: 0, review: 0, error: 0, same: 0, skip: 0 };
  for (const item of items) counts[item.status] += 1;

  return {
    pageFingerprint: state.manifest.pageFingerprint,
    pageMismatch,
    items,
    counts,
  };
}
