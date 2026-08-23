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
import { formatDateForElement, matchRadioOption, matchSelectOption } from "./match";
import { fillCombobox } from "./combobox";

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

  try {
    if (handle.descriptor.type === "checkbox") {
      if (!(element instanceof HTMLInputElement)) {
        return { id, label: handle.descriptor.label, status: "error", message: "ARIA checkbox пока не поддержан для записи." };
      }
      setChecked(element, action === "uncheck" ? false : action === "check" ? true : booleanValue(value));
    } else if (handle.descriptor.type === "radio") {
      const match = matchRadioOption(handle.elements, value);
      if (!match || match.confidence < 0.75) {
        return { id, label: handle.descriptor.label, status: "review", requestedValue: value, message: "Radio-вариант неоднозначен." };
      }
      setChecked(match.element, true);
    } else if (element instanceof HTMLSelectElement) {
      const match = matchSelectOption(element, value);
      if (!match || match.confidence < 0.75) {
        return { id, label: handle.descriptor.label, status: "review", requestedValue: value, message: "Select-вариант неоднозначен." };
      }
      setSelectValue(element, match.value);
    } else if (handle.descriptor.type === "combobox") {
      const result = await fillCombobox(element, String(value ?? ""));
      if (!result.ok) {
        return {
          id,
          label: handle.descriptor.label,
          status: "review",
          requestedValue: value,
          actualValue: result.actual,
          message: result.message,
        };
      }
    } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const text =
        handle.descriptor.type === "date"
          ? formatDateForElement(element, String(value ?? ""))
          : String(value ?? "");
      setInputValue(element, text);
    } else if (element.isContentEditable) {
      setContentEditable(element, String(value ?? ""));
    } else {
      return { id, label: handle.descriptor.label, status: "error", message: "Тип элемента пока не поддержан для записи." };
    }

    const actual = readValue(handle);
    const desired = handle.descriptor.type === "select" || handle.descriptor.type === "radio" ? actual : value;
    const verified =
      handle.descriptor.type === "combobox" ||
      comparable(actual) === comparable(desired) ||
      (handle.descriptor.type === "date" && Boolean(actual));

    return {
      id,
      label: handle.descriptor.label,
      status: verified ? "filled" : "review",
      requestedValue: value,
      actualValue: actual,
      message: verified ? undefined : "Компонент не подтвердил запрошенное значение.",
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
      if (handle.descriptor.type === "checkbox" && element instanceof HTMLInputElement) {
        setChecked(element, booleanValue(snapshot.value));
      } else if (handle.descriptor.type === "radio") {
        const match = matchRadioOption(handle.elements, snapshot.value);
        if (match) setChecked(match.element, true);
      } else if (element instanceof HTMLSelectElement) {
        setSelectValue(element, String(snapshot.value ?? ""));
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
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
