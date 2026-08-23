import type { FillRequest, RpcResponse } from "../shared/types";
import { scanDocument, type ScanState } from "./scanner";
import { previewFill } from "./preview";
import { fillRequest, undoLast } from "./filler";
import { setOverlayHandles, setOverlayVisible, toggleOverlay } from "./overlay";

declare global {
  interface Window {
    __FORMFILL_ASSIST_LOADED__?: boolean;
  }
}

if (!window.__FORMFILL_ASSIST_LOADED__) {
  window.__FORMFILL_ASSIST_LOADED__ = true;

  let mutationRevision = 0;
  let state: ScanState | null = null;
  let observerTimer: number | undefined;

  const scan = (showOverlay = true): ScanState => {
    state = scanDocument(mutationRevision);
    setOverlayHandles(state.handles);
    if (showOverlay) setOverlayVisible(true);
    return state;
  };

  const observer = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      if (record.type === "childList") return record.addedNodes.length > 0 || record.removedNodes.length > 0;
      return ["disabled", "readonly", "aria-disabled", "aria-hidden", "role"].includes(record.attributeName ?? "");
    });
    if (!relevant) return;

    clearTimeout(observerTimer);
    observerTimer = window.setTimeout(() => {
      mutationRevision += 1;
    }, 180);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "readonly", "aria-disabled", "aria-hidden", "role"],
  });

  browser.runtime.onMessage.addListener(async (message: unknown): Promise<RpcResponse> => {
    if (!message || typeof message !== "object" || !("action" in message)) return { ok: false, error: "Некорректная команда." };
    const action = (message as { action: string }).action;
    const payload = (message as { payload?: unknown }).payload;

    try {
      if (action === "ping") return { ok: true, data: "pong" };
      if (action === "scan") return { ok: true, data: scan(true).manifest };
      if (action === "toggleOverlay") {
        if (!state) scan(false);
        return { ok: true, data: toggleOverlay() };
      }

      if (!state) scan(false);

      if (action === "preview") {
        return { ok: true, data: previewFill(state!, payload as FillRequest) };
      }
      if (action === "fill") {
        const result = await fillRequest(state!, payload as FillRequest, mutationRevision);
        state = scanDocument(mutationRevision);
        setOverlayHandles(state.handles);
        return { ok: true, data: result };
      }
      if (action === "undo") {
        const result = await undoLast(state!);
        state = scanDocument(mutationRevision);
        setOverlayHandles(state.handles);
        return { ok: true, data: result };
      }

      return { ok: false, error: `Неизвестная команда: ${action}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Ошибка content script." };
    }
  });
}
