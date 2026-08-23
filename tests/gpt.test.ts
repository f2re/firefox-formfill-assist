import { describe, expect, it } from "vitest";
import { makeGptPacket } from "../src/shared/gpt";
import type { FieldDescriptor, FormManifest } from "../src/shared/types";

function field(overrides: Partial<FieldDescriptor> & Pick<FieldDescriptor, "id" | "type" | "label">): FieldDescriptor {
  return {
    id: overrides.id,
    type: overrides.type,
    label: overrides.label,
    required: false,
    disabled: false,
    readonly: false,
    sensitive: false,
    fingerprint: {
      tag: "input",
      label: overrides.label,
      formIndex: 0,
      domPath: overrides.id,
    },
    ...overrides,
  };
}

function manifest(): FormManifest {
  return {
    version: 1,
    page: "https://example.test/form?private=query",
    pageFingerprint: "fp-test-123",
    createdAt: "2026-08-23T12:00:00.000Z",
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

describe("makeGptPacket", () => {
  it("builds a screenshot-aware strict prompt for supported field ids", () => {
    const prompt = makeGptPacket(manifest());

    expect(prompt).toContain("приложенные скриншоты/изображения/документы");
    expect(prompt).toContain("Fxx или I<n>-Fxx");
    expect(prompt).toContain('"I1-F02"');
    expect(prompt).toContain('"pageFingerprint": "fp-test-123"');
    expect(prompt).toContain("Верни только один JSON object");
    expect(prompt).toContain("JSON.parse");
    expect(prompt).toContain('"options": [');
    expect(prompt).toContain('"readonly": true');
    expect(prompt).toContain('"fields": {}');
  });

  it("does not leak sensitive labels, URL query values, or fake fill values", () => {
    const prompt = makeGptPacket(manifest());

    expect(prompt).not.toContain("Пароль");
    expect(prompt).toContain("Защищённое поле");
    expect(prompt).not.toContain("private=query");
    expect(prompt).not.toContain("пример текстового значения");
  });
});
