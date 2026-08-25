import { z } from "zod";
import type {
  FieldDescriptor,
  FillOperation,
  FillRequest,
  FormManifest,
  PrimitiveFillValue,
} from "./types";

const primitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const operationSchema = z
  .object({
    action: z.enum(["set", "select", "check", "uncheck", "clear", "skip"]),
    value: primitiveSchema.optional(),
  })
  .strict();

const fieldIdPattern = /^(?:F\d{2,}|I\d+-F\d{2,}|P\d+-(?:F\d{2,}|I\d+-F\d{2,}))$/;
const captureIdPattern = /^[A-Za-z0-9_-]{16,96}$/;
const fingerprintPattern = /^[a-f0-9]{8}$/i;

export const aiFillResponseSchema = z
  .object({
    version: z.literal(2),
    captureId: z.string().regex(captureIdPattern),
    pageFingerprint: z.string().regex(fingerprintPattern),
    status: z.enum(["ready", "needs_input", "mismatch"]),
    fields: z.record(z.string().regex(fieldIdPattern), z.union([primitiveSchema, operationSchema])),
    questions: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
    warnings: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
  })
  .strict();

export interface AiFillResponse {
  version: 2;
  captureId: string;
  pageFingerprint: string;
  status: "ready" | "needs_input" | "mismatch";
  fields: Record<string, PrimitiveFillValue | FillOperation>;
  questions?: string[];
  warnings?: string[];
}

export interface AiCaptureBinding {
  captureId: string;
  pageFingerprint: string;
  manifest: FormManifest;
}

export type AiResponseDecision =
  | { kind: "ready"; request: FillRequest; warnings: string[] }
  | { kind: "needs_input"; questions: string[]; warnings: string[] }
  | { kind: "mismatch"; message: string; warnings: string[] };

export class AiResponseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseParseError";
  }
}

export class AiResponseBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseBindingError";
  }
}

function candidateJsonObjects(text: string): string[] {
  const clean = text
    .replace(/```(?:json|javascript|js)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  const candidates = [clean];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(clean.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

function humanIssue(path: PropertyKey[], message: string): string {
  const location = path.length ? path.map(String).join(".") : "root";
  if (location === "version") return "ожидается новый формат ответа version=2";
  if (location === "captureId") return "captureId отсутствует или повреждён";
  if (location === "pageFingerprint") return "pageFingerprint должен быть полным 8-символьным значением";
  if (location === "status") return "status должен быть ready, needs_input или mismatch";
  return `${location}: ${message}`;
}

export function parseAiFillResponse(text: string): AiFillResponse {
  let lastError = "в ответе не найден JSON object";

  for (const candidate of candidateJsonObjects(text)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const validated = aiFillResponseSchema.safeParse(parsed);
      if (validated.success) return validated.data as AiFillResponse;
      lastError = validated.error.issues
        .slice(0, 4)
        .map((issue) => humanIssue(issue.path, issue.message))
        .join("; ");
    } catch (error) {
      if (error instanceof SyntaxError) lastError = error.message;
    }
  }

  throw new AiResponseParseError(
    `Не удалось прочитать ответ ИИ: ${lastError}. Скопируйте новый промпт из текущего пакета и попросите ИИ вернуть только JSON.`,
  );
}

function isOperation(value: PrimitiveFillValue | FillOperation): value is FillOperation {
  return Boolean(value && typeof value === "object" && "action" in value);
}

function requestedSelectValue(value: PrimitiveFillValue | FillOperation): PrimitiveFillValue | undefined {
  if (!isOperation(value) || value.action !== "select") return undefined;
  return value.value;
}

function validateValueForField(field: FieldDescriptor, value: PrimitiveFillValue | FillOperation): void {
  if (value === null) {
    throw new AiResponseBindingError(`${field.id}: null нельзя использовать вместо неизвестного значения.`);
  }
  if (typeof value === "string" && !value.trim()) {
    throw new AiResponseBindingError(`${field.id}: пустая строка не является подтверждённым значением.`);
  }

  if (["select", "radio", "combobox"].includes(field.type)) {
    const selected = requestedSelectValue(value);
    if (selected === undefined || typeof selected !== "string" || !selected.trim()) {
      throw new AiResponseBindingError(
        `${field.id} (${field.label}): для поля выбора нужен объект {"action":"select","value":"..."}.`,
      );
    }
    if (field.options?.length && !field.options.includes(selected)) {
      throw new AiResponseBindingError(
        `${field.id} (${field.label}): вариант «${selected}» отсутствует в списке этой формы. Ответ, вероятно, относится к другой странице.`,
      );
    }
  }

  if (field.type === "checkbox") {
    if (!isOperation(value) || !["check", "uncheck", "clear", "skip"].includes(value.action)) {
      throw new AiResponseBindingError(
        `${field.id} (${field.label}): checkbox допускает только check/uncheck/clear/skip.`,
      );
    }
  }
}

function uniqueText(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function validateAiFillResponse(
  response: AiFillResponse,
  binding: AiCaptureBinding,
): AiResponseDecision {
  if (response.captureId !== binding.captureId) {
    throw new AiResponseBindingError(
      "Ответ ИИ создан для другого снимка. Не применяйте его: снова скопируйте промпт именно из текущего пакета.",
    );
  }
  if (response.pageFingerprint !== binding.pageFingerprint) {
    throw new AiResponseBindingError(
      "Ответ ИИ относится к другой версии формы: pageFingerprint не совпадает. Подготовьте новый снимок и промпт.",
    );
  }

  const warnings = uniqueText(response.warnings);
  if (response.status === "mismatch") {
    return {
      kind: "mismatch",
      message: warnings[0] ?? "ИИ сообщил, что приложенный скриншот не соответствует manifest текущей формы.",
      warnings,
    };
  }

  const fieldsById = new Map(binding.manifest.fields.map((field) => [field.id, field]));
  const unknownIds: string[] = [];
  const protectedIds: string[] = [];

  for (const [id, value] of Object.entries(response.fields)) {
    const field = fieldsById.get(id);
    if (!field) {
      unknownIds.push(id);
      continue;
    }
    if (field.sensitive || field.disabled || field.readonly || field.type === "protected") {
      protectedIds.push(id);
      continue;
    }
    validateValueForField(field, value);
  }

  if (unknownIds.length) {
    throw new AiResponseBindingError(
      `Ответ содержит поля, которых нет в текущем снимке: ${unknownIds.slice(0, 6).join(", ")}. Это похоже на ответ для другой формы.`,
    );
  }
  if (protectedIds.length) {
    throw new AiResponseBindingError(
      `ИИ попытался заполнить защищённые или недоступные поля: ${protectedIds.slice(0, 6).join(", ")}. Ответ отклонён.`,
    );
  }

  const questions = uniqueText(response.questions);
  if (response.status === "needs_input" || Object.keys(response.fields).length === 0) {
    return {
      kind: "needs_input",
      questions: questions.length
        ? questions
        : ["Какие точные значения нужно внести в эту форму? Добавьте их в поле «Исходные данные для ИИ»."],
      warnings,
    };
  }

  return {
    kind: "ready",
    request: {
      version: 1,
      pageFingerprint: binding.pageFingerprint,
      fields: response.fields,
    },
    warnings,
  };
}
