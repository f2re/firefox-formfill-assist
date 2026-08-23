import { describe, expect, it } from "vitest";
import {
  KNOWN_FORM_CACHE_MAX_ENTRIES,
  KNOWN_FORM_CACHE_RETENTION_MS,
  assessKnownForm,
  createEmptyKnownFormCache,
  createKnownFormEntry,
  pruneKnownFormCache,
  rememberKnownForm,
} from "../src/shared/form-cache";
import type { FillResult, FieldDescriptor, FormManifest } from "../src/shared/types";

function field(
  id: string,
  label: string,
  options: { name?: string; domId?: string; sensitive?: boolean; domPath?: string } = {},
): FieldDescriptor {
  return {
    id,
    type: options.sensitive ? "protected" : "text",
    label,
    required: true,
    disabled: false,
    readonly: false,
    sensitive: Boolean(options.sensitive),
    fingerprint: {
      tag: "input",
      inputType: options.sensitive ? "password" : "text",
      name: options.name,
      domId: options.domId,
      label,
      formIndex: 0,
      domPath: options.domPath ?? `form>${id}`,
    },
  };
}

function manifest(
  fingerprint = "form-v1",
  fields: FieldDescriptor[] = [field("F01", "Имя", { name: "name", domId: "name" })],
  page = "https://example.test/application?token=ignored#section",
): FormManifest {
  return {
    version: 1,
    page,
    pageFingerprint: fingerprint,
    createdAt: "2026-08-23T12:00:00.000Z",
    fields,
    unsupportedCrossOriginFrames: 0,
    mutationRevision: 0,
  };
}

const resultWithValues: FillResult = {
  startedAt: "2026-08-23T12:00:00.000Z",
  completedAt: "2026-08-23T12:00:01.000Z",
  fields: [
    {
      id: "F01",
      label: "Имя",
      status: "filled",
      requestedValue: "Очень секретное значение",
      actualValue: "Очень секретное значение",
    },
  ],
  filled: 1,
  same: 0,
  review: 0,
  errors: 0,
  skipped: 0,
  newFieldCount: 0,
};

describe("known form structure cache", () => {
  it("stores structure and counters without form values, query or fragment", () => {
    const entry = createKnownFormEntry(manifest(), resultWithValues, 1_000);
    const serialized = JSON.stringify(entry);

    expect(serialized).not.toContain("Очень секретное значение");
    expect(serialized).not.toContain("token=ignored");
    expect(serialized).not.toContain("#section");
    expect(serialized).not.toContain("domPath");
    expect(entry.pathname).toBe("/application");
    expect(entry.successCount).toBe(1);
  });

  it("recognizes an unchanged fingerprint and rebinds by strong structural identity, not cached id", () => {
    const original = manifest("same-fingerprint", [
      field("F01", "Имя", { name: "name", domId: "name" }),
      field("F02", "Организация", { name: "company", domId: "company" }),
    ]);
    const cache = rememberKnownForm(createEmptyKnownFormCache(), original, resultWithValues, 1_000);

    const current = manifest("same-fingerprint", [
      field("F91", "Имя", { name: "name", domId: "name", domPath: "completely>different>path" }),
      field("F92", "Организация", { name: "company", domId: "company", domPath: "another>path" }),
    ]);
    const assessment = assessKnownForm(cache, current, 2_000);

    expect(assessment.kind).toBe("recognized");
    if (assessment.kind !== "recognized") throw new Error("Expected recognized cache entry");
    expect(assessment.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cachedId: "F01", currentId: "F91" }),
        expect.objectContaining({ cachedId: "F02", currentId: "F92" }),
      ]),
    );
    expect(assessment.bindings.every((binding) => binding.confidence >= 0.85)).toBe(true);
  });

  it("rejects a changed form even at the same route", () => {
    const cache = rememberKnownForm(createEmptyKnownFormCache(), manifest("old-fingerprint"), undefined, 1_000);
    const changed = manifest("new-fingerprint", [
      field("F01", "Имя", { name: "name", domId: "name" }),
      field("F02", "Новая секция", { name: "new", domId: "new" }),
    ]);

    const assessment = assessKnownForm(cache, changed, 2_000);
    expect(assessment.kind).toBe("changed");
    if (assessment.kind === "changed") expect(assessment.reason).toContain("Количество полей изменилось");
  });

  it("refuses to rebind duplicate anonymous labels because the mapping is ambiguous", () => {
    const anonymous = [field("F01", "Телефон"), field("F02", "Телефон")];
    const cache = rememberKnownForm(createEmptyKnownFormCache(), manifest("duplicates", anonymous), undefined, 1_000);
    const current = manifest("duplicates", [field("F41", "Телефон"), field("F42", "Телефон")]);

    const assessment = assessKnownForm(cache, current, 2_000);
    expect(assessment.kind).toBe("changed");
    if (assessment.kind === "changed") expect(assessment.reason).toContain("Не удалось однозначно перепривязать");
  });

  it("does not recognize the same structure on a different route", () => {
    const cache = rememberKnownForm(createEmptyKnownFormCache(), manifest("same"), undefined, 1_000);
    const otherRoute = manifest("same", undefined, "https://example.test/other");
    expect(assessKnownForm(cache, otherRoute, 2_000)).toEqual({ kind: "unknown" });
  });

  it("prunes expired entries and enforces a small bounded cache", () => {
    let cache = createEmptyKnownFormCache();
    const now = 200 * 24 * 60 * 60 * 1000;
    for (let index = 0; index < KNOWN_FORM_CACHE_MAX_ENTRIES + 8; index += 1) {
      cache = rememberKnownForm(
        cache,
        manifest(`fingerprint-${index}`, undefined, `https://example.test/form-${index}`),
        undefined,
        now - index * 1_000,
      );
    }
    expect(cache.entries).toHaveLength(KNOWN_FORM_CACHE_MAX_ENTRIES);

    const expired = {
      ...cache,
      entries: [
        ...cache.entries,
        {
          ...cache.entries[0]!,
          key: "expired",
          lastUsedAt: new Date(now - KNOWN_FORM_CACHE_RETENTION_MS - 1).toISOString(),
        },
      ],
    };
    expect(pruneKnownFormCache(expired, now).entries.some((entry) => entry.key === "expired")).toBe(false);
  });
});
