import type { FieldHandle } from "./scanner";

const ROOT_ID = "__formfill_assist_overlay__";
let visible = false;
let currentHandles = new Map<string, FieldHandle>();
let problemStatuses = new Map<string, "review" | "error">();
let scheduled = false;

function topViewportRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  let currentWindow = element.ownerDocument.defaultView;

  while (currentWindow && currentWindow !== currentWindow.parent) {
    let frame: Element | null = null;
    try {
      frame = currentWindow.frameElement;
    } catch {
      break;
    }
    if (!frame) break;

    const frameRect = frame.getBoundingClientRect();
    left += frameRect.left;
    top += frameRect.top;
    currentWindow = frame.ownerDocument.defaultView;
  }

  return new DOMRect(left, top, rect.width, rect.height);
}

function ensureRoot(): HTMLDivElement {
  let root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483647",
      fontFamily: "system-ui, sans-serif",
    });
    document.documentElement.append(root);
  }
  return root;
}

function appendProblemFrame(root: HTMLDivElement, rect: DOMRect, status: "review" | "error"): void {
  const frame = document.createElement("div");
  const color = status === "error" ? "#dc2626" : "#d97706";
  const background = status === "error" ? "rgba(220,38,38,.08)" : "rgba(217,119,6,.08)";
  Object.assign(frame.style, {
    position: "fixed",
    left: `${Math.max(0, rect.left - 3)}px`,
    top: `${Math.max(0, rect.top - 3)}px`,
    width: `${Math.max(6, rect.width + 6)}px`,
    height: `${Math.max(6, rect.height + 6)}px`,
    border: `2px solid ${color}`,
    borderRadius: "6px",
    background,
    boxShadow: `0 0 0 1px rgba(255,255,255,.55), 0 0 0 3px ${background}`,
    pointerEvents: "none",
  });
  root.append(frame);
}

function render(): void {
  scheduled = false;
  const root = ensureRoot();
  root.replaceChildren();
  root.style.display = visible ? "block" : "none";
  if (!visible) return;

  for (const handle of currentHandles.values()) {
    const element = handle.elements[0];
    if (!element) continue;
    const rect = topViewportRect(element);
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;

    const problemStatus = problemStatuses.get(handle.id);
    if (problemStatus) appendProblemFrame(root, rect, problemStatus);

    const badge = document.createElement("span");
    badge.textContent = handle.id;
    badge.title = handle.descriptor.sensitive ? "Защищённое поле" : handle.descriptor.label;
    const badgeBackground =
      problemStatus === "error"
        ? "#dc2626"
        : problemStatus === "review"
          ? "#d97706"
          : handle.descriptor.sensitive
            ? "#6b7280"
            : "#1f6feb";
    Object.assign(badge.style, {
      position: "fixed",
      left: `${Math.min(innerWidth - 38, Math.max(2, rect.right + 4))}px`,
      top: `${Math.min(innerHeight - 22, Math.max(2, rect.top))}px`,
      padding: "2px 5px",
      borderRadius: "4px",
      background: badgeBackground,
      color: "#fff",
      fontSize: "11px",
      fontWeight: "700",
      lineHeight: "16px",
      boxShadow: "0 1px 4px rgba(0,0,0,.35)",
      pointerEvents: "none",
    });
    root.append(badge);
  }
}

function scheduleRender(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(render);
}

export function setOverlayHandles(handles: Map<string, FieldHandle>): void {
  currentHandles = handles;
  scheduleRender();
}

export function setOverlayProblemStatuses(problems: Array<{ id: string; status: "review" | "error" }>): number {
  problemStatuses = new Map(problems.map((problem) => [problem.id, problem.status]));
  scheduleRender();
  return problemStatuses.size;
}

export function clearOverlayProblems(): void {
  if (!problemStatuses.size) return;
  problemStatuses.clear();
  scheduleRender();
}

export function setOverlayVisible(nextVisible: boolean): boolean {
  visible = nextVisible;
  scheduleRender();
  return visible;
}

export function toggleOverlay(): boolean {
  return setOverlayVisible(!visible);
}

addEventListener("scroll", scheduleRender, true);
addEventListener("resize", scheduleRender);
