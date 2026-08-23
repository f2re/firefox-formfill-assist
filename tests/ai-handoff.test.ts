import { describe, expect, it } from "vitest";
import { aiCaptureFilename, planAiHandoff } from "../src/shared/ai-handoff";
import { acceptManifestInSession, createFormSession } from "../src/shared/session";
import type { FormManifest } from "../src/shared/types";

function manifest(fingerprint = "fp-page-1", path = "/form"): FormManifest {
  return {
    version: 1,
    page: `https://example.test${path}`,
    pageFingerprint: fingerprint,
    createdAt: "2026-08-23T13:00:00.000Z",
    unsupportedCrossOriginFrames: 0,
    mutationRevision: 0,
    fields: [
      {
        id: "F01",
        type: "text",
        label: "Фамилия",
        required: true,
        disabled: false,
        readonly: false,
        sensitive: false,
        fingerprint: { tag: "input", label: "Фамилия", formIndex: 0, domPath: "#surname" },
      },
    ],
  };
}

describe("planAiHandoff", () => {
  it("creates a normal Fxx prompt without a session", () => {
    const plan = planAiHandoff(manifest());
    expect(plan.fieldNamespace).toBe("Fxx / I<n>-Fxx");
    expect(plan.pageFingerprint).toBe("fp-page-1");
    expect(plan.prompt).toContain('"id": "F01"');
    expect(plan.prompt).not.toContain('"fieldPrefix"');
  });

  it("binds the prompt to the active Pn-Fxx session page", () => {
    const page = manifest();
    const session = acceptManifestInSession(createFormSession(Date.now(), "session-test"), page);
    const plan = planAiHandoff(page, session);

    expect(plan.pageNumber).toBe(1);
    expect(plan.fieldNamespace).toBe("P1-Fxx");
    expect(plan.prompt).toContain('"id": "P1-F01"');
    expect(plan.prompt).toContain('"id": "session-test"');
  });

  it("refuses to prepare a prompt for an unconfirmed next page", () => {
    const first = manifest();
    const session = acceptManifestInSession(createFormSession(Date.now(), "session-test"), first);
    const next = manifest("fp-page-2", "/form/step-2");

    expect(() => planAiHandoff(next, session)).toThrow(/Продолжить текущую сессию/);
  });
});

describe("aiCaptureFilename", () => {
  it("creates a filesystem-safe page-specific PNG name", () => {
    expect(aiCaptureFilename("2026-08-23T13:44:05.123Z", 2)).toBe(
      "formfill-ai-p2-2026-08-23T13-44-05-123Z.png",
    );
  });
});
