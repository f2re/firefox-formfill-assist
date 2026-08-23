import { describe, expect, it } from "vitest";
import { makeGptFeedbackReport } from "../src/shared/report";
import type { FillResult, FormManifest } from "../src/shared/types";

const manifest: FormManifest = {
  version: 1,
  page: "https://example.test/form",
  pageFingerprint: "abc123",
  createdAt: "2026-08-23T12:00:00.000Z",
  mutationRevision: 0,
  unsupportedCrossOriginFrames: 0,
  fields: [
    {
      id: "F01",
      type: "select",
      label: "Регион",
      required: true,
      disabled: false,
      readonly: false,
      sensitive: false,
      options: ["Санкт-Петербург", "Москва"],
      fingerprint: { tag: "select", inputType: "select", label: "Регион", formIndex: 0, domPath: "form>select" },
    },
    {
      id: "F02",
      type: "protected",
      label: "Защищённое поле",
      required: false,
      disabled: false,
      readonly: false,
      sensitive: true,
      fingerprint: { tag: "input", inputType: "password", label: "Пароль", formIndex: 0, domPath: "form>input" },
    },
  ],
};

const result: FillResult = {
  startedAt: "2026-08-23T12:00:00.000Z",
  completedAt: "2026-08-23T12:00:01.000Z",
  filled: 0,
  same: 0,
  review: 1,
  errors: 1,
  skipped: 0,
  newFieldCount: 0,
  fields: [
    {
      id: "F01",
      label: "Регион",
      status: "review",
      requestedValue: "Ленинградская область",
      actualValue: "",
      message: "Нужно выбрать вариант.",
    },
    {
      id: "F02",
      label: "Защищённое поле",
      status: "error",
      requestedValue: "top-secret",
      actualValue: "top-secret",
      message: "Чувствительное поле заблокировано.",
    },
  ],
};

describe("GPT feedback report", () => {
  it("includes useful failed options but never serializes sensitive fields", () => {
    const report = makeGptFeedbackReport(manifest, result);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({
      id: "F01",
      requested: "Ленинградская область",
      available: ["Санкт-Петербург", "Москва"],
    });
    expect(JSON.stringify(report)).not.toContain("top-secret");
    expect(JSON.stringify(report)).not.toContain("F02");
  });
});
