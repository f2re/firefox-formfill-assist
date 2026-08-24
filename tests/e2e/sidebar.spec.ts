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
    const fakeManifest = {
      version: 1,
      page: "https://example.test/form",
      pageFingerprint: "fp-sidebar-smoke",
      createdAt: "2026-08-23T19:00:00.000Z",
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
          getManifest: () => ({ version: "0.4.2" }),
          sendMessage: async (message: { action?: string }) => {
            if (message?.action === "scan") return { ok: true, data: fakeManifest };
            if (message?.action === "ping") return { ok: true, data: { status: "READY" } };
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
          onChanged: {
            addListener: () => undefined,
            removeListener: () => undefined,
          },
        },
        tabs: {
          query: async () => [{ id: 7, windowId: 3 }],
          captureVisibleTab: async () =>
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7Z8AAAAASUVORK5CYII=",
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

test("production sidebar loads its relative bundles and exposes the guided flow", async ({ page }) => {
  const pageErrors: string[] = [];
  const httpErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  const response = await page.goto(`${baseUrl}/sidebar/index.html`, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);

  await expect(page.locator("#boot-fallback")).toHaveCount(0);
  await expect(page.locator(".ai-flow-title")).toHaveText("Заполнить форму с помощью ИИ");
  await expect(page.locator(".title")).toHaveText("FormFill Assistant");
  await expect(page.getByRole("button", { name: "1. Подготовить снимок и промпт" })).toBeVisible();

  await page.getByRole("button", { name: "1. Подготовить снимок и промпт" }).click();
  await expect(page.locator(".ai-flow-preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "3. Скопировать промпт" })).toBeVisible();
  await expect(page.locator("#ai-response-json")).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(httpErrors).toEqual([]);
});
