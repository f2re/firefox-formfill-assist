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
import { stringifyGptFeedbackReport } from "../shared/report";

const STATUS_LABEL: Record<PreviewItem["status"], string> = {
  ok: "✓ готово",
  review: "⚠ проверить",
  error: "✕ ошибка",
  same: "= совпадает",
  skip: "пропуск",
};

const PREVIEW_LIMIT = 40;

type PreviewFilter = "all" | "attention";

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

async function loadHistory(): Promise<HistoryEntry[]> {
  const stored = await browser.storage.local.get("history");
  return Array.isArray(stored.history) ? (stored.history as HistoryEntry[]).slice(0, 10) : [];
}

async function saveHistory(manifest: FormManifest, result: FillResult): Promise<HistoryEntry[]> {
  const history = await loadHistory();
  const entry: HistoryEntry = {
    timestamp: result.completedAt,
    page: new URL(manifest.page).origin,
    fields: result.fields.length,
    successful: result.filled + result.same,
    review: result.review,
    errors: result.errors,
  };
  const next = [entry, ...history].slice(0, 10);
  await browser.storage.local.set({ history: next });
  return next;
}

function historyTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function App() {
  const [manifest, setManifest] = useState<FormManifest | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [jsonText, setJsonText] = useState("");
  const [request, setRequest] = useState<FillRequest | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<FillResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("all");
  const [previewExpanded, setPreviewExpanded] = useState(false);
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

  const filteredPreviewItems = useMemo(() => {
    if (!preview) return [];
    if (previewFilter === "attention") {
      return preview.items.filter((item) => item.status === "review" || item.status === "error");
    }
    return preview.items;
  }, [preview, previewFilter]);

  const visiblePreviewItems = useMemo(
    () => previewExpanded ? filteredPreviewItems : filteredPreviewItems.slice(0, PREVIEW_LIMIT),
    [filteredPreviewItems, previewExpanded],
  );

  const problemResults = useMemo(
    () => result?.fields.filter((item) => item.status === "review" || item.status === "error") ?? [],
    [result],
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
      setPreviewExpanded(false);
      setPreviewFilter("all");
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

  const applyParsedPreview = async (text: string): Promise<void> => {
    if (!manifest) throw new Error("Сначала проанализируйте текущую форму.");
    const parsed = parseFillRequest(text);
    const nextPreview = await callTab<PreviewResult>("preview", parsed);
    setJsonText(text);
    setRequest(parsed);
    setPreview(nextPreview);
    setResult(null);
    setPreviewExpanded(false);
    setPreviewFilter(nextPreview.counts.review + nextPreview.counts.error > 0 ? "attention" : "all");
    setStatus(
      `JSON распознан: ${nextPreview.counts.ok + nextPreview.counts.same} готово, ${nextPreview.counts.review} проверить, ${nextPreview.counts.error} ошибок.`,
    );
  };

  const parseAndPreview = (text: string) => run(() => applyParsedPreview(text));

  const pasteClipboard = () =>
    run(async () => {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("Буфер обмена пуст.");
      await applyParsedPreview(text);
    });

  const fill = () =>
    run(async () => {
      if (!manifest || !request || !preview) throw new Error("Сначала загрузите JSON и проверьте preview.");
      if (preview.pageMismatch) throw new Error("Fingerprint страницы отличается. Выполните анализ заново и получите новый JSON.");
      if (preview.counts.error > 0) throw new Error("В preview есть ошибки. Исправьте JSON перед заполнением.");

      const next = await callTab<FillResult>("fill", request);
      setResult(next);
      setHistory(await saveHistory(manifest, next));
      setStatus(
        `Заполнение завершено: ${next.filled} изменено, ${next.same} уже совпадало, ${next.review} проверить, ${next.errors} ошибок.`,
      );
    });

  const undo = () =>
    run(async () => {
      const undoResult = await callTab<UndoResult>("undo");
      setResult(null);
      setStatus(`Отменено изменений: ${undoResult.restored}. Ошибок: ${undoResult.errors}.`);
    });

  const copyResultForGpt = () =>
    run(async () => {
      if (!manifest || !result) throw new Error("Нет результата заполнения для отчёта.");
      await navigator.clipboard.writeText(stringifyGptFeedbackReport(manifest, result));
      setStatus("Отчёт о проблемных Fxx скопирован для ChatGPT. Защищённые поля исключены.");
    });

  const clearHistory = () =>
    run(async () => {
      await browser.storage.local.remove("history");
      setHistory([]);
      setStatus("Локальная история операций очищена.");
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
    void loadHistory().then(setHistory);
  }, []);

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

      {error && <div class="card error" role="alert">{error}</div>}

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
          <div class="section-head">
            <strong>Предварительный просмотр</strong>
            <div class="segmented" aria-label="Фильтр preview">
              <button
                class={previewFilter === "all" ? "selected" : ""}
                onClick={() => { setPreviewFilter("all"); setPreviewExpanded(false); }}
              >Все {preview.items.length}</button>
              <button
                class={previewFilter === "attention" ? "selected" : ""}
                onClick={() => { setPreviewFilter("attention"); setPreviewExpanded(false); }}
              >Требуют внимания {preview.counts.review + preview.counts.error}</button>
            </div>
          </div>

          {preview.pageMismatch && (
            <div class="status warning-text">
              ⚠ JSON создан для другой версии страницы. Текущий fingerprint: {preview.pageFingerprint}
            </div>
          )}

          {visiblePreviewItems.length ? (
            <div class="preview">
              {visiblePreviewItems.map((item) => (
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
          ) : (
            <p class="small empty-state">Нет полей, требующих внимания.</p>
          )}

          {!previewExpanded && filteredPreviewItems.length > PREVIEW_LIMIT && (
            <button class="text-button" onClick={() => setPreviewExpanded(true)}>
              Показать остальные {filteredPreviewItems.length - PREVIEW_LIMIT}
            </button>
          )}

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
          <div class="section-head">
            <strong>Заполнение завершено</strong>
            <span class="small">{result.completedAt ? historyTime(result.completedAt) : ""}</span>
          </div>
          <div class="result-metrics">
            <span>✓ <strong>{result.filled}</strong> изменено</span>
            <span>= <strong>{result.same}</strong> совпадало</span>
            <span>⚠ <strong>{result.review}</strong> проверить</span>
            <span>✕ <strong>{result.errors}</strong> ошибок</span>
          </div>
          {result.newFieldCount > 0 && (
            <p class="status">После заполнения появилось новых полей: {result.newFieldCount}. Выполните анализ повторно.</p>
          )}
          {problemResults.length > 0 && (
            <div class="problem-list">
              {problemResults.map((item) => (
                <div class="problem-item" key={item.id}>
                  <strong>{item.id} — {item.label}</strong>
                  <span>{item.message ?? (item.status === "review" ? "Требуется проверка." : "Не удалось заполнить поле.")}</span>
                </div>
              ))}
            </div>
          )}
          <div class="actions two" style="margin-top:8px">
            <button class="danger" disabled={busy} onClick={undo}>Отменить изменения</button>
            <button disabled={busy} onClick={copyResultForGpt}>Скопировать отчёт для GPT</button>
          </div>
        </section>
      )}

      <section class="card status" aria-live="polite">{status}</section>

      <details class="card">
        <summary>Дополнительно</summary>
        <div class="details-body">
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
            <p class="small">Недоступных cross-origin iframe: {manifest.unsupportedCrossOriginFrames}.</p>
          ) : null}
          {manifest && <p class="small">Fingerprint: {manifest.pageFingerprint}</p>}
        </div>
      </details>

      <details class="card">
        <summary>История ({history.length})</summary>
        <div class="details-body">
          {history.length ? (
            <div class="history-list">
              {history.map((entry, index) => (
                <div class="history-item" key={`${entry.timestamp}-${index}`}>
                  <div>
                    <strong>{entry.page}</strong>
                    <span>{historyTime(entry.timestamp)}</span>
                  </div>
                  <div class="history-stats">
                    {entry.successful}/{entry.fields} ✓
                    {entry.review > 0 && <> · {entry.review} ⚠</>}
                    {entry.errors > 0 && <> · {entry.errors} ✕</>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p class="small empty-state">История пока пуста. Значения полей здесь не сохраняются.</p>
          )}
          {history.length > 0 && (
            <button class="text-button danger" disabled={busy} onClick={clearHistory}>Очистить историю</button>
          )}
        </div>
      </details>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
