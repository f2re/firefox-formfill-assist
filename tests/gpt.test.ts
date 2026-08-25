import { describe, expect, it } from "vitest";
import { makeBoundAiPrompt } from "../src/shared/gpt";
import type { FieldDescriptor, FormManifest } from "../src/shared/types";

function field(overrides: Partial<FieldDescriptor> & Pick<FieldDescriptor, "id" | "type" | "label">): FieldDescriptor {
  return {
    ...overrides,
    id: overrides.id,
    type: overrides.type,
    label: overrides.label,
    required: overrides.required ?? false,
    disabled: overrides.disabled ?? false,
    readonly: overrides.readonly ?? false,
    sensitive: overrides.sensitive ?? false,
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
    page: "https://example.test/form?private=query",
    pageFingerprint: "2e940ecf",
    createdAt: "2026-08-25T05:00:00.000Z",
    unsupportedCrossOriginFrames: 0,
    mutationRevision: 0,
    fields: [
      field({ id: "F01", type: "text", label: "Фамилия", required: true }),
      field({ id: "I1-F02", type: "select", label: "Город", options: ["Москва", "Тула"] }),
      field({ id: "F03", type: "protected", label: "Пароль", sensitive: true }),
      field({ id: "F04", type: "text", label: "Служебное", readonly: true }),
    ],
  };
}

const context = {
  captureId: "1d8cc2f7-6281-4f16-a52f-987f6e21a410",
  capturedAt: "2026-08-25T05:01:02.000Z",
  sourceData: "Фамилия: Иванов\nГород: Тула",
};

describe("makeBoundAiPrompt", () => {
  it("binds a compact prompt to the exact screenshot and response contract", () => {
    const prompt = makeBoundAiPrompt(manifest(), context);

    expect(prompt).toContain("контракт ответа v2");
    expect(prompt).toContain(`captureId: ${context.captureId}`);
    expect(prompt).toContain("pageFingerprint: 2e940ecf");
    expect(prompt).toContain('"version":2');
    expect(prompt).toContain(`"captureId":"${context.captureId}"`);
    expect(prompt).toContain('"status":"ready"');
    expect(prompt).toContain('"id":"I1-F02"');
    expect(prompt).toContain('"options":["Москва","Тула"]');
    expect(prompt).toContain("status=\"needs_input\"");
    expect(prompt).toContain("status=\"mismatch\"");
    expect(prompt).toContain("Фамилия: Иванов");
    expect(prompt).toContain("Город: Тула");
    expect(prompt).toContain("Верни только JSON");
  });

  it("does not leak a URL query or the label of a protected field", () => {
    const prompt = makeBoundAiPrompt(manifest(), context);

    expect(prompt).not.toContain("private=query");
    expect(prompt).not.toContain("Пароль");
    expect(prompt).toContain("Защищённое поле");
    expect(prompt).toContain('"readonly":true');
  });

  it("forces needs_input rather than guessing when source data is empty", () => {
    const prompt = makeBoundAiPrompt(manifest(), { ...context, sourceData: "" });

    expect(prompt).toContain("<ИСХОДНЫЕ ДАННЫЕ НЕ ПЕРЕДАНЫ>");
    expect(prompt).toContain("Не придумывай ФИО");
    expect(prompt).toContain("Обязательность поля не является данными");
    expect(prompt).toContain("Не используй null или пустую строку");
  });
});
