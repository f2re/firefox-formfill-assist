import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";

interface TestField {
  id: string;
  label: string;
  type: string;
  sensitive: boolean;
}

interface TestManifest {
  pageFingerprint: string;
  fields: TestField[];
}

interface SessionPage {
  pageNumber: number;
  pageFingerprint: string;
}

interface SessionState {
  currentPage: number;
  pages: SessionPage[];
}

interface SessionHarnessWindow extends Window {
  __formfillE2E: {
    scan(): TestManifest;
    rescan(): TestManifest;
    startSession(manifest: TestManifest): SessionState;
    sessionRelation(manifest: TestManifest): { kind: string; suggestedPage?: number; page?: SessionPage };
    continueSession(manifest: TestManifest): SessionState;
    currentSessionPage(): SessionPage | null;
    normalizeSessionRequest(request: unknown, manifest: TestManifest): unknown;
    sessionGptPacket(manifest: TestManifest): string;
  };
}

let harnessSource = "";

test.beforeAll(async () => {
  harnessSource = await readFile(".e2e-dist/harness.js", "utf8");
});

async function installHarness(page: Page): Promise<void> {
  await page.addScriptTag({ content: harnessSource });
}

async function scan(page: Page): Promise<TestManifest> {
  return page.evaluate(() => (window as unknown as SessionHarnessWindow).__formfillE2E.scan());
}

function fieldByLabel(manifest: TestManifest, label: string): TestField {
  const field = manifest.fields.find((candidate) => candidate.label.includes(label));
  if (!field) throw new Error(`Field not found: ${label}`);
  return field;
}

test("multi-page session requires explicit continuation and rejects another page namespace", async ({ page }) => {
  await page.setContent(`<label for="name">Имя</label><input id="name" name="name">`);
  await installHarness(page);

  const page1 = await scan(page);
  const page1Field = fieldByLabel(page1, "Имя");
  const session1 = await page.evaluate(
    (manifest) => (window as unknown as SessionHarnessWindow).__formfillE2E.startSession(manifest),
    page1,
  );
  expect(session1.currentPage).toBe(1);

  const packet1 = await page.evaluate(
    (manifest) => (window as unknown as SessionHarnessWindow).__formfillE2E.sessionGptPacket(manifest),
    page1,
  );
  expect(packet1).toContain(`P1-${page1Field.id}`);

  const localPage1 = await page.evaluate(
    ({ manifest, id }) =>
      (window as unknown as SessionHarnessWindow).__formfillE2E.normalizeSessionRequest(
        { version: 1, pageFingerprint: manifest.pageFingerprint, fields: { [`P1-${id}`]: "Иван" } },
        manifest,
      ),
    { manifest: page1, id: page1Field.id },
  ) as any;
  expect(localPage1.fields[page1Field.id]).toBe("Иван");

  await page.evaluate(() => {
    history.pushState({}, "", "/step-2");
    document.body.innerHTML = '<label for="org">Организация</label><input id="org" name="organization">';
  });
  const page2 = await page.evaluate(() => (window as unknown as SessionHarnessWindow).__formfillE2E.rescan());
  expect(page2.pageFingerprint).not.toBe(page1.pageFingerprint);

  const relation = await page.evaluate(
    (manifest) => (window as unknown as SessionHarnessWindow).__formfillE2E.sessionRelation(manifest),
    page2,
  );
  expect(relation).toMatchObject({ kind: "candidate", suggestedPage: 2 });

  const page2Field = fieldByLabel(page2, "Организация");
  const rejectedBeforeContinue = await page.evaluate(
    ({ manifest, id }) => {
      try {
        (window as unknown as SessionHarnessWindow).__formfillE2E.normalizeSessionRequest(
          { version: 1, pageFingerprint: manifest.pageFingerprint, fields: { [`P2-${id}`]: "ООО Пример" } },
          manifest,
        );
        return "accepted";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    { manifest: page2, id: page2Field.id },
  );
  expect(rejectedBeforeContinue).toContain("SESSION_PAGE_CHANGED");

  const session2 = await page.evaluate(
    (manifest) => (window as unknown as SessionHarnessWindow).__formfillE2E.continueSession(manifest),
    page2,
  );
  expect(session2.currentPage).toBe(2);

  const packet2 = await page.evaluate(
    (manifest) => (window as unknown as SessionHarnessWindow).__formfillE2E.sessionGptPacket(manifest),
    page2,
  );
  expect(packet2).toContain(`P2-${page2Field.id}`);

  const localPage2 = await page.evaluate(
    ({ manifest, id }) =>
      (window as unknown as SessionHarnessWindow).__formfillE2E.normalizeSessionRequest(
        { version: 1, pageFingerprint: manifest.pageFingerprint, fields: { [`P2-${id}`]: "ООО Пример" } },
        manifest,
      ),
    { manifest: page2, id: page2Field.id },
  ) as any;
  expect(localPage2.fields[page2Field.id]).toBe("ООО Пример");

  const rejectedOldPage = await page.evaluate(
    ({ manifest, id }) => {
      try {
        (window as unknown as SessionHarnessWindow).__formfillE2E.normalizeSessionRequest(
          { version: 1, pageFingerprint: manifest.pageFingerprint, fields: { [`P1-${id}`]: "Чужое" } },
          manifest,
        );
        return "accepted";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    { manifest: page2, id: page2Field.id },
  );
  expect(rejectedOldPage).toContain("SESSION_PAGE_MISMATCH");
});
