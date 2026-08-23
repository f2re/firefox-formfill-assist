import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type {
  FillRequest,
  FillResult,
  FormManifest,
  HistoryEntry,
  PreviewItem,
  PreviewResult,
  RpcResponse,
  UndoResult,
} from "../shared/types";
import { parseFillRequest } from "../shared/schema";
import { makeGptPacket } from "../shared/gpt";

const STATUS_LABEL: Record<PreviewItem["status"], string> = {
  ok: "✓ готово",
  review: "⚠ проверить",
  error: "✕ ошибка",
  same: "= совпадает",
  skip: "пропуск",
};

async function callTab<T>(action: "scan" | "toggleOverlay" | "preview" | "fill" | "undo", payload?: unknown): Promise<T> {
  const response = (await browser.runtime.sendMessage({
    scope: "tab",
    action,
    payload,
  })) as RpcResponse<T>;

  if (!response?.ok) throw new Error(response?.error || "Расширение не получило ответ от страницы.");
  return response.data as T;
}

function shortValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

async function saveHistory(manifest: FormManifest, result: FillResult): Promise<void> {
  const stored = await browser.storage.local.get("history");
  const history = Array.isArray(stored.history) ? (stored.history as HistoryEntry[]) : [];
  const entry: HistoryEntry = {
    timestamp: result.completedAt,
    page: new URL(manifest.page).origin,
    fields: result.fields.length,
    successful: result.filled + result.same,
    review: result.review,
    errors: result.errors,
  };
  await browser.storage.local.set({ history: [entry, ...history].slice(0, 10) });
}

function App() {
  const [manifest, setManifest] = useState<FormManifest | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [jsonText, setJsonText] = useState("");
  const [request, setRequest] = useState<FillRequest | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<FillResult | null>(null);
  const [status, setStatus] = useState("Страница ещё не проанализирована.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const requiredCount = useMemo(
    () => manifest?.fields.filter((field) => field.required).length ?? 0,
    [manifest],
  );
  const selectCount = useMemo(
    () => manifest?.fields.filter((field) => ["select", "combobox", "radio"].includes(field.type)).length ?? 0,
    [manifest],
  );
  const protectedCount = useMemo(
    () => manifest?.fields.filter((field) => field.sensitive).length ?? 0,
    [manifest],
  );

  const run = async (work: () => Promise<void>) => {
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

  const analyze = () =>
    run(async () => {
      const next = await callTab<FormManifest>("scan");
      setManifest(next);
      setPreview(null);
      setResult(null);
      setStatus(`Найдено полей: ${next.fields.length}. Идентификаторы Fxx показаны на странице.`);
    });

  const toggleNumbers = () =>
    run(async () => {
      const shown = await callTab<boolean>("toggleOverlay");
      setOverlayVisible(shown);
      setStatus(shown ? "Номера полей показаны." : "Номера полей скрыты.");
    });

  const copyForGpt = () =>
    run(async () => {
      if (!manifest) throw new Error("Сначала проанализируйте форму.");
      await navigator.clipboard.writeText(makeGptPacket(manifest));
      setStatus("Описание формы и инструкция для GPT скопированы в буфер.");
    });

  const parseAndPreview = (text: string) =>
    run(async () => {
      if (!manifest) throw new Error("Сначала проанализируйте текущую форму.");
      const parsed = parseFillRequest(text);
      const nextPreview = await callTab<PreviewResult>("preview", parsed);
      setJsonText(text);
      setRequest(parsed);
      setPreview(nextPreview);
      setResult(null);
      setStatus(
        `JSON распознан: ${nextPreview.counts.ok + nextPreview.counts.same} готово, ${nextPreview.counts.review} проверить, ${nextPreview.counts.error} ошибок.`,
      );
    });

  const pasteClipboard = () =>
    run(async () => {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("Буфер обмена пуст.");
      if (!manifest) throw new Error("Сначала проанализируйте текущую форму.");
      const parsed = parseFillRequest(text);
      const nextPreview = await callTab<PreviewResult>("preview", parsed);
      setJsonText(text);
      setRequest(parsed);
      setPreview(nextPreview);
      setResult(null);
      setStatus(
        `JSON распознан: ${nextPreview.counts.ok + nextPreview.counts.same} готово, ${nextPreview.counts.review} проверить, ${nextPreview.counts.error} ошибок.`,
      );
    });

  const fill = () =>
    run(async () => {
      if (!manifest || !request || !preview) throw new Error("Сначала загрузите JSON и проверьте preview.");
      if (preview.pageMismatch) throw new Error("Fingerprint страницы отличается. Выполните анализ заново и получите новый JSON.");
      if (preview.counts.error > 0) throw new Error("В preview есть ошибки. Исправьте JSON перед заполнением.");

      const next = await callTab<FillResult>("fill", request);
      setResult(next);
      await saveHistory(manifest, next);
      setStatus(`Заполнение завершено: ${next.filled} изменено, ${next.same} уже совпадало, ${next.review} проверить.`);
    });

  const undo = () =>
    run(async () => {
      const undoResult = await callTab<UndoResult>("undo");
      setResult(null);
      setStatus(`Отменено изменений: ${undoResult.restored}. Ошибок: ${undoResult.errors}.`);
    });

  const handlePendingCommand = async () => {
    const stored = await browser.storage.local.get("pendingCommand");
    const pending = stored.pendingCommand as { command?: string; createdAt?: number } | undefined;
    if (!pending?.command || !pending.createdAt || Date.now() - pending.createdAt > 10_000) return;
    await browser.storage.local.remove("pendingCommand");
    if (pending.command === "analyze-form") analyze();
    if (pending.command === "paste-json") pasteClipboard();
    if (pending.command === "fill-preview") fill();
  };

  useEffect(() => {
    void handlePendingCommand();
    const listener = (changes: Record<string, browser.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.pendingCommand?.newValue) void handlePendingCommand();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [manifest, request, preview]);

  return (
    <main class="app">
      <header class="header">
        <div>
          <div class="title">FormFill Assistant</div>
          <div class="small">JSON → preview → DOM, без submit</div>
        </div>
        <div class="version">v{browser.runtime.getManifest().version}</div>
      </header>

      {error && <div class="card error">{error}</div>}

      <section class="card">
        {manifest ? (
          <div class="metrics">
            <div class="metric"><strong>{manifest.fields.length}</strong>полей</div>
            <div class="metric"><strong>{requiredCount}</strong>обязательных</div>
            <div class="metric"><strong>{selectCount}</strong>выборов</div>
            <div class="metric"><strong>{protectedCount}</strong>защищённых</div>
          </div>
        ) : (
          <div class="status">{status}</div>
        )}
      </section>

      <section class="actions main">
        <button class="primary" disabled={busy} onClick={analyze}>1. Анализировать</button>
        <button disabled={busy || !manifest} onClick={toggleNumbers}>
          2. {overlayVisible ? "Скрыть номера" : "Показать номера"}
        </button>
        <button disabled={busy || !manifest} onClick={copyForGpt}>3. Скопировать для GPT</button>
        <button disabled={busy || !manifest} onClick={pasteClipboard}>4. Вставить ответ</button>
      </section>

      {preview && (
        <section class={`card ${preview.pageMismatch ? "warning" : ""}`}>
          {preview.pageMismatch && (
            <div class="status">
              ⚠ JSON создан для другой версии страницы. Текущий fingerprint: {preview.pageFingerprint}
            </div>
          )}
          <div class="preview">
            {preview.items.map((item) => (
              <div class="preview-item" key={item.id}>
                <div class="preview-id">{item.id}</div>
                <div class="preview-values">
                  <strong>{item.label}</strong>
                  <div>Сейчас: {shortValue(item.currentValue)}</div>
                  <div>Будет: {shortValue(item.requestedValue)}</div>
                  {item.message && <div class="preview-message">{item.message}</div>}
                </div>
                <span class={`badge badge-${item.status}`}>{STATUS_LABEL[item.status]}</span>
              </div>
            ))}
          </div>
          <div class="actions" style="margin-top:8px">
            <button
              class="primary"
              disabled={busy || preview.pageMismatch || preview.counts.error > 0}
              onClick={fill}
            >
              5. Заполнить {preview.counts.ok} полей
            </button>
          </div>
        </section>
      )}

      {result && (
        <section class="card success">
          <strong>Заполнение завершено</strong>
          <div class="status">
            ✓ {result.filled} изменено · = {result.same} совпадало · ⚠ {result.review} проверить · ✕ {result.errors} ошибок
            {result.newFieldCount > 0 && <> · появилось новых полей: {result.newFieldCount}</>}
          </div>
          <div class="actions" style="margin-top:8px">
            <button class="danger" disabled={busy} onClick={undo}>Отменить изменения</button>
          </div>
        </section>
      )}

      <section class="card status">{status}</section>

      <details class="card">
        <summary>Дополнительно</summary>
        <div style="margin-top:8px">
          <textarea
            value={jsonText}
            onInput={(event) => setJsonText((event.currentTarget as HTMLTextAreaElement).value)}
            placeholder="Вставьте JSON вручную, если буфер недоступен"
          />
          <div class="actions" style="margin-top:7px">
            <button disabled={busy || !jsonText.trim()} onClick={() => parseAndPreview(jsonText)}>
              Проверить JSON
            </button>
          </div>
          {manifest?.unsupportedCrossOriginFrames ? (
            <p class="small">Cross-origin iframe недоступны: {manifest.unsupportedCrossOriginFrames}.</p>
          ) : null}
          {manifest && <p class="small">Fingerprint: {manifest.pageFingerprint}</p>}
        </div>
      </details>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
