import { describe, expect, it } from "vitest";
import { parseFillRequest } from "../src/shared/schema";
import {
  acceptManifestInSession,
  createFormSession,
  currentSessionPage,
  isFormSessionExpired,
  normalizeSessionFillRequest,
  qualifySessionFieldId,
  recordSessionFillResult,
  relationToSession,
} from "../src/shared/session";
import { makeGptPacket } from "../src/shared/gpt";
import type { FillResult, FormManifest } from "../src/shared/types";

function manifest(fingerprint: string, page = "/step-1"): FormManifest {
  return {
    version: 1,
    page: `https://example.test${page}`,
    pageFingerprint: fingerprint,
    createdAt: "2026-08-23T12:00:00.000Z",
    unsupportedCrossOriginFrames: 0,
    mutationRevision: 0,
    fields: [
      {
        id: "F01",
        type: "text",
        label: "Имя",
        required: true,
        disabled: false,
        readonly: false,
        sensitive: false,
        fingerprint: {
          tag: "input",
          inputType: "text",
          name: "name",
          label: "Имя",
          formIndex: 0,
          domPath: "form>input",
        },
      },
    ],
  };
}

const fillResult: FillResult = {
  startedAt: "2026-08-23T12:00:01.000Z",
  completedAt: "2026-08-23T12:00:02.000Z",
  fields: [{ id: "F01", label: "Имя", status: "filled", requestedValue: "Иван", actualValue: "Иван" }],
  filled: 1,
  same: 0,
  review: 0,
  errors: 0,
  skipped: 0,
  newFieldCount: 0,
};

describe("multi-page form sessions", () => {
  it("requires explicit accept before a new fingerprint becomes page 2", () => {
    const page1 = manifest("page-one", "/step-1");
    const page2 = manifest("page-two", "/step-2");
    let session = createFormSession(1_000, "session-test");

    expect(relationToSession(session, page1)).toEqual({ kind: "unbound", suggestedPage: 1 });
    session = acceptManifestInSession(session, page1, 2_000);
    expect(currentSessionPage(session)?.pageNumber).toBe(1);

    expect(relationToSession(session, page2)).toEqual({ kind: "candidate", suggestedPage: 2 });
    expect(currentSessionPage(session)?.pageFingerprint).toBe("page-one");

    session = acceptManifestInSession(session, page2, 3_000);
    expect(currentSessionPage(session)).toMatchObject({ pageNumber: 2, pageFingerprint: "page-two" });
    expect(session.pages).toHaveLength(2);
  });

  it("normalizes only identifiers from the active session page", () => {
    const page1 = manifest("page-one");
    const session = acceptManifestInSession(createFormSession(1_000, "s"), page1, 2_000);
    const parsed = parseFillRequest(
      JSON.stringify({ version: 1, pageFingerprint: "page-one", fields: { "P1-F01": "Иван" } }),
    );

    expect(normalizeSessionFillRequest(parsed, session, page1)).toEqual({
      version: 1,
      pageFingerprint: "page-one",
      fields: { F01: "Иван" },
    });

    const wrongPage = parseFillRequest(
      JSON.stringify({ version: 1, pageFingerprint: "page-one", fields: { "P2-F01": "Чужое" } }),
    );
    expect(() => normalizeSessionFillRequest(wrongPage, session, page1)).toThrow("SESSION_PAGE_MISMATCH");
  });

  it("round-trips iframe field identity through the session namespace", () => {
    const page1 = manifest("page-one");
    page1.fields.push({
      ...page1.fields[0]!,
      id: "I1-F02",
      label: "Поле iframe",
      fingerprint: { ...page1.fields[0]!.fingerprint, label: "Поле iframe", domPath: "iframe[1]>input" },
    });
    const session = acceptManifestInSession(createFormSession(1_000, "s"), page1, 2_000);
    const parsed = parseFillRequest(
      JSON.stringify({ version: 1, pageFingerprint: "page-one", fields: { "P1-I1-F02": "Значение" } }),
    );

    expect(qualifySessionFieldId(1, "I1-F02")).toBe("P1-I1-F02");
    expect(normalizeSessionFillRequest(parsed, session, page1)).toEqual({
      version: 1,
      pageFingerprint: "page-one",
      fields: { "I1-F02": "Значение" },
    });
  });

  it("rejects unqualified Fxx while a session is active", () => {
    const page1 = manifest("page-one");
    const session = acceptManifestInSession(createFormSession(1_000, "s"), page1, 2_000);
    const parsed = parseFillRequest(JSON.stringify({ version: 1, fields: { F01: "Иван" } }));
    expect(() => normalizeSessionFillRequest(parsed, session, page1)).toThrow("ожидаются идентификаторы");
  });

  it("records only per-page counts, never values", () => {
    const page1 = manifest("page-one");
    let session = acceptManifestInSession(createFormSession(1_000, "s"), page1, 2_000);
    session = recordSessionFillResult(session, page1, fillResult, 3_000);

    expect(session.pages[0]).toMatchObject({ filled: 1, same: 0, review: 0, errors: 0 });
    expect(JSON.stringify(session)).not.toContain("Иван");
  });

  it("generates Pn field manifest and expires idle sessions", () => {
    const page1 = manifest("page-one");
    const session = acceptManifestInSession(createFormSession(1_000, "session-visible"), page1, 2_000);
    const packet = makeGptPacket(page1, { sessionId: session.id, pageNumber: 1 });

    expect(qualifySessionFieldId(1, "F01")).toBe("P1-F01");
    expect(packet).toContain('"P1-F01"');
    expect(packet).toContain('"session":{"id":"session-visible","page":1,"fieldPrefix":"P1-"}');
    expect(isFormSessionExpired(session, 2_000 + 11 * 60 * 60 * 1000)).toBe(false);
    expect(isFormSessionExpired(session, 2_000 + 13 * 60 * 60 * 1000)).toBe(true);
  });
});
