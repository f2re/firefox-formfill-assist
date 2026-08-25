import { describe, expect, it } from "vitest";
import {
  parseAiFillResponse,
  validateAiFillResponse,
} from "../src/shared/ai-response";
import type { FieldDescriptor, FormManifest } from "../src/shared/types";

const captureId = "1d8cc2f7-6281-4f16-a52f-987f6e21a410";
const fingerprint = "2e940ecf";

function field(overrides: Partial<FieldDescriptor> & Pick<FieldDescriptor, "id" | "type" | "label">): FieldDescriptor {
  return {
    id: overrides.id,
    type: overrides.type,
    label: overrides.label,
    required: overrides.required ?? false,
    disabled: overrides.disabled ?? false,
    readonly: overrides.readonly ?? false,
    sensitive: overrides.sensitive ?? false,
    options: overrides.options,
    optionsDynamic: overrides.optionsDynamic,
    unit: overrides.unit,
    fingerprint: overrides.fingerprint ?? {
      tag: "input",
      label: overrides.label,
      formIndex: 0,
      domPath: overrides.id,
    },
  };
}

function manifest(): FormManifest {
  return {
    version: 1,
    page: "https://example.test/callback",
    pageFingerprint: fingerprint,
    createdAt: "2026-08-25T05:00:00.000Z",
    unsupportedCrossOriginFrames: 0,
    mutationRevision: 0,
    fields: [
      field({ id: "F01", type: "text", label: "Имя", required: true }),
      field({ id: "F02", type: "tel", label: "Телефон", required: true }),
      field({ id: "F03", type: "select", label: "Город", options: ["Москва", "Санкт-Петербург"] }),
      field({ id: "F04", type: "checkbox", label: "Согласие", required: true }),
      field({ id: "F05", type: "protected", label: "Пароль", sensitive: true }),
    ],
  };
}

function ready(fields: Record<string, unknown> = { F01: "Иван", F02: "+79990000000" }): string {
  return JSON.stringify({
    version: 2,
    captureId,
    pageFingerprint: fingerprint,
    status: "ready",
    fields,
    questions: [],
    warnings: [],
  });
}

describe("capture-bound AI response", () => {
  it("accepts a matching ready response and normalizes it to the DOM contract", () => {
    const response = parseAiFillResponse(ready({
      F01: "Иван",
      F03: { action: "select", value: "Санкт-Петербург" },
      F04: { action: "check" },
    }));
    const decision = validateAiFillResponse(response, {
      captureId,
      pageFingerprint: fingerprint,
      manifest: manifest(),
    });

    expect(decision.kind).toBe("ready");
    if (decision.kind === "ready") {
      expect(decision.request).toEqual({
        version: 1,
        pageFingerprint: fingerprint,
        fields: {
          F01: "Иван",
          F03: { action: "select", value: "Санкт-Петербург" },
          F04: { action: "check" },
        },
      });
    }
  });

  it("rejects a response copied from another screenshot", () => {
    const response = parseAiFillResponse(ready());
    expect(() => validateAiFillResponse(response, {
      captureId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      pageFingerprint: fingerprint,
      manifest: manifest(),
    })).toThrow(/другого снимка/i);
  });

  it("rejects abbreviated fingerprint and old version before preview", () => {
    expect(() => parseAiFillResponse(JSON.stringify({
      version: 2,
      captureId,
      pageFingerprint: "2e94",
      status: "ready",
      fields: {},
    }))).toThrow(/полным 8-символьным/i);

    expect(() => parseAiFillResponse(JSON.stringify({
      version: 1,
      pageFingerprint: fingerprint,
      fields: {},
    }))).toThrow(/version=2/i);
  });

  it("treats unknown ids as a response for another form", () => {
    const response = parseAiFillResponse(ready({ F33: "Postal code" }));
    expect(() => validateAiFillResponse(response, {
      captureId,
      pageFingerprint: fingerprint,
      manifest: manifest(),
    })).toThrow(/другой формы/i);
  });

  it("returns concrete questions instead of inventing missing data", () => {
    const response = parseAiFillResponse(JSON.stringify({
      version: 2,
      captureId,
      pageFingerprint: fingerprint,
      status: "needs_input",
      fields: {},
      questions: ["Укажите имя", "Укажите номер телефона"],
      warnings: [],
    }));
    const decision = validateAiFillResponse(response, {
      captureId,
      pageFingerprint: fingerprint,
      manifest: manifest(),
    });

    expect(decision).toEqual({
      kind: "needs_input",
      questions: ["Укажите имя", "Укажите номер телефона"],
      warnings: [],
    });
  });

  it("rejects a select value that is not present on this page", () => {
    const response = parseAiFillResponse(ready({
      F03: { action: "select", value: "Saint Petersburg" },
    }));
    expect(() => validateAiFillResponse(response, {
      captureId,
      pageFingerprint: fingerprint,
      manifest: manifest(),
    })).toThrow(/отсутствует в списке/i);
  });

  it("blocks protected targets even when the AI supplies a value", () => {
    const response = parseAiFillResponse(ready({ F05: "secret" }));
    expect(() => validateAiFillResponse(response, {
      captureId,
      pageFingerprint: fingerprint,
      manifest: manifest(),
    })).toThrow(/защищённые/i);
  });
});
