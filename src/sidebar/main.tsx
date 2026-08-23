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
import {
  FORM_SESSION_STORAGE_KEY,
  acceptManifestInSession,
  createFormSession,
  currentSessionPage,
  isFormSessionExpired,
  normalizeSessionFillRequest,
  qualifySessionFieldId,
  recordSessionFillResult,
  relationToSession,
  sessionMatchesManifest,
  type FormSession,
} from "../shared/session";

const STATUS_LABEL: Record<PreviewItem["status"], string> = {
  ok: "✓ готово",
  review: "⚠ проверить",
  error: "✕ ошибка",
  same: "= совпадает",
  skip: "пропуск",
};

const PREVIEW_LIMIT = 40;

type PreviewFilter = "all" | "attention";
type TabAction = "ping" | "scan" | "toggleOverlay" | "highlightProblems" | "preview" | "fill" | "undo";

async function callTab<T>(action: TabAction, payload?: unknown): Promise<T> {
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

async function loadActiveSession(): Promise<FormSession | null> {
  const stored = await browser.storage.local.get(FORM_SESSION_STORAGE_KEY);
  const candidate = stored[FORM_SESSION_STORAGE_KEY] as FormSession | undefined;
  if (!candidate || candidate.version !== 1 || typeof candidate.id !== "string" || !Array.isArray(candidate.pages)) {
    return null;
  }
  if (isFormSessionExpired(candidate)) {
    await browser.storage.local.remove(FORM_SESSION_STORAGE_KEY);
    return null;
  }
  return candidate;
}

async function persistActiveSession(session: FormSession | null): Promise<void> {
  if (session) {
    await browser.storage.local.set({ [FORM_SESSION_STORAGE_KEY]: session });
  } else {
    await browser.storage.local.remove(FORM_SESSION_STORAGE_KEY);
  }
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
  const [session, setSession] = useState<FormSession | null>(null);
  const [sessionCandidate, setSessionCandidate] = useState<FormManifest | null>(null);
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
  const sessionPage = useMemo(() => (session ? currentSessionPage(session) : null), [session]);

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

  const displayFieldId = (fieldId: string): string =>
    sessionPage && manifest && session && sessionMatchesManifest(session, manifest)
      ? qualifySessionFieldId(sessionPage.pageNumber, fieldId)
      : fieldId;

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

  const ensurePageNotChanged = async (): Promise<void> => {
    const ping = await callTab<{ status?: string }>("ping");
    if (ping?.status === "PAGE_CHANGED") {
      throw new Error("Страница изменилась. Нажмите «Анализировать» перед продолжением.");
    }
  };

  const analyze = () =>
    run(async () => {
      const next = await callTab<FormManifest>("scan");
      setManifest(next);
      setPreview(null);
      setRequest(null);
      setResult(null);
      setPreviewExpanded(false);
      setPreviewFilter("all");

      if (session) {
        const relation = relationToSession(session, next);
        if (relation.kind === "current") {
          setSessionCandidate(null);
          setStatus(`Сессия: страница ${relation.page.pageNumber}. Найдено полей: ${next.fields.length}.`);
          return;
        }

        setSessionCandidate(next);
        const targetPage = relation.kind === "known" ? relation.page.pageNumber : relation.suggestedPage;
        setStatus(
          relation.kind === "known"
            ? `Обнаружена ранее посещённая страница ${targetPage}. Подтвердите переход в текущей сессии.`
            : `Обнаружена новая форма. Можно продолжить текущую сессию как страницу ${targetPage}.`,
        );
        return;
      }

      setSessionCandidate(null);
      setStatus(`Найдено полей: ${next.fields.length}. Идентификаторы Fxx показаны на странице.`);
    });

  const startSession = () =>
    run(async () => {
      if (!manifest) throw new Error("Сначала проанализируйте первую страницу формы.");
      const next = acceptManifestInSession(createFormSession(), manifest);
      await persistActiveSession(next);
      setSession(next);
      setSessionCandidate(null);
      setPreview(null);
      setRequest(null);
      setResult(null);
      setStatus("Многостраничная сессия начата. Текущая форма — страница 1.");
    });

  const continueSession = () =>
    run(async () => {
      if (!session || !sessionCandidate) throw new Error("Нет новой страницы для продолжения сессии.");
      const next = acceptManifestInSession(session, sessionCandidate);
      await persistActiveSession(next);
      setSession(next);
      setSessionCandidate(null);
      setPreview(null);
      setRequest(null);
      setResult(null);
      const page = currentSessionPage(next);
      setStatus(`Сессия продолжена: страница ${page?.pageNumber ?? next.currentPage}.`);
    });

  const endSession = () =>
    run(async () => {
      await persistActiveSession(null);
      setSession(null);
      setSessionCandidate(null);
      setPreview(null);
      setRequest(null);
      setResult(null);
      setStatus("Многостраничная сессия завершена. Текущие значения полей не сохранялись.");
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
      await ensurePageNotChanged();
      if (sessionCandidate) throw new Error("Сначала подтвердите продолжение сессии на этой странице или завершите сессию.");

      if (session) {
        const page = currentSessionPage(session);
        if (!page || !sessionMatchesManifest(session, manifest)) {
          throw new Error("Текущая форма не привязана к активной странице сессии.");
        }
        await navigator.clipboard.writeText(
          makeGptPacket(manifest, { sessionId: session.id, pageNumber: page.pageNumber }),
        );
        setStatus(`Промпт страницы ${page.pageNumber} с идентификаторами P${page.pageNumber}-Fxx скопирован для ИИ.`);
        return;
      }

      await navigator.clipboard.writeText(makeGptPacket(manifest));
      setStatus("Динамический промпт и manifest текущей формы скопированы для ИИ.");
    });

  const applyParsedPreview = async (text: string): Promise<void> => {
    if (!manifest) throw new Error("Сначала проанализируйте текущую форму.");
    await ensurePageNotChanged();
    if (sessionCandidate) throw new Error("Сначала подтвердите продолжение сессии на этой странице или завершите сессию.");

    const parsed = parseFillRequest(text);
    const localRequest = session ? normalizeSessionFillRequest(parsed, session, manifest) : parsed;
    const nextPreview = await callTab<PreviewResult>("preview", localRequest);
    setJsonText(text);
    setRequest(localRequest);
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
      await ensurePageNotChanged();
      if (sessionCandidate) throw new Error("Сначала подтвердите текущую страницу сессии.");
      if (preview.pageMismatch) throw new Error("Fingerprint страницы отличается. Выполните анализ заново и получите новый JSON.");
      if (preview.counts.error > 0) throw new Error("В preview есть ошибки. Исправьте JSON перед заполнением.");

      const next = await callTab<FillResult>("fill", request);
      setResult(next);
      setHistory(await saveHistory(manifest, next));

      if (session) {
        const updatedSession = recordSessionFillResult(session, manifest, next);
        await persistActiveSession(updatedSession);
        setSession(updatedSession);
      }

      setStatus(
        `Заполнение завершено: ${next.filled} изменено, ${next.same} уже совпадало, ${next.review} проверить, ${next.errors} ошибок.`,
      );
    });

  const undo = () =>
    run(async () => {
      await ensurePageNotChanged();
      const undoResult = await callTab<UndoResult>("undo");
      setResult(null);
      setStatus(`Отменено изменений: ${undoResult.restored}. Ошибок: ${undoResult.errors}.`);
    });

  const copyResultForGpt = () =>
    run(async () => {
      if (!manifest || !result) throw new Error("Нет результата заполнения для отчёта.");
      const page = session ? currentSessionPage(session) : null;
      const options = page && sessionMatchesManifest(session!, manifest)
        ? {
            mapId: (id: string) => qualifySessionFieldId(page.pageNumber, id),
            session: { id: session!.id, page: page.pageNumber },
          }
        : undefined;
      await navigator.clipboard.writeText(stringifyGptFeedbackReport(manifest, result, options));
      setStatus("Privacy-safe отчёт о проблемных полях скопирован для ИИ. Защищённые поля исключены.");
    });

  const highlightProblems = () =>
    run(async () => {
      if (!problemResults.length) throw new Error("Нет проблемных полей для подсветки.");
      const count = await callTab<number>(
        "highlightProblems",
        problemResults.map((item) => ({
          id: item.id,
          status: item.status === "error" ? "error" as const : "review" as const,
        })),
      );
      setOverlayVisible(true);
      setStatus(`Подсвечено проблемных полей: ${count}. Красные — ошибки, жёлтые — требуют проверки.`);
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
    void Promise.all([loadHistory(), loadActiveSession()]).then(([storedHistory, storedSession]) => {
      setHistory(storedHistory);
      setSession(storedSession);
      if (storedSession) {
        const page = currentSessionPage(storedSession);
        setStatus(`Восстановлена локальная сессия${page ? `, страница ${page.pageNumber}` : ""}. Проанализируйте текущую форму.`);
      }
    });
  }, []);

  useEffect(() => {
    void handlePendingCommand();
    const listener = (changes: Record<string, browser.storage.StorageChange>, area: string) => {
      if (area === "local" && changes.pendingCommand?.newValue) void handlePendingCommand();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [manifest, request, preview, session, sessionCandidate]);

  return (
    <main class="app">
      <header class="header">
        <div>
          <div class="title">FormFill Assistant</div>
          <div class="small">ИИ → JSON → preview → безопасное заполнение</div>
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

      <section class={`card session-card ${sessionCandidate ? "warning" : ""}`}>
        {session ? (
          <>
            <div class="section-head">
              <div>
                <strong>Многостраничная сессия</strong>
                <div class="small">
                  {sessionPage ? `Страница ${sessionPage.pageNumber}` : "Ожидается первая страница"} · {session.pages.length} стр. · {session.id.slice(0, 8)}
                </div>
              </div>
              <button class="text-button danger compact" disabled={busy} onClick={endSession}>Завершить</button>
            </div>

            {sessionCandidate && (
              <div class="session-candidate">
                <strong>Обнаружена другая форма</strong>
                <p class="small">Она не станет следующей страницей сессии без вашего подтверждения.</p>
                <button class="primary" disabled={busy} onClick={continueSession}>Продолжить текущую сессию</button>
              </div>
            )}

            {session.pages.length > 0 && (
              <div class="session-pages">
                {session.pages.map((page) => (
                  <span class={page.pageNumber === session.currentPage ? "selected" : ""} key={page.pageNumber}>
                    P{page.pageNumber} · {page.fieldCount}
                    {page.completedAt ? ` · ${page.errors ? `${page.errors} ✕` : "✓"}` : ""}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div class="section-head">
            <div>
              <strong>Многостраничная анкета</strong>
              <div class="small">Опционально: P1-Fxx, P2-Fxx… без автоматического перехода между страницами.</div>
            </div>
            <button disabled={busy || !manifest} onClick={startSession}>Начать сессию</button>
          </div>
        )}
      </section>

      <section class="actions main">
        <button class="primary" disabled={busy} onClick={analyze}>1. Анализировать форму</button>
        <button disabled={busy || !manifest} onClick={toggleNumbers}>
          2. {overlayVisible ? "Скрыть Fxx" : "Показать Fxx"}
        </button>
        <button disabled={busy || !manifest || Boolean(sessionCandidate)} onClick={copyForGpt}>3. Скопировать промпт для ИИ</button>
        <button disabled={busy || !manifest || Boolean(sessionCandidate)} onClick={pasteClipboard}>4. Вставить ответ ИИ</button>
      </section>

      {preview && (
        <section class={`card ${preview.pageMismatch ? "warning" : ""}`}>
          <div class="section-head">
            <strong>Предварительная проверка</strong>
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
                  <div class="preview-id">{displayFieldId(item.id)}</div>
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
              disabled={busy || preview.pageMismatch || preview.counts.error > 0 || Boolean(sessionCandidate)}
              onClick={fill}
            >
              5. Заполнить {preview.counts.ok} безопасных полей
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
            <>
              <div class="problem-list">
                {problemResults.map((item) => (
                  <div class="problem-item" key={item.id}>
                    <strong>{displayFieldId(item.id)} — {item.label}</strong>
                    <span>{item.message ?? (item.status === "review" ? "Требуется проверка." : "Не удалось заполнить поле.")}</span>
                  </div>
                ))}
              </div>
              <div class="actions" style="margin-top:8px">
                <button disabled={busy} onClick={highlightProblems}>Подсветить проблемные</button>
              </div>
            </>
          )}
          <div class="actions two" style="margin-top:8px">
            <button class="danger" disabled={busy} onClick={undo}>Отменить изменения</button>
            <button disabled={busy} onClick={copyResultForGpt}>Скопировать отчёт для ИИ</button>
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
            <button disabled={busy || !jsonText.trim() || Boolean(sessionCandidate)} onClick={() => parseAndPreview(jsonText)}>
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
