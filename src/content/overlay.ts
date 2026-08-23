import type { FieldHandle } from "./scanner";

const ROOT_ID = "__formfill_assist_overlay__";
let visible = false;
let currentHandles = new Map<string, FieldHandle>();
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

    const badge = document.createElement("span");
    badge.textContent = handle.id;
    badge.title = handle.descriptor.sensitive ? "Защищённое поле" : handle.descriptor.label;
    Object.assign(badge.style, {
      position: "fixed",
      left: `${Math.min(innerWidth - 38, Math.max(2, rect.right + 4))}px`,
      top: `${Math.min(innerHeight - 22, Math.max(2, rect.top))}px`,
      padding: "2px 5px",
      borderRadius: "4px",
      background: handle.descriptor.sensitive ? "#6b7280" : "#1f6feb",
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
