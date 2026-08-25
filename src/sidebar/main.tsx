import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  FillRequest,
  FillResult,
  FormManifest,
  PreviewItem,
  PreviewResult,
  RpcResponse,
  UndoResult,
} from "../shared/types";
import {
  parseAiFillResponse,
  validateAiFillResponse,
  type AiResponseDecision,
} from "../shared/ai-response";
import { makeBoundAiPrompt, makePortableAiPromptTemplate } from "../shared/gpt";
import { aiCaptureFilename } from "../shared/ai-handoff";

const STATUS_LABEL: Record<PreviewItem["status"], string> = {
  ok: "Готово",
  review: "Проверить",
  error: "Ошибка",
  same: "Уже совпадает",
  skip: "Пропуск",
};

const ADVANCED_STORAGE_KEY = "formfillAdvancedUi";
const MAX_PREVIEW_ITEMS = 60;

type TabAction = "ping" | "scan" | "toggleOverlay" | "highlightProblems" | "preview" | "fill" | "undo";
type BusyAction = "scan" | "capture" | "copy-image" | "copy-prompt" | "review" | "fill" | "undo" | "diagnostics" | null;

interface ActiveTab extends browser.tabs.Tab {
  id: number;
  windowId: number;
}

interface CapturePacket {
  captureId: string;
  tabId: number;
  windowId: number;
  title: string;
  pageUrl: string;
  capturedAt: string;
  dataUrl: string;
  filename: string;
  manifest: FormManifest;
  screenshotCopied: boolean;
}

interface PageSummary {
  tabId: number;
  title: string;
  pageUrl: string;
  manifest: FormManifest;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Неизвестная ошибка расширения.";
}

async function callTab<T>(action: TabAction, payload?: unknown): Promise<T> {
  const response = (await browser.runtime.sendMessage({
    scope: "tab",
    action,
    payload,
  })) as RpcResponse<T>;

  if (!response?.ok) {
    throw new Error(response?.error || "Расширение не получило ответ от страницы.");
  }
  return response.data as T;
}

async function activeTab(): Promise<ActiveTab> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== "number" || typeof tab.windowId !== "number") {
    throw new Error("Firefox не сообщил активную вкладку. Переключитесь на страницу формы и повторите.");
  }
  return tab as ActiveTab;
}

async function scanActivePage(): Promise<PageSummary> {
  const tab = await activeTab();
  const manifest = await callTab<FormManifest>("scan");
  return {
    tabId: tab.id,
    title: tab.title?.trim() || pageHost(manifest.page),
    pageUrl: manifest.page,
    manifest,
  };
}

async function togglePrivacyMasks(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["capture-mask.js"],
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function copyPng(dataUrl: string): Promise<void> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("Не удалось прочитать подготовленный PNG.");
  const buffer = await response.arrayBuffer();
  await browser.clipboard.setImageData(buffer, "png");
}

function downloadPng(dataUrl: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function createCaptureId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const random = new Uint32Array(4);
  crypto.getRandomValues(random);
  return `capture-${Date.now().toString(36)}-${Array.from(random, (value) => value.toString(36)).join("")}`;
}

function pageHost(page: string): string {
  try {
    return new URL(page).host || page;
  } catch {
    return page;
  }
}

function pagePath(page: string): string {
  try {
    const url = new URL(page);
    return `${url.origin}${url.pathname}`;
  } catch {
    return page;
  }
}

function shortText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 110 ? `${text.slice(0, 107)}…` : text;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function scrollTo(id: string): void {
  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

function stageNumber(packet: CapturePacket | null, responseText: string, preview: PreviewResult | null, result: FillResult | null): number {
  if (result) return 5;
  if (preview) return 4;
  if (responseText.trim()) return 3;
  if (packet) return 2;
  return 1;
}

function App() {
  const version = browser.runtime.getManifest().version;
  const [page, setPage] = useState<PageSummary | null>(null);
  const [packet, setPacket] = useState<CapturePacket | null>(null);
  const [sourceData, setSourceData] = useState("");
  const [responseText, setResponseText] = useState("");
  const [request, setRequest] = useState<FillRequest | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<FillResult | null>(null);
  const [aiDecision, setAiDecision] = useState<AiResponseDecision | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [staleReason, setStaleReason] = useState("");
  const [status, setStatus] = useState("Проверяем текущую страницу…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<BusyAction>("scan");
  const [advanced, setAdvanced] = useState(false);
  const responseRef = useRef<HTMLTextAreaElement>(null);

  const prompt = useMemo(() => {
    if (!packet) return "";
    return makeBoundAiPrompt(packet.manifest, {
      captureId: packet.captureId,
      capturedAt: packet.capturedAt,
      sourceData,
    });
  }, [packet, sourceData]);

  const stage = stageNumber(packet, responseText, preview, result);
  const currentTabIsForm = Boolean(packet && activeTabId === packet.tabId);
  const protectedCount = page?.manifest.fields.filter((field) => field.sensitive || field.type === "protected").length ?? 0;
  const requiredCount = page?.manifest.fields.filter((field) => field.required).length ?? 0;

  const run = async (action: Exclude<BusyAction, null>, work: () => Promise<void>): Promise<void> => {
    setBusy(action);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(messageFrom(cause));
    } finally {
      setBusy(null);
    }
  };

  const refreshPage = async (quiet = false): Promise<PageSummary | null> => {
    if (!quiet) {
      setBusy("scan");
      setError("");
      setStatus("Проверяем текущую страницу…");
    }
    try {
      const next = await scanActivePage();
      setPage(next);
      setActiveTabId(next.tabId);
      if (!quiet) {
        setStatus(
          next.manifest.fields.length
            ? `Форма найдена: ${next.manifest.fields.length} полей. Можно подготовить пакет для ИИ.`
            : "На видимой странице не найдено доступных полей формы.",
        );
      }
      return next;
    } catch (cause) {
      if (!quiet) {
        setPage(null);
        setError(messageFrom(cause));
        setStatus("Страница пока недоступна для анализа.");
      }
      return null;
    } finally {
      if (!quiet) setBusy(null);
    }
  };

  useEffect(() => {
    void browser.storage.local.get(ADVANCED_STORAGE_KEY).then((stored) => {
      setAdvanced(stored[ADVANCED_STORAGE_KEY] === true);
    });
    void refreshPage();
  }, []);

  useEffect(() => {
    void browser.storage.local.set({ [ADVANCED_STORAGE_KEY]: advanced });
  }, [advanced]);

  useEffect(() => {
    const onActivated = (info: browser.tabs.OnActivatedActiveInfoType) => {
      setActiveTabId(info.tabId);
    };
    const onUpdated = (tabId: number, changeInfo: browser.tabs._OnUpdatedChangeInfo) => {
      if (!packet || tabId !== packet.tabId) return;
      if (changeInfo.url || changeInfo.status === "loading") {
        setStaleReason("Исходная вкладка перешла на другую страницу. Перед применением ответа подготовьте новый пакет.");
      }
    };
    const onRemoved = (tabId: number) => {
      if (packet?.tabId === tabId) {
        setStaleReason("Исходная вкладка формы закрыта. Откройте форму и подготовьте новый пакет.");
      }
    };

    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [packet]);

  const clearAfterCapture = (): void => {
    setResponseText("");
    setRequest(null);
    setPreview(null);
    setResult(null);
    setAiDecision(null);
    setStaleReason("");
  };

  const preparePacket = (): void => {
    void run("capture", async () => {
      setStatus("Анализируем форму, маскируем текущие значения и делаем снимок…");
      const nextPage = await scanActivePage();
      if (!nextPage.manifest.fields.length) {
        throw new Error("На странице не найдено полей, которые расширение может безопасно заполнить.");
      }

      const tab = await activeTab();
      if (tab.id !== nextPage.tabId) {
        throw new Error("Активная вкладка изменилась во время анализа. Повторите подготовку пакета.");
      }

      let masksEnabled = false;
      let dataUrl = "";
      try {
        await togglePrivacyMasks(tab.id);
        masksEnabled = true;
        await delay(140);
        dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      } finally {
        if (masksEnabled) {
          try {
            await togglePrivacyMasks(tab.id);
          } catch {
            // capture-mask.js removes its own masks after the safety timeout as well.
          }
        }
      }

      if (!dataUrl.startsWith("data:image/png")) {
        throw new Error("Firefox не вернул PNG активной вкладки.");
      }

      const capturedAt = new Date().toISOString();
      let screenshotCopied = false;
      try {
        await copyPng(dataUrl);
        screenshotCopied = true;
      } catch {
        // Explicit copy/download controls remain available.
      }

      const nextPacket: CapturePacket = {
        captureId: createCaptureId(),
        tabId: tab.id,
        windowId: tab.windowId,
        title: nextPage.title,
        pageUrl: nextPage.pageUrl,
        capturedAt,
        dataUrl,
        filename: aiCaptureFilename(capturedAt),
        manifest: nextPage.manifest,
        screenshotCopied,
      };

      setPage(nextPage);
      setActiveTabId(tab.id);
      setPacket(nextPacket);
      clearAfterCapture();
      setStatus(
        screenshotCopied
          ? "Пакет готов. Снимок уже скопирован; добавьте исходные данные и скопируйте промпт."
          : "Пакет готов. Firefox не дал скопировать изображение автоматически — используйте кнопку «Скопировать снимок».",
      );
      await browser.storage.local.set({
        lastCaptureMeta: {
          version,
          captureId: nextPacket.captureId,
          tabId: nextPacket.tabId,
          page: pagePath(nextPacket.pageUrl),
          pageFingerprint: nextPacket.manifest.pageFingerprint,
          fieldCount: nextPacket.manifest.fields.length,
          capturedAt,
        },
      });
      scrollTo("handoff-card");
    });
  };

  const copyScreenshot = (): void => {
    void run("copy-image", async () => {
      if (!packet) throw new Error("Сначала подготовьте пакет для ИИ.");
      await copyPng(packet.dataUrl);
      setPacket({ ...packet, screenshotCopied: true });
      setStatus("Снимок скопирован. Вставьте его в диалог vision-ИИ.");
    });
  };

  const copyPrompt = (): void => {
    void run("copy-prompt", async () => {
      if (!packet) throw new Error("Сначала подготовьте пакет для ИИ.");
      await navigator.clipboard.writeText(prompt);
      setStatus(
        sourceData.trim()
          ? "Промпт с исходными данными скопирован. Вставьте его после снимка в тот же диалог ИИ."
          : "Промпт скопирован без исходных данных. ИИ не должен угадывать значения и, вероятно, вернёт вопросы needs_input.",
      );
      window.setTimeout(() => responseRef.current?.focus(), 120);
    });
  };

  const ensureOriginalPage = async (): Promise<FormManifest> => {
    if (!packet) throw new Error("Нет активного пакета. Подготовьте снимок и промпт заново.");
    if (staleReason) throw new Error(staleReason);

    const tab = await activeTab();
    setActiveTabId(tab.id);
    if (tab.id !== packet.tabId) {
      throw new Error(
        `Вернитесь на вкладку исходной формы «${packet.title}» (${pageHost(packet.pageUrl)}), затем повторите проверку. Пакет сохранён и не потерян.`,
      );
    }

    const fresh = await callTab<FormManifest>("scan");
    if (fresh.pageFingerprint !== packet.manifest.pageFingerprint) {
      const reason = "Форма изменилась после снимка: pageFingerprint больше не совпадает. Подготовьте новый пакет.";
      setStaleReason(reason);
      throw new Error(reason);
    }
    return fresh;
  };

  const reviewResponse = (): void => {
    void run("review", async () => {
      if (!packet) throw new Error("Сначала подготовьте пакет для ИИ.");
      let text = responseText.trim();
      if (!text) {
        text = (await navigator.clipboard.readText()).trim();
        if (!text) throw new Error("Вставьте JSON от ИИ в поле ответа или скопируйте его в буфер обмена.");
        setResponseText(text);
      }

      const parsed = parseAiFillResponse(text);
      const decision = validateAiFillResponse(parsed, {
        captureId: packet.captureId,
        pageFingerprint: packet.manifest.pageFingerprint,
        manifest: packet.manifest,
      });
      setAiDecision(decision);
      setRequest(null);
      setPreview(null);
      setResult(null);

      if (decision.kind === "mismatch") {
        setStatus("ИИ обнаружил несоответствие скриншота и manifest. Ничего не будет заполнено.");
        throw new Error(decision.message);
      }
      if (decision.kind === "needs_input") {
        setStatus("ИИ не хватает точных данных. Добавьте ответы в «Исходные данные», затем снова скопируйте промпт.");
        scrollTo("ai-questions");
        return;
      }

      await ensureOriginalPage();
      const nextPreview = await callTab<PreviewResult>("preview", decision.request);
      setRequest(decision.request);
      setPreview(nextPreview);
      setStatus(
        `Проверка готова: ${nextPreview.counts.ok + nextPreview.counts.same} допустимо, ${nextPreview.counts.review} требует внимания, ${nextPreview.counts.error} ошибок.`,
      );
      scrollTo("preview-card");
    });
  };

  const fillSafeFields = (): void => {
    void run("fill", async () => {
      if (!request || !preview) throw new Error("Сначала проверьте ответ ИИ и просмотрите изменения.");
      await ensureOriginalPage();
      if (preview.pageMismatch) throw new Error("Ответ относится к другой версии страницы. Подготовьте новый пакет.");
      if (preview.counts.error > 0) throw new Error("В предварительной проверке есть ошибки. Исправьте ответ ИИ перед заполнением.");

      const next = await callTab<FillResult>("fill", request);
      setResult(next);
      setStatus(
        `Заполнение завершено: ${next.filled} изменено, ${next.same} уже совпадало, ${next.review} проверить, ${next.errors} ошибок.`,
      );
      scrollTo("result-card");
    });
  };

  const undo = (): void => {
    void run("undo", async () => {
      await ensureOriginalPage();
      const restored = await callTab<UndoResult>("undo");
      setResult(null);
      setStatus(`Отменено изменений: ${restored.restored}. Ошибок отмены: ${restored.errors}.`);
    });
  };

  const toggleNumbers = (): void => {
    void run("scan", async () => {
      await ensureOriginalPage();
      const visible = await callTab<boolean>("toggleOverlay");
      setStatus(visible ? "Метки Fxx показаны на форме." : "Метки Fxx скрыты.");
    });
  };

  const resetFlow = (keepSourceData = true): void => {
    setPacket(null);
    setResponseText("");
    setRequest(null);
    setPreview(null);
    setResult(null);
    setAiDecision(null);
    setStaleReason("");
    setError("");
    if (!keepSourceData) setSourceData("");
    setStatus("Пакет сброшен. Проверьте страницу и подготовьте новый снимок.");
    void refreshPage(true);
    scrollTo("top");
  };

  const copyDiagnostics = (): void => {
    void run("diagnostics", async () => {
      const tab = await activeTab().catch(() => null);
      const diagnostics = {
        extensionVersion: version,
        userAgent: navigator.userAgent,
        activeTabId: tab?.id ?? null,
        capturedTabId: packet?.tabId ?? null,
        capturedPage: packet ? pagePath(packet.pageUrl) : null,
        captureId: packet?.captureId ?? null,
        pageFingerprint: packet?.manifest.pageFingerprint ?? page?.manifest.pageFingerprint ?? null,
        fieldCount: packet?.manifest.fields.length ?? page?.manifest.fields.length ?? null,
        staleReason: staleReason || null,
        lastError: error || null,
      };
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setStatus("Диагностика без значений полей скопирована в буфер обмена.");
    });
  };

  const previewItems = preview?.items.slice(0, MAX_PREVIEW_ITEMS) ?? [];
  const decisionWarnings = aiDecision?.warnings ?? [];
  const questions = aiDecision?.kind === "needs_input" ? aiDecision.questions : [];

  return (
    <main id="top" class="app-shell">
      <header class="app-header">
        <div class="brand">
          <img src="../icons/formfill.svg" alt="" class="brand-icon" />
          <div>
            <div class="brand-title">FormFill Assistant</div>
            <div class="brand-subtitle">Снимок → ИИ → проверка → заполнение</div>
          </div>
        </div>
        <span class="version">v{version}</span>
      </header>

      <div class="progress" aria-label={`Шаг ${stage} из 5`}>
        {["Страница", "Пакет", "Ответ", "Проверка", "Готово"].map((label, index) => {
          const number = index + 1;
          const state = number < stage ? "done" : number === stage ? "active" : "";
          return (
            <div class={`progress-step ${state}`} key={label} aria-current={number === stage ? "step" : undefined}>
              <span>{number < stage ? "✓" : number}</span>
              <small>{label}</small>
            </div>
          );
        })}
      </div>

      <section class={`page-card ${page?.manifest.fields.length ? "ready" : ""}`}>
        <div class="page-state-icon" aria-hidden="true">{busy === "scan" ? "…" : page?.manifest.fields.length ? "✓" : "!"}</div>
        <div class="page-summary">
          <strong>{page ? pageHost(page.pageUrl) : "Текущая страница"}</strong>
          <span>{page?.title || status}</span>
          {page && (
            <div class="page-metrics">
              <span>{page.manifest.fields.length} полей</span>
              <span>{requiredCount} обязательных</span>
              <span>{protectedCount} защищённых</span>
            </div>
          )}
        </div>
        <button class="icon-button" type="button" disabled={busy !== null} onClick={() => void refreshPage()} title="Проверить страницу" aria-label="Проверить страницу">↻</button>
      </section>

      {error && (
        <section class="message error-message" role="alert">
          <strong>Не удалось продолжить</strong>
          <p>{error}</p>
          <div class="inline-actions">
            <button type="button" onClick={() => location.reload()}>Перезапустить панель</button>
            <button type="button" disabled={busy !== null} onClick={copyDiagnostics}>Скопировать диагностику</button>
          </div>
        </section>
      )}

      {staleReason && (
        <section class="message warning-message" role="alert">
          <strong>Пакет устарел</strong>
          <p>{staleReason}</p>
          <button class="primary" type="button" disabled={busy !== null} onClick={preparePacket}>Подготовить новый пакет</button>
        </section>
      )}

      {!packet ? (
        <section class="workspace-card hero-card">
          <div class="eyebrow">Один основной сценарий</div>
          <h1>Подготовьте текущую форму для ИИ</h1>
          <p class="lead">
            Расширение само найдёт поля, присвоит им Fxx, временно закроет уже введённые значения и сделает снимок. Никакие данные не отправляются автоматически.
          </p>

          <label class="field-label" for="source-data-before">Исходные данные для заполнения <span>необязательно сейчас</span></label>
          <textarea
            id="source-data-before"
            class="source-data"
            value={sourceData}
            onInput={(event) => setSourceData((event.currentTarget as HTMLTextAreaElement).value)}
            placeholder={'Например:\nИмя: Иван Петров\nТелефон: +7 999 000-00-00\nСообщение: Прошу перезвонить после 15:00'}
            spellcheck={false}
          />
          <p class="field-help">Значения хранятся только в этой панели и попадут наружу лишь когда вы вручную скопируете промпт.</p>

          <button
            class="primary primary-large"
            type="button"
            disabled={busy !== null || !page?.manifest.fields.length}
            onClick={preparePacket}
          >
            {busy === "capture" ? "Готовим снимок…" : "Подготовить снимок и промпт"}
          </button>

          {!page?.manifest.fields.length && busy === null && (
            <button class="secondary" type="button" onClick={() => void refreshPage()}>Сначала проверить страницу</button>
          )}

          <div class="safety-row">
            <span>Без сервера</span>
            <span>Без автоподстановки до preview</span>
            <span>Без Submit</span>
          </div>
        </section>
      ) : (
        <>
          <section id="handoff-card" class="workspace-card">
            <div class="section-heading">
              <div>
                <div class="eyebrow">Пакет привязан к снимку</div>
                <h2>{packet.title}</h2>
              </div>
              <button class="text-button" type="button" onClick={() => resetFlow(true)}>Начать заново</button>
            </div>

            <img class="screenshot-preview" src={packet.dataUrl} alt="Снимок текущей формы с метками Fxx" />
            <div class="binding-strip">
              <span>capture {packet.captureId.slice(0, 8)}…</span>
              <span>fingerprint {packet.manifest.pageFingerprint}</span>
              <span>{packet.manifest.fields.length} полей</span>
              <span>{formatTime(packet.capturedAt)}</span>
            </div>

            {!currentTabIsForm && (
              <div class="message info-message">
                <strong>Вы на другой вкладке</strong>
                <p>Это нормально для работы с ИИ. Пакет сохранён для {pageHost(packet.pageUrl)}. Перед проверкой или заполнением вернитесь к вкладке формы.</p>
              </div>
            )}

            <label class="field-label" for="source-data">Исходные данные для ИИ <span>не давайте ИИ угадывать</span></label>
            <textarea
              id="source-data"
              class="source-data"
              value={sourceData}
              onInput={(event) => setSourceData((event.currentTarget as HTMLTextAreaElement).value)}
              placeholder="Вставьте точные данные, из которых нужно заполнить форму. Если данных нет, ИИ должен вернуть needs_input и вопросы."
              spellcheck={false}
            />

            <div class="handoff-grid">
              <button class="secondary" type="button" disabled={busy !== null} onClick={copyScreenshot}>
                {busy === "copy-image" ? "Копируем…" : packet.screenshotCopied ? "✓ Снимок скопирован" : "1. Скопировать снимок"}
              </button>
              <button class="primary" type="button" disabled={busy !== null} onClick={copyPrompt}>
                {busy === "copy-prompt" ? "Копируем…" : "2. Скопировать промпт"}
              </button>
              <button class="secondary wide" type="button" disabled={busy !== null} onClick={() => downloadPng(packet.dataUrl, packet.filename)}>
                Скачать PNG
              </button>
            </div>

            <ol class="handoff-help">
              <li>Откройте ChatGPT, Claude, Gemini или другой vision-ИИ в отдельной вкладке.</li>
              <li>Вставьте снимок, затем промпт в тот же диалог.</li>
              <li>ИИ обязан вернуть JSON v2 с тем же captureId и полным fingerprint.</li>
            </ol>

            <label class="field-label" for="ai-response">Ответ ИИ</label>
            <textarea
              ref={responseRef}
              id="ai-response"
              class="ai-response"
              value={responseText}
              onInput={(event) => {
                setResponseText((event.currentTarget as HTMLTextAreaElement).value);
                setAiDecision(null);
              }}
              placeholder='Вставьте JSON, начинающийся с {"version":2,...}. Можно оставить поле пустым, если JSON уже скопирован в буфер.'
              spellcheck={false}
            />
            <button class="primary primary-large" type="button" disabled={busy !== null} onClick={reviewResponse}>
              {busy === "review" ? "Проверяем ответ…" : "Проверить ответ ИИ"}
            </button>
          </section>

          {questions.length > 0 && (
            <section id="ai-questions" class="workspace-card questions-card">
              <div class="eyebrow">ИИ не хватает данных</div>
              <h2>Уточните значения, не меняя форму</h2>
              <ul>
                {questions.map((question) => <li key={question}>{question}</li>)}
              </ul>
              {decisionWarnings.length > 0 && (
                <div class="warning-list">
                  {decisionWarnings.map((warning) => <p key={warning}>{warning}</p>)}
                </div>
              )}
              <p class="field-help">Добавьте ответы в поле «Исходные данные для ИИ» выше и снова нажмите «Скопировать промпт».</p>
            </section>
          )}
        </>
      )}

      {preview && (
        <section id="preview-card" class={`workspace-card preview-card ${preview.pageMismatch ? "invalid" : ""}`}>
          <div class="section-heading">
            <div>
              <div class="eyebrow">Обязательная проверка</div>
              <h2>Что изменится на странице</h2>
            </div>
            <div class="preview-counts">
              <span class="ok">{preview.counts.ok + preview.counts.same} допустимо</span>
              <span class="review">{preview.counts.review} проверить</span>
              <span class="bad">{preview.counts.error} ошибок</span>
            </div>
          </div>

          {decisionWarnings.length > 0 && (
            <div class="message warning-message compact">
              {decisionWarnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}

          <div class="preview-list">
            {previewItems.map((item) => (
              <article class={`preview-item status-${item.status}`} key={item.id}>
                <div class="field-id">{item.id}</div>
                <div class="preview-values">
                  <strong>{item.label}</strong>
                  <span><b>Сейчас:</b> {shortText(item.currentValue)}</span>
                  <span><b>Будет:</b> {shortText(item.requestedValue)}</span>
                  {item.message && <p>{item.message}</p>}
                </div>
                <span class={`status-badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>
              </article>
            ))}
          </div>

          {preview.items.length > MAX_PREVIEW_ITEMS && (
            <p class="field-help">Показаны первые {MAX_PREVIEW_ITEMS} из {preview.items.length} полей.</p>
          )}

          <button
            class="primary primary-large"
            type="button"
            disabled={busy !== null || preview.pageMismatch || preview.counts.error > 0}
            onClick={fillSafeFields}
          >
            {busy === "fill" ? "Заполняем…" : `Заполнить ${preview.counts.ok} безопасных полей`}
          </button>
          <p class="submit-note">Кнопка отправки формы не нажимается. После заполнения проверьте страницу самостоятельно.</p>
        </section>
      )}

      {result && (
        <section id="result-card" class="workspace-card result-card">
          <div class="result-icon">✓</div>
          <h2>Поля обработаны</h2>
          <div class="result-grid">
            <span><strong>{result.filled}</strong> изменено</span>
            <span><strong>{result.same}</strong> совпадало</span>
            <span><strong>{result.review}</strong> проверить</span>
            <span><strong>{result.errors}</strong> ошибок</span>
          </div>
          {result.newFieldCount > 0 && (
            <div class="message warning-message compact">
              После заполнения появилось новых полей: {result.newFieldCount}. Перед дальнейшим заполнением подготовьте новый пакет.
            </div>
          )}
          <div class="handoff-grid">
            <button class="secondary" type="button" disabled={busy !== null} onClick={undo}>
              {busy === "undo" ? "Отменяем…" : "Отменить изменения"}
            </button>
            <button class="primary" type="button" onClick={() => resetFlow(true)}>Новый пакет</button>
          </div>
        </section>
      )}

      <section class="status-line" aria-live="polite">
        <span class={busy ? "status-dot busy" : "status-dot"}></span>
        {status}
      </section>

      <details class="advanced-card" open={advanced} onToggle={(event) => setAdvanced((event.currentTarget as HTMLDetailsElement).open)}>
        <summary>Расширенные инструменты и диагностика</summary>
        <div class="advanced-body">
          <div class="advanced-actions">
            <button type="button" disabled={!packet || busy !== null} onClick={toggleNumbers}>Показать/скрыть Fxx</button>
            <button type="button" disabled={busy !== null} onClick={copyDiagnostics}>Скопировать диагностику</button>
            <button type="button" disabled={busy !== null} onClick={() => location.reload()}>Перезапустить панель</button>
            <button type="button" onClick={() => resetFlow(false)}>Сбросить всё</button>
          </div>
          {packet && (
            <>
              <p class="technical">Страница: {pagePath(packet.pageUrl)}</p>
              <p class="technical">captureId: {packet.captureId}</p>
              <p class="technical">pageFingerprint: {packet.manifest.pageFingerprint}</p>
              <label class="field-label" for="raw-prompt">Текущий динамический промпт</label>
              <textarea id="raw-prompt" class="technical-textarea" readonly value={prompt} />
            </>
          )}
          <button
            class="text-button"
            type="button"
            onClick={() => void navigator.clipboard.writeText(makePortableAiPromptTemplate())}
          >
            Скопировать универсальный шаблон без manifest
          </button>
        </div>
      </details>

      <footer class="app-footer">Локальная обработка · без telemetry · без auto-submit</footer>
    </main>
  );
}

function showFatalError(cause: unknown): void {
  const root = document.getElementById("app") ?? document.body;
  root.replaceChildren();

  const card = document.createElement("section");
  card.className = "fatal-card";
  const title = document.createElement("strong");
  title.textContent = "FormFill Assistant не запустился";
  const text = document.createElement("p");
  text.textContent = messageFrom(cause);
  const help = document.createElement("p");
  help.textContent = "Обновите расширение, перезапустите Firefox и приложите это сообщение к отчёту об ошибке.";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Перезапустить панель";
  button.addEventListener("click", () => location.reload());
  card.append(title, text, help, button);
  root.append(card);
}

window.addEventListener("error", (event) => showFatalError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => showFatalError(event.reason));

try {
  const root = document.getElementById("app");
  if (!root) throw new Error("В sidebar отсутствует корневой элемент #app.");
  render(<App />, root);
  document.documentElement.dataset.formfillReady = "true";
  document.getElementById("boot-fallback")?.remove();
} catch (cause) {
  showFatalError(cause);
}
