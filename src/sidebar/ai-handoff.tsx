import { render } from "preact";
import { useState } from "preact/hooks";
import type { FormManifest, RpcResponse } from "../shared/types";
import { aiCaptureFilename, planAiHandoff } from "../shared/ai-handoff";
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

const PANEL_CSS = `
#ai-handoff-root { position: relative; z-index: 50; }
.ai-handoff-fab {
  position: fixed; right: 12px; bottom: 12px; z-index: 1000;
  min-height: 38px; padding: 8px 12px; border-radius: 999px;
  border-color: #1f6feb; background: #1f6feb; color: #fff; font-weight: 700;
  box-shadow: 0 5px 18px rgba(15,23,42,.22);
}
.ai-handoff-panel {
  position: fixed; left: 10px; right: 10px; bottom: 58px; z-index: 999;
  max-height: min(72vh, 620px); overflow: auto;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 12px;
  padding: 10px; box-shadow: 0 12px 34px rgba(15,23,42,.24);
}
.ai-handoff-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.ai-handoff-head button { width:auto; min-height:28px; padding:4px 8px; }
.ai-handoff-preview {
  display:block; width:100%; max-height:220px; object-fit:contain; margin-top:8px;
  border:1px solid #d7dde5; border-radius:8px; background:#eef2f7;
}
.ai-handoff-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:8px; }
.ai-handoff-actions .wide { grid-column:1 / -1; }
.ai-handoff-note { margin:7px 0 0; font-size:11px; line-height:1.45; color:#64748b; }
.ai-handoff-error { margin-top:8px; padding:7px; border-radius:7px; background:#fff1f2; color:#9f1239; font-size:11px; }
.ai-handoff-ok { margin-top:7px; padding:7px; border-radius:7px; background:#f0fdf4; color:#166534; font-size:11px; }
@media (prefers-color-scheme: dark) {
  .ai-handoff-panel { background:#161b22; border-color:#374151; color:#e5e7eb; }
  .ai-handoff-preview { background:#0f172a; border-color:#374151; }
  .ai-handoff-note { color:#94a3b8; }
}
`;

async function callScan(): Promise<FormManifest> {
  const response = (await browser.runtime.sendMessage({ scope: "tab", action: "scan" })) as RpcResponse<FormManifest>;
  if (!response?.ok || !response.data) {
    throw new Error(response?.error || "Не удалось проанализировать форму перед снимком.");
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

async function activeTab(): Promise<browser.tabs.Tab> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || tab.windowId === undefined) throw new Error("Не удалось определить активную вкладку.");
  return tab;
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

function AiHandoff() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [handoff, setHandoff] = useState<CapturedHandoff | null>(null);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Неизвестная ошибка подготовки снимка.");
    } finally {
      setBusy(false);
    }
  };

  const capture = () =>
    void run(async () => {
      const tab = await activeTab();
      const manifest = await callScan();
      const session = await loadSession();
      const plan = planAiHandoff(manifest, session);

      let masksEnabled = false;
      let dataUrl = "";
      try {
        await togglePrivacyMasks(tab.id!);
        masksEnabled = true;
        await delay(110);
        dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      } finally {
        if (masksEnabled) {
          try {
            await togglePrivacyMasks(tab.id!);
          } catch {
            // The injected mask script also removes itself automatically after 15 seconds.
          }
        }
      }

      if (!dataUrl.startsWith("data:image/png")) throw new Error("Firefox не вернул PNG снимок активной вкладки.");

      const capturedAt = new Date().toISOString();
      let screenshotCopied = false;
      try {
        await copyPng(dataUrl);
        screenshotCopied = true;
      } catch {
        // Download remains available as a deterministic fallback.
      }

      const next: CapturedHandoff = {
        dataUrl,
        prompt: plan.prompt,
        filename: aiCaptureFilename(capturedAt, plan.pageNumber),
        capturedAt,
        fieldCount: plan.fieldCount,
        fieldNamespace: plan.fieldNamespace,
        pageFingerprint: plan.pageFingerprint,
        unsupportedCrossOriginFrames: manifest.unsupportedCrossOriginFrames,
        screenshotCopied,
      };
      setHandoff(next);
      setStatus(
        screenshotCopied
          ? "Снимок готов и уже скопирован. Вставьте его в vision-ИИ, затем скопируйте промпт."
          : "Снимок готов. Копирование изображения недоступно — используйте «Скачать PNG».",
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
      setStatus("PNG скопирован. Вставьте изображение в vision-ИИ.");
    });

  const copyPrompt = () =>
    void run(async () => {
      if (!handoff) throw new Error("Сначала подготовьте снимок — промпт должен соответствовать этому fingerprint.");
      await navigator.clipboard.writeText(handoff.prompt);
      setStatus("Промпт скопирован. Вставьте его в тот же диалог ИИ после изображения.");
    });

  return (
    <div id="ai-handoff-root">
      <style>{PANEL_CSS}</style>
      <button class="ai-handoff-fab" disabled={busy} onClick={() => setOpen(!open)}>
        {busy ? "Подготовка…" : "Снимок + промпт"}
      </button>

      {open && (
        <section class="ai-handoff-panel" aria-label="Подготовка формы для ИИ">
          <div class="ai-handoff-head">
            <div>
              <strong>Для vision-ИИ</strong>
              <div class="small">Снимок видимой области + строгий JSON-контракт</div>
            </div>
            <button disabled={busy} onClick={() => setOpen(false)}>×</button>
          </div>

          <p class="ai-handoff-note">
            Перед снимком расширение временно закрывает содержимое видимых полей privacy-масками, но оставляет подписи и метки Fxx/Pn-Fxx. Ничего не отправляется автоматически.
          </p>

          <button class="primary" style="width:100%; margin-top:8px" disabled={busy} onClick={capture}>
            {handoff ? "Переснять и обновить промпт" : "Подготовить снимок и промпт"}
          </button>

          {error && <div class="ai-handoff-error" role="alert">{error}</div>}
          {status && <div class="ai-handoff-ok">{status}</div>}

          {handoff && (
            <>
              <img class="ai-handoff-preview" src={handoff.dataUrl} alt="Снимок формы с метками полей" />
              <p class="ai-handoff-note">
                {handoff.fieldCount} полей · {handoff.fieldNamespace} · fingerprint {handoff.pageFingerprint.slice(0, 12)}…
              </p>
              {handoff.unsupportedCrossOriginFrames > 0 && (
                <div class="ai-handoff-error">
                  На странице есть cross-origin iframe: {handoff.unsupportedCrossOriginFrames}. Их содержимое нельзя надёжно замаскировать; проверьте изображение перед передачей ИИ.
                </div>
              )}
              <div class="ai-handoff-actions">
                <button disabled={busy} onClick={copyScreenshot}>Скопировать PNG</button>
                <button class="primary" disabled={busy} onClick={copyPrompt}>Скопировать промпт</button>
                <button class="wide" disabled={busy} onClick={() => downloadPng(handoff.dataUrl, handoff.filename)}>
                  Скачать PNG
                </button>
              </div>
              <p class="ai-handoff-note">
                Порядок: вставьте PNG в ChatGPT/Claude/Gemini → вставьте промпт → скопируйте полученный JSON → вернитесь к форме и нажмите «Вставить ответ».
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

render(<AiHandoff />, document.getElementById("ai-handoff")!);
