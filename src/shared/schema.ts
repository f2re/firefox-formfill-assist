import { z } from "zod";
import type { FillRequest } from "./types";

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const operation = z.object({
  action: z.enum(["set", "select", "check", "uncheck", "clear", "skip"]),
  value: primitive.optional(),
});

const fieldIdPattern = /^(?:F\d{2,}|I\d+-F\d{2,}|P\d+-F\d{2,})$/;

export const fillRequestSchema = z.object({
  version: z.literal(1),
  pageFingerprint: z.string().min(1).optional(),
  fields: z.record(z.string().regex(fieldIdPattern), z.union([primitive, operation])),
});

export class FillRequestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FillRequestParseError";
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

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
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
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(clean.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function parseFillRequest(text: string): FillRequest {
  let lastError = "В ответе не найден валидный JSON object.";

  for (const candidate of candidateJsonObjects(text)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const validated = fillRequestSchema.safeParse(parsed);
      if (validated.success) return validated.data as FillRequest;
      lastError = validated.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
    } catch (error) {
      if (error instanceof SyntaxError) lastError = error.message;
    }
  }

  throw new FillRequestParseError(`Не удалось прочитать ответ ChatGPT: ${lastError}`);
}
