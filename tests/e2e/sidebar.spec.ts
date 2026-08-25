import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { test, expect } from "@playwright/test";

const distRoot = resolve(process.cwd(), "dist");
let server: Server;
let baseUrl = "";

const CONTENT_TYPE: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "sidebar/index.html";
      const filePath = resolve(distRoot, relative);
      if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
        response.writeHead(403).end("forbidden");
        return;
      }

      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) {
        response.writeHead(404).end("not found");
        return;
      }

      response.writeHead(200, {
        "content-type": CONTENT_TYPE[extname(filePath)] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(await readFile(filePath));
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : "server error");
    }
  });

  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveReady());
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start sidebar fixture server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => error ? reject(error) : resolveClosed());
  });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const stored: Record<string, unknown> = {};
    let clipboardText = "";
    const noEvent = { addListener: () => undefined, removeListener: () => undefined };
    const fakeManifest = {
      version: 1,
      page: "https://example.test/callback",
      pageFingerprint: "2e940ecf",
      createdAt: "2026-08-25T05:00:00.000Z",
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
          fingerprint: { tag: "input", label: "Имя", formIndex: 0, domPath: "form/input[1]" },
        },
        {
          id: "F02",
          type: "tel",
          label: "Телефон",
          required: true,
          disabled: false,
          readonly: false,
          sensitive: false,
          fingerprint: { tag: "input", label: "Телефон", formIndex: 0, domPath: "form/input[2]" },
        },
      ],
    };

    const storageGet = async (keys?: string | string[] | Record<string, unknown>) => {
      if (typeof keys === "string") return { [keys]: stored[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, stored[key]]));
      if (keys && typeof keys === "object") {
        return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, stored[key] ?? fallback]));
      }
      return { ...stored };
    };

    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        runtime: {
          getManifest: () => ({ version: "0.5.0" }),
          sendMessage: async (message: { action?: string }) => {
            if (message?.action === "scan") return { ok: true, data: fakeManifest };
            if (message?.action === "ping") {
              return { ok: true, data: { status: "ready", url: fakeManifest.page } };
            }
            if (message?.action === "preview") {
              return {
                ok: true,
                data: {
                  pageFingerprint: fakeManifest.pageFingerprint,
                  pageMismatch: false,
                  items: [
                    {
                      id: "F01",
                      label: "Имя",
                      currentValue: "",
                      requestedValue: "Иван Петров",
                      status: "ok",
                    },
                    {
                      id: "F02",
                      label: "Телефон",
                      currentValue: "",
                      requestedValue: "+79990000000",
                      status: "ok",
                    },
                  ],
                  counts: { ok: 2, review: 0, error: 0, same: 0, skip: 0 },
                },
              };
            }
            if (message?.action === "fill") {
              return {
                ok: true,
                data: {
                  startedAt: "2026-08-25T05:01:00.000Z",
                  completedAt: "2026-08-25T05:01:00.100Z",
                  fields: [],
                  filled: 2,
                  same: 0,
                  review: 0,
                  errors: 0,
                  skipped: 0,
                  newFieldCount: 0,
                },
              };
            }
            if (message?.action === "undo") return { ok: true, data: { restored: 2, errors: 0 } };
            if (message?.action === "toggleOverlay") return { ok: true, data: true };
            return { ok: true, data: null };
          },
        },
        storage: {
          local: {
            get: storageGet,
            set: async (values: Record<string, unknown>) => Object.assign(stored, values),
            remove: async (keys: string | string[]) => {
              for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
            },
          },
        },
        tabs: {
          query: async () => [{
            id: 7,
            windowId: 3,
            title: "Callback form",
            url: fakeManifest.page,
          }],
          captureVisibleTab: async () =>
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7Z8AAAAASUVORK5CYII=",
          onActivated: noEvent,
          onUpdated: noEvent,
          onRemoved: noEvent,
        },
        scripting: {
          executeScript: async () => [],
        },
        clipboard: {
          setImageData: async () => undefined,
        },
      },
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardText,
        writeText: async (value: string) => { clipboardText = value; },
      },
    });
  });
});

test("production sidebar boots and completes the capture-bound v2 workflow", async ({ page }) => {
  const pageErrors: string[] = [];
  const httpErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  const response = await page.goto(`${baseUrl}/sidebar/index.html`, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  await expect(page.locator("#boot-fallback")).toHaveCount(0);
  await expect(page.locator(".brand-title")).toHaveText("FormFill Assistant");
  await expect(page.locator(".version")).toHaveText("v0.5.0");
  await expect(page.locator(".page-card.ready")).toContainText("2 полей");
  await expect(page.getByRole("button", { name: "Подготовить снимок и промпт" })).toBeVisible();

  await page.locator("#source-data-before").fill("Имя: Иван Петров\nТелефон: +79990000000");
  await page.getByRole("button", { name: "Подготовить снимок и промпт" }).click();
  await expect(page.locator(".screenshot-preview")).toBeVisible();
  await expect(page.locator(".binding-strip")).toContainText("fingerprint 2e940ecf");

  await page.getByRole("button", { name: /Скопировать промпт/ }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt.length).toBeLessThan(8_000);
  expect(prompt).toContain("контракт ответа v2");
  expect(prompt).toContain("Имя: Иван Петров");
  expect(prompt).not.toContain("private=query");
  const captureId = /- captureId: ([A-Za-z0-9_-]+)/.exec(prompt)?.[1];
  expect(captureId).toBeTruthy();

  await page.locator("#ai-response").fill(JSON.stringify({
    version: 2,
    captureId,
    pageFingerprint: "2e940ecf",
    status: "ready",
    fields: {
      F01: "Иван Петров",
      F02: "+79990000000",
    },
    questions: [],
    warnings: [],
  }));
  await page.getByRole("button", { name: "Проверить ответ ИИ" }).click();

  await expect(page.locator("#preview-card")).toBeVisible();
  await expect(page.locator(".preview-item")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Заполнить 2 безопасных полей" })).toBeEnabled();
  await page.getByRole("button", { name: "Заполнить 2 безопасных полей" }).click();
  await expect(page.locator("#result-card")).toContainText("2 изменено");

  expect(pageErrors).toEqual([]);
  expect(httpErrors).toEqual([]);
});

test("production HTML uses one deterministic non-module sidebar bundle", async ({ page }) => {
  await page.goto(`${baseUrl}/sidebar/index.html`, { waitUntil: "networkidle" });
  const scripts = await page.locator("script[src]").evaluateAll((nodes) =>
    nodes.map((node) => ({ src: node.getAttribute("src"), type: node.getAttribute("type") })),
  );
  expect(scripts).toEqual([{ src: "./sidebar.js", type: null }]);
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute("href", "./sidebar.css");
});
