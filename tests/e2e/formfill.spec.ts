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

interface HarnessWindow extends Window {
  __formfillE2E: {
    scan(): TestManifest;
    rescan(): TestManifest;
    preview(request: unknown): unknown;
    fill(request: unknown): Promise<any>;
    undo(): Promise<any>;
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
  return page.evaluate(() => (window as unknown as HarnessWindow).__formfillE2E.scan());
}

function fieldByLabel(manifest: TestManifest, label: string): TestField {
  const field = manifest.fields.find((candidate) => candidate.label.includes(label));
  if (!field) throw new Error(`Field not found: ${label}`);
  return field;
}

test("fills standard controls, verifies actual state and never submits", async ({ page }) => {
  await page.setContent(`
    <form id="application">
      <label for="surname">Фамилия</label><input id="surname" value="">
      <label for="birth">Дата рождения</label><input id="birth" type="date">
      <label for="region">Регион</label>
      <select id="region"><option value="">—</option><option value="spb">Санкт-Петербург</option><option value="msk">Москва</option></select>
      <label><input id="agree" type="checkbox"> Согласен</label>
      <label><input id="male" type="radio" name="sex" value="male"> Мужской</label>
      <label><input id="female" type="radio" name="sex" value="female"> Женский</label>
      <button id="submit" type="submit">Отправить</button>
    </form>
    <script>
      window.__submitCount = 0;
      window.__submitClickCount = 0;
      document.getElementById('application').addEventListener('submit', event => {
        event.preventDefault();
        window.__submitCount += 1;
      });
      document.getElementById('submit').addEventListener('click', () => window.__submitClickCount += 1);
    </script>
  `);
  await installHarness(page);
  const manifest = await scan(page);
  const surname = fieldByLabel(manifest, "Фамилия");
  const birth = fieldByLabel(manifest, "Дата рождения");
  const region = fieldByLabel(manifest, "Регион");
  const agree = fieldByLabel(manifest, "Согласен");
  const sex = fieldByLabel(manifest, "Мужской");

  const request = {
    version: 1,
    pageFingerprint: manifest.pageFingerprint,
    fields: {
      [surname.id]: "Иванов",
      [birth.id]: "1985-03-12",
      [region.id]: "Санкт-Петербург",
      [agree.id]: true,
      [sex.id]: "Женский",
    },
    submit: true,
  };

  const preview = await page.evaluate(
    (payload) => (window as unknown as HarnessWindow).__formfillE2E.preview(payload),
    request,
  ) as any;
  expect(preview.pageMismatch).toBe(false);
  expect(preview.items.filter((item: any) => item.status === "error")).toEqual([]);

  const result = await page.evaluate(
    (payload) => (window as unknown as HarnessWindow).__formfillE2E.fill(payload),
    request,
  );
  expect(result.errors).toBe(0);
  expect(result.review).toBe(0);
  expect(result.filled).toBeGreaterThanOrEqual(5);

  await expect(page.locator("#surname")).toHaveValue("Иванов");
  await expect(page.locator("#birth")).toHaveValue("1985-03-12");
  await expect(page.locator("#region")).toHaveValue("spb");
  await expect(page.locator("#agree")).toBeChecked();
  await expect(page.locator("#female")).toBeChecked();
  expect(await page.evaluate(() => (window as any).__submitCount)).toBe(0);
  expect(await page.evaluate(() => (window as any).__submitClickCount)).toBe(0);
});

test("unknown Fxx and page mismatch cannot redirect writes", async ({ page }) => {
  await page.setContent(`<label for="name">Имя</label><input id="name" value="Исходное">`);
  await installHarness(page);
  const manifest = await scan(page);
  const preview = await page.evaluate(
    (payload) => (window as unknown as HarnessWindow).__formfillE2E.preview(payload),
    { version: 1, pageFingerprint: "definitely-another-page", fields: { F999: "Чужое значение" } },
  ) as any;

  expect(preview.pageMismatch).toBe(true);
  expect(preview.counts.error).toBe(1);

  const result = await page.evaluate(
    (payload) => (window as unknown as HarnessWindow).__formfillE2E.fill(payload),
    { version: 1, fields: { F999: "Чужое значение" } },
  );
  expect(result.errors).toBe(1);
  await expect(page.locator("#name")).toHaveValue("Исходное");
  expect(manifest.fields).toHaveLength(1);
});

test("controlled input events, dependent fields and undo work in Firefox", async ({ page }) => {
  await page.setContent(`
    <label for="controlled">Контролируемое поле</label><input id="controlled" value="старое">
    <label for="country">Страна</label><select id="country"><option value="">—</option><option value="ru">Россия</option></select>
    <div id="dependent"></div>
    <script>
      window.__model = 'старое';
      window.__inputEvents = 0;
      const controlled = document.getElementById('controlled');
      controlled.addEventListener('input', () => {
        window.__model = controlled.value;
        window.__inputEvents += 1;
      });
      document.getElementById('country').addEventListener('change', event => {
        if (event.target.value === 'ru' && !document.getElementById('region-new')) {
          document.getElementById('dependent').innerHTML = '<label for="region-new">Новый регион</label><input id="region-new">';
        }
      });
    </script>
  `);
  await installHarness(page);
  const manifest = await scan(page);
  const controlled = fieldByLabel(manifest, "Контролируемое поле");
  const country = fieldByLabel(manifest, "Страна");

  const result = await page.evaluate(
    (payload) => (window as unknown as HarnessWindow).__formfillE2E.fill(payload),
    { version: 1, fields: { [controlled.id]: "новое", [country.id]: "Россия" } },
  );
  expect(result.errors).toBe(0);
  expect(result.newFieldCount).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => (window as any).__model)).toBe("новое");
  expect(await page.evaluate(() => (window as any).__inputEvents)).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#region-new")).toBeVisible();

  const undo = await page.evaluate(() => (window as unknown as HarnessWindow).__formfillE2E.undo());
  expect(undo.errors).toBe(0);
  await expect(page.locator("#controlled")).toHaveValue("старое");
});

test("duplicate labels remain distinct and sensitive fields are blocked", async ({ page }) => {
  await page.setContent(`
    <div><label for="phone-a">Телефон</label><input id="phone-a" name="mobile"></div>
    <div><label for="phone-b">Телефон</label><input id="phone-b" name="work"></div>
    <div><label for="password">Пароль</label><input id="password" type="password"></div>
  `);
  await installHarness(page);
  const manifest = await scan(page);
  const phones = manifest.fields.filter((field) => field.label === "Телефон");
  expect(phones).toHaveLength(2);
  expect(phones[0]!.id).not.toBe(phones[1]!.id);
  const password = fieldByLabel(manifest, "Пароль");
  expect(password.sensitive).toBe(true);

  const result = await page.evaluate(
    (payload) => (window as unknown as HarnessWindow).__formfillE2E.fill(payload),
    {
      version: 1,
      fields: {
        [phones[0]!.id]: "+79990000001",
        [phones[1]!.id]: "+79990000002",
        [password.id]: "secret",
      },
    },
  );
  expect(result.filled).toBe(2);
  expect(result.errors).toBe(1);
  await expect(page.locator("#phone-a")).toHaveValue("+79990000001");
  await expect(page.locator("#phone-b")).toHaveValue("+79990000002");
  await expect(page.locator("#password")).toHaveValue("");
});

test("scanner reaches same-origin iframe and open Shadow DOM", async ({ page }) => {
  await page.setContent(`
    <iframe id="same" srcdoc="<label><span>Поле iframe</span><input id='inside'></label>"></iframe>
    <div id="shadow-host"></div>
    <script>
      const shadow = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
      shadow.innerHTML = '<label><span>Поле Shadow DOM</span><input id="shadow-input"></label>';
    </script>
  `);
  await page.locator("#same").contentFrame().locator("#inside").waitFor();
  await installHarness(page);
  const manifest = await scan(page);
  expect(manifest.fields.some((field) => field.label.includes("Поле iframe"))).toBe(true);
  expect(manifest.fields.some((field) => field.label.includes("Поле Shadow DOM"))).toBe(true);
});
