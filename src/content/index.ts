import type { FillRequest, RpcResponse } from "../shared/types";
import {
  discoverObservationRoots,
  scanDocument,
  type ObservationRoot,
  type ScanState,
} from "./scanner";
import { previewFill } from "./preview";
import { fillRequest, undoLast } from "./filler";
import { setOverlayHandles, setOverlayVisible, toggleOverlay } from "./overlay";

declare global {
  interface Window {
    __FORMFILL_ASSIST_LOADED__?: boolean;
  }
}

const OVERLAY_ID = "__formfill_assist_overlay__";
const OBSERVED_ATTRIBUTES = [
  "disabled",
  "readonly",
  "required",
  "aria-disabled",
  "aria-hidden",
  "aria-label",
  "aria-labelledby",
  "aria-required",
  "role",
  "type",
  "name",
  "id",
  "placeholder",
];

if (!window.__FORMFILL_ASSIST_LOADED__) {
  window.__FORMFILL_ASSIST_LOADED__ = true;

  let mutationRevision = 0;
  let state: ScanState | null = null;
  let observerTimer: number | undefined;
  let routeInvalidated = false;
  let currentUrl = location.href;
  let observers: MutationObserver[] = [];

  const nodeInsideOverlay = (node: Node): boolean => {
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    if (!element) return false;
    if (element.id === OVERLAY_ID) return true;
    return Boolean(element.closest?.(`#${OVERLAY_ID}`));
  };

  const isRelevantMutation = (record: MutationRecord): boolean => {
    if (nodeInsideOverlay(record.target)) return false;
    if (record.type === "attributes") return OBSERVED_ATTRIBUTES.includes(record.attributeName ?? "");
    if (record.type !== "childList") return false;

    const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    return changed.some((node) => !nodeInsideOverlay(node));
  };

  const observerTarget = (root: ObservationRoot): Node | null => {
    if ("documentElement" in root) return root.documentElement;
    return root;
  };

  const disconnectObservers = (): void => {
    for (const observer of observers) observer.disconnect();
    observers = [];
  };

  const rebindObservers = (): void => {
    disconnectObservers();
    const discovery = discoverObservationRoots();

    for (const root of discovery.roots) {
      const target = observerTarget(root);
      if (!target) continue;
      const view = target.ownerDocument?.defaultView;
      const ObserverCtor = view?.MutationObserver;
      if (!ObserverCtor) continue;

      const observer = new ObserverCtor((records) => {
        if (!records.some(isRelevantMutation)) return;
        clearTimeout(observerTimer);
        observerTimer = window.setTimeout(() => {
          mutationRevision += 1;
          if (state && !routeInvalidated) {
            state = scanDocument(mutationRevision);
            setOverlayHandles(state.handles);
          }
          rebindObservers();
        }, 180);
      });
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: OBSERVED_ATTRIBUTES,
      });
      observers.push(observer);
    }
  };

  const scan = (showOverlay = true, acceptRoute = false): ScanState => {
    state = scanDocument(mutationRevision);
    setOverlayHandles(state.handles);
    rebindObservers();
    if (acceptRoute) routeInvalidated = false;
    if (showOverlay) setOverlayVisible(true);
    return state;
  };

  const ensureFreshState = (): ScanState => {
    if (!state || state.manifest.mutationRevision !== mutationRevision) return scan(false, false);
    return state;
  };

  const markRouteChanged = (): void => {
    const nextUrl = location.href;
    if (nextUrl === currentUrl) return;
    currentUrl = nextUrl;
    mutationRevision += 1;
    routeInvalidated = true;
    state = null;
    setOverlayHandles(new Map());
    rebindObservers();
  };

  const originalPushState = history.pushState.bind(history);
  history.pushState = (data: unknown, unused: string, url?: string | URL | null): void => {
    originalPushState(data, unused, url);
    queueMicrotask(markRouteChanged);
  };

  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (data: unknown, unused: string, url?: string | URL | null): void => {
    originalReplaceState(data, unused, url);
    queueMicrotask(markRouteChanged);
  };

  addEventListener("popstate", () => queueMicrotask(markRouteChanged));
  addEventListener("hashchange", () => queueMicrotask(markRouteChanged));
  rebindObservers();

  browser.runtime.onMessage.addListener(async (message: unknown): Promise<RpcResponse> => {
    if (!message || typeof message !== "object" || !("action" in message)) {
      return { ok: false, error: "Некорректная команда." };
    }
    const action = (message as { action: string }).action;
    const payload = (message as { payload?: unknown }).payload;

    try {
      if (action === "ping") {
        return {
          ok: true,
          data: {
            status: routeInvalidated ? "PAGE_CHANGED" : "ready",
            mutationRevision,
            url: location.href,
          },
        };
      }
      if (action === "scan") return { ok: true, data: scan(true, true).manifest };
      if (action === "toggleOverlay") {
        if (!state || routeInvalidated) scan(false, true);
        return { ok: true, data: toggleOverlay() };
      }

      if (routeInvalidated) {
        return {
          ok: false,
          error: "PAGE_CHANGED: адрес страницы изменился. Выполните анализ формы заново.",
        };
      }

      const freshState = ensureFreshState();

      if (action === "preview") {
        return { ok: true, data: previewFill(freshState, payload as FillRequest) };
      }
      if (action === "fill") {
        const result = await fillRequest(freshState, payload as FillRequest, mutationRevision);
        state = scanDocument(mutationRevision);
        setOverlayHandles(state.handles);
        rebindObservers();
        return { ok: true, data: result };
      }
      if (action === "undo") {
        const result = await undoLast(freshState);
        state = scanDocument(mutationRevision);
        setOverlayHandles(state.handles);
        rebindObservers();
        return { ok: true, data: result };
      }

      return { ok: false, error: `Неизвестная команда: ${action}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Ошибка content script." };
    }
  });
}
