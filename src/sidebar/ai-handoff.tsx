import { render } from "preact";
import { useState } from "preact/hooks";
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

const PANEL_CSS = `
#ai-handoff-root { position: relative; z-index: 50; }
.ai-handoff-fab {
  position: fixed; right: 14px; bottom: 14px; z-index: 1000;
  min-height: 42px; padding: 9px 14px 9px 12px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.24);
  background: linear-gradient(135deg,#0f6cf2 0%,#16bfd2 56%,#6748ed 100%);
  color:#fff; font-weight:760; letter-spacing:-.01em;
  box-shadow:0 12px 28px rgba(25,94,194,.30), inset 0 1px 0 rgba(255,255,255,.22);
}
.ai-handoff-fab::before {
  content:"✦"; display:inline-grid; place-items:center; width:22px; height:22px;
  margin-right:7px; border-radius:7px; background:rgba(255,255,255,.18); font-size:13px;
}
.ai-handoff-fab:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 15px 32px rgba(25,94,194,.36); }
.ai-handoff-panel {
  position:fixed; left:10px; right:10px; bottom:66px; z-index:999;
  max-height:min(76vh,680px); overflow:auto;
  background:rgba(255,255,255,.97); border:1px solid #d7e3f2; border-radius:18px;
  padding:12px; box-shadow:0 22px 54px rgba(16,42,86,.24); backdrop-filter:blur(18px);
}
.ai-handoff-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.ai-handoff-brand { display:flex; align-items:center; gap:9px; min-width:0; }
.ai-handoff-logo { width:38px; height:38px; flex:0 0 auto; filter:drop-shadow(0 4px 8px rgba(26,86,170,.16)); }
.ai-handoff-title { font-size:13px; font-weight:790; color:#192a4b; }
.ai-handoff-head button { width:auto; min-height:30px; padding:4px 9px; border-radius:9px; }
.ai-handoff-steps { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; margin-top:10px; }
.ai-handoff-step { padding:7px; border:1px solid #e1eaf5; border-radius:10px; background:#f7faff; font-size:9.5px; line-height:1.3; color:#61718a; }
.ai-handoff-step strong { display:block; margin-bottom:2px; color:#245bad; font-size:10px; }
.ai-handoff-preview { display:block; width:100%; max-height:250px; object-fit:contain; margin-top:10px; border:1px solid #d7e3f2; border-radius:12px; background:#edf3fa; box-shadow:inset 0 0 0 1px rgba(255,255,255,.55); }
.ai-handoff-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:9px; }
.ai-handoff-actions .wide { grid-column:1 / -1; }
.ai-handoff-template { width:100%; margin-top:7px; min-height:34px; padding:7px 9px; border-style:dashed; background:rgba(244,248,254,.7); font-size:10.5px; color:#536985; }
.ai-handoff-note { margin:8px 0 0; font-size:10.5px; line-height:1.48; color:#687891; }
.ai-handoff-error { margin-top:9px; padding:8px 9px; border:1px solid #efbdc6; border-radius:10px; background:#fff2f5; color:#aa2d47; font-size:10.5px; }
.ai-handoff-ok { margin-top:9px; padding:8px 9px; border:1px solid #bce2d0; border-radius:10px; background:#f0fbf6; color:#18704e; font-size:10.5px; }
@media (max-width:319px){ .ai-handoff-steps{grid-template-columns:1fr;} .ai-handoff-actions{grid-template-columns:1fr;} .ai-handoff-actions .wide{grid-column:auto;} }
@media (prefers-color-scheme: dark) {
  .ai-handoff-panel { background:rgba(20,28,41,.98); border-color:#33445b; color:#edf5ff; }
  .ai-handoff-title { color:#edf5ff; }
  .ai-handoff-step { background:#182337; border-color:#2d3d54; color:#aab7ca; }
  .ai-handoff-step strong { color:#8ebcff; }
  .ai-handoff-preview { background:#101827; border-color:#33445b; }
  .ai-handoff-template { background:#172134; border-color:#3a4a62; color:#b1bfd1; }
  .ai-handoff-note { color:#a7b4c8; }
  .ai-handoff-error { background:#351f2a; border-color:#623748; color:#ffc4d0; }
  .ai-handoff-ok { background:#153026; border-color:#2b5a47; color:#b9efd5; }
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
        await togglePrivacyMasks(tab.id);
        masksEnabled = true;
        await delay(110);
        dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      } finally {
        if (masksEnabled) {
          try {
            await togglePrivacyMasks(tab.id);
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
          ? "Готово: PNG уже в буфере. Вставьте его в vision-ИИ и затем скопируйте динамический промпт."
          : "Снимок готов. Если Firefox не дал положить PNG в буфер, используйте «Скачать PNG».",
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
      setStatus("Динамический промпт скопирован. Вставьте его в тот же диалог ИИ после изображения.");
    });

  const copyPortableTemplate = () =>
    void run(async () => {
      await navigator.clipboard.writeText(makePortableAiPromptTemplate());
      setStatus(
        "Универсальный шаблон скопирован. Для реального заполнения нужен актуальный [FORM_MANIFEST]; для текущей формы используйте динамический промпт.",
      );
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
            <div class="ai-handoff-brand">
              <img class="ai-handoff-logo" src="../icons/formfill.svg" alt="" />
              <div>
                <div class="ai-handoff-title">Подготовить форму для vision-ИИ</div>
                <div class="small">Приватный screenshot + строгий JSON-контракт</div>
              </div>
            </div>
            <button disabled={busy} onClick={() => setOpen(false)} aria-label="Закрыть">×</button>
          </div>

          <div class="ai-handoff-steps" aria-label="Порядок работы">
            <div class="ai-handoff-step"><strong>1 · Подготовить</strong>Сканируем форму, показываем Fxx и маскируем текущие значения.</div>
            <div class="ai-handoff-step"><strong>2 · Передать ИИ</strong>Вставьте PNG и динамический промпт в один диалог vision-ИИ.</div>
            <div class="ai-handoff-step"><strong>3 · Вернуть JSON</strong>Скопируйте ответ ИИ и нажмите «Вставить ответ» в sidebar.</div>
          </div>

          <p class="ai-handoff-note">
            Расширение ничего не отправляет наружу само. Текущие значения видимых editable-полей закрываются локальными privacy-масками перед снимком.
          </p>

          <button class="primary" style="width:100%; margin-top:9px" disabled={busy} onClick={capture}>
            {handoff ? "Переснять и обновить ИИ-пакет" : "Подготовить снимок и промпт"}
          </button>
          <button class="ai-handoff-template" disabled={busy} onClick={copyPortableTemplate}>
            Универсальный шаблон для внешней интеграции
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
                  На странице есть cross-origin iframe: {handoff.unsupportedCrossOriginFrames}. Их содержимое нельзя надёжно замаскировать; проверьте PNG перед передачей ИИ.
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
                После ответа ИИ вернитесь в sidebar: «Вставить ответ» → обязательный preview → «Заполнить». Submit/Next всегда остаются ручными.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

render(<AiHandoff />, document.getElementById("ai-handoff")!);
