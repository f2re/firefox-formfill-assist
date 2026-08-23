import type {
  FillActionName,
  FillFieldResult,
  FillOperation,
  FillRequest,
  FillResult,
  PrimitiveFillValue,
  UndoResult,
} from "../shared/types";
import { normalizeText } from "../shared/normalize";
import type { ScanState } from "./scanner";
import { scanDocument } from "./scanner";
import { readValue, setChecked, setContentEditable, setInputValue, setSelectValue } from "./values";
import { formatDateForElement, matchDisposition, matchRadioOption, matchSelectOption } from "./match";
import { fillCombobox } from "./combobox";
import { isInput, isSelect, isTextArea } from "./dom";

interface UndoSnapshot {
  id: string;
  value: PrimitiveFillValue;
}

let undoStack: UndoSnapshot[] = [];

function resolved(raw: PrimitiveFillValue | FillOperation): { action: FillActionName; value: PrimitiveFillValue } {
  if (typeof raw === "object" && raw !== null && "action" in raw) {
    if (raw.action === "clear") return { action: "clear", value: "" };
    if (raw.action === "check") return { action: "check", value: raw.value ?? true };
    if (raw.action === "uncheck") return { action: "uncheck", value: raw.value ?? false };
    return { action: raw.action, value: raw.value ?? null };
  }
  return { action: "set", value: raw };
}

function comparable(value: PrimitiveFillValue): string {
  return typeof value === "boolean" ? String(value) : normalizeText(value);
}

function booleanValue(value: PrimitiveFillValue): boolean {
  if (typeof value === "boolean") return value;
  const normalized = normalizeText(value);
  return ["true", "1", "yes", "да", "on", "checked"].includes(normalized);
}

function unsafeMatchResult(
  id: string,
  label: string,
  value: PrimitiveFillValue,
  kind: "Radio" | "Select",
  confidence?: number,
): FillFieldResult {
  if (confidence !== undefined && matchDisposition(confidence) === "review") {
    return {
      id,
      label,
      status: "review",
      requestedValue: value,
      message: `${kind}-вариант найден с уверенностью ${Math.round(confidence * 100)}%. Автоматическая запись запрещена — требуется проверка.`,
    };
  }
  return {
    id,
    label,
    status: "error",
    requestedValue: value,
    message: `${kind}-вариант не найден с достаточной уверенностью.`,
  };
}

async function applyOne(state: ScanState, id: string, raw: PrimitiveFillValue | FillOperation): Promise<FillFieldResult> {
  const handle = state.handles.get(id);
  const { action, value } = resolved(raw);
  if (action === "skip") return { id, label: handle?.descriptor.label ?? id, status: "skipped" };

  if (!handle) {
    return { id, label: id, status: "error", requestedValue: value, message: "Fxx отсутствует в текущей форме." };
  }
  if (handle.descriptor.sensitive) {
    return { id, label: "Защищённое поле", status: "error", message: "Чувствительное поле заблокировано." };
  }

  const before = readValue(handle);
  if (comparable(before) === comparable(value)) {
    return { id, label: handle.descriptor.label, status: "same", requestedValue: value, actualValue: before };
  }

  const element = handle.elements[0];
  if (!element) return { id, label: handle.descriptor.label, status: "error", message: "DOM element исчез." };

  let expectedActual: PrimitiveFillValue = value;
  let verificationOverride: boolean | null = null;
  let verificationMessage: string | undefined;

  try {
    if (handle.descriptor.type === "checkbox") {
      if (!isInput(element)) {
        return { id, label: handle.descriptor.label, status: "error", message: "ARIA checkbox пока не поддержан для записи." };
      }
      const checked = action === "uncheck" ? false : action === "check" ? true : booleanValue(value);
      setChecked(element, checked);
      expectedActual = checked;
    } else if (handle.descriptor.type === "radio") {
      const match = matchRadioOption(handle.elements, value);
      if (!match || matchDisposition(match.confidence) !== "auto") {
        return unsafeMatchResult(id, handle.descriptor.label, value, "Radio", match?.confidence);
      }
      setChecked(match.element, true);
      expectedActual = match.label;
    } else if (isSelect(element)) {
      const match = matchSelectOption(element, value);
      if (!match || matchDisposition(match.confidence) !== "auto") {
        return unsafeMatchResult(id, handle.descriptor.label, value, "Select", match?.confidence);
      }
      setSelectValue(element, match.value);
      expectedActual = match.value;
    } else if (handle.descriptor.type === "combobox") {
      const result = await fillCombobox(element, String(value ?? ""));
      verificationOverride = result.ok;
      verificationMessage = result.message;
      expectedActual = result.actual ?? result.expected ?? value;
      if (!result.ok) {
        const disposition = result.confidence === undefined ? "review" : matchDisposition(result.confidence);
        return {
          id,
          label: handle.descriptor.label,
          status: disposition === "reject" ? "error" : "review",
          requestedValue: value,
          actualValue: result.actual,
          message: result.message,
        };
      }
    } else if (isInput(element) || isTextArea(element)) {
      const text =
        handle.descriptor.type === "date"
          ? formatDateForElement(element, String(value ?? ""))
          : String(value ?? "");
      setInputValue(element, text);
      expectedActual = text;
    } else if (element.isContentEditable) {
      const text = String(value ?? "");
      setContentEditable(element, text);
      expectedActual = text;
    } else {
      return { id, label: handle.descriptor.label, status: "error", message: "Тип элемента пока не поддержан для записи." };
    }

    const actual = readValue(handle);
    const verified = verificationOverride ?? comparable(actual) === comparable(expectedActual);

    return {
      id,
      label: handle.descriptor.label,
      status: verified ? "filled" : "review",
      requestedValue: value,
      actualValue: actual,
      message: verified
        ? verificationMessage
        : verificationMessage ?? "Компонент не подтвердил запрошенное значение.",
    };
  } catch (error) {
    return {
      id,
      label: handle.descriptor.label,
      status: "error",
      requestedValue: value,
      message: error instanceof Error ? error.message : "Неизвестная ошибка записи.",
    };
  }
}

function waitForDom(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fillRequest(state: ScanState, request: FillRequest, mutationRevision: number): Promise<FillResult> {
  const startedAt = new Date().toISOString();
  undoStack = [];

  for (const id of Object.keys(request.fields)) {
    const handle = state.handles.get(id);
    if (handle && !handle.descriptor.sensitive) undoStack.push({ id, value: readValue(handle) });
  }

  const results: FillFieldResult[] = [];
  for (const [id, raw] of Object.entries(request.fields)) {
    const result = await applyOne(state, id, raw);
    results.push(result);

    const handle = state.handles.get(id);
    if (
      handle &&
      ["select", "radio", "checkbox", "combobox"].includes(handle.descriptor.type) &&
      result.status === "filled"
    ) {
      await waitForDom();
    }
  }

  await waitForDom(80);
  const rescanned = scanDocument(mutationRevision);
  const newFieldCount = Math.max(0, rescanned.manifest.fields.length - state.manifest.fields.length);

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    fields: results,
    filled: results.filter((item) => item.status === "filled").length,
    same: results.filter((item) => item.status === "same").length,
    review: results.filter((item) => item.status === "review").length,
    errors: results.filter((item) => item.status === "error").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    newFieldCount,
  };
}

export async function undoLast(state: ScanState): Promise<UndoResult> {
  let restored = 0;
  let errors = 0;

  for (const snapshot of undoStack) {
    const handle = state.handles.get(snapshot.id);
    const element = handle?.elements[0];
    if (!handle || !element) {
      errors += 1;
      continue;
    }

    try {
      if (handle.descriptor.type === "checkbox" && isInput(element)) {
        setChecked(element, booleanValue(snapshot.value));
      } else if (handle.descriptor.type === "radio") {
        if (snapshot.value === null) {
          for (const radio of handle.elements) if (isInput(radio)) setChecked(radio, false);
        } else {
          const match = matchRadioOption(handle.elements, snapshot.value);
          if (!match) throw new Error("Не удалось восстановить radio-вариант.");
          setChecked(match.element, true);
        }
      } else if (isSelect(element)) {
        setSelectValue(element, String(snapshot.value ?? ""));
      } else if (isInput(element) || isTextArea(element)) {
        setInputValue(element, String(snapshot.value ?? ""));
      } else if (element.isContentEditable) {
        setContentEditable(element, String(snapshot.value ?? ""));
      } else {
        errors += 1;
        continue;
      }
      restored += 1;
    } catch {
      errors += 1;
    }
  }

  undoStack = [];
  return { restored, errors };
}
