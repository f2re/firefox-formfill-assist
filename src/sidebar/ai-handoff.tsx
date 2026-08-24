import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { FormManifest, RpcResponse } from "../shared/types";
import { aiCaptureFilename, planAiHandoff } from "../shared/ai-handoff";
import { makePortableAiPromptTemplate } from "../shared/gpt";
import {
  FORM_SESSION_STORAGE_KEY,
  isFormSessionExpired,
  type FormSession,
} from "../shared/session";

interface CapturedHandoff {
  dataUrl: string;
  prompt: string;
  filename: string;
  capturedAt: string;
  fieldCount: number;
  fieldNamespace: string;
  pageFingerprint: string;
  unsupportedCrossOriginFrames: number;
  screenshotCopied: boolean;
}

interface ActiveTab extends browser.tabs.Tab {
  id: number;
  windowId: number;
}

type AppStage = 0 | 4 | 5;

const ADVANCED_UI_STORAGE_KEY = "formfillAdvancedUi";

async function callScan(): Promise<FormManifest> {
  const response = (await browser.runtime.sendMessage({ scope: "tab", action: "scan" })) as RpcResponse<FormManifest>;
  if (!response?.ok || !response.data) {
    throw new Error(response?.error || "Не удалось проанализировать форму.");
  }
  return response.data;
}

async function loadSession(): Promise<FormSession | null> {
  const stored = await browser.storage.local.get(FORM_SESSION_STORAGE_KEY);
  const candidate = stored[FORM_SESSION_STORAGE_KEY] as FormSession | undefined;
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.pages)) return null;
  if (isFormSessionExpired(candidate)) {
    await browser.storage.local.remove(FORM_SESSION_STORAGE_KEY);
    return null;
  }
  return candidate;
}

async function activeTab(): Promise<ActiveTab> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || typeof tab.id !== "number" || typeof tab.windowId !== "number") {
    throw new Error("Не удалось определить активную вкладку.");
  }
  return tab as ActiveTab;
}

async function togglePrivacyMasks(tabId: number): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ["capture-mask.js"],
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyPng(dataUrl: string): Promise<void> {
  const response = await fetch(dataUrl);
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

function scrollToMain(): void {
  window.setTimeout(() => {
    document.getElementById("app")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

function AiHandoff() {
  const [expanded, setExpanded] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [handoff, setHandoff] = useState<CapturedHandoff | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [responseStarted, setResponseStarted] = useState(false);
  const [appStage, setAppStage] = useState<AppStage>(0);
  const jsonRef = useRef<HTMLTextAreaElement>(null);

  const stage = useMemo(() => {
    if (appStage === 5) return 5;
    if (appStage === 4) return 4;
    if (responseStarted || jsonText.trim()) return 3;
    if (handoff) return 2;
    return 1;
  }, [appStage, handoff, jsonText, responseStarted]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Неизвестная ошибка.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    document.body.classList.toggle("formfill-simple", !advanced);
    void browser.storage.local.set({ [ADVANCED_UI_STORAGE_KEY]: advanced });
  }, [advanced]);

  useEffect(() => {
    void browser.storage.local.get(ADVANCED_UI_STORAGE_KEY).then((stored) => {
      if (stored[ADVANCED_UI_STORAGE_KEY] === true) setAdvanced(true);
    });
  }, []);

  useEffect(() => {
    const app = document.getElementById("app");
    if (!app) return;

    const inspect = () => {
      if (app.querySelector(".success")) {
        setAppStage(5);
        return;
      }
      if (app.querySelector('[aria-label="Фильтр preview"]')) {
        setAppStage(4);
        return;
      }
      setAppStage(0);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(app, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const openHandler = () => setExpanded(true);
    window.addEventListener("formfill:open-ai-handoff", openHandler);
    return () => window.removeEventListener("formfill:open-ai-handoff", openHandler);
  }, []);

  const capture = () =>
    void run(async () => {
      setStatus("Анализируем форму и готовим безопасный снимок…");
      const tab = await activeTab();
      const manifest = await callScan();
      const session = await loadSession();
      const plan = planAiHandoff(manifest, session);

      let masksEnabled = false;
      let dataUrl = "";
      try {
        await togglePrivacyMasks(tab.id);
        masksEnabled = true;
        await delay(120);
        dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      } finally {
        if (masksEnabled) {
          try {
            await togglePrivacyMasks(tab.id);
          } catch {
            // capture-mask.js also removes itself after 15 seconds.
          }
        }
      }

      if (!dataUrl.startsWith("data:image/png")) {
        throw new Error("Firefox не вернул PNG активной страницы.");
      }

      const capturedAt = new Date().toISOString();
      let screenshotCopied = false;
      try {
        await copyPng(dataUrl);
        screenshotCopied = true;
      } catch {
        // The explicit copy and download buttons remain available.
      }

      setHandoff({
        dataUrl,
        prompt: plan.prompt,
        filename: aiCaptureFilename(capturedAt, plan.pageNumber),
        capturedAt,
        fieldCount: plan.fieldCount,
        fieldNamespace: plan.fieldNamespace,
        pageFingerprint: plan.pageFingerprint,
        unsupportedCrossOriginFrames: manifest.unsupportedCrossOriginFrames,
        screenshotCopied,
      });
      setJsonText("");
      setResponseStarted(false);
      setAppStage(0);
      setExpanded(true);
      setStatus(
        screenshotCopied
          ? "Снимок готов и уже скопирован. Вставьте его в vision-ИИ, затем скопируйте промпт."
          : "Снимок готов. Firefox не разрешил автоматическое копирование — нажмите «Скопировать снимок» или «Скачать PNG».",
      );

      await browser.storage.local.set({
        pendingCommand: { command: "analyze-form", createdAt: Date.now() },
      });
    });

  const copyScreenshot = () =>
    void run(async () => {
      if (!handoff) throw new Error("Сначала подготовьте снимок.");
      await copyPng(handoff.dataUrl);
      setHandoff({ ...handoff, screenshotCopied: true });
      setStatus("Снимок скопирован. Вставьте его в диалог vision-ИИ.");
    });

  const copyPrompt = () =>
    void run(async () => {
      if (!handoff) throw new Error("Сначала подготовьте снимок и manifest формы.");
      await navigator.clipboard.writeText(handoff.prompt);
      setStatus("Промпт скопирован. Вставьте его в тот же диалог ИИ после снимка.");
      window.setTimeout(() => jsonRef.current?.focus(), 100);
    });

  const sendJsonForPreview = () =>
    void run(async () => {
      const entered = jsonText.trim();
      if (entered) {
        await navigator.clipboard.writeText(entered);
      } else {
        const clipboardText = await navigator.clipboard.readText();
        if (!clipboardText.trim()) {
          throw new Error("Вставьте JSON от ИИ в поле или скопируйте его в буфер обмена.");
        }
      }

      setResponseStarted(true);
      setStatus("Ответ ИИ передан на строгую проверку. Ниже появится preview; ничего ещё не заполнено.");
      await browser.storage.local.set({
        pendingCommand: { command: "paste-json", createdAt: Date.now() },
      });
      setExpanded(false);
      scrollToMain();
    });

  const copyPortableTemplate = () =>
    void run(async () => {
      await navigator.clipboard.writeText(makePortableAiPromptTemplate());
      setStatus("Универсальный шаблон скопирован. Для текущей формы надёжнее использовать динамический промпт выше.");
    });

  const resetFlow = () => {
    setHandoff(null);
    setJsonText("");
    setResponseStarted(false);
    setAppStage(0);
    setError("");
    setStatus("");
    setExpanded(true);
  };

  if (!expanded) {
    return (
      <button class="ai-flow-collapsed" type="button" onClick={() => setExpanded(true)}>
        <span>{stage >= 4 ? "Preview готов — проверьте поля ниже" : "Заполнить форму с помощью ИИ"}</span>
        <span aria-hidden="true">⌃</span>
      </button>
    );
  }

  return (
    <section class="ai-flow-card" aria-label="Пошаговое заполнение формы с помощью ИИ">
      <div class="ai-flow-head">
        <div class="ai-flow-brand">
          <img class="ai-flow-logo" src="../icons/formfill.svg" alt="" />
          <div>
            <div class="ai-flow-title">Заполнить форму с помощью ИИ</div>
            <div class="ai-flow-subtitle">Один понятный сценарий: страница → снимок и промпт → JSON → preview → заполнение</div>
          </div>
        </div>
        <div class="ai-flow-head-actions">
          {handoff && (
            <button class="ai-flow-icon-button" type="button" onClick={resetFlow} title="Начать заново" aria-label="Начать заново">↻</button>
          )}
          <button class="ai-flow-icon-button" type="button" onClick={() => setExpanded(false)} title="Свернуть" aria-label="Свернуть">⌄</button>
        </div>
      </div>

      <div class="ai-flow-steps" aria-label={`Текущий шаг: ${stage} из 5`}>
        {["Страница", "Снимок", "Ответ ИИ", "Проверка", "Заполнение"].map((label, index) => {
          const number = index + 1;
          const state = number < stage ? "done" : number === stage ? "active" : "";
          return (
            <div class={`ai-flow-step ${state}`} key={label} aria-current={number === stage ? "step" : undefined}>
              <span class="ai-flow-step-number">{number < stage ? "✓" : number}</span>
              {label}
            </div>
          );
        })}
      </div>

      <div class="ai-flow-body">
        {!handoff ? (
          <>
            <p class="ai-flow-lead">
              Откройте нужную страницу и нажмите одну кнопку. Расширение само найдёт поля, покажет метки Fxx, временно закроет уже введённые значения и подготовит пакет для vision-ИИ.
            </p>
            <div class="ai-flow-safety">
              <span>Ничего не отправляется автоматически</span>
              <span>Пароли и чувствительные поля блокируются</span>
              <span>Submit никогда не нажимается</span>
            </div>
            <button class="ai-flow-primary" type="button" disabled={busy} onClick={capture}>
              {busy ? "Подготавливаем страницу…" : "1. Подготовить снимок и промпт"}
            </button>
          </>
        ) : (
          <>
            <img class="ai-flow-preview" src={handoff.dataUrl} alt="Снимок формы с метками Fxx" />
            <div class="ai-flow-meta">
              {handoff.fieldCount} полей · {handoff.fieldNamespace} · fingerprint {handoff.pageFingerprint.slice(0, 12)}…
            </div>

            {handoff.unsupportedCrossOriginFrames > 0 && (
              <div class="ai-flow-warning">
                На странице есть cross-origin iframe: {handoff.unsupportedCrossOriginFrames}. Их содержимое браузер не даёт надёжно замаскировать — проверьте снимок перед передачей ИИ.
              </div>
            )}

            <div class="ai-flow-actions">
              <button class="ai-flow-secondary" type="button" disabled={busy} onClick={copyScreenshot}>
                {handoff.screenshotCopied ? "✓ Снимок скопирован" : "2. Скопировать снимок"}
              </button>
              <button class="ai-flow-primary" type="button" disabled={busy} onClick={copyPrompt}>
                3. Скопировать промпт
              </button>
              <button class="ai-flow-secondary wide" type="button" disabled={busy} onClick={() => downloadPng(handoff.dataUrl, handoff.filename)}>
                Скачать PNG, если вставка изображения недоступна
              </button>
            </div>

            <div class="ai-flow-note">
              Вставьте снимок и промпт в один диалог ChatGPT, Claude, Gemini или другого vision-ИИ. Передайте ИИ исходные данные для формы. В ответе должен быть только JSON.
            </div>

            <label class="ai-flow-json-label" for="ai-response-json">Ответ ИИ</label>
            <textarea
              ref={jsonRef}
              id="ai-response-json"
              class="ai-flow-json"
              value={jsonText}
              onInput={(event) => setJsonText((event.currentTarget as HTMLTextAreaElement).value)}
              placeholder="Вставьте сюда JSON от ИИ или оставьте поле пустым, если JSON уже скопирован в буфер"
              spellcheck={false}
            />
            <button class="ai-flow-primary" type="button" disabled={busy} onClick={sendJsonForPreview}>
              {busy ? "Проверяем ответ…" : "4. Проверить ответ ИИ"}
            </button>
          </>
        )}

        {error && <div class="ai-flow-error" role="alert">{error}</div>}
        {status && <div class="ai-flow-status" aria-live="polite">{status}</div>}

        <div class="ai-flow-footer">
          <button class="ai-flow-toggle" type="button" onClick={() => setAdvanced(!advanced)}>
            {advanced ? "Скрыть расширенные инструменты" : "Показать расширенные инструменты"}
          </button>
          <div class="ai-flow-privacy">Локальная обработка · без telemetry · без auto-submit</div>
        </div>

        {advanced && (
          <button class="ai-flow-toggle" type="button" disabled={busy} onClick={copyPortableTemplate}>
            Скопировать универсальный шаблон промпта для внешней интеграции
          </button>
        )}
      </div>
    </section>
  );
}

document.getElementById("boot-fallback")?.remove();
render(<AiHandoff />, document.getElementById("ai-handoff")!);
